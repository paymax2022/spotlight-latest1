package referrals

import (
	"crypto/subtle"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
)

// RewardHandler exposes the Direct Referral Rewards ENGINE HTTP surface: the user
// API (/v1/referrals), the admin console (/v1/admin/referrals), and the internal
// service-to-service purchase hooks. JSON is snake_case to match the existing
// referrals handler convention.
type RewardHandler struct {
	svc            *RewardService
	internalSecret string // shared secret guarding /internal/referrals/* (empty ⇒ closed)
}

// NewRewardHandler builds the handler. internalSecret guards the internal hooks;
// if empty, the internal endpoints fail closed (503) so a purchase event can never
// be accepted unauthenticated.
func NewRewardHandler(svc *RewardService, internalSecret string) *RewardHandler {
	return &RewardHandler{svc: svc, internalSecret: internalSecret}
}

// callerID returns the authenticated user id (mirrored by RequireAuthContext).
func callerID(c *gin.Context) string { return c.GetString("user_id") }

// ============================================================================
// USER API — /v1/referrals (Bearer; object-level authZ = caller's own data).
// ============================================================================

// PostLink handles POST /v1/referrals/link — generate/fetch the caller's code.
func (h *RewardHandler) PostLink(c *gin.Context) {
	uid := callerID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	link, err := h.svc.GetOrCreateLink(c.Request.Context(), uid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, link)
}

// PostAttribute handles POST /v1/referrals/attribute — apply a code at signup.
// Idempotent per user; rejects self-referral and unknown codes.
func (h *RewardHandler) PostAttribute(c *gin.Context) {
	uid := callerID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	var req struct {
		Code string `json:"code"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	referrerID, err := h.svc.Attribute(c.Request.Context(), uid, req.Code)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"referrer_id": referrerID, "referred_user_id": uid})
}

// GetDashboard handles GET /v1/referrals/me/dashboard.
func (h *RewardHandler) GetDashboard(c *gin.Context) {
	uid := callerID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	d, err := h.svc.GetDashboard(c.Request.Context(), uid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, d)
}

// GetReferrals handles GET /v1/referrals/me/referrals.
func (h *RewardHandler) GetReferrals(c *gin.Context) {
	uid := callerID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	list, err := h.svc.ListReferrals(c.Request.Context(), uid, limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"referrals": list})
}

// GetEarnings handles GET /v1/referrals/me/earnings (paginated).
func (h *RewardHandler) GetEarnings(c *gin.Context) {
	uid := callerID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	rewards, err := h.svc.ListEarnings(c.Request.Context(), uid, limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"earnings": rewards})
}

// GetMilestones handles GET /v1/referrals/me/milestones (achieved + upcoming).
func (h *RewardHandler) GetMilestones(c *gin.Context) {
	uid := callerID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	achieved, upcoming, err := h.svc.ListMilestones(c.Request.Context(), uid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"achieved": achieved, "upcoming": upcoming})
}

// ============================================================================
// INTERNAL — service-to-service purchase hooks (shared-secret guarded).
// ============================================================================

// requireInternalSecret fail-closes: no configured secret ⇒ 503; mismatch ⇒ 401.
// The header is X-Internal-Secret; compared in constant time.
func (h *RewardHandler) requireInternalSecret(c *gin.Context) bool {
	if h.internalSecret == "" {
		c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{"error": "internal endpoint disabled"})
		return false
	}
	got := c.GetHeader("X-Internal-Secret")
	if subtle.ConstantTimeCompare([]byte(got), []byte(h.internalSecret)) != 1 {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid internal secret"})
		return false
	}
	return true
}

// PostPurchaseSettled handles POST /internal/referrals/purchase-settled.
func (h *RewardHandler) PostPurchaseSettled(c *gin.Context) {
	if !h.requireInternalSecret(c) {
		return
	}
	var in PurchaseSettled
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	if in.SettledAt.IsZero() {
		in.SettledAt = time.Now()
	}
	if err := h.svc.OnPurchaseSettled(c.Request.Context(), in); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

// PostPurchaseRefunded handles POST /internal/referrals/purchase-refunded.
func (h *RewardHandler) PostPurchaseRefunded(c *gin.Context) {
	if !h.requireInternalSecret(c) {
		return
	}
	var in PurchaseRefunded
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	if in.RefundedAt.IsZero() {
		in.RefundedAt = time.Now()
	}
	if err := h.svc.OnPurchaseRefunded(c.Request.Context(), in); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

// PostRecalcTiers handles POST /internal/referrals/recalc-tiers — a manual trigger
// for the nightly recalc when no in-process scheduler is running.
func (h *RewardHandler) PostRecalcTiers(c *gin.Context) {
	if !h.requireInternalSecret(c) {
		return
	}
	if err := h.svc.RecalculateTiers(c.Request.Context()); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

// ============================================================================
// ADMIN API — /v1/admin/referrals (RBAC applied per-route in the router).
// ============================================================================

// AdminGetConfig handles GET /v1/admin/referrals/config (A1).
func (h *RewardHandler) AdminGetConfig(c *gin.Context) {
	cfg, err := h.svc.GetActiveConfig(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, cfg)
}

// AdminPutConfig handles PUT /v1/admin/referrals/config (A1) — publish a new
// versioned config. Warns (via response) that it applies to FUTURE transactions.
func (h *RewardHandler) AdminPutConfig(c *gin.Context) {
	var req struct {
		TierTable      []TierBand      `json:"tier_table"`
		MilestoneTable []MilestoneBand `json:"milestone_table"`
		EffectiveFrom  *time.Time      `json:"effective_from"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	var eff time.Time
	if req.EffectiveFrom != nil {
		eff = *req.EffectiveFrom
	}
	cfg, err := h.svc.PublishConfig(c.Request.Context(), req.TierTable, req.MilestoneTable, eff, callerID(c))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"config":  cfg,
		"warning": "changes apply to future transactions only; past rewards are never recomputed",
	})
}

// AdminAnalytics handles GET /v1/admin/referrals/analytics (A2).
func (h *RewardHandler) AdminAnalytics(c *gin.Context) {
	a, err := h.svc.GetAnalytics(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, a)
}

// AdminFraudQueue handles GET /v1/admin/referrals/fraud-queue (A3).
func (h *RewardHandler) AdminFraudQueue(c *gin.Context) {
	flags, err := h.svc.ListFraudQueue(c.Request.Context(), c.Query("status"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"flags": flags})
}

// AdminFraudAction handles POST /v1/admin/referrals/fraud-queue (A3) — action a flag.
func (h *RewardHandler) AdminFraudAction(c *gin.Context) {
	var req struct {
		FlagID string `json:"flag_id"`
		Action string `json:"action"` // CLEARED / VOIDED / SUSPENDED
		Note   string `json:"note"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	if err := h.svc.ActionFraudFlag(c.Request.Context(), req.FlagID, req.Action, req.Note, callerID(c)); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

// AdminLedger handles GET /v1/admin/referrals/ledger (A4), filterable.
func (h *RewardHandler) AdminLedger(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "100"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	rewards, err := h.svc.AdminListLedger(c.Request.Context(), c.Query("status"), c.Query("module"), limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ledger": rewards})
}

// AdminGetCase handles GET /v1/admin/referrals/:referrerId/case (A5).
func (h *RewardHandler) AdminGetCase(c *gin.Context) {
	referrerID := c.Param("referrerId")
	cv, err := h.svc.GetCase(c.Request.Context(), referrerID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, cv)
}

// AdminAdjustCase handles POST /v1/admin/referrals/:referrerId/case (A5). A manual
// adjustment requires a logged reason and an Idempotency-Key header.
func (h *RewardHandler) AdminAdjustCase(c *gin.Context) {
	referrerID := c.Param("referrerId")
	idem := c.GetHeader("Idempotency-Key")
	if idem == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Idempotency-Key header required"})
		return
	}
	var req struct {
		AdjustKobo int64  `json:"adjust_kobo"`
		Reason     string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	if err := h.svc.AdjustCase(c.Request.Context(), referrerID, req.AdjustKobo, req.Reason, callerID(c), idem); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

// AdminMilestonesLog handles GET /v1/admin/referrals/milestones-log (A6).
func (h *RewardHandler) AdminMilestonesLog(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "100"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	log, err := h.svc.ListMilestonesLog(c.Request.Context(), limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"milestones": log})
}

// AdminModuleStatus handles GET /v1/admin/referrals/module-status (A7).
func (h *RewardHandler) AdminModuleStatus(c *gin.Context) {
	mods, err := h.svc.ModuleStatus(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"modules": mods})
}
