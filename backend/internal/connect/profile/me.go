package connectprofile

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"path"
	"strings"
	"time"

	"spotlight/backend/go-common/cryptox"
	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	"spotlight/backend/internal/platform/r2"

	"github.com/gin-gonic/gin"
)

const (
	photoPresignTTL = 10 * time.Minute
	photoViewTTL    = 60 * time.Minute
)

// mediaKeyPrefix is the only R2 prefix a member may reference for their own
// media. Keys are minted by PresignMedia, so anything else is rejected.
func mediaKeyPrefix(userID string) string { return "connect/profile/" + userID + "/" }

var photoAllowedContentTypes = map[string]string{
	"image/jpeg": ".jpg",
	"image/png":  ".png",
	"image/webp": ".webp",
}

var photoAllowedExt = map[string]bool{".jpg": true, ".jpeg": true, ".png": true, ".webp": true}

// WithPresigner lets the service mint upload URLs and sign stored object keys
// back into viewable URLs (the R2 bucket is not public). Without it stored values
// are passed through, which is correct for photos registered as plain URLs.
func (s *Service) WithPresigner(p *r2.Presigner) *Service {
	s.presigner = p
	return s
}

// Photo is one profile photo as its owner sees it (any moderation status).
type Photo struct {
	ID               string `json:"id"`
	URL              string `json:"url"`
	ModerationStatus string `json:"moderation_status"`
	SortOrder        int    `json:"sort_order"`
}

// FullProfile is everything the owner's own profile screen needs in one read.
type FullProfile struct {
	*Profile
	Modes  []Mode  `json:"modes"`
	Photos []Photo `json:"photos"`
}

// resolveMedia turns a stored value into something a client can render. A URL is
// returned as-is; an object key becomes a short-lived signed GET. Failures return
// the stored value unchanged: a photo that cannot be signed must not stop the
// member seeing the rest of their profile.
func (s *Service) resolveMedia(stored string) string {
	if strings.Contains(stored, "://") || s.presigner == nil || !s.presigner.Configured() {
		return stored
	}
	u, err := s.presigner.PresignGet(stored, photoViewTTL)
	if err != nil {
		return stored
	}
	return u
}

// ListPhotos returns the caller's photos in display order.
func (s *Service) ListPhotos(ctx context.Context, userID string) ([]Photo, error) {
	p, err := s.GetOrCreate(ctx, userID)
	if err != nil {
		return nil, err
	}
	const q = `SELECT id, url, moderation_status, sort_order
		FROM connect_profile_media
		WHERE profile_id = $1 AND kind = 'photo'
		ORDER BY sort_order, created_at, id`
	rows, err := s.db.Query(ctx, q, p.ID)
	if err != nil {
		return nil, fmt.Errorf("connect: list photos: %w", err)
	}
	defer rows.Close()
	out := []Photo{}
	for rows.Next() {
		var ph Photo
		if err := rows.Scan(&ph.ID, &ph.URL, &ph.ModerationStatus, &ph.SortOrder); err != nil {
			return nil, err
		}
		ph.URL = s.resolveMedia(ph.URL)
		out = append(out, ph)
	}
	return out, rows.Err()
}

// GetMe assembles the caller's complete profile: details, per-mode state, photos.
func (s *Service) GetMe(ctx context.Context, userID string) (*FullProfile, error) {
	p, err := s.GetOrCreate(ctx, userID)
	if err != nil {
		return nil, err
	}
	modes, err := s.GetModes(ctx, userID)
	if err != nil {
		return nil, err
	}
	if modes == nil {
		modes = []Mode{}
	}
	photos, err := s.ListPhotos(ctx, userID)
	if err != nil {
		return nil, err
	}
	return &FullProfile{Profile: p, Modes: modes, Photos: photos}, nil
}

// ErrMediaNotFound is returned when a media id is not the caller's.
var ErrMediaNotFound = errors.New("connect: media not found")

// DeleteMedia removes one of the caller's media items. The row is matched
// through the caller's profile, so another member's id is simply "not found".
func (s *Service) DeleteMedia(ctx context.Context, userID, mediaID string) error {
	p, err := s.GetOrCreate(ctx, userID)
	if err != nil {
		return err
	}
	tag, err := s.db.Exec(ctx,
		`DELETE FROM connect_profile_media WHERE id = $1 AND profile_id = $2`, mediaID, p.ID)
	if err != nil {
		return fmt.Errorf("connect: delete media: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrMediaNotFound
	}
	return nil
}

// ErrBadOrder is returned when a reorder request does not list exactly the
// caller's photos.
var ErrBadOrder = errors.New("connect: order must list each of your photos exactly once")

// ReorderPhotos sets display order. The first id becomes the primary photo. The
// list must be exactly the caller's photo set so a partial or foreign list can
// never silently drop or hijack a photo.
func (s *Service) ReorderPhotos(ctx context.Context, userID string, ids []string) error {
	p, err := s.GetOrCreate(ctx, userID)
	if err != nil {
		return err
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	rows, err := tx.Query(ctx,
		`SELECT id FROM connect_profile_media WHERE profile_id = $1 AND kind = 'photo' FOR UPDATE`, p.ID)
	if err != nil {
		return fmt.Errorf("connect: lock photos: %w", err)
	}
	have := map[string]bool{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		have[id] = true
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	if len(ids) != len(have) {
		return ErrBadOrder
	}
	seen := map[string]bool{}
	for _, id := range ids {
		if !have[id] || seen[id] {
			return ErrBadOrder
		}
		seen[id] = true
	}
	for i, id := range ids {
		if _, err := tx.Exec(ctx,
			`UPDATE connect_profile_media SET sort_order = $1 WHERE id = $2 AND profile_id = $3`, i, id, p.ID); err != nil {
			return fmt.Errorf("connect: reorder photos: %w", err)
		}
	}
	return tx.Commit(ctx)
}

// GetMe — GET /api/v1/connect/profile/me (authenticated member).
func (h *Handler) GetMe(c *gin.Context) {
	uid := ginutil.UserID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": strAuthenticationRequired})
		return
	}
	fp, err := h.svc.GetMe(c.Request.Context(), uid)
	if err != nil {
		log.Printf("[connect-profile] GetMe: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load profile"})
		return
	}
	c.JSON(http.StatusOK, gin.H{keyData: fp})
}

type presignMediaRequest struct {
	FileName    string `json:"file_name"`
	ContentType string `json:"content_type" binding:"required"`
}

// PresignMedia — POST /api/v1/connect/profile/media/presign. Issues a short-lived
// presigned PUT for one photo; the key is chosen here, never by the client. The
// client PUTs the bytes to R2, then registers the returned object_key through
// POST /profile/media.
func (h *Handler) PresignMedia(c *gin.Context) {
	uid := ginutil.UserID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": strAuthenticationRequired})
		return
	}
	pr := h.svc.presigner
	if pr == nil || !pr.Configured() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "photo uploads are not configured"})
		return
	}
	// Configured() only proves the variables are non-empty; probe once (cached) so a
	// wrong bucket or read-only token reads as "unavailable", not a PUT failure.
	if err := pr.Healthy(c.Request.Context()); err != nil {
		log.Printf("[connect-profile] R2 write probe failed, photo uploads disabled until R2_* config is fixed: %v", err)
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "photo uploads are not configured"})
		return
	}
	var req presignMediaRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	ct := strings.ToLower(strings.TrimSpace(req.ContentType))
	ext, ok := photoAllowedContentTypes[ct]
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Photos must be JPEG, PNG or WebP."})
		return
	}
	if req.FileName != "" {
		if e := strings.ToLower(path.Ext(req.FileName)); e != "" && !photoAllowedExt[e] {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Photos must be JPEG, PNG or WebP."})
			return
		}
	}
	key := mediaKeyPrefix(uid) + cryptox.RandHex(16) + ext
	url, err := pr.PresignPut(key, ct, photoPresignTTL)
	if err != nil {
		if errors.Is(err, r2.ErrNotConfigured) {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "photo uploads are not configured"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not issue upload url"})
		return
	}
	c.JSON(http.StatusOK, gin.H{keyData: gin.H{
		"upload_url":   url,
		"object_key":   key,
		"content_type": ct,
		"expires_in":   int(photoPresignTTL.Seconds()),
		"method":       "PUT",
	}})
}

// DeleteMedia — DELETE /api/v1/connect/profile/media/:id.
func (h *Handler) DeleteMedia(c *gin.Context) {
	uid := ginutil.UserID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": strAuthenticationRequired})
		return
	}
	err := h.svc.DeleteMedia(c.Request.Context(), uid, c.Param("id"))
	if errors.Is(err, ErrMediaNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "photo not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not remove photo"})
		return
	}
	c.JSON(http.StatusOK, gin.H{keyData: gin.H{"ok": true}})
}

type reorderRequest struct {
	IDs []string `json:"ids" binding:"required"`
}

// ReorderMedia — PUT /api/v1/connect/profile/media/order. The first id is the
// primary photo.
func (h *Handler) ReorderMedia(c *gin.Context) {
	uid := ginutil.UserID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": strAuthenticationRequired})
		return
	}
	var req reorderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	if err := h.svc.ReorderPhotos(c.Request.Context(), uid, req.IDs); err != nil {
		if errors.Is(err, ErrBadOrder) {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not reorder photos"})
		return
	}
	photos, err := h.svc.ListPhotos(c.Request.Context(), uid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load photos"})
		return
	}
	c.JSON(http.StatusOK, gin.H{keyData: photos})
}
