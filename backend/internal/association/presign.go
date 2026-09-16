package association

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

// presign.go — backend-owned presigned Cloudflare R2 uploads for association logos.
//
// WHY THIS EXISTS
// ---------------
// The create-organisation wizard has always offered "tap to upload a logo", and
// the picker handed back a device-local file:// URI which was then stored
// verbatim in assoc_organisations.logo_url. The logo rendered on the founder's
// own phone and nowhere else — not for other members, not in the admin console.
// Making the logo a required field turned that from a cosmetic gap into a trap,
// because every founder who used the picker got a broken logo.
//
// The flow now mirrors estate's (see internal/estate/presign.go):
//
//  1. Client calls POST /api/finance/associations/uploads/logo/presign with
//     {fileName, contentType}.
//  2. Backend derives a SERVER-CONTROLLED object key
//     (association/logo/<userID>/<rand><ext>) and returns a short-lived
//     presigned PUT URL plus that key.
//  3. Client PUTs the image straight to R2 — never through this API.
//  4. Client sends the KEY back as the draft's logoUri, and it is stored in
//     logo_url in place of a URL.
//
// SCOPED TO THE USER, NOT AN ORGANISATION — deliberately. Estate presigns
// against /:id because the estate already exists and membership can be checked.
// A logo is chosen while the organisation is still a draft on the founder's
// phone, so there is no id to scope to and no membership to verify. The key is
// namespaced by the caller's own user id instead: a caller can only ever write
// inside their own prefix, and the random component makes keys unguessable, so
// the worst an authenticated caller can do is upload images into their own
// namespace.
//
// R2 credentials stay server-side. When R2 is unconfigured the endpoint fails
// closed with 503 rather than fabricating a URL that would 404 later.

// logoPresignTTL bounds how long an issued upload URL is valid.
const logoPresignTTL = 10 * time.Minute

// logoViewTTL bounds the signed GET URLs handed back on read. An hour is long
// enough that a list scrolled for a while keeps rendering, and short enough that
// a leaked URL stops working the same day.
const logoViewTTL = 60 * time.Minute

// logoAllowedContentTypes restricts what a presigned PUT may upload. The type is
// bound into the signature, so the client must send exactly this Content-Type
// and cannot smuggle another.
var logoAllowedContentTypes = map[string]bool{
	"image/png":     true,
	"image/jpeg":    true,
	"image/webp":    true,
	"image/svg+xml": true,
}

// logoAllowedExt restricts the extension appended to the derived key.
var logoAllowedExt = map[string]bool{
	".png": true, ".jpg": true, ".jpeg": true, ".webp": true, ".svg": true,
}

// documentAllowedContentTypes / documentAllowedExt are the document vault's
// allowlists. Wider than a logo's — a constitution or a set of minutes is a PDF
// or an office file — but still an allowlist: the content type is bound into the
// signature, so accepting anything would let a caller store an executable behind
// a document-shaped key.
var documentAllowedContentTypes = map[string]bool{
	"application/pdf":    true,
	"image/png":          true,
	"image/jpeg":         true,
	"application/msword": true,
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document": true,
	"application/vnd.ms-excel": true,
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": true,
	"text/csv": true,
}

var documentAllowedExt = map[string]bool{
	".pdf": true, ".png": true, ".jpg": true, ".jpeg": true,
	".doc": true, ".docx": true, ".xls": true, ".xlsx": true, ".csv": true,
}

// documentDownloadTTL bounds an issued document download URL.
const documentDownloadTTL = 60 * time.Minute

// WithPresigner attaches an R2 presigner to the handler so the upload endpoint
// can mint presigned PUT URLs. A nil or unconfigured presigner makes the
// endpoint fail closed with 503.
func (h *Handler) WithPresigner(p *r2.Presigner, bucket string) *Handler {
	h.presigner = p
	h.presignBucket = bucket
	return h
}

// WithPresigner attaches an R2 presigner to the service so stored object keys
// can be resolved to viewable URLs on read. Without it the service still works —
// it simply passes stored values through, which is the correct behaviour for the
// URLs that were stored before uploads existed.
func (s *Service) WithPresigner(p *r2.Presigner) *Service {
	s.presigner = p
	return s
}

// PresignLogoUploadRequest is the body for POST /associations/uploads/logo/presign.
type PresignLogoUploadRequest struct {
	FileName    string `json:"fileName" binding:"required"`    // used only for its extension
	ContentType string `json:"contentType" binding:"required"` // must be allowed
}

// PresignLogoUploadResponse is what the client uses to PUT the image to R2.
type PresignLogoUploadResponse struct {
	UploadURL   string `json:"uploadUrl"`   // presigned PUT URL (short-lived)
	ObjectKey   string `json:"objectKey"`   // send this back as the draft's logoUri
	Bucket      string `json:"bucket"`      //
	ContentType string `json:"contentType"` // the client MUST send this exact header on the PUT
	ExpiresIn   int    `json:"expiresIn"`   // seconds
	Method      string `json:"method"`      // always "PUT"
}

// PresignLogoUpload issues a presigned R2 PUT URL for an organisation logo,
// scoped to the authenticated caller.
// POST /api/finance/associations/uploads/logo/presign
func (h *Handler) PresignLogoUpload(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	if h.presigner == nil || !h.presigner.Configured() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "logo uploads are not configured"})
		return
	}

	var req PresignLogoUploadRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ct := strings.ToLower(strings.TrimSpace(req.ContentType))
	if !logoAllowedContentTypes[ct] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported content type"})
		return
	}
	ext := strings.ToLower(path.Ext(req.FileName))
	if !logoAllowedExt[ext] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported file extension"})
		return
	}

	key := fmt.Sprintf("association/logo/%s/%s%s", userID, logoRandToken(), ext)

	url, err := h.presigner.PresignPut(key, ct, logoPresignTTL)
	if err != nil {
		if err == r2.ErrNotConfigured {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "logo uploads are not configured"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not issue upload url"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": PresignLogoUploadResponse{
		UploadURL:   url,
		ObjectKey:   key,
		Bucket:      h.presignBucket,
		ContentType: ct,
		ExpiresIn:   int(logoPresignTTL.Seconds()),
		Method:      "PUT",
	}})
}

// IsStoredObjectKey reports whether a stored logo value is an R2 object key
// rather than a URL.
//
// logo_url holds both, because organisations created before uploads existed
// stored a pasted URL and the admin console still writes one. Anything with a
// scheme is a URL and is passed through untouched; anything else is treated as a
// key. Keys are always minted by PresignLogoUpload, so they always start with
// the association/ prefix — checking the prefix as well means a malformed
// legacy value is passed through rather than turned into a signed URL for an
// object that does not exist.
func IsStoredObjectKey(v string) bool {
	v = strings.TrimSpace(v)
	if v == "" || strings.Contains(v, "://") {
		return false
	}
	return strings.HasPrefix(v, "association/")
}

// resolveLogo turns a stored logo value into something a client can render.
//
// A pasted URL is returned unchanged. An object key becomes a short-lived signed
// GET URL, because the R2 bucket is not public — there is no base URL that would
// make a key fetchable, so a key handed to a client verbatim renders nothing.
//
// Every failure mode returns the value unchanged rather than an error: no
// presigner wired, R2 unconfigured, or a signing failure. A logo is decoration,
// and an organisation that cannot be listed because its logo could not be signed
// would be a far worse outcome than one that renders without a picture.
func (s *Service) resolveLogo(stored *string) *string {
	if stored == nil || !IsStoredObjectKey(*stored) {
		return stored
	}
	if s.presigner == nil || !s.presigner.Configured() {
		return stored
	}
	url, err := s.presigner.PresignGet(*stored, logoViewTTL)
	if err != nil {
		return stored
	}
	return &url
}

// logoRandToken returns a 16-byte hex token for unguessable object keys.
func logoRandToken() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// ── Document vault uploads ───────────────────────────────────────────────────

// PresignDocumentUpload issues a presigned R2 PUT URL for an organisation's
// document vault.
//
// Unlike the logo endpoint this IS organisation-scoped, and admin-gated: the
// vault belongs to the organisation rather than to the person uploading, so the
// key is namespaced by organisation and only somebody who administers it may
// write there. The document row is created separately, through the existing
// admin endpoint, with the objectKey returned here.
// POST /api/finance/associations/admin/organisations/:id/documents/presign
func (h *Handler) PresignDocumentUpload(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	orgID := c.Param("id")
	if err := h.svc.requireOrgAdmin(c.Request.Context(), userID, orgID); err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	if h.presigner == nil || !h.presigner.Configured() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "document uploads are not configured"})
		return
	}

	var req PresignLogoUploadRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	ct := strings.ToLower(strings.TrimSpace(req.ContentType))
	if !documentAllowedContentTypes[ct] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported content type"})
		return
	}
	ext := strings.ToLower(path.Ext(req.FileName))
	if !documentAllowedExt[ext] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported file extension"})
		return
	}

	key := fmt.Sprintf("association/document/%s/%s%s", orgID, logoRandToken(), ext)
	url, err := h.presigner.PresignPut(key, ct, logoPresignTTL)
	if err != nil {
		if err == r2.ErrNotConfigured {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "document uploads are not configured"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not issue upload url"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": PresignLogoUploadResponse{
		UploadURL:   url,
		ObjectKey:   key,
		Bucket:      h.presignBucket,
		ContentType: ct,
		ExpiresIn:   int(logoPresignTTL.Seconds()),
		Method:      "PUT",
	}})
}

// DocumentDownloadURL returns a short-lived signed GET for a document the caller
// may read.
//
// The bucket is not public, so a stored object key is not fetchable on its own.
// Authorisation is the SERVICE's, not this handler's: ResolveDocumentDownload
// checks the caller is an active member of the document's organisation and, for
// a restricted document, that they are an admin.
//
// A document whose storage_key is empty predates uploads. It has no file to
// serve, and saying so is better than a signed URL for an object that was never
// written.
// GET /api/finance/associations/documents/:id/download-url
func (h *Handler) DocumentDownloadURL(c *gin.Context) {
	key, err := h.svc.ResolveDocumentDownload(c.Request.Context(), c.GetString("user_id"), c.Param("id"))
	if err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	if key == "" {
		c.JSON(http.StatusNotFound, gin.H{"error": "this document has no file attached"})
		return
	}
	if h.presigner == nil || !h.presigner.Configured() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "downloads are not configured"})
		return
	}
	url, err := h.presigner.PresignGet(key, documentDownloadTTL)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "downloads are not configured"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"downloadUrl": url,
		"expiresIn":   int(documentDownloadTTL.Seconds()),
		"method":      "GET",
	}})
}
