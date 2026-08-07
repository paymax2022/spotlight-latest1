package transport

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/http"
	"path"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/platform/r2"
)

// presign.go — backend-owned presigned Cloudflare R2 uploads for driver documents.
//
// The mobile driver-onboarding flow (features/mobility) needs to upload a licence,
// insurance certificate, roadworthiness certificate, etc. before submitting the
// resulting object key via POST /driver/documents. Previously the client had to
// supply an arbitrary file_url string (untrusted). Now:
//
//  1. Client calls POST /api/finance/driver/documents/presign with the snake_case
//     body {doc_type, file_name, mime_type}.
//  2. Backend derives a SERVER-CONTROLLED object key
//     (drivers/<userID>/documents/<docType>/<rand>-<sanitizedFileName>) and returns
//     a short-lived presigned PUT URL + the file (object) key as camelCase
//     {uploadUrl, fileUrl}.
//  3. Client PUTs the binary directly to R2, then submits fileUrl via the existing
//     POST /driver/documents endpoint.
//
// The client cannot choose an arbitrary key (no overwriting another driver's
// objects), and the Content-Type is bound into the signature (no type smuggling).
// R2 credentials are server-side only; when R2 is unconfigured the endpoint fails
// closed with 503 rather than fabricating a URL (mirrors estate.PresignUpload).

// driverPresignTTL bounds how long an issued upload URL is valid.
const driverPresignTTL = 10 * time.Minute

// driverDocTypes is the allowed set of driver document types. It matches the
// mobile DocType union (features/mobility/types) and also accepts the broader
// transport document vocabulary so newer clients are not rejected.
var driverDocTypes = map[string]bool{
	// mobile DocType union
	"drivers_licence":   true,
	"government_id":     true,
	"proof_of_address":  true,
	"vehicle_insurance": true,
	"roadworthiness":    true,
	// broader transport document vocabulary
	"license":         true,
	"vehicle_reg":     true,
	"insurance":       true,
	"road_worthiness": true,
	"lasrra":          true,
	"psv":             true,
	"profile_photo":   true,
}

// driverAllowedUploadContentTypes restricts what a presigned PUT may upload
// (bound into the signature, so the client must send exactly this Content-Type).
var driverAllowedUploadContentTypes = map[string]bool{
	"image/jpeg":      true,
	"image/png":       true,
	"image/webp":      true,
	"application/pdf": true,
}

// WithPresigner attaches an R2 presigner so the driver-document upload endpoint
// can mint short-lived presigned PUT URLs. A nil or unconfigured presigner makes
// the endpoint fail closed with 503.
func (h *Handler) WithPresigner(p *r2.Presigner, bucket string) *Handler {
	h.presigner = p
	h.presignBucket = bucket
	return h
}

// DriverDocPresignRequest is the snake_case body for
// POST /driver/documents/presign.
type DriverDocPresignRequest struct {
	DocType  string `json:"doc_type" binding:"required"`
	FileName string `json:"file_name" binding:"required"`
	MimeType string `json:"mime_type" binding:"required"`
}

// DriverDocPresignResponse is the camelCase body the mobile client consumes: it
// PUTs the binary to UploadURL, then persists FileURL (the object key) via the
// existing POST /driver/documents endpoint.
type DriverDocPresignResponse struct {
	UploadURL string `json:"uploadUrl"` // presigned PUT URL (short-lived)
	FileURL   string `json:"fileUrl"`   // server-chosen object key to echo back on submit
}

// PresignDriverDocument issues a presigned R2 PUT URL scoped to the authenticated
// driver for a document upload.
// POST /api/finance/driver/documents/presign
func (h *Handler) PresignDriverDocument(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	if h.presigner == nil || !h.presigner.Configured() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "uploads are not configured"})
		return
	}

	var req DriverDocPresignRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	docType := strings.ToLower(strings.TrimSpace(req.DocType))
	if !driverDocTypes[docType] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported document type"})
		return
	}
	ct := strings.ToLower(strings.TrimSpace(req.MimeType))
	if !driverAllowedUploadContentTypes[ct] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported content type"})
		return
	}
	fileName := sanitizeUploadFileName(req.FileName)
	if fileName == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid file name"})
		return
	}

	// Server-controlled key: client cannot influence the path beyond its own scope.
	// The random component prevents guessing/overwrite.
	key := fmt.Sprintf("drivers/%s/documents/%s/%s-%s", userID, docType, driverRandToken(), fileName)

	url, err := h.presigner.PresignPut(key, ct, driverPresignTTL)
	if err != nil {
		if err == r2.ErrNotConfigured {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "uploads are not configured"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not issue upload url"})
		return
	}

	c.JSON(http.StatusOK, DriverDocPresignResponse{
		UploadURL: url,
		FileURL:   key,
	})
}

// sanitizeUploadFileName reduces a client-supplied file name to its base name and
// keeps only a safe character set, so it cannot alter the object-key path.
func sanitizeUploadFileName(name string) string {
	base := path.Base(strings.TrimSpace(name))
	if base == "." || base == "/" || base == ".." {
		return ""
	}
	var b strings.Builder
	for i := 0; i < len(base); i++ {
		c := base[i]
		switch {
		case c >= 'A' && c <= 'Z',
			c >= 'a' && c <= 'z',
			c >= '0' && c <= '9',
			c == '-', c == '_', c == '.':
			b.WriteByte(c)
		default:
			b.WriteByte('_')
		}
	}
	return b.String()
}

// driverRandToken returns a 16-byte hex token for unguessable object keys.
func driverRandToken() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
