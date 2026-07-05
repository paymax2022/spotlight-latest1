package estate

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

// presign.go — backend-owned presigned Cloudflare R2 uploads for the estate module.
//
// Closes the cross-cutting acceptance gap in Blocks 25 (profile photo), 28 (guard
// incident evidence), 35 (repair photos) and 39 (documents): previously every
// media URL was an untrusted client-supplied string. Now:
//
//  1. Client calls POST /api/finance/estate/:id/uploads/presign with
//     {kind, fileName, contentType}.
//  2. Backend verifies estate membership, derives a SERVER-CONTROLLED object key
//     (estate/<estateID>/<userID>/<kind>/<rand><ext>) and returns a short-lived
//     presigned PUT URL + the key.
//  3. Client PUTs the binary directly to R2 (never through our API).
//  4. Client records metadata via the existing endpoints, passing the returned key.
//
// The client cannot choose an arbitrary key (no overwriting another resident's or
// estate's objects), and the Content-Type is bound into the signature (no type
// smuggling). R2 credentials are server-side only; when R2 is unconfigured the
// endpoint fails closed with 503 rather than fabricating a URL.

// estatePresignTTL bounds how long an issued upload URL is valid.
const estatePresignTTL = 10 * time.Minute

// estateUploadKinds maps the client-facing upload kind → object-key prefix segment.
var estateUploadKinds = map[string]string{
	"profile_photo":     "photo",    // Block 25 — resident profile photo
	"vehicle_doc":       "vehicle",  // Block 25 — vehicle document
	"incident_evidence": "incident", // Block 28 — guard incident evidence
	"repair_evidence":   "repair",   // Block 35 — repair photos
	"document":          "doc",      // Block 39 — estate document
}

// estateAllowedUploadContentTypes restricts what a presigned PUT may upload
// (bound into the signature, so the client must send exactly this Content-Type).
var estateAllowedUploadContentTypes = map[string]bool{
	"image/png":       true,
	"image/jpeg":      true,
	"image/webp":      true,
	"application/pdf": true,
}

// estateAllowedUploadExt restricts the file extension appended to the derived key.
var estateAllowedUploadExt = map[string]bool{
	".png": true, ".jpg": true, ".jpeg": true, ".webp": true, ".pdf": true,
}

// WithPresigner attaches an R2 presigner so the estate upload endpoint can mint
// short-lived presigned PUT URLs. A nil or unconfigured presigner makes the
// endpoint fail closed with 503.
func (h *Handler) WithPresigner(p *r2.Presigner, bucket string) *Handler {
	h.presigner = p
	h.presignBucket = bucket
	return h
}

// PresignUploadRequest is the body for POST /uploads/presign.
type PresignUploadRequest struct {
	Kind        string `json:"kind" binding:"required"`        // see estateUploadKinds
	FileName    string `json:"fileName" binding:"required"`    // used only for its extension
	ContentType string `json:"contentType" binding:"required"` // must be allowed
}

// PresignUploadResponse is what the client uses to PUT the binary to R2.
type PresignUploadResponse struct {
	UploadURL   string `json:"uploadUrl"`   // presigned PUT URL (short-lived)
	ObjectKey   string `json:"objectKey"`   // server-chosen key to echo back when recording metadata
	Bucket      string `json:"bucket"`      //
	ContentType string `json:"contentType"` // the client MUST send this exact header on the PUT
	ExpiresIn   int    `json:"expiresIn"`   // seconds
	Method      string `json:"method"`      // always "PUT"
}

// PresignUpload issues a presigned R2 PUT URL scoped to the authenticated caller
// within an estate they belong to.
// POST /api/finance/estate/:id/uploads/presign
func (h *Handler) PresignUpload(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	estateID := c.Param("id")
	if h.presigner == nil || !h.presigner.Configured() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "uploads are not configured"})
		return
	}

	var req PresignUploadRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Membership check: only an estate member may mint upload URLs for that estate.
	if err := h.svc.assertResident(c.Request.Context(), estateID, userID); err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}

	prefix, ok := estateUploadKinds[req.Kind]
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported upload kind"})
		return
	}
	ct := strings.ToLower(strings.TrimSpace(req.ContentType))
	if !estateAllowedUploadContentTypes[ct] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported content type"})
		return
	}
	ext := strings.ToLower(path.Ext(req.FileName))
	if !estateAllowedUploadExt[ext] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported file extension"})
		return
	}

	// Server-controlled key: client cannot influence the path beyond its own scope.
	// Random component prevents guessing/overwrite.
	key := fmt.Sprintf("estate/%s/%s/%s/%s%s", estateID, userID, prefix, estateRandToken(), ext)

	url, err := h.presigner.PresignPut(key, ct, estatePresignTTL)
	if err != nil {
		if err == r2.ErrNotConfigured {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "uploads are not configured"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not issue upload url"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": PresignUploadResponse{
		UploadURL:   url,
		ObjectKey:   key,
		Bucket:      h.presignBucket,
		ContentType: ct,
		ExpiresIn:   int(estatePresignTTL.Seconds()),
		Method:      "PUT",
	}})
}

// documentDownloadTTL bounds how long an issued document download URL is valid
// (Block 39 acceptance: 60-minute presigned GET).
const documentDownloadTTL = 60 * time.Minute

// DocumentDownloadURL returns a short-lived (60-min) presigned GET URL for an
// estate document the caller is authorised to read. Legacy documents that
// predate server-controlled keys (object_key empty) pass their stored URL
// through unchanged.
// GET /api/finance/estate/:id/documents/:did/download-url
func (h *Handler) DocumentDownloadURL(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	estateID := c.Param("id")
	docID := c.Param("did")

	objectKey, fileURL, err := h.svc.ResolveDocumentForDownload(c.Request.Context(), estateID, userID, docID)
	if err != nil {
		switch {
		case err == ErrDocumentForbidden:
			c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		case err == ErrDocumentNotFound:
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		default:
			// roleIn failure (not an estate member) → forbidden.
			c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		}
		return
	}

	// Legacy passthrough: no server-controlled key, return the stored URL.
	if objectKey == "" {
		if fileURL == "" {
			c.JSON(http.StatusNotFound, gin.H{"error": "document has no downloadable file"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": gin.H{
			"downloadUrl": fileURL,
			"expiresIn":   0,
			"method":      "GET",
			"legacy":      true,
		}})
		return
	}

	if h.presigner == nil || !h.presigner.Configured() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "downloads are not configured"})
		return
	}
	url, err := h.presigner.PresignGet(objectKey, documentDownloadTTL)
	if err != nil {
		if err == r2.ErrNotConfigured {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "downloads are not configured"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not issue download url"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"downloadUrl": url,
		"expiresIn":   int(documentDownloadTTL.Seconds()),
		"method":      "GET",
	}})
}

// estateRandToken returns a 16-byte hex token for unguessable object keys.
func estateRandToken() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
