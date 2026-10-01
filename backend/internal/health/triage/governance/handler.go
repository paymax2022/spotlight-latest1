package governance

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"spotlight/backend/internal/health/triage"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/go-common/cryptox"
	"spotlight/backend/go-common/httperr"
)

// Handler exposes the admin clinical-governance API + the validation runner. All
// admin routes are RBAC-gated by health.triage.review (applied at registration).
// The actor is the authenticated reviewer (the licensed clinician signing off).
type Handler struct {
	gov    *GovernanceService
	val    *ValidationService
	engine triage.EngineProvider
}

// NewHandler builds the admin handler.
func NewHandler(gov *GovernanceService, val *ValidationService, engine triage.EngineProvider) *Handler {
	return &Handler{gov: gov, val: val, engine: engine}
}

func actor(c *gin.Context) string {
	if u, ok := middleware.GetAuthenticatedUser(c); ok {
		return u.ID
	}
	return c.GetString("user_id")
}

var govErrMap = httperr.New(http.StatusBadRequest,
	httperr.R(http.StatusNotFound, ErrNotFound),
	httperr.R(http.StatusForbidden, ErrSignOffRequired),
	httperr.R(http.StatusConflict, ErrIllegalTransition, ErrConflict),
)

// respond writes a uniform success/error envelope. Callers capture the (value,
// error) pair first (a multi-value call result cannot be spread alongside `c`).
func respond[T any](c *gin.Context, v T, err error) {
	if err != nil {
		govErrMap.WriteOK(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": v})
}

func (h *Handler) CreateContent(c *gin.Context) {
	var in ContentItem
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}
	v, err := h.gov.CreateContentDraft(c.Request.Context(), actor(c), in)
	respond(c, v, err)
}

func (h *Handler) EditContent(c *gin.Context) {
	var body struct {
		Body    string   `json:"body" binding:"required"`
		RAGTags []string `json:"rag_tags"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}
	v, err := h.gov.EditContent(c.Request.Context(), actor(c), c.Param("id"), body.Body, body.RAGTags)
	respond(c, v, err)
}

func (h *Handler) ListContent(c *gin.Context) {
	v, err := h.gov.ListContent(c.Request.Context(), c.Query("state"), c.Query("kind"), c.Query("language"))
	respond(c, v, err)
}

func (h *Handler) ContentLifecycle(c *gin.Context) {
	id := c.Param("id")
	uid := actor(c)
	ctx := c.Request.Context()
	var (
		v   *ContentItem
		err error
	)
	switch c.Param("action") {
	case "submit":
		v, err = h.gov.SubmitContentForReview(ctx, uid, id)
	case "approve":
		v, err = h.gov.ApproveContent(ctx, uid, id)
	case "kickback":
		v, err = h.gov.KickBackContent(ctx, uid, id)
	case "publish":
		v, err = h.gov.PublishContent(ctx, uid, id) // SC-6: reviewer = signer
	case "deprecate":
		v, err = h.gov.DeprecateContent(ctx, uid, id)
	default:
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "unknown action"})
		return
	}
	respond(c, v, err)
}

func (h *Handler) CreateRule(c *gin.Context) {
	var in RedFlagRule
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}
	v, err := h.gov.CreateRuleDraft(c.Request.Context(), actor(c), in)
	respond(c, v, err)
}

func (h *Handler) EditRule(c *gin.Context) {
	var body struct {
		Name         string        `json:"name" binding:"required"`
		Condition    RuleCondition `json:"condition"`
		UrgencyLevel int           `json:"urgency_level"`
		Severity     string        `json:"severity"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}
	v, err := h.gov.EditRule(c.Request.Context(), actor(c), c.Param("id"), body.Name, body.Condition, body.UrgencyLevel, body.Severity)
	respond(c, v, err)
}

func (h *Handler) ListRules(c *gin.Context) {
	v, err := h.gov.ListRules(c.Request.Context(), c.Query("state"))
	respond(c, v, err)
}

func (h *Handler) RuleLifecycle(c *gin.Context) {
	id := c.Param("id")
	uid := actor(c)
	ctx := c.Request.Context()
	var (
		v   *RedFlagRule
		err error
	)
	switch c.Param("action") {
	case "submit":
		v, err = h.gov.SubmitRuleForReview(ctx, uid, id)
	case "approve":
		v, err = h.gov.ApproveRule(ctx, uid, id)
	case "kickback":
		v, err = h.gov.KickBackRule(ctx, uid, id)
	case "publish":
		v, err = h.gov.PublishRule(ctx, uid, id) // SC-6 sign-off
	case "deprecate":
		v, err = h.gov.DeprecateRule(ctx, uid, id)
	default:
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "unknown action"})
		return
	}
	respond(c, v, err)
}

func (h *Handler) UpsertVignette(c *gin.Context) {
	var v Vignette
	if err := c.ShouldBindJSON(&v); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}
	out, err := h.val.store.UpsertVignette(c.Request.Context(), &v)
	respond(c, out, err)
}

func (h *Handler) ListVignettes(c *gin.Context) {
	v, err := h.val.store.ListVignettes(c.Request.Context())
	respond(c, v, err)
}

// RunValidation POST /health/triage/admin/validation/run — runs the shadow eval and
// returns the sensitivity report (SC-11). Emergency sensitivity leads.
func (h *Handler) RunValidation(c *gin.Context) {
	rep, err := h.val.RunShadowEval(c.Request.Context(), h.engine)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "report": rep})
}

func (h *Handler) UpsertLanguagePack(c *gin.Context) {
	var lp LanguagePack
	if err := c.ShouldBindJSON(&lp); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}
	v, err := h.gov.UpsertLanguagePack(c.Request.Context(), actor(c), lp)
	respond(c, v, err)
}

func (h *Handler) ListLanguagePacks(c *gin.Context) {
	v, err := h.gov.ListLanguagePacks(c.Request.Context())
	respond(c, v, err)
}

// RegisterHealthTriageGovernance wires the clinical-governance + validation admin
// API. Admin routes are RBAC-gated by health.triage.review; the member group is
// reserved for future bare member subpaths (the governance surface is admin-only
// today). Seeds the EN + Pidgin language packs + the African vignette corpus.
func RegisterHealthTriageGovernance(member, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService) {
	if pool == nil {
		return
	}
	repo := NewRepository(pool)
	gov := NewGovernanceService(repo)
	val := NewValidationService(repo)
	// The validation harness shadows the production engine; the deterministic mock
	// stands in until the licensed engine is wired by config.
	engine := triage.EngineProvider(triage.MockEngine{})
	h := NewHandler(gov, val, engine)

	// Best-effort seed of language packs + vignettes (idempotent upserts).
	ctx := context.Background()
	_ = gov.SeedLanguagePacks(ctx)
	_ = val.SeedVignettes(ctx)

	rev := middleware.RequirePermission(rbac, "health.triage.review")

	// Admin (RBAC health.triage.review) — content lifecycle.
	// admin is already rooted at /api/health/triage/admin (adminGroupTop5 in
	// health_triage_routes.go) — this used to re-prepend "/health/triage/admin",
	// doubling the segment and 404ing every governance admin call.
	cg := admin.Group("")
	cg.GET("/content", rev, h.ListContent)
	cg.POST("/content", rev, h.CreateContent)
	cg.PUT("/content/:id", rev, h.EditContent)
	cg.POST("/content/:id/:action", rev, h.ContentLifecycle) // submit|approve|kickback|publish|deprecate

	// Admin — red-flag-rule lifecycle.
	cg.GET("/rules", rev, h.ListRules)
	cg.POST("/rules", rev, h.CreateRule)
	cg.PUT("/rules/:id", rev, h.EditRule)
	cg.POST("/rules/:id/:action", rev, h.RuleLifecycle)

	// Admin — vignettes + validation.
	cg.GET("/vignettes", rev, h.ListVignettes)
	cg.POST("/vignettes", rev, h.UpsertVignette)
	cg.POST("/validation/run", rev, h.RunValidation)

	// Admin — language packs.
	cg.GET("/language-packs", rev, h.ListLanguagePacks)
	cg.POST("/language-packs", rev, h.UpsertLanguagePack)

	_ = member // reserved for future bare member subpaths
}

// NewDBRedFlagEngine builds the clinician-governed, DB-backed red-flag engine that
// LAYERS OVER triage.DefaultRedFlagEngine (urgency-only). Inject the returned
// engine into the core triage service: it loads only PUBLISHED rules and can only
// RAISE urgency above the deterministic default.
func NewDBRedFlagEngine(pool *pgxpool.Pool) *DBRedFlagEngine {
	return NewDBRedFlagEngineWithSource(NewRepository(pool), triage.DefaultRedFlagEngine{})
}

// MountWhatsApp mounts the signed inbound WhatsApp webhook at
// /internal/webhooks/triage/whatsapp. secret is config.TriageWhatsAppSecret;
// driver adapts the core triage service; enabled is
// FeatureHealthTriageWhatsAppEnabled. When pool is nil the mount is a no-op.
func MountWhatsApp(r gin.IRouter, pool *pgxpool.Pool, secret string, driver TriageDriver, enabled bool) {
	if pool == nil || driver == nil {
		return
	}
	wh := NewWhatsAppHandler(NewRepository(pool), secret, driver, enabled)
	r.POST("/internal/webhooks/triage/whatsapp", wh.Handle)
}

// EVERY channel message. These constants are the canonical footer; appendSafety
// guarantees they are present on every WhatsApp reply. ──

const (
	// DisclaimerText — the symptom checker triages & navigates; it never diagnoses.
	DisclaimerText = "Note: This is general guidance for triage, not a medical diagnosis. Always consult a qualified health professional."
	// EmergencyLine — the one-tap emergency escalation shown on every message.
	EmergencyLine = "EMERGENCY? Reply 999 or call 112 now for an ambulance."
)

// appendSafety appends the SC-8 disclaimer + one-tap emergency line to a reply,
// idempotently (it won't double-append if a line is already present). Every
// outbound WhatsApp message passes through here.
func appendSafety(reply string) string {
	reply = strings.TrimRight(reply, "\n ")
	if !strings.Contains(reply, DisclaimerText) {
		reply += "\n\n" + DisclaimerText
	}
	if !strings.Contains(reply, EmergencyLine) {
		reply += "\n" + EmergencyLine
	}
	return reply
}

// TriageDriver is the injected port the WhatsApp handler maps a message onto. The
// core triage service adapts to it: given an external (channel) id + the user's
// text + language, it starts or continues a triage session and returns the reply,
// whether the disposition is an emergency, and any error. Keeping this an interface
// means the governance package never imports/edits the protected core service.
type TriageDriver interface {
	StartOrContinue(ctx context.Context, externalID, text, language string) (reply string, emergency bool, err error)
}

// WhatsAppHandler is the signed inbound WhatsApp webhook. It HMAC-verifies the raw
// body, idempotently resolves the external id → channel session (so a redelivered
// webhook never starts a duplicate triage), drives the TriageDriver, and returns a
// reply that ALWAYS carries the SC-8 disclaimer + one-tap emergency line.
type WhatsAppHandler struct {
	repo    *Repository
	secret  string
	driver  TriageDriver
	enabled bool
}

// NewWhatsAppHandler builds the handler. enabled mirrors the
// FeatureHealthTriageWhatsAppEnabled flag — when false the route is inert.
func NewWhatsAppHandler(repo *Repository, secret string, driver TriageDriver, enabled bool) *WhatsAppHandler {
	return &WhatsAppHandler{repo: repo, secret: secret, driver: driver, enabled: enabled}
}

const channelWhatsApp = "whatsapp"

// verifySignature does a constant-time HMAC-SHA256 check of the raw body against
// the configured secret. The signature header may be "sha256=<hex>" or bare hex.
func (h *WhatsAppHandler) verifySignature(body []byte, sig string) bool {
	if h.secret == "" || sig == "" {
		return false
	}
	sig = strings.TrimPrefix(strings.TrimSpace(sig), "sha256=")
	return cryptox.ConstantTimeEqual(cryptox.HMACSHA256Hex(h.secret, string(body)), sig)
}

// inboundMessage is the minimal shape we read from a WhatsApp inbound payload.
// MessageID is the idempotency key (the provider's unique per-message id); From is
// the wa_id used as the external session id.
type inboundMessage struct {
	MessageID string `json:"message_id"`
	From      string `json:"from"`
	Text      string `json:"text"`
	Language  string `json:"language"`
}

// Handle handles POST /internal/webhooks/triage/whatsapp.
func (h *WhatsAppHandler) Handle(c *gin.Context) {
	if !h.enabled {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "whatsapp triage disabled"})
		return
	}
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.Status(http.StatusBadRequest)
		return
	}
	sig := c.GetHeader("X-Hub-Signature-256")
	if sig == "" {
		sig = c.GetHeader("X-Signature")
	}
	if !h.verifySignature(body, sig) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid signature"})
		return
	}

	var msg inboundMessage
	if err := json.Unmarshal(body, &msg); err != nil || msg.From == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payload"})
		return
	}
	if msg.Language == "" {
		msg.Language = "en"
	}

	ctx := c.Request.Context()

	// Idempotency: key on the provider message id (unique per message). If we've
	// already processed this exact message, ack without re-driving the triage.
	idemKey := msg.MessageID
	if idemKey == "" {
		idemKey = msg.From // degrade gracefully; still de-dupes per sender turn
	}
	_, inserted, err := h.repo.UpsertChannelSession(ctx, channelWhatsApp, idemKey, nil)
	if err != nil {
		c.Status(http.StatusInternalServerError)
		return
	}
	if !inserted {
		// Redelivery: already handled. Re-emit a safe ack (still SC-8 compliant).
		c.JSON(http.StatusOK, gin.H{"reply": appendSafety("We already received that message."), "duplicate": true})
		return
	}

	// Drive the core triage via the injected adapter, keyed by the sender wa_id.
	reply, emergency, derr := h.driver.StartOrContinue(ctx, msg.From, msg.Text, msg.Language)
	if derr != nil {
		// Even on error, return an SC-8-compliant safe message (emergency line always present).
		c.JSON(http.StatusOK, gin.H{
			"reply": appendSafety("Sorry, we hit a problem. If this is urgent, please seek care now."),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"reply":     appendSafety(reply),
		"emergency": emergency,
	})
}
