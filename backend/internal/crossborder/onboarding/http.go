package onboarding

import (
	"context"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/ginutil"
)

// ErrStepUpRejected means the caller's transaction PIN was wrong or locked.
var ErrStepUpRejected = errors.New("onboarding: step-up rejected")

// StepUp is the second factor (the user's transaction PIN) required for
// activation and T&C acceptance, mirroring the existing money-action policy.
// A nil StepUp fails closed.
type StepUp interface {
	HasPin(ctx context.Context, userID string) (bool, error)
	// VerifyPin returns ErrStepUpRejected for a wrong or locked PIN. It is
	// never called with an empty PIN.
	VerifyPin(ctx context.Context, userID, pin string) error
}

// API is the service surface the handlers need (satisfied by *Service).
// Every method takes the AUTHENTICATED user id; there is no account-id
// parameter anywhere, so a caller can only ever reach their own account.
type API interface {
	Activate(ctx context.Context, userID string, in ActivateInput) (GlobalAccount, error)
	SubmitDocuments(ctx context.Context, userID string, docs []DocumentRef) error
	AcceptTnC(ctx context.Context, userID string, in TnCAcceptance) error
	GetStatus(ctx context.Context, userID string) (StatusView, error)
	ListWallets(ctx context.Context, userID string) ([]WalletView, error)
	FundingDetails(ctx context.Context, userID, currency string) ([]FundingDetail, error)
	UploadLink(ctx context.Context, userID string, kind DocumentKind, fileName, contentType string) (UploadLink, error)
}

var _ API = (*Service)(nil)

// HandlerConfig are the non-secret handler settings.
type HandlerConfig struct {
	// TnCDocument/TnCVersion identify the terms the user must accept. The
	// client must echo the version; a mismatch is refused.
	TnCDocument string
	TnCVersion  string
	// TnCURL is surfaced in the status payload when set.
	TnCURL string
}

// Handler serves the /v1/global endpoints.
type Handler struct {
	api      API
	profiles ProfileReader
	stepUp   StepUp
	cfg      HandlerConfig
}

// NewHandler builds the HTTP handler. profiles supplies the server-held
// contact data (email/phone are never taken from the request body).
func NewHandler(api API, profiles ProfileReader, stepUp StepUp, cfg HandlerConfig) *Handler {
	if cfg.TnCDocument == "" {
		cfg.TnCDocument = "global-account-terms"
	}
	if cfg.TnCVersion == "" {
		cfg.TnCVersion = "v1"
	}
	return &Handler{api: api, profiles: profiles, stepUp: stepUp, cfg: cfg}
}

// Register mounts the routes on g (expected: an authenticated group such as
// /v1/global with RequireAuthContext already applied).
func (h *Handler) Register(g gin.IRoutes) {
	g.GET("/status", h.Status)
	g.POST("/activate", h.Activate)
	g.PUT("/onboarding/documents", h.PutDocuments)
	g.POST("/onboarding/documents/upload-link", h.CreateUploadLink)
	g.POST("/onboarding/tnc", h.AcceptTnC)
	g.GET("/wallets", h.Wallets)
	g.GET("/wallets/:ccy/funding-details", h.FundingDetails)
}

const maxBodyBytes = 1 << 20

func fail(c *gin.Context, code int, msg string) {
	c.AbortWithStatusJSON(code, gin.H{"success": false, "error": msg})
}

// uid returns the authenticated user or aborts with 401.
func uid(c *gin.Context) (string, bool) {
	u := ginutil.UserID(c)
	if u == "" {
		fail(c, http.StatusUnauthorized, "authentication required")
		return "", false
	}
	return u, true
}

func (h *Handler) writeErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrTierTooLow):
		fail(c, http.StatusForbidden, "tier_too_low")
	case errors.Is(err, ErrTierUnavailable):
		log.Printf("[global] tier lookup failed: %v", err)
		fail(c, http.StatusServiceUnavailable, "tier_unavailable")
	case errors.Is(err, ErrActivationConflict):
		fail(c, http.StatusConflict, "account_conflict")
	case errors.Is(err, ErrNoAccount), errors.Is(err, ErrUnknownCurrency):
		fail(c, http.StatusNotFound, "not_found")
	case errors.Is(err, ErrWrongState), errors.Is(err, ErrIncompleteAccount):
		fail(c, http.StatusConflict, "wrong_state")
	case errors.Is(err, ErrDocumentsIncomplete):
		fail(c, http.StatusUnprocessableEntity, "documents_incomplete")
	case errors.Is(err, ErrPayloadIncomplete):
		// Messages are field-level ("KYC address is required"), never values.
		fail(c, http.StatusUnprocessableEntity, err.Error())
	case errors.Is(err, ErrUnknownDocumentKind):
		fail(c, http.StatusBadRequest, "unknown_document_kind")
	default:
		log.Printf("[global] internal error: %v", err)
		fail(c, http.StatusInternalServerError, "internal")
	}
}

// requireStepUp verifies the transaction PIN. It returns false after writing
// the response when the step-up is not satisfied.
func (h *Handler) requireStepUp(c *gin.Context, userID, pin string) bool {
	if strings.TrimSpace(pin) == "" {
		// Refused BEFORE verification: an absent PIN is not a lockout guess.
		fail(c, http.StatusBadRequest, "pin_required")
		return false
	}
	if h.stepUp == nil {
		fail(c, http.StatusForbidden, "step_up_unavailable") // fail closed
		return false
	}
	has, err := h.stepUp.HasPin(c.Request.Context(), userID)
	if err != nil {
		log.Printf("[global] step-up lookup failed: %v", err)
		fail(c, http.StatusInternalServerError, "internal")
		return false
	}
	if !has {
		fail(c, http.StatusForbidden, "pin_not_set")
		return false
	}
	if err := h.stepUp.VerifyPin(c.Request.Context(), userID, pin); err != nil {
		if errors.Is(err, ErrStepUpRejected) {
			fail(c, http.StatusForbidden, "pin_invalid")
			return false
		}
		log.Printf("[global] step-up verify failed: %v", err)
		fail(c, http.StatusInternalServerError, "internal")
		return false
	}
	return true
}

func nextStep(v StatusView) string {
	if !v.Exists {
		return "activate"
	}
	switch v.Status {
	case StatusNotStarted:
		return "submit_documents"
	case StatusSubmitted, StatusInReview:
		return "await_review"
	case StatusAwaitingTnC:
		return "accept_tnc"
	case StatusRejected:
		return "resubmit_documents"
	case StatusSuspended:
		return "contact_support"
	case StatusActive:
		return "none"
	}
	return "none"
}

func rfc3339(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := t.UTC().Format(time.RFC3339)
	return &s
}

type walletJSON struct {
	Currency string `json:"currency"`
	Status   string `json:"status"`
}

// Status handles GET /status.
func (h *Handler) Status(c *gin.Context) {
	userID, ok := uid(c)
	if !ok {
		return
	}
	v, err := h.api.GetStatus(c.Request.Context(), userID)
	if err != nil {
		h.writeErr(c, err)
		return
	}
	wallets := []walletJSON{}
	if v.Exists && v.Status == StatusActive {
		ws, err := h.api.ListWallets(c.Request.Context(), userID)
		if err != nil && !errors.Is(err, ErrNoAccount) {
			h.writeErr(c, err)
			return
		}
		for _, w := range ws {
			wallets = append(wallets, walletJSON{Currency: w.Currency, Status: w.Status})
		}
	}
	body := gin.H{
		"status":           string(v.Status),
		"exists":           v.Exists,
		"next_step":        nextStep(v),
		"tnc_required":     v.TnCRequired,
		"rejection_reason": v.RejectionReason,
		"submitted_at":     rfc3339(v.SubmittedAt),
		"approved_at":      rfc3339(v.ApprovedAt),
		"tnc_accepted_at":  rfc3339(v.TnCAcceptedAt),
		"wallets":          wallets,
	}
	if v.Exists {
		body["subject_type"] = string(v.SubjectType)
	}
	if v.TnCRequired && h.cfg.TnCURL != "" {
		body["tnc_url"] = h.cfg.TnCURL
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": body})
}

type docJSON struct {
	Kind       string `json:"kind"`
	DocumentID string `json:"document_id"`
	Action     string `json:"action"`
}

func parseDocs(in []docJSON) ([]DocumentRef, bool) {
	out := make([]DocumentRef, 0, len(in))
	for _, d := range in {
		kind := DocumentKind(strings.ToUpper(strings.TrimSpace(d.Kind)))
		if !validKind(kind) || strings.TrimSpace(d.DocumentID) == "" {
			return nil, false
		}
		act := DocumentAction(strings.ToUpper(strings.TrimSpace(d.Action)))
		if !act.Valid() {
			return nil, false
		}
		if act == "" {
			act = DocActionAdd
		}
		out = append(out, DocumentRef{Kind: kind, DocumentID: strings.TrimSpace(d.DocumentID), Action: act})
	}
	return out, true
}

func validKind(k DocumentKind) bool {
	switch k {
	case DocIdentity, DocAddressProof, DocIncorporation, DocOwnershipChart:
		return true
	}
	return false
}

type addressJSON struct {
	Line1      string `json:"line1"`
	Line2      string `json:"line2"`
	City       string `json:"city"`
	State      string `json:"state"`
	PostalCode string `json:"postal_code"`
	Country    string `json:"country"`
}

func (a addressJSON) domain() Address {
	return Address{Line1: a.Line1, Line2: a.Line2, City: a.City, State: a.State, PostalCode: a.PostalCode, Country: a.Country}
}

type shareholderJSON struct {
	Type               string      `json:"type"`
	Name               string      `json:"name"`
	Email              string      `json:"email"`
	Phone              string      `json:"phone"`
	DateOfBirth        string      `json:"date_of_birth"`
	Nationality        string      `json:"nationality"`
	Address            addressJSON `json:"address"`
	RegistrationNo     string      `json:"registration_no"`
	Country            string      `json:"country"`
	OwnershipBps       int         `json:"ownership_bps"`
	ControllingOfficer bool        `json:"controlling_officer"`
	Role               string      `json:"role"`
	Documents          []docJSON   `json:"documents"`
}

type businessJSON struct {
	LegalName          string            `json:"legal_name"`
	RegistrationNumber string            `json:"registration_number"`
	CompanyType        string            `json:"company_type"`
	Country            string            `json:"country"`
	RegisteredAddress  addressJSON       `json:"registered_address"`
	OperatingAddress   addressJSON       `json:"operating_address"`
	Shareholders       []shareholderJSON `json:"shareholders"`
}

type activateReq struct {
	Pin              string        `json:"pin"`
	SubjectType      string        `json:"subject_type"`
	SelectedProducts []string      `json:"selected_products"`
	Documents        []docJSON     `json:"documents"`
	Business         *businessJSON `json:"business"`
}

func (b *businessJSON) domain() (*BusinessProfile, bool) {
	out := &BusinessProfile{
		LegalName: b.LegalName, RegistrationNumber: b.RegistrationNumber, CompanyType: b.CompanyType,
		Country: b.Country, RegisteredAddress: b.RegisteredAddress.domain(), OperatingAddress: b.OperatingAddress.domain(),
	}
	for _, s := range b.Shareholders {
		docs, ok := parseDocs(s.Documents)
		if !ok {
			return nil, false
		}
		t := ShareholderType(strings.ToUpper(strings.TrimSpace(s.Type)))
		if t != ShareholderIndividual && t != ShareholderCorporate {
			return nil, false
		}
		out.Shareholders = append(out.Shareholders, ShareholderInput{
			Type: t, Name: s.Name, Email: s.Email, Phone: s.Phone, DateOfBirth: s.DateOfBirth,
			Nationality: s.Nationality, Address: s.Address.domain(), RegistrationNo: s.RegistrationNo,
			Country: s.Country, OwnershipBps: s.OwnershipBps, ControllingOfficer: s.ControllingOfficer,
			Role: s.Role, Documents: docs,
		})
	}
	return out, true
}

// Activate handles POST /activate (step-up required; idempotent).
func (h *Handler) Activate(c *gin.Context) {
	userID, ok := uid(c)
	if !ok {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxBodyBytes)
	var req activateReq
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid_body")
		return
	}
	st := SubjectType(strings.ToLower(strings.TrimSpace(req.SubjectType)))
	if st != SubjectIndividual && st != SubjectBusiness {
		fail(c, http.StatusBadRequest, "invalid_subject_type")
		return
	}
	docs, ok2 := parseDocs(req.Documents)
	if !ok2 {
		fail(c, http.StatusBadRequest, "invalid_documents")
		return
	}
	var biz *BusinessProfile
	if st == SubjectBusiness {
		if req.Business == nil {
			fail(c, http.StatusBadRequest, "business_required")
			return
		}
		b, ok := req.Business.domain()
		if !ok {
			fail(c, http.StatusBadRequest, "invalid_business")
			return
		}
		biz = b
	}
	if !h.requireStepUp(c, userID, req.Pin) {
		return
	}
	// Contact data is server-held, never client-supplied.
	prof, err := h.profiles.GetProfile(c.Request.Context(), userID)
	if err != nil {
		log.Printf("[global] profile read failed: %v", err)
		fail(c, http.StatusInternalServerError, "internal")
		return
	}
	prof.UserID = userID
	prof.Business = biz
	acct, err := h.api.Activate(c.Request.Context(), userID, ActivateInput{
		SubjectType: st, Profile: prof,
		Extras: ActivateExtras{SelectedProducts: req.SelectedProducts, Documents: docs},
	})
	if err != nil {
		h.writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{
		"status":       string(acct.Status),
		"subject_type": string(acct.SubjectType),
		"next_step":    nextStep(StatusView{Exists: true, Status: acct.Status}),
	}})
}

// PutDocuments handles PUT /onboarding/documents (ADD/UPDATE/DELETE).
func (h *Handler) PutDocuments(c *gin.Context) {
	userID, ok := uid(c)
	if !ok {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxBodyBytes)
	var req struct {
		Documents []docJSON `json:"documents"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || len(req.Documents) == 0 {
		fail(c, http.StatusBadRequest, "invalid_body")
		return
	}
	docs, ok2 := parseDocs(req.Documents)
	if !ok2 {
		fail(c, http.StatusBadRequest, "invalid_documents")
		return
	}
	if err := h.api.SubmitDocuments(c.Request.Context(), userID, docs); err != nil {
		h.writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// CreateUploadLink handles POST /onboarding/documents/upload-link.
func (h *Handler) CreateUploadLink(c *gin.Context) {
	userID, ok := uid(c)
	if !ok {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxBodyBytes)
	var req struct {
		Kind        string `json:"kind"`
		FileName    string `json:"file_name"`
		ContentType string `json:"content_type"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid_body")
		return
	}
	kind := DocumentKind(strings.ToUpper(strings.TrimSpace(req.Kind)))
	name := strings.TrimSpace(req.FileName)
	if !validKind(kind) || name == "" || len(name) > 255 || strings.ContainsAny(name, `/\`) {
		fail(c, http.StatusBadRequest, "invalid_upload_request")
		return
	}
	l, err := h.api.UploadLink(c.Request.Context(), userID, kind, name, strings.TrimSpace(req.ContentType))
	if err != nil {
		h.writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"upload_url": l.URL, "document_id": l.DocumentID}})
}

// AcceptTnC handles POST /onboarding/tnc (step-up required).
func (h *Handler) AcceptTnC(c *gin.Context) {
	userID, ok := uid(c)
	if !ok {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxBodyBytes)
	var req struct {
		Pin      string `json:"pin"`
		Accepted bool   `json:"accepted"`
		Version  string `json:"version"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || !req.Accepted {
		fail(c, http.StatusBadRequest, "acceptance_required")
		return
	}
	if req.Version != h.cfg.TnCVersion {
		fail(c, http.StatusConflict, "tnc_version_mismatch")
		return
	}
	if !h.requireStepUp(c, userID, req.Pin) {
		return
	}
	err := h.api.AcceptTnC(c.Request.Context(), userID, TnCAcceptance{
		Document: h.cfg.TnCDocument, Version: h.cfg.TnCVersion,
		IP: c.ClientIP(), Device: c.GetHeader("User-Agent"),
	})
	if err != nil {
		h.writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// Wallets handles GET /wallets.
func (h *Handler) Wallets(c *gin.Context) {
	userID, ok := uid(c)
	if !ok {
		return
	}
	ws, err := h.api.ListWallets(c.Request.Context(), userID)
	if err != nil {
		h.writeErr(c, err)
		return
	}
	out := make([]walletJSON, 0, len(ws))
	for _, w := range ws {
		out = append(out, walletJSON{Currency: w.Currency, Status: w.Status})
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"wallets": out}})
}

// FundingDetails handles GET /wallets/:ccy/funding-details.
func (h *Handler) FundingDetails(c *gin.Context) {
	userID, ok := uid(c)
	if !ok {
		return
	}
	ccy := strings.ToUpper(strings.TrimSpace(c.Param("ccy")))
	if len(ccy) != 3 {
		fail(c, http.StatusBadRequest, "invalid_currency")
		return
	}
	fds, err := h.api.FundingDetails(c.Request.Context(), userID, ccy)
	if err != nil {
		h.writeErr(c, err)
		return
	}
	type fdJSON struct {
		AccountName   string `json:"account_name"`
		AccountNumber string `json:"account_number"`
		BankName      string `json:"bank_name"`
		BankCode      string `json:"bank_code"`
		Reference     string `json:"reference"`
	}
	out := make([]fdJSON, 0, len(fds))
	for _, f := range fds {
		out = append(out, fdJSON{f.AccountName, f.AccountNumber, f.BankName, f.BankCode, f.Reference})
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"currency": ccy, "funding_details": out}})
}
