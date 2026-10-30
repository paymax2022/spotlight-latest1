package transport

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"path"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"spotlight/backend/go-common/cryptox"
	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	"spotlight/backend/internal/provider"
	"spotlight/backend/internal/platform/r2"
)

// Driver identity verification (NIN, driver's licence) and server-side document
// uploads.
//
// Why the upload is proxied through the API instead of a browser PUT to R2: a
// presigned PUT makes the upload depend on the bucket's CORS policy matching the
// web app's origin, which is environment configuration the app cannot verify and
// which has already failed silently in local dev (presign 200, no object, no
// record). Go performs the R2 PUT itself here, so the browser only talks to its
// own origin. The presign endpoint stays for native callers.

// driverDocumentMaxBytes bounds one uploaded driver document.
const driverDocumentMaxBytes = 25 << 20

// driverUploadContentTypes is the extension → canonical content-type map for
// uploads. The content type is chosen server-side from the extension — never
// from the client-supplied part header — so a renamed file cannot smuggle a
// renderable type (the same rule as the registration upload route).
var driverUploadContentTypes = map[string]string{
	".jpg":  "image/jpeg",
	".jpeg": "image/jpeg",
	".png":  "image/png",
	".webp": "image/webp",
	".pdf":  "application/pdf",
}

// driverIdentityDocTypes maps the document type a driver submits to the Dojah
// id_type and its human label. Only documents that can be verified by data-match
// are here; proof of address stays a file upload.
var driverIdentityDocTypes = map[string]struct {
	IDType string
	Label  string
}{
	"nin":             {IDType: "nin", Label: "NIN"},
	"drivers_licence": {IDType: "drivers_license", Label: "driver's licence"},
}

// DriverIdentityRequest is POST /driver/kyc/verify.
type DriverIdentityRequest struct {
	DocType  string `json:"doc_type" binding:"required"`
	IDNumber string `json:"id_number" binding:"required"`
}

// DriverIdentityResponse reports the outcome of a provider data-match. Status is
// the stored driver_documents status (approved | submitted | rejected).
type DriverIdentityResponse struct {
	DocType     string `json:"docType"`
	Status      string `json:"status"`
	Verified    bool   `json:"verified"`
	Reason      string `json:"reason,omitempty"`
	MatchedName string `json:"matchedName,omitempty"`
}

// GuarantorRequest is POST /driver/guarantor.
type GuarantorRequest struct {
	FullName     string `json:"full_name" binding:"required"`
	Phone        string `json:"phone" binding:"required"`
	Email        string `json:"email"`
	Relationship string `json:"relationship" binding:"required"`
}

// Guarantor is the driver's guarantor. The document this person signs is issued
// after onboarding (DocumentStatus starts at pending_issue), so capturing the
// details is what onboarding requires — not the signature.
type Guarantor struct {
	ID                string    `json:"id"`
	FullName          string    `json:"fullName"`
	Phone             string    `json:"phone"`
	Email             *string   `json:"email,omitempty"`
	Relationship      string    `json:"relationship"`
	DocumentStatus    string    `json:"documentStatus"`
	SignedDocumentURL *string   `json:"signedDocumentUrl,omitempty"`
	CreatedAt         time.Time `json:"createdAt"`
}

// WithIDVerifier attaches the provider used for NIN / driver's licence
// data-match. A nil verifier makes the endpoint fail closed with 503.
func (h *Handler) WithIDVerifier(p provider.IdNumberPort) *Handler {
	h.idVerifier = p
	return h
}

// VerifyDriverIdentity data-matches the driver's NIN or licence number against
// the provider and records the result as a driver_documents row.
// POST /api/finance/driver/kyc/verify
func (h *Handler) VerifyDriverIdentity(c *gin.Context) {
	userID := ginutil.UserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	var req DriverIdentityRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	docType := normalizeIdentityDocType(req.DocType)
	spec, ok := driverIdentityDocTypes[docType]
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported document type"})
		return
	}
	idNumber := strings.TrimSpace(req.IDNumber)
	if !validIdentityNumber(spec.IDType, idNumber) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "enter a valid " + spec.Label})
		return
	}
	if h.idVerifier == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "identity verification is not available right now"})
		return
	}

	result, err := h.idVerifier.VerifyIDNumber(c.Request.Context(), provider.KycVerifyRequest{
		ClientRef: uuid.NewString(),
		UserID:    userID,
		Type:      provider.KycIDNumber,
		IDType:    spec.IDType,
		IDNumber:  idNumber,
	})
	if err != nil {
		// A provider outage is not the driver's fault. Record the check as
		// submitted so ops can complete it, and let the driver carry on rather
		// than trapping them on a step they cannot influence.
		log.Printf("[transport] driver identity verify (%s) failed: %v", docType, err)
		result = provider.KycCheckResult{Status: provider.KycReview, Reason: "verification could not be completed — our team will review it"}
	}

	status := driverDocStatusForKyc(result.Status)
	doc, err := h.svc.RecordIdentityDocument(c.Request.Context(), userID, docType, status)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, DriverIdentityResponse{
		DocType:     doc.DocType,
		Status:      doc.Status,
		Verified:    doc.Status == "approved",
		Reason:      result.Reason,
		MatchedName: matchedIdentityName(result.ExtractedFields),
	})
}

// UploadDriverDocument accepts a multipart file, PUTs it to R2 server-side and
// records the driver_documents row in one round trip. Replaces the client-side
// presign → browser PUT → submit sequence for the web app.
// POST /api/finance/driver/documents/upload
func (h *Handler) UploadDriverDocument(c *gin.Context) {
	userID := ginutil.UserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	if h.presigner == nil || !h.presigner.Configured() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "uploads are not configured"})
		return
	}

	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, driverDocumentMaxBytes+512<<10)
	if err := c.Request.ParseMultipartForm(8 << 20); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "expected multipart/form-data with a file"})
		return
	}
	docType := strings.ToLower(strings.TrimSpace(c.PostForm("doc_type")))
	if !driverDocTypes[docType] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported document type"})
		return
	}
	fileHeader, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file is required"})
		return
	}
	if fileHeader.Size > driverDocumentMaxBytes {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file is too large"})
		return
	}
	name := sanitizeUploadFileName(fileHeader.Filename)
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid file name"})
		return
	}
	contentType, ok := driverUploadContentTypes[strings.ToLower(path.Ext(name))]
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported file format"})
		return
	}
	src, err := fileHeader.Open()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "could not read the file"})
		return
	}
	defer src.Close()
	buf, err := io.ReadAll(io.LimitReader(src, driverDocumentMaxBytes+1))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "could not read the file"})
		return
	}
	if len(buf) > driverDocumentMaxBytes {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file is too large"})
		return
	}

	key := fmt.Sprintf("drivers/%s/documents/%s/%s-%s", userID, docType, cryptox.RandHex(16), name)
	if err := h.putObject(c.Request.Context(), key, contentType, buf); err != nil {
		log.Printf("[transport] driver document R2 PUT failed: %v", err)
		c.JSON(http.StatusBadGateway, gin.H{"error": "could not store the document — please try again"})
		return
	}

	doc, err := h.svc.AddDocument(c.Request.Context(), userID, DocumentRequest{DocType: docType, FileURL: key})
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, doc)
}

// putObject performs the R2 PUT itself so the browser never has to.
func (h *Handler) putObject(ctx context.Context, key, contentType string, body []byte) error {
	url, err := h.presigner.PresignPut(key, contentType, 5*time.Minute)
	if err != nil {
		if errors.Is(err, r2.ErrNotConfigured) {
			return errors.New("uploads are not configured")
		}
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", contentType)
	resp, err := (&http.Client{Timeout: 60 * time.Second}).Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("r2 responded %d", resp.StatusCode)
	}
	return nil
}

// AddGuarantor stores (or replaces) the driver's guarantor details.
// POST /api/finance/driver/guarantor
func (h *Handler) AddGuarantor(c *gin.Context) {
	userID := ginutil.UserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	var req GuarantorRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	g, err := h.svc.UpsertGuarantor(c.Request.Context(), userID, req)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, g)
}

func (s *Service) UpsertGuarantor(ctx context.Context, userID string, req GuarantorRequest) (*Guarantor, error) {
	driverID, err := s.resolveDriverID(ctx, userID)
	if err != nil {
		return nil, err
	}
	fullName := strings.TrimSpace(req.FullName)
	phone := strings.TrimSpace(req.Phone)
	relationship := strings.TrimSpace(req.Relationship)
	email := strings.TrimSpace(req.Email)
	if len(fullName) < 3 {
		return nil, codedErr(http.StatusBadRequest, CodeInvalidState, "enter your guarantor's full name")
	}
	if !validGuarantorPhone(phone) {
		return nil, codedErr(http.StatusBadRequest, CodeInvalidState, "enter a valid guarantor phone number")
	}
	if relationship == "" {
		return nil, codedErr(http.StatusBadRequest, CodeInvalidState, "select how the guarantor knows you")
	}
	var emailPtr *string
	if email != "" {
		if !strings.Contains(email, "@") || strings.HasPrefix(email, "@") || strings.HasSuffix(email, "@") {
			return nil, codedErr(http.StatusBadRequest, CodeInvalidState, "enter a valid guarantor email")
		}
		emailPtr = &email
	}
	g := &Guarantor{}
	err = s.db.QueryRow(ctx, `
		INSERT INTO driver_guarantors (driver_id, full_name, phone, email, relationship)
		VALUES ($1,$2,$3,$4,$5)
		ON CONFLICT (driver_id) DO UPDATE
		  SET full_name=$2, phone=$3, email=$4, relationship=$5, updated_at=now()
		RETURNING id, full_name, phone, email, relationship, document_status, signed_document_url, created_at`,
		driverID, fullName, phone, emailPtr, relationship,
	).Scan(&g.ID, &g.FullName, &g.Phone, &g.Email, &g.Relationship, &g.DocumentStatus, &g.SignedDocumentURL, &g.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("transport: upsert guarantor: %w", err)
	}
	return g, nil
}

// RecordIdentityDocument stores the provider outcome as the driver's document of
// record. Replacing the previous row keeps retries idempotent without leaving a
// trail of stale rejections for the reviewer.
func (s *Service) RecordIdentityDocument(ctx context.Context, userID, docType, status string) (*DriverDocument, error) {
	driverID, err := s.resolveDriverID(ctx, userID)
	if err != nil {
		return nil, err
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `DELETE FROM driver_documents WHERE driver_id=$1 AND doc_type=$2`, driverID, docType); err != nil {
		return nil, fmt.Errorf("transport: clear identity document: %w", err)
	}
	doc := &DriverDocument{ID: uuid.NewString(), DriverID: driverID, DocType: docType, Status: status}
	if err := tx.QueryRow(ctx, `
		INSERT INTO driver_documents (id, driver_id, doc_type, file_url, status)
		VALUES ($1,$2,$3,NULL,$4) RETURNING created_at`,
		doc.ID, driverID, docType, status).Scan(&doc.CreatedAt); err != nil {
		return nil, fmt.Errorf("transport: insert identity document: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return doc, nil
}

func (s *Service) getGuarantor(ctx context.Context, driverID string) (*Guarantor, error) {
	g := &Guarantor{}
	err := s.db.QueryRow(ctx, `
		SELECT id, full_name, phone, email, relationship, document_status, signed_document_url, created_at
		FROM driver_guarantors WHERE driver_id=$1`, driverID).
		Scan(&g.ID, &g.FullName, &g.Phone, &g.Email, &g.Relationship, &g.DocumentStatus, &g.SignedDocumentURL, &g.CreatedAt)
	if err != nil {
		return nil, err
	}
	return g, nil
}

func normalizeIdentityDocType(s string) string {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "nin", "national_id":
		return "nin"
	case "drivers_licence", "drivers_license", "driver_licence", "driver_license", "dl", "license", "licence":
		return "drivers_licence"
	default:
		return strings.ToLower(strings.TrimSpace(s))
	}
}

// validIdentityNumber enforces the shape of each provider lookup so an obvious
// typo never becomes a paid provider call: NIN is 11 digits, a licence is 5–20
// alphanumerics.
func validIdentityNumber(idType, v string) bool {
	switch idType {
	case "nin":
		if len(v) != 11 {
			return false
		}
		for i := 0; i < len(v); i++ {
			if v[i] < '0' || v[i] > '9' {
				return false
			}
		}
		return true
	default:
		if len(v) < 5 || len(v) > 20 {
			return false
		}
		for i := 0; i < len(v); i++ {
			c := v[i]
			if (c >= '0' && c <= '9') || (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c == '-' || c == '/' {
				continue
			}
			return false
		}
		return true
	}
}

func validGuarantorPhone(v string) bool {
	digits := 0
	for i := 0; i < len(v); i++ {
		c := v[i]
		if c >= '0' && c <= '9' {
			digits++
			continue
		}
		if c == '+' || c == ' ' || c == '-' || c == '(' || c == ')' {
			continue
		}
		return false
	}
	return digits >= 7 && digits <= 15
}

// driverDocStatusForKyc maps a provider outcome onto the driver_documents status
// CHECK (submitted | approved | rejected | expired).
func driverDocStatusForKyc(s provider.KycCheckStatus) string {
	switch s {
	case provider.KycPassed:
		return "approved"
	case provider.KycFailed:
		return "rejected"
	default:
		return "submitted"
	}
}

// matchedIdentityName picks the human name out of provider fields so the driver
// can confirm the record that was matched.
func matchedIdentityName(fields map[string]string) string {
	if v := strings.TrimSpace(fields["full_name"]); v != "" {
		return v
	}
	if v := strings.TrimSpace(fields["name"]); v != "" {
		return v
	}
	first := strings.TrimSpace(fields["first_name"])
	last := strings.TrimSpace(fields["last_name"])
	return strings.TrimSpace(strings.Join([]string{first, last}, " "))
}
