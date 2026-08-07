package governance

import (
	"context"
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/health/triage"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
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

func statusFor(err error) int {
	switch {
	case errors.Is(err, ErrNotFound):
		return http.StatusNotFound
	case errors.Is(err, ErrSignOffRequired):
		return http.StatusForbidden
	case errors.Is(err, ErrIllegalTransition):
		return http.StatusConflict
	case errors.Is(err, ErrConflict):
		return http.StatusConflict
	default:
		return http.StatusBadRequest
	}
}

// respond writes a uniform success/error envelope. Callers capture the (value,
// error) pair first (a multi-value call result cannot be spread alongside `c`).
func respond[T any](c *gin.Context, v T, err error) {
	if err != nil {
		c.JSON(statusFor(err), gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": v})
}

// ─────────────────────────────── Content ─────────────────────────────────────

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

// ─────────────────────────────── Red-flag rules ──────────────────────────────

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

// ─────────────────────────────── Vignettes / validation ──────────────────────

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

// ─────────────────────────────── Language packs ──────────────────────────────

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

// ─────────────────────────────── Wiring ──────────────────────────────────────

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
	cg := admin.Group("/health/triage/admin")
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
