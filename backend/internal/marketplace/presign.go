package marketplace

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"path"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/platform/r2"
)

// presign.go — backend-owned presigned Cloudflare R2 uploads for listing photos.
//
// Gap endpoint the Sell agent's Smart Composer needs: the client cannot upload a
// binary through our JSON API, so it asks for a short-lived presigned PUT URL and
// PUTs the image straight to R2. This mirrors the estate module's presign pattern
// (backend/internal/estate/presign.go) exactly — server-controlled object key,
// Content-Type bound into the signature, fail-closed 503 when R2 is unconfigured
// (NEVER a fabricated URL).
//
// Object key is scoped to the authenticated seller:
//   marketplace/<userID>/<rand>.<ext>
// so a client can neither overwrite another seller's objects nor smuggle a path.

// listingMediaPresignTTL bounds how long an issued upload URL is valid.
const listingMediaPresignTTL = 10 * time.Minute

// listingMediaContentTypes restricts what a presigned PUT may upload (bound into
// the signature, so the client must send exactly this Content-Type).
var listingMediaContentTypes = map[string]bool{
	"image/png":  true,
	"image/jpeg": true,
	"image/webp": true,
}

// listingMediaExt restricts the file extension appended to the derived key. The
// extension is inferred from either the client-declared MIME type or the file
// name (whichever resolves) so the key always carries a safe, known suffix.
var listingMediaExt = map[string]string{
	"image/png":  ".png",
	"image/jpeg": ".jpg",
	"image/webp": ".webp",
}

var listingMediaAllowedExt = map[string]bool{
	".png": true, ".jpg": true, ".jpeg": true, ".webp": true,
}

// WithPresigner attaches an R2 presigner (+ bucket) so the listing-media upload
// endpoint can mint presigned PUT URLs. A nil/unconfigured presigner makes the
// endpoint fail closed with 503.
func (h *Handler) WithPresigner(p *r2.Presigner, bucket string) *Handler {
	h.presigner = p
	h.presignBucket = bucket
	return h
}

// PresignMediaRequest is the body for POST /listings/media/presign.
type PresignMediaRequest struct {
	FileName string `json:"file_name"`
	MimeType string `json:"mime_type"`
}

// PresignMedia issues a presigned R2 PUT URL scoped to the authenticated seller.
// POST /v1/marketplace/media/presign
// Body:  { file_name, mime_type }
// Reply: { upload_url, file_url, object_key, mime_type, expires_in, method }
func (h *Handler) PresignMedia(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	if h.presigner == nil || !h.presigner.Configured() {
		fail(c, newErr(http.StatusServiceUnavailable, CodeUploadsNotConfigured, "listing media uploads are not configured"))
		return
	}

	var req PresignMediaRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, fieldErr(CodeValidation, err.Error(), ""))
		return
	}

	mime := strings.ToLower(strings.TrimSpace(req.MimeType))
	if !listingMediaContentTypes[mime] {
		fail(c, fieldErr(CodeValidation, "unsupported mime_type (png, jpeg, webp only)", "mime_type"))
		return
	}

	// Extension: prefer the MIME-derived one; fall back to the file name's ext.
	ext := listingMediaExt[mime]
	if ext == "" {
		fnExt := strings.ToLower(path.Ext(req.FileName))
		if listingMediaAllowedExt[fnExt] {
			ext = fnExt
		}
	}
	if ext == "" {
		fail(c, fieldErr(CodeValidation, "unsupported file extension", "file_name"))
		return
	}

	// Server-controlled key: the client cannot influence the path beyond its own
	// scope; the random component prevents guessing/overwrite.
	key := "marketplace/" + uid + "/" + mktRandToken() + ext

	url, err := h.presigner.PresignPut(key, mime, listingMediaPresignTTL)
	if err != nil {
		if err == r2.ErrNotConfigured {
			fail(c, newErr(http.StatusServiceUnavailable, CodeUploadsNotConfigured, "listing media uploads are not configured"))
			return
		}
		fail(c, newErr(http.StatusInternalServerError, CodeInternal, "could not issue upload url"))
		return
	}

	respond(c, http.StatusOK, gin.H{
		"upload_url": url,
		// file_url is the canonical object reference the client echoes back on
		// listing create (media_ids). It is the object key, not a public URL —
		// public delivery is served through the R2/CDN binding, not from here.
		"file_url":   key,
		"object_key": key,
		"bucket":     h.presignBucket,
		"mime_type":  mime,
		"expires_in": int(listingMediaPresignTTL.Seconds()),
		"method":     "PUT",
	})
}

// mktRandToken returns a 16-byte hex token for unguessable object keys.
func mktRandToken() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
