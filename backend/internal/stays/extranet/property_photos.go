package extranet

// property_photos.go — property (and optional room-type) photo uploads for the
// hotelier extranet. A DIRECT-rail (self-listed) property had no photo storage
// at all: gateway.PropertyContent.Photos was always empty for it (see
// backend/internal/stays/adapters/direct.go), so a host-created listing could
// never actually show a picture to a guest.
//
// Mirrors the marketplace listing-media pattern exactly (backend/internal/
// marketplace/presign.go + service.go's ThumbPresigner): the R2 bucket is
// PRIVATE, so only the object KEY is stored — never a public URL. Uploading is
// presign → client PUTs the bytes straight to R2 → confirm (persist the row).
// Reading presigns a short-lived GET for each stored key at request time.

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/platform/r2"
)

// photoPresignTTL bounds how long an issued upload URL is valid.
const photoPresignTTL = 10 * time.Minute

// photoReadTTL is how long a fetchable photo URL stays valid once presigned for
// read — long enough that a host's edit session or a guest's browse session
// never sees an image expire mid-view.
const photoReadTTL = 6 * time.Hour

var photoContentTypes = map[string]string{ // mime -> extension
	"image/png":  ".png",
	"image/jpeg": ".jpg",
	"image/webp": ".webp",
}

// PropertyPhoto is one stored photo, with a freshly-presigned read URL (never
// the bare object key — the bucket is private).
type PropertyPhoto struct {
	ID         string `json:"id"`
	RoomTypeID string `json:"room_type_id,omitempty"`
	URL        string `json:"url"`
	Caption    string `json:"caption"`
	IsCover    bool   `json:"is_cover"`
	SortOrder  int    `json:"sort_order"`
}

// --- repository ---

type propertyPhotoRow struct {
	ID         string
	RoomTypeID string
	StorageKey string
	Caption    string
	IsCover    bool
	SortOrder  int
}

func (r *Repository) ListPropertyPhotos(ctx context.Context, propertyID string) ([]propertyPhotoRow, error) {
	rows, err := r.db.Query(ctx, `
		SELECT id, COALESCE(room_type_id::text,''), storage_key, caption, is_cover, sort_order
		FROM public.stays_property_photo
		WHERE property_id = $1
		ORDER BY is_cover DESC, sort_order ASC, created_at ASC`, propertyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []propertyPhotoRow
	for rows.Next() {
		var p propertyPhotoRow
		if err := rows.Scan(&p.ID, &p.RoomTypeID, &p.StorageKey, &p.Caption, &p.IsCover, &p.SortOrder); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// CreatePropertyPhoto records an uploaded photo. The first photo a property
// gets is automatically its cover — a listing should never have zero cover
// photo once it has at least one photo.
func (r *Repository) CreatePropertyPhoto(ctx context.Context, propertyID, roomTypeID, storageKey, caption string) (propertyPhotoRow, error) {
	p := propertyPhotoRow{RoomTypeID: roomTypeID, StorageKey: storageKey, Caption: caption}
	err := r.db.QueryRow(ctx, `
		INSERT INTO public.stays_property_photo (property_id, room_type_id, storage_key, caption, is_cover, sort_order)
		VALUES ($1, NULLIF($2,'')::uuid, $3, $4,
		        NOT EXISTS (SELECT 1 FROM public.stays_property_photo WHERE property_id = $1),
		        (SELECT COALESCE(MAX(sort_order),-1)+1 FROM public.stays_property_photo WHERE property_id = $1))
		RETURNING id, is_cover, sort_order`, propertyID, roomTypeID, storageKey, caption).
		Scan(&p.ID, &p.IsCover, &p.SortOrder)
	return p, err
}

// SetCoverPhoto unsets any other cover for the property and marks this one, in
// one statement — a listing must never end up with two covers or none.
func (r *Repository) SetCoverPhoto(ctx context.Context, propertyID, photoID string) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("extranet: begin set-cover tx: %w", err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `UPDATE public.stays_property_photo SET is_cover = false WHERE property_id = $1`, propertyID); err != nil {
		return err
	}
	ct, err := tx.Exec(ctx, `UPDATE public.stays_property_photo SET is_cover = true WHERE id = $1 AND property_id = $2`, photoID, propertyID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return tx.Commit(ctx)
}

func (r *Repository) UpdatePropertyPhoto(ctx context.Context, propertyID, photoID string, caption *string, sortOrder *int) error {
	ct, err := r.db.Exec(ctx, `
		UPDATE public.stays_property_photo
		SET caption = COALESCE($3, caption),
		    sort_order = COALESCE($4, sort_order),
		    updated_at = now()
		WHERE id = $1 AND property_id = $2`, photoID, propertyID, caption, sortOrder)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// DeletePropertyPhoto removes a photo. If it was the cover, promotes the
// earliest remaining photo (by sort order) to cover so the listing is never
// left without one while it still has photos.
func (r *Repository) DeletePropertyPhoto(ctx context.Context, propertyID, photoID string) (storageKey string, err error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("extranet: begin delete-photo tx: %w", err)
	}
	defer tx.Rollback(ctx)

	var wasCover bool
	if err := tx.QueryRow(ctx, `
		DELETE FROM public.stays_property_photo WHERE id = $1 AND property_id = $2
		RETURNING storage_key, is_cover`, photoID, propertyID).Scan(&storageKey, &wasCover); err != nil {
		return "", ErrNotFound
	}
	if wasCover {
		if _, err := tx.Exec(ctx, `
			UPDATE public.stays_property_photo SET is_cover = true
			WHERE id = (SELECT id FROM public.stays_property_photo WHERE property_id = $1 ORDER BY sort_order ASC, created_at ASC LIMIT 1)`,
			propertyID); err != nil {
			return "", err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("extranet: commit delete-photo tx: %w", err)
	}
	return storageKey, nil
}

// CountPropertyPhotos backs the go-live checklist's photo requirement.
func (r *Repository) CountPropertyPhotos(ctx context.Context, propertyID string) (int, error) {
	var n int
	err := r.db.QueryRow(ctx, `SELECT count(*) FROM public.stays_property_photo WHERE property_id = $1`, propertyID).Scan(&n)
	return n, err
}

// --- service ---

// PhotoPresigner is the slice of the R2 presigner this needs, so this package
// does not take a dependency on the whole platform client (matches
// marketplace.ThumbPresigner's shape).
type PhotoPresigner interface {
	PresignPut(key, contentType string, expiry time.Duration) (string, error)
	PresignGet(key string, expiry time.Duration) (string, error)
	Configured() bool
}

// ErrUploadsNotConfigured is returned when R2 env is absent — fail closed with
// a clear error rather than a fabricated URL.
var ErrUploadsNotConfigured = fmt.Errorf("%w: photo uploads are not configured", ErrValidation)

// PresignPhotoUpload issues a presigned PUT URL for a new property photo. The
// object key is server-controlled and scoped to the property
// (stays/<propertyId>/<rand><ext>), so a client cannot overwrite another
// property's objects or smuggle a path.
func (s *Service) PresignPhotoUpload(ctx context.Context, userID, propertyID, mimeType string) (uploadURL, storageKey string, err error) {
	if err := s.guard(ctx, userID, propertyID); err != nil {
		return "", "", err
	}
	if s.photos == nil || !s.photos.Configured() {
		return "", "", ErrUploadsNotConfigured
	}
	mime := strings.ToLower(strings.TrimSpace(mimeType))
	ext, ok := photoContentTypes[mime]
	if !ok {
		return "", "", fmt.Errorf("%w: unsupported mime_type (png, jpeg, webp only)", ErrValidation)
	}
	key := "stays/" + propertyID + "/" + randToken() + ext
	url, err := s.photos.PresignPut(key, mime, photoPresignTTL)
	if err != nil {
		if err == r2.ErrNotConfigured {
			return "", "", ErrUploadsNotConfigured
		}
		return "", "", err
	}
	return url, key, nil
}

// ConfirmPhotoUpload persists the row for an object the client has already PUT
// to R2 (the presigned URL from PresignPhotoUpload). roomTypeID is optional —
// empty means a general property photo.
func (s *Service) ConfirmPhotoUpload(ctx context.Context, userID, propertyID, storageKey, roomTypeID, caption string) (*PropertyPhoto, error) {
	if err := s.guard(ctx, userID, propertyID); err != nil {
		return nil, err
	}
	if strings.TrimSpace(storageKey) == "" || !strings.HasPrefix(storageKey, "stays/"+propertyID+"/") {
		return nil, fmt.Errorf("%w: storage_key does not belong to this property", ErrValidation)
	}
	row, err := s.repo.CreatePropertyPhoto(ctx, propertyID, roomTypeID, storageKey, caption)
	if err != nil {
		return nil, err
	}
	return s.buildPhoto(row), nil
}

// ListPhotos returns the property's photos with freshly-presigned read URLs.
func (s *Service) ListPhotos(ctx context.Context, userID, propertyID string) ([]PropertyPhoto, error) {
	if err := s.guard(ctx, userID, propertyID); err != nil {
		return nil, err
	}
	rows, err := s.repo.ListPropertyPhotos(ctx, propertyID)
	if err != nil {
		return nil, err
	}
	out := make([]PropertyPhoto, 0, len(rows))
	for _, row := range rows {
		out = append(out, *s.buildPhoto(row))
	}
	return out, nil
}

func (s *Service) buildPhoto(row propertyPhotoRow) *PropertyPhoto {
	return &PropertyPhoto{
		ID: row.ID, RoomTypeID: row.RoomTypeID, Caption: row.Caption,
		IsCover: row.IsCover, SortOrder: row.SortOrder, URL: s.presignPhotoRead(row.StorageKey),
	}
}

// presignPhotoRead converts a stored object key into a fetchable URL, or ""
// when there is no presigner or signing fails. Never an error: a photo row
// that cannot currently be displayed is still worth returning (matches
// marketplace.Service.presignThumb's behaviour).
func (s *Service) presignPhotoRead(key string) string {
	if key == "" || s.photos == nil || !s.photos.Configured() {
		return ""
	}
	url, err := s.photos.PresignGet(key, photoReadTTL)
	if err != nil {
		return ""
	}
	return url
}

func (s *Service) SetCoverPhoto(ctx context.Context, userID, propertyID, photoID string) error {
	if err := s.guard(ctx, userID, propertyID); err != nil {
		return err
	}
	return s.repo.SetCoverPhoto(ctx, propertyID, photoID)
}

func (s *Service) UpdatePhoto(ctx context.Context, userID, propertyID, photoID string, caption *string, sortOrder *int) error {
	if err := s.guard(ctx, userID, propertyID); err != nil {
		return err
	}
	return s.repo.UpdatePropertyPhoto(ctx, propertyID, photoID, caption, sortOrder)
}

func (s *Service) DeletePhoto(ctx context.Context, userID, propertyID, photoID string) error {
	if err := s.guard(ctx, userID, propertyID); err != nil {
		return err
	}
	// The R2 object itself is left in place (best-effort cleanup is a later
	// increment — see marketplace's own media lifecycle for precedent); deleting
	// the row is what removes it from the listing, which is the part a host
	// actually observes.
	_, err := s.repo.DeletePropertyPhoto(ctx, propertyID, photoID)
	return err
}

func randToken() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// --- handler ---

// PresignPhoto: POST /properties/:propertyId/photos/presign {mime_type}
func (h *Handler) PresignPhoto(c *gin.Context) {
	var b struct {
		MimeType string `json:"mime_type" binding:"required"`
	}
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	uploadURL, key, err := h.svc.PresignPhotoUpload(c.Request.Context(), uid(c), c.Param("propertyId"), b.MimeType)
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"upload_url": uploadURL, "storage_key": key, "method": "PUT",
		"expires_in": int(photoPresignTTL.Seconds()),
	}})
}

// CreatePhoto: POST /properties/:propertyId/photos {storage_key, room_type_id?, caption?}
// Confirms an upload already PUT to the presigned URL above.
func (h *Handler) CreatePhoto(c *gin.Context) {
	var b struct {
		StorageKey string `json:"storage_key" binding:"required"`
		RoomTypeID string `json:"room_type_id"`
		Caption    string `json:"caption"`
	}
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	photo, err := h.svc.ConfirmPhotoUpload(c.Request.Context(), uid(c), c.Param("propertyId"), b.StorageKey, b.RoomTypeID, b.Caption)
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": photo})
}

// ListPhotos: GET /properties/:propertyId/photos
func (h *Handler) ListPhotos(c *gin.Context) {
	out, err := h.svc.ListPhotos(c.Request.Context(), uid(c), c.Param("propertyId"))
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// UpdatePhoto: PATCH /properties/:propertyId/photos/:photoId {caption?, sort_order?, is_cover?}
// is_cover=true is handled as its own transactional "make this the cover" op;
// other fields are a plain field patch.
func (h *Handler) UpdatePhoto(c *gin.Context) {
	var b struct {
		Caption   *string `json:"caption"`
		SortOrder *int    `json:"sort_order"`
		IsCover   *bool   `json:"is_cover"`
	}
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	propertyID, photoID := c.Param("propertyId"), c.Param("photoId")
	if b.IsCover != nil && *b.IsCover {
		if err := h.svc.SetCoverPhoto(c.Request.Context(), uid(c), propertyID, photoID); err != nil {
			mapErr(c, err)
			return
		}
	}
	if b.Caption != nil || b.SortOrder != nil {
		if err := h.svc.UpdatePhoto(c.Request.Context(), uid(c), propertyID, photoID, b.Caption, b.SortOrder); err != nil {
			mapErr(c, err)
			return
		}
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"ok": true}})
}

// DeletePhoto: DELETE /properties/:propertyId/photos/:photoId
func (h *Handler) DeletePhoto(c *gin.Context) {
	if err := h.svc.DeletePhoto(c.Request.Context(), uid(c), c.Param("propertyId"), c.Param("photoId")); err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"ok": true}})
}
