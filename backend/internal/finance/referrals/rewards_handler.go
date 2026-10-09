package referrals

import (
	"crypto/subtle"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
)

const keyInvalidBody = "invalid body"

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

// USER API — /v1/referrals (Bearer; object-level authZ = caller's own data).

// PostLink handles POST /v1/referrals/link — generate/fetch the caller's code.
func (h *RewardHandler) PostLink(c *gin.Context) {
	uid := ginutil.UserID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{keyError: msgUnauthenticated})
		return
	}
	link, err := h.svc.GetOrCreateLink(c.Request.Context(), uid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, link)
}

// PostAttribute handles POST /v1/referrals/attribute — apply a code at signup
// or as a late claim. Idempotent per user; rejects self-referral and unknown
// codes. The response is honest about the outcome: `attributed` is true only
// when the submitted code is the attribution now in effect (false when a
// different real referrer already won or the house placeholder is no longer
// claimable), and `referrer_id` is the caller's ACTUAL current referrer —
// empty when still house-attributed.
func (h *RewardHandler) PostAttribute(c *gin.Context) {
	uid := ginutil.UserID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{keyError: msgUnauthenticated})
		return
	}
	var req struct {
		Code string `json:"code"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: keyInvalidBody})
		return
	}
	referrerID, attributed, err := h.svc.Attribute(c.Request.Context(), uid, req.Code)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		keyReferrerID: referrerID, keyReferredUserID: uid, "attributed": attributed,
	})
}

// GetDashboard handles GET /v1/referrals/me/dashboard.
func (h *RewardHandler) GetDashboard(c *gin.Context) {
	uid := ginutil.UserID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{keyError: msgUnauthenticated})
		return
	}
	d, err := h.svc.GetDashboard(c.Request.Context(), uid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, d)
}

// parsePageParams validates ?limit/?offset from raw query values. Malformed or
// negative input is an error (the caller turns it into a 400): before this,
// strconv.Atoi errors were swallowed to 0 — so `limit=abc` silently returned an
// empty page — and `offset=-1` reached SQL verbatim and 500'd on
// `OFFSET must not be negative`. limit is clamped to [default, max]; offset
// must be >= 0.
func parsePageParams(limitRaw, offsetRaw string, def, max int) (int, int, error) {
	limit, offset := def, 0
	if limitRaw != "" {
		v, err := strconv.Atoi(limitRaw)
		if err != nil || v < 0 {
			return 0, 0, fmt.Errorf("invalid limit %q", limitRaw)
		}
		limit = v
	}
	if offsetRaw != "" {
		v, err := strconv.Atoi(offsetRaw)
		if err != nil || v < 0 {
			return 0, 0, fmt.Errorf("invalid offset %q", offsetRaw)
		}
		offset = v
	}
	if limit == 0 {
		limit = def
	}
	if limit > max {
		limit = max
	}
	return limit, offset, nil
}

// pageParams is parsePageParams + the standard 400 response.
func pageParams(c *gin.Context, def, max int) (int, int, bool) {
	limit, offset, err := parsePageParams(c.Query("limit"), c.Query("offset"), def, max)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: err.Error()})
		return 0, 0, false
	}
	return limit, offset, true
}

// GetReferrals handles GET /v1/referrals/me/referrals.
func (h *RewardHandler) GetReferrals(c *gin.Context) {
	uid := ginutil.UserID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{keyError: msgUnauthenticated})
		return
	}
	limit, offset, ok := pageParams(c, 50, 200)
	if !ok {
		return
	}
	list, err := h.svc.ListReferrals(c.Request.Context(), uid, limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"referrals": list})
}

// GetEarnings handles GET /v1/referrals/me/earnings (paginated).
func (h *RewardHandler) GetEarnings(c *gin.Context) {
	uid := ginutil.UserID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{keyError: msgUnauthenticated})
		return
	}
	limit, offset, ok := pageParams(c, 50, 200)
	if !ok {
		return
	}
	rewards, err := h.svc.ListEarnings(c.Request.Context(), uid, limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"earnings": rewards})
}

// GetMilestones handles GET /v1/referrals/me/milestones (achieved + upcoming).
func (h *RewardHandler) GetMilestones(c *gin.Context) {
	uid := ginutil.UserID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{keyError: msgUnauthenticated})
		return
	}
	achieved, upcoming, err := h.svc.ListMilestones(c.Request.Context(), uid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"achieved": achieved, "upcoming": upcoming})
}

// INTERNAL — service-to-service purchase hooks (shared-secret guarded).

// requireInternalSecret fail-closes: no configured secret ⇒ 503; mismatch ⇒ 401.
// The header is X-Internal-Secret; compared in constant time.
func (h *RewardHandler) requireInternalSecret(c *gin.Context) bool {
	if h.internalSecret == "" {
		c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{keyError: "internal endpoint disabled"})
		return false
	}
	got := c.GetHeader("X-Internal-Secret")
	if subtle.ConstantTimeCompare([]byte(got), []byte(h.internalSecret)) != 1 {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{keyError: "invalid internal secret"})
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
		c.JSON(http.StatusBadRequest, gin.H{keyError: keyInvalidBody})
		return
	}
	if in.SettledAt.IsZero() {
		in.SettledAt = time.Now()
	}
	if err := h.svc.OnPurchaseSettled(c.Request.Context(), in); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
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
		c.JSON(http.StatusBadRequest, gin.H{keyError: keyInvalidBody})
		return
	}
	if in.RefundedAt.IsZero() {
		in.RefundedAt = time.Now()
	}
	if err := h.svc.OnPurchaseRefunded(c.Request.Context(), in); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
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
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

// ADMIN API — /v1/admin/referrals (RBAC applied per-route in the router).

// AdminGetConfig handles GET /v1/admin/referrals/config (A1).
func (h *RewardHandler) AdminGetConfig(c *gin.Context) {
	cfg, err := h.svc.GetActiveConfig(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
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
		c.JSON(http.StatusBadRequest, gin.H{keyError: keyInvalidBody})
		return
	}
	var eff time.Time
	if req.EffectiveFrom != nil {
		eff = *req.EffectiveFrom
	}
	cfg, err := h.svc.PublishConfig(c.Request.Context(), req.TierTable, req.MilestoneTable, eff, ginutil.UserID(c))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
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
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, a)
}

// AdminFraudQueue handles GET /v1/admin/referrals/fraud-queue (A3).
func (h *RewardHandler) AdminFraudQueue(c *gin.Context) {
	flags, err := h.svc.ListFraudQueue(c.Request.Context(), c.Query("status"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
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
		c.JSON(http.StatusBadRequest, gin.H{keyError: keyInvalidBody})
		return
	}
	if err := h.svc.ActionFraudFlag(c.Request.Context(), req.FlagID, req.Action, req.Note, ginutil.UserID(c)); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

// AdminLedger handles GET /v1/admin/referrals/ledger (A4), filterable.
func (h *RewardHandler) AdminLedger(c *gin.Context) {
	limit, offset, ok := pageParams(c, 100, 500)
	if !ok {
		return
	}
	rewards, err := h.svc.AdminListLedger(c.Request.Context(), c.Query("status"), c.Query("module"), limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ledger": rewards})
}

// AdminGetCase handles GET /v1/admin/referrals/:referrerId/case (A5).
func (h *RewardHandler) AdminGetCase(c *gin.Context) {
	referrerID := c.Param("referrerId")
	cv, err := h.svc.GetCase(c.Request.Context(), referrerID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, cv)
}

// AdminAdjustCase handles POST /v1/admin/referrals/:referrerId/case (A5). A manual
// adjustment requires a logged reason and an Idempotency-Key header.
func (h *RewardHandler) AdminAdjustCase(c *gin.Context) {
	referrerID := c.Param("referrerId")
	idem := ginutil.IdempotencyKey(c)
	if idem == "" {
		c.JSON(http.StatusBadRequest, gin.H{keyError: "Idempotency-Key header required"})
		return
	}
	var req struct {
		AdjustKobo int64  `json:"adjust_kobo"`
		Reason     string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: keyInvalidBody})
		return
	}
	if err := h.svc.AdjustCase(c.Request.Context(), referrerID, req.AdjustKobo, req.Reason, ginutil.UserID(c), idem); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

// AdminSetCode handles PUT /v1/admin/referrals/:referrerId/code.
// Lets an admin replace a referrer's generated code with a memorable one. The
// 409 branch is the feature's whole safety story: codes are the key attribution
// resolves on, so handing one person a code that already belongs to another
// would silently redirect the original owner's rewards.
func (h *RewardHandler) AdminSetCode(c *gin.Context) {
	referrerID := c.Param("referrerId")
	if referrerID == "" {
		c.JSON(http.StatusBadRequest, gin.H{keyError: "referrerId required"})
		return
	}
	var req struct {
		Code string `json:"code"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: keyInvalidBody})
		return
	}
	link, err := h.svc.SetLinkCode(c.Request.Context(), referrerID, req.Code)
	switch {
	case errors.Is(err, ErrCodeTaken):
		// 409, not 400: the request is well formed, the code is simply spoken
		// for. The admin UI needs to tell those apart to say anything useful.
		c.JSON(http.StatusConflict, gin.H{keyError: "that referral code is already in use"})
		return
	case err != nil:
		// Validation messages name the offending character on purpose — "invalid
		// code" would leave an admin guessing which of five characters is wrong.
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": link.Code, keyReferrerID: link.ReferrerID})
}

// AdminMilestonesLog handles GET /v1/admin/referrals/milestones-log (A6).
func (h *RewardHandler) AdminMilestonesLog(c *gin.Context) {
	limit, offset, ok := pageParams(c, 100, 500)
	if !ok {
		return
	}
	log, err := h.svc.ListMilestonesLog(c.Request.Context(), limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"milestones": log})
}

// AdminModuleStatus handles GET /v1/admin/referrals/module-status (A7).
func (h *RewardHandler) AdminModuleStatus(c *gin.Context) {
	mods, err := h.svc.ModuleStatus(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"modules": mods})
}
