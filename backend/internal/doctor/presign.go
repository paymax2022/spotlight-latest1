package doctor

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

// presign.go — backend-owned presigned Cloudflare R2 uploads for the doctor module.
//
// Flow (mirrors DOCTOR_GO_LIVE.md "Uploads (R2)"):
//  1. Client calls POST /api/v1/doctor/uploads/presign with {kind, fileName, contentType}.
//  2. Backend derives a SERVER-CONTROLLED object key (doctor/<uid>/<kind>/<rand><ext>)
//     and returns a short-lived presigned PUT URL + the key.
//  3. Client PUTs the binary directly to R2 (never through our API).
//  4. Client records metadata via the existing endpoints (SetProfilePhoto,
//     UploadProfileDocument, RenewVetLicence, SendChatAttachment, AddDisputeEvidence),
//     passing the returned key/url. The API stores metadata only — no binary touches
//     our servers, and the client cannot choose an arbitrary key (no overwrite of
//     another doctor's objects).
//
// Covers the five upload kinds called out for go-live:
//   uploadProfilePhoto · uploadDocument · renewLicence · sendAttachment · uploadDisputeEvidence
//
// Security: R2 credentials are server-side only (config). When R2 is not configured
// the endpoint fails closed with 503 (never a fabricated URL). The presign TTL is short.

// presignTTL bounds how long an issued upload URL is valid.
const presignTTL = 10 * time.Minute

// uploadKinds maps the client-facing upload kind → object-key prefix segment.
// Each corresponds 1:1 to a metadata-recording endpoint.
var uploadKinds = map[string]string{
	"profile_photo":    "photo",   // uploadProfilePhoto  → POST /profile/photo
	"document":         "doc",     // uploadDocument      → POST /profile/documents
	"licence":          "licence", // renewLicence        → POST /vet/licence/renew
	"chat_attachment":  "chat",    // sendAttachment      → POST /chat/:threadId/attachments
	"dispute_evidence": "dispute", // uploadDisputeEvidence→ POST /disputes/:id/evidence
}

// allowedUploadContentTypes restricts what a presigned PUT may upload (bound into
// the signature, so the client must send exactly this Content-Type).
var allowedUploadContentTypes = map[string]bool{
	"image/png":       true,
	"image/jpeg":      true,
	"image/webp":      true,
	"application/pdf": true,
	"audio/mpeg":      true, // voice attachments
	"audio/mp4":       true,
	"audio/wav":       true,
}

// allowedUploadExt restricts the file extension we append to the derived key.
var allowedUploadExt = map[string]bool{
	".png": true, ".jpg": true, ".jpeg": true, ".webp": true,
	".pdf": true, ".mp3": true, ".m4a": true, ".wav": true,
}

// PresignUploadRequest is the body for POST /uploads/presign.
type PresignUploadRequest struct {
	Kind        string `json:"kind" binding:"required"`        // see uploadKinds
	FileName    string `json:"fileName" binding:"required"`    // used only for its extension
	ContentType string `json:"contentType" binding:"required"` // must be in allowedUploadContentTypes
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

// PresignUpload issues a presigned R2 PUT URL scoped to the authenticated doctor.
// POST /api/v1/doctor/uploads/presign
func (h *Handler) PresignUpload(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	if h.presigner == nil || !h.presigner.Configured() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "uploads are not configured"})
		return
	}

	var req PresignUploadRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	prefix, ok := uploadKinds[req.Kind]
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported upload kind"})
		return
	}
	ct := strings.ToLower(strings.TrimSpace(req.ContentType))
	if !allowedUploadContentTypes[ct] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported content type"})
		return
	}
	ext := strings.ToLower(path.Ext(req.FileName))
	if !allowedUploadExt[ext] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported file extension"})
		return
	}

	// Server-controlled key: the client cannot influence the path beyond its own
	// scope. Random component prevents guessing/overwrite.
	key := fmt.Sprintf("doctor/%s/%s/%s%s", uid, prefix, randToken(), ext)

	url, err := h.presigner.PresignPut(key, ct, presignTTL)
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
		ExpiresIn:   int(presignTTL.Seconds()),
		Method:      "PUT",
	}})
}

// randToken returns a 16-byte hex token for unguessable object keys.
func randToken() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
