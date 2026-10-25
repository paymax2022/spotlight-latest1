package restaurant

import (
	"context"
	"errors"
	"log"
	"net/http"
	"net/url"
	"path"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/cryptox"
	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
)

// store_images.go — backend-owned presigned uploads for a restaurant's pictures: its
// logo, its banner, and the photo on each menu item. It follows kyb_documents.go step
// for step, because the constraints are the same: the bucket is private and has no
// public domain.
//
//  1. The owner asks POST /restaurant/:id/images/presign for an upload URL. The
//     backend checks the caller may manage the store, CHOOSES the object key
//     (restaurant/<id>/<store|menu>/<kind>/<rand><ext>) and binds the Content-Type into
//     the signature, so the client cannot pick where an image lands or smuggle another
//     type.
//  2. The client PUTs straight to R2, then saves the returned key as logo_url,
//     banner_url or image_url through the normal update. Each update accepts only a key
//     under THIS restaurant's prefix for THAT kind, so one outlet cannot point at
//     another's object and a banner cannot be saved as a logo.
//  3. Every read that returns one of these signs a stored key into a short-lived GET URL
//     (viewStoreImage). The columns keep holding both shapes, like association.logo_url:
//     an http(s) link is a link, a restaurant/… value is a key we minted.
//
// SVG is deliberately not allowed: it can carry script, and these images are rendered
// back to customers.

const (
	// storeImagePresignTTL covers a phone photo upload on a poor connection.
	storeImagePresignTTL = 10 * time.Minute
	// storeImageViewTTL bounds a signed view URL (same window as KYB documents).
	storeImageViewTTL = 60 * time.Minute
)

// StoreImageKind is which of a store's pictures an upload is for. Menu items share the
// same rail: their photos are the store's own content, minted under the same restaurant
// prefix, so one route, one validation and one signing path cover all three.
type StoreImageKind string

const (
	StoreImageLogo   StoreImageKind = "logo"
	StoreImageBanner StoreImageKind = "banner"
	StoreImageMenu   StoreImageKind = "menu"
)

// ErrStoreImageUploadsUnavailable means R2 is unset or failed its write probe.
// Callers map it to 503 so the app can say uploads are unavailable rather than loop.
var ErrStoreImageUploadsUnavailable = errors.New("restaurant: image uploads are not configured")

// errStoreImageBadRef is returned for an image reference that is neither an http(s)
// link nor a key minted for this restaurant and kind.
var errStoreImageBadRef = errors.New("restaurant: image must be an http(s) link or a picture uploaded for this restaurant")

// storeImageContentTypeByExt is both the extension allowlist and the extension→type
// binding: the declared Content-Type must match the file's extension.
var storeImageContentTypeByExt = map[string]string{
	".png":  "image/png",
	".jpg":  "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
}

// parseStoreImageKind accepts exactly "logo", "banner" or "menu" — it ends up in an
// object key.
func parseStoreImageKind(s string) (StoreImageKind, bool) {
	switch StoreImageKind(s) {
	case StoreImageLogo:
		return StoreImageLogo, true
	case StoreImageBanner:
		return StoreImageBanner, true
	case StoreImageMenu:
		return StoreImageMenu, true
	}
	return "", false
}

// storeImageGroup is the folder a kind's keys live in: the storefront's own two pictures
// under "store", the food photos under "menu".
func storeImageGroup(kind StoreImageKind) string {
	if kind == StoreImageMenu {
		return "menu"
	}
	return "store"
}

// storeImageKeyPrefix is the object-key prefix every STOREFRONT image of a restaurant
// starts with (logo and banner).
func storeImageKeyPrefix(restaurantID string) string {
	return "restaurant/" + restaurantID + "/store/"
}

// storeImageKindPrefix is the prefix for ONE kind. A saved reference must start with it,
// so an upload minted for another kind — or another restaurant — is refused.
func storeImageKindPrefix(restaurantID string, kind StoreImageKind) string {
	return "restaurant/" + restaurantID + "/" + storeImageGroup(kind) + "/" + string(kind) + "/"
}

// storeImageKey builds the server-controlled object key for an upload.
func storeImageKey(restaurantID string, kind StoreImageKind, ext string) string {
	return storeImageKindPrefix(restaurantID, kind) + cryptox.RandHex(16) + ext
}

// classifyStoreImageRef validates a submitted image reference for restaurantID and kind,
// reporting whether it is an object key (true) or an external link (false). An empty ref
// means "no change" and is accepted.
func classifyStoreImageRef(restaurantID string, kind StoreImageKind, ref string) (isKey bool, err error) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return false, nil
	}
	if u, perr := url.Parse(ref); perr == nil && u.Scheme != "" {
		// A scheme means a link. Only web links: this value is rendered by the apps, so
		// javascript:, data:, file: (a path on the owner's phone) and r2:// never get in.
		if (u.Scheme == "http" || u.Scheme == "https") && u.Host != "" {
			return false, nil
		}
		return false, errStoreImageBadRef
	}
	prefix := storeImageKindPrefix(restaurantID, kind)
	if !strings.HasPrefix(ref, prefix) || strings.Contains(ref, "..") {
		return false, errStoreImageBadRef
	}
	if _, ok := storeImageContentTypeByExt[strings.ToLower(path.Ext(ref))]; !ok {
		return false, errStoreImageBadRef
	}
	return true, nil
}

// isOwnStoreImageKey reports whether a stored value is one of the keys this feature
// mints. Narrow on purpose: only these are signed. Anything else already in the column
// (a link, or whatever older rows hold) is returned exactly as stored, so no existing
// image stops rendering.
func isOwnStoreImageKey(v string) bool {
	if u, err := url.Parse(v); err == nil && u.Scheme != "" {
		return false
	}
	if !strings.HasPrefix(v, "restaurant/") {
		return false
	}
	return strings.Contains(v, "/store/") || strings.Contains(v, "/menu/")
}

// viewStoreImage turns a stored value into something a client can render.
func (s *Service) viewStoreImage(ref *string) *string {
	if ref == nil {
		return nil
	}
	v := strings.TrimSpace(*ref)
	if v == "" {
		return nil
	}
	if !isOwnStoreImageKey(v) {
		return ref
	}
	// A key we cannot sign is hidden rather than returned: the client would show a
	// broken image, and the raw key is an internal storage path.
	if s.kybPresigner == nil || !s.kybPresigner.Configured() {
		return nil
	}
	signed, err := s.kybPresigner.PresignGet(v, storeImageViewTTL)
	if err != nil {
		return nil
	}
	return &signed
}

// resolveStoreImages rewrites a restaurant's stored image references into viewable URLs.
// Call it after every scan that returns a Restaurant to a client.
func (s *Service) resolveStoreImages(r *Restaurant) {
	if r == nil {
		return
	}
	r.LogoURL = s.viewStoreImage(r.LogoURL)
	r.BannerURL = s.viewStoreImage(r.BannerURL)
}

// StoreImagePresign is what the client needs to PUT an image to R2.
type StoreImagePresign struct {
	UploadURL   string `json:"upload_url"`   // presigned PUT URL (short-lived)
	ObjectKey   string `json:"object_key"`   // send back as logo_url / banner_url
	ContentType string `json:"content_type"` // the client MUST send this exact header on the PUT
	ExpiresIn   int    `json:"expires_in"`   // seconds
	Method      string `json:"method"`       // always "PUT"
}

// PresignStoreImage mints a presigned upload URL for a store picture: its logo, its
// banner, or the photo on a menu item.
func (s *Service) PresignStoreImage(ctx context.Context, restaurantID, userID, kindStr, fileName, contentType string) (*StoreImagePresign, error) {
	kind, ok := parseStoreImageKind(strings.TrimSpace(kindStr))
	if !ok {
		return nil, errors.New("restaurant: kind must be logo, banner or menu")
	}
	// A storefront picture is a store-management decision; a dish photo is part of the
	// menu, so staff who can edit the menu can photograph it without owning the storefront.
	perm := PermManageStore
	if kind == StoreImageMenu {
		perm = PermManageMenu
	}
	if err := s.AssertStaffPermission(ctx, restaurantID, userID, perm); err != nil {
		return nil, err
	}
	ext := strings.ToLower(path.Ext(strings.TrimSpace(fileName)))
	want, ok := storeImageContentTypeByExt[ext]
	if !ok {
		return nil, errors.New("restaurant: unsupported image type (use PNG, JPG or WEBP)")
	}
	if ct := strings.ToLower(strings.TrimSpace(contentType)); ct != want {
		return nil, errors.New("restaurant: content type does not match the file extension")
	}

	if s.kybPresigner == nil || !s.kybPresigner.Configured() {
		return nil, ErrStoreImageUploadsUnavailable
	}
	// Configured() only proves the variables are non-empty; a wrong bucket or a
	// read-only token still signs and then fails at the client's PUT. The probe is
	// cached, and the precise cause goes to the log, never to the client.
	if err := s.kybPresigner.Healthy(ctx); err != nil {
		log.Printf("[restaurant] R2 write probe failed, store image uploads disabled until R2_* config is fixed: %v", err)
		return nil, ErrStoreImageUploadsUnavailable
	}

	rid, err := canonicalRestaurantID(restaurantID)
	if err != nil {
		return nil, err
	}
	key := storeImageKey(rid, kind, ext)
	u, err := s.kybPresigner.PresignPut(key, want, storeImagePresignTTL)
	if err != nil {
		return nil, ErrStoreImageUploadsUnavailable
	}
	return &StoreImagePresign{
		UploadURL:   u,
		ObjectKey:   key,
		ContentType: want,
		ExpiresIn:   int(storeImagePresignTTL.Seconds()),
		Method:      "PUT",
	}, nil
}

// PresignStoreImage → POST /restaurant/:id/images/presign (store managers).
func (h *Handler) PresignStoreImage(c *gin.Context) {
	userID := ginutil.UserID(c)
	var body struct {
		Kind        string `json:"kind" binding:"required"`
		FileName    string `json:"file_name" binding:"required"`
		ContentType string `json:"content_type" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	p, err := h.svc.PresignStoreImage(c.Request.Context(), c.Param("id"), userID, body.Kind, body.FileName, body.ContentType)
	if err != nil {
		if errors.Is(err, ErrStoreImageUploadsUnavailable) {
			// httperr.Msg masks 5xx text; the app keys its "uploads unavailable" message
			// off this status, and the wording is safe to show.
			c.JSON(http.StatusServiceUnavailable, gin.H{keyError: "image uploads are not configured"})
			return
		}
		c.JSON(ownerErrStatus(err), gin.H{keyError: httperr.Msg(c, ownerErrStatus(err), err)})
		return
	}
	c.JSON(http.StatusOK, p)
}

// validateStoreImageRefs checks the logo/banner references of an update against this
// restaurant. Either may be nil (unchanged).
func (s *Service) validateStoreImageRefs(restaurantID string, logo, banner *string) error {
	if logo == nil && banner == nil {
		return nil
	}
	rid, err := canonicalRestaurantID(restaurantID)
	if err != nil {
		return err
	}
	if logo != nil {
		if _, err := classifyStoreImageRef(rid, StoreImageLogo, *logo); err != nil {
			return err
		}
	}
	if banner != nil {
		if _, err := classifyStoreImageRef(rid, StoreImageBanner, *banner); err != nil {
			return err
		}
	}
	return nil
}

// validateItemImageRef checks a submitted menu-item picture: an http(s) link, or a key
// THIS restaurant's menu uploads minted. A nil reference means "unchanged" and an empty
// one means "clear the picture"; both pass.
func (s *Service) validateItemImageRef(restaurantID string, ref *string) error {
	if ref == nil {
		return nil
	}
	rid, err := canonicalRestaurantID(restaurantID)
	if err != nil {
		return err
	}
	_, err = classifyStoreImageRef(rid, StoreImageMenu, *ref)
	return err
}

// viewMenuItem turns a stored menu-item picture into a viewable URL, hiding a key this
// server cannot sign (the app would show a broken image, and the raw key is an internal
// storage path).
func (s *Service) viewMenuItem(it *MenuItem) {
	if it != nil {
		it.ImageURL = s.viewStoreImage(it.ImageURL)
	}
}

// viewMenuItems does the same for a slice of items read from the menu.
func (s *Service) viewMenuItems(items []MenuItem) {
	for i := range items {
		s.viewMenuItem(&items[i])
	}
}

// loadBanners fills BannerURL (raw, unresolved) for every restaurant in rs with ONE query.
// It is a separate read, rather than a new column in each of the several SELECT lists, so
// the existing scans stay exactly as they were. A failure is logged and swallowed: a store
// still renders without its banner, and reads keep working on a database where
// banner_url has not been added yet.
func (s *Service) loadBanners(ctx context.Context, rs []*Restaurant) {
	byID := map[string][]*Restaurant{}
	ids := make([]string, 0, len(rs))
	for _, r := range rs {
		if r == nil || r.ID == "" {
			continue
		}
		if _, seen := byID[r.ID]; !seen {
			ids = append(ids, r.ID)
		}
		byID[r.ID] = append(byID[r.ID], r)
	}
	if len(ids) == 0 {
		return
	}
	rows, err := s.db.Query(ctx, `SELECT id::text, banner_url FROM restaurants WHERE id = ANY($1::uuid[]) AND banner_url IS NOT NULL`, ids)
	if err != nil {
		log.Printf("[restaurant] banner lookup skipped: %v", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var banner *string
		if err := rows.Scan(&id, &banner); err != nil {
			log.Printf("[restaurant] banner lookup scan: %v", err)
			return
		}
		for _, r := range byID[id] {
			r.BannerURL = banner
		}
	}
}

// finishStoreImages is what every read that returns stores calls last: it attaches the
// banner and turns stored image keys into viewable URLs for the logo and the banner.
func (s *Service) finishStoreImages(ctx context.Context, rs ...*Restaurant) {
	s.loadBanners(ctx, rs)
	for _, r := range rs {
		s.resolveStoreImages(r)
	}
}
