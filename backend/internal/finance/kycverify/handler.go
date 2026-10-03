package kycverify

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/cryptox"
	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	"spotlight/backend/internal/provider"
)

const keyUnauthenticated = "unauthenticated"

const keyInvalidRequestBody = "invalid request body"

const keyError = "error"

// Handler exposes the member, webhook, and admin HTTP surface for the KYC
// verification gateway. Member ops derive the caller's user id from the auth
// context (set by requireUserID) — NEVER from the body — enforcing object-level
// authz. Admin ops are RBAC-gated by the router; webhooks are signature-verified.
type Handler struct {
	svc *Service
	wh  *WebhookService
}

// NewHandler builds the KYC verification handler.
func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc, wh: svc.NewWebhookService()}
}

// errMap maps domain errors to HTTP status codes (service.go documents each).
var errMap = httperr.New(http.StatusInternalServerError,
	httperr.R(http.StatusForbidden, ErrConsentRequired, ErrForbidden),
	httperr.R(http.StatusBadRequest, ErrInvalidTier, ErrInvalidRequest),
	httperr.R(http.StatusServiceUnavailable, ErrNoProvider, ErrProviderUnavailable),
	httperr.R(http.StatusNotFound, ErrNotFound),
	httperr.R(http.StatusConflict, ErrIllegalTransition),
)

func writeErr(c *gin.Context, err error) {
	body := gin.H{keyError: httperr.Msg(c, errMap.Code(err), err)}
	switch {
	case errors.Is(err, ErrConsentRequired):
		body["code"] = "consent_required"
	case errors.Is(err, ErrNoProvider):
		body["code"] = "no_provider"
	}
	c.JSON(errMap.Code(err), body)
}

type startSessionBody struct {
	TargetTier int `json:"target_tier"`
}

// StartSession handles POST /api/finance/kyc/session
func (h *Handler) StartSession(c *gin.Context) {
	uid := ginutil.UserID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{keyError: keyUnauthenticated})
		return
	}
	var body startSessionBody
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: keyInvalidRequestBody})
		return
	}
	sess, err := h.svc.StartSession(c.Request.Context(), uid, body.TargetTier)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, sess)
}

// GetSession handles GET /api/finance/kyc/session/:id
func (h *Handler) GetSession(c *gin.Context) {
	uid := ginutil.UserID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{keyError: keyUnauthenticated})
		return
	}
	sess, checks, err := h.svc.GetSession(c.Request.Context(), uid, c.Param("id"))
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"session": sess, "checks": checks})
}

type consentBody struct {
	Scope   string `json:"scope"`
	Version string `json:"version"`
}

// RecordConsent handles POST /api/finance/kyc/consent
func (h *Handler) RecordConsent(c *gin.Context) {
	uid := ginutil.UserID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{keyError: keyUnauthenticated})
		return
	}
	var body consentBody
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: keyInvalidRequestBody})
		return
	}
	rec, err := h.svc.RecordConsent(c.Request.Context(), uid, body.Scope, body.Version, c.ClientIP())
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, rec)
}

// checkBody is the shared JSON shape for every check submission. The
// Idempotency-Key header (falling back to client_ref) is the provider idempotency
// key + verification_check.client_ref.
type checkBody struct {
	SessionID string `json:"session_id"`
	ClientRef string `json:"client_ref"`
	IDType    string `json:"id_type"`
	IDNumber  string `json:"id_number"`
	FirstName string `json:"first_name"`
	LastName  string `json:"last_name"`
	DOB       string `json:"dob"`
	SelfieB64 string `json:"selfie_b64"`
	// Contract (openapi.yaml) field names are front_b64/back_b64; keep the legacy
	// doc_front_b64/doc_back_b64 as accepted aliases so no client silently drops a
	// document image (the DOCUMENT check gates CBN Tier 3).
	DocFrontB64      string            `json:"front_b64"`
	DocBackB64       string            `json:"back_b64"`
	DocFrontB64Alias string            `json:"doc_front_b64"`
	DocBackB64Alias  string            `json:"doc_back_b64"`
	DocType          string            `json:"doc_type"`
	Extra            map[string]string `json:"extra"`
}

func (h *Handler) runCheck(c *gin.Context, ct provider.KycCheckType) {
	uid := ginutil.UserID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{keyError: keyUnauthenticated})
		return
	}
	var body checkBody
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: keyInvalidRequestBody})
		return
	}
	if body.SessionID == "" {
		c.JSON(http.StatusBadRequest, gin.H{keyError: "session_id required"})
		return
	}
	clientRef := body.ClientRef
	if k := ginutil.IdempotencyKey(c); k != "" {
		clientRef = k // header wins (it IS the client_ref).
	}
	// Accept both the contract field names (front_b64/back_b64) and the legacy
	// aliases (doc_front_b64/doc_back_b64) so a document image is never dropped.
	docFront := body.DocFrontB64
	if docFront == "" {
		docFront = body.DocFrontB64Alias
	}
	docBack := body.DocBackB64
	if docBack == "" {
		docBack = body.DocBackB64Alias
	}
	req := provider.KycVerifyRequest{
		ClientRef:   clientRef,
		Type:        ct,
		IDType:      body.IDType,
		IDNumber:    body.IDNumber,
		FirstName:   body.FirstName,
		LastName:    body.LastName,
		DOB:         body.DOB,
		SelfieB64:   body.SelfieB64,
		DocFrontB64: docFront,
		DocBackB64:  docBack,
		DocType:     body.DocType,
		Extra:       body.Extra,
	}
	ch, err := h.svc.RunCheck(c.Request.Context(), uid, body.SessionID, ct, req)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusAccepted, ch) // 202: may still be PENDING (webhook terminal)
}

// CheckIDNumber handles POST /api/finance/kyc/checks/id-number
func (h *Handler) CheckIDNumber(c *gin.Context) { h.runCheck(c, provider.KycIDNumber) }

// CheckFacial handles POST /api/finance/kyc/checks/facial
func (h *Handler) CheckFacial(c *gin.Context) { h.runCheck(c, provider.KycIDFacial) }

// CheckLiveness handles POST /api/finance/kyc/checks/liveness
func (h *Handler) CheckLiveness(c *gin.Context) { h.runCheck(c, provider.KycLiveness) }

// CheckDocument handles POST /api/finance/kyc/checks/document
func (h *Handler) CheckDocument(c *gin.Context) { h.runCheck(c, provider.KycDocument) }

// CheckAML handles POST /api/finance/kyc/checks/aml
func (h *Handler) CheckAML(c *gin.Context) { h.runCheck(c, provider.KycAML) }

type sdkTokenBody struct {
	Provider string `json:"provider"`
}

// SDKToken handles POST /api/finance/kyc/sdk-token. Stub: returns a short-lived,
// server-issued placeholder token so the client SDK flow (e.g. Smile ID web SDK)
// never receives a provider SECRET. A real implementation mints a provider
// session token server-side; this keeps the contract stable meanwhile.
func (h *Handler) SDKToken(c *gin.Context) {
	uid := ginutil.UserID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{keyError: keyUnauthenticated})
		return
	}
	var body sdkTokenBody
	_ = c.ShouldBindJSON(&body)
	tok := "sdk_" + cryptox.Token()
	c.JSON(http.StatusOK, gin.H{
		"provider":   body.Provider,
		"token":      tok,
		"expires_at": time.Now().Add(10 * time.Minute).UTC(),
		"stub":       true,
	})
}

// Webhook handles POST /api/kyc/webhooks/:provider. Pipeline: read raw body →
// verify signature via the registered parser → dedupe + process. Deterministic
// failures ACK 200 so the provider stops retrying; the dedupe insert makes every
// redelivery a no-op.
func (h *Handler) Webhook(c *gin.Context) {
	providerName := c.Param("provider")
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.Status(http.StatusBadRequest)
		return
	}
	sig := webhookSignature(c, providerName)
	if !h.wh.Verify(providerName, body, sig) {
		c.Status(http.StatusUnauthorized)
		return
	}
	ctx := c.Request.Context()
	if err := h.wh.Ingest(ctx, providerName, body); err != nil {
		// Deterministic processing failure → still 200 (provider stops retrying);
		// the event is recorded in webhook_event with status=failed for follow-up.
		c.JSON(http.StatusOK, gin.H{"ok": false, keyError: httperr.Msg(c, http.StatusOK, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// webhookSignature reads the provider-specific signature header. Each provider
// signs the raw body; we try the common header names per provider.
func webhookSignature(c *gin.Context, providerName string) string {
	switch providerName {
	case "dojah":
		if s := c.GetHeader("X-Dojah-Signature"); s != "" {
			return s
		}
		return c.GetHeader("x-dojah-signature")
	case "smileid":
		if s := c.GetHeader("X-Smile-Signature"); s != "" {
			return s
		}
		return c.GetHeader("signature")
	case "youverify":
		if s := c.GetHeader("X-Youverify-Signature"); s != "" {
			return s
		}
		return c.GetHeader("x-youverify-signature")
	default:
		if s := c.GetHeader("X-Signature"); s != "" {
			return s
		}
		return c.GetHeader("signature")
	}
}

// ReviewQueue handles GET /api/finance/admin/kyc/review-queue
func (h *Handler) ReviewQueue(c *gin.Context) {
	cases, err := h.svc.ReviewQueue(c.Request.Context(), 100, 0)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"cases": cases})
}

// GetCase handles GET /api/finance/admin/kyc/cases/:id
func (h *Handler) GetCase(c *gin.Context) {
	rc, err := h.svc.GetCase(c.Request.Context(), c.Param("id"))
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, rc)
}

type decisionBody struct {
	Reason string `json:"reason"`
}

// ApproveCase handles POST /api/finance/admin/kyc/cases/:id/approve
func (h *Handler) ApproveCase(c *gin.Context) {
	var body decisionBody
	_ = c.ShouldBindJSON(&body)
	st, err := h.svc.ApproveCase(c.Request.Context(), c.Param("id"), ginutil.UserID(c), body.Reason)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": st})
}

// RejectCase handles POST /api/finance/admin/kyc/cases/:id/reject
func (h *Handler) RejectCase(c *gin.Context) {
	var body decisionBody
	_ = c.ShouldBindJSON(&body)
	st, err := h.svc.RejectCase(c.Request.Context(), c.Param("id"), ginutil.UserID(c), body.Reason)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": st})
}

// ListRoutingRules handles GET /api/finance/admin/kyc/routing-rules
func (h *Handler) ListRoutingRules(c *gin.Context) {
	rules, err := h.svc.ListRoutingRules(c.Request.Context())
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"rules": rules})
}

type routingRuleBody struct {
	OrderedProviders []string `json:"ordered_providers"`
	Threshold        int      `json:"threshold"`
	Enabled          bool     `json:"enabled"`
}

// UpdateRoutingRule handles PUT /api/finance/admin/kyc/routing-rules/:check_type
func (h *Handler) UpdateRoutingRule(c *gin.Context) {
	var body routingRuleBody
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: keyInvalidRequestBody})
		return
	}
	ct := provider.KycCheckType(c.Param("check_type"))
	if !validCheckType(ct) {
		c.JSON(http.StatusBadRequest, gin.H{keyError: "unknown check_type"})
		return
	}
	rule := RoutingRule{
		CheckType:        ct,
		OrderedProviders: body.OrderedProviders,
		Threshold:        body.Threshold,
		Enabled:          body.Enabled,
	}
	if err := h.svc.UpdateRoutingRule(c.Request.Context(), ginutil.UserID(c), rule); err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, rule)
}

// Events handles GET /api/finance/admin/kyc/events — the review-queue plus any
// sessions still pending, a lightweight admin activity view.
func (h *Handler) Events(c *gin.Context) {
	cases, err := h.svc.ReviewQueue(c.Request.Context(), 200, 0)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"events": cases})
}

// validCheckType guards the routing-rule path param against the CHECK domain.
func validCheckType(ct provider.KycCheckType) bool {
	switch ct {
	case provider.KycIDNumber, provider.KycIDFacial, provider.KycLiveness,
		provider.KycDocument, provider.KycAML:
		return true
	}
	return false
}

// WebhookService ingests provider callbacks/webhooks. Pipeline (hardened):
//  1. verify the signature via the provider's registered KycWebhookParser,
//  2. dedupe via webhook_event ON CONFLICT (provider,event_id) — redelivery is a
//     200 no-op,
//  3. parse into the normalized KycWebhookEvent,
//  4. find the check by client_ref,
//  5. guarded transition to the terminal status + persist normalized fields,
//  6. run the orchestrator (may elevate the tier),
//  7. audit.
//
// Idempotent: a redelivery of the same (provider,event_id) processes nothing.
type WebhookService struct {
	repo *Repository
	reg  *Registry
	pii  *PIIStore
	orch *Orchestrator
}

// NewWebhookService builds the webhook ingestion service. It shares the repo,
// registry, PII store and orchestrator with the member Service.
func (s *Service) NewWebhookService() *WebhookService {
	return &WebhookService{repo: s.repo, reg: s.reg, pii: s.pii, orch: s.orch}
}

// Verify reports whether the raw payload's signature is valid for a provider. A
// provider with no registered parser fails closed (unknown provider → false).
func (w *WebhookService) Verify(providerName string, payload []byte, signature string) bool {
	parser, ok := w.reg.ParserFor(providerName)
	if !ok {
		return false
	}
	return parser.VerifyKycSignature(payload, signature)
}

// Ingest processes one verified webhook delivery. The signature MUST already have
// been checked (handler calls Verify first). Returns nil for both a successful
// process and a benign redelivery no-op; a non-nil error is a genuine processing
// failure (the handler still ACKs 200 to stop provider retries, recording
// status=failed).
func (w *WebhookService) Ingest(ctx context.Context, providerName string, payload []byte) error {
	parser, ok := w.reg.ParserFor(providerName)
	if !ok {
		return fmt.Errorf("%w: unknown provider %q", ErrProviderUnavailable, providerName)
	}
	ev, err := parser.ParseKycWebhook(payload)
	if err != nil {
		return fmt.Errorf("kycverify: parse webhook %s: %w", providerName, err)
	}
	if ev == nil {
		return nil
	}

	eventID := ev.EventID
	if eventID == "" {
		// No event id surfaced — fall back to a deterministic dedupe key so we
		// still dedupe. Never drop.
		eventID = ev.ClientRef + ":" + string(ev.Status)
	}

	inserted, err := w.repo.InsertWebhookEvent(ctx, providerName, eventID, "kyc", payload)
	if err != nil {
		return err
	}
	if dec := DecideDedupe(boolToRows(inserted)); dec.AckNoOp {
		return nil // redelivery → ACK no-op
	}

	procErr := w.process(ctx, providerName, ev)

	status := "processed"
	if procErr != nil {
		status = "failed"
	}
	if merr := w.repo.MarkWebhookProcessed(ctx, providerName, eventID, status); merr != nil {
		log.Printf("kycverify: mark webhook processed provider=%s event=%s: %v", providerName, eventID, merr)
	}
	return procErr
}

// process correlates the event to a check by client_ref, applies the guarded
// terminal transition, and recomputes the session.
func (w *WebhookService) process(ctx context.Context, providerName string, ev *provider.KycWebhookEvent) error {
	if ev.ClientRef == "" {
		log.Printf("kycverify: webhook provider=%s missing client_ref — stored, no action", providerName)
		return nil
	}
	ch, err := w.repo.GetCheckByClientRef(ctx, ev.ClientRef)
	if err != nil {
		return err
	}

	dec := DecideTerminal(ev.Status)
	if !dec.Apply {
		return nil // still pending — leave the check as-is
	}
	// Idempotent: a redelivered terminal for an already-terminal check is a no-op
	// via the state machine's same-status rule.
	if err := applyCheckTransition(ch.Status, dec.Target); err != nil {
		return err
	}

	// Seal any raw payload the webhook carried (AAD = check id). Never logged.
	if len(ev.Raw) > 0 {
		if ref, perr := w.pii.Put(ctx, ch.ID, ch.UserID, providerName, ev.Raw); perr == nil {
			ch.RawPayloadRef = ref
		} else {
			log.Printf("kycverify: seal webhook payload check=%s: %v", ch.ID, perr)
		}
	}
	ch.Provider = providerName
	ch.ProviderRef = ev.ProviderRef
	ch.Status = dec.Target
	ch.Match = ev.Match
	ch.Confidence = ev.Confidence
	ch.Reason = ev.Reason
	if err := w.repo.UpdateCheckResult(ctx, ch); err != nil {
		return err
	}
	log.Printf("audit kycverify event=kycverify.webhook.applied user=%s id=%s detail=provider=%s status=%s",
		ch.UserID, ch.ID, providerName, dec.Target)

	// Recompute the session (may elevate the tier when the full set passed).
	if _, err := w.orch.Recompute(ctx, ch.SessionID); err != nil {
		return err
	}
	return nil
}

func boolToRows(b bool) int64 {
	if b {
		return 1
	}
	return 0
}
