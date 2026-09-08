package marketplace

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// admin_handler.go implements the /v1/marketplace/admin routes. Every mutating admin
// route requires reason_code in the body (§ integration contract) and the service
// writes an immutable mkt_admin_audit_log row.

// reasonBody is the common admin mutation body carrying the mandatory reason_code.
type reasonBody struct {
	ReasonCode string `json:"reason_code"`
}

// AdminModerationQueue GET /admin/moderation/queue
func (h *Handler) AdminModerationQueue(c *gin.Context) {
	limit, offset := pageParams(c)
	ls, err := h.svc.ModerationQueue(c.Request.Context(), limit, offset)
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, ls)
}

// AdminApproveListing POST /admin/listings/:id/approve
func (h *Handler) AdminApproveListing(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	var body reasonBody
	_ = c.ShouldBindJSON(&body)
	l, err := h.svc.ApproveListing(c.Request.Context(), uid, c.Param("id"), body.ReasonCode)
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, l)
}

// AdminRejectListing POST /admin/listings/:id/reject — reason_code MANDATORY.
func (h *Handler) AdminRejectListing(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	var body reasonBody
	if err := c.ShouldBindJSON(&body); err != nil {
		fail(c, fieldErr(CodeValidation, err.Error(), ""))
		return
	}
	l, err := h.svc.RejectListing(c.Request.Context(), uid, c.Param("id"), body.ReasonCode)
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, l)
}

// AdminFlags GET /admin/flags
func (h *Handler) AdminFlags(c *gin.Context) {
	limit, offset := pageParams(c)
	fs, err := h.svc.repo.ListFlags(c.Request.Context(), c.Query("status"), limit, offset)
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, fs)
}

// AdminActionFlag POST /admin/flags/:id/action — reason_code MANDATORY.
func (h *Handler) AdminActionFlag(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	var body struct {
		Action     string `json:"action"` // actioned | dismissed
		ReasonCode string `json:"reason_code"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		fail(c, fieldErr(CodeValidation, err.Error(), ""))
		return
	}
	if body.ReasonCode == "" {
		fail(c, ErrReasonRequired)
		return
	}
	if body.Action != "actioned" && body.Action != "dismissed" {
		fail(c, fieldErr(CodeValidation, "action must be actioned or dismissed", "action"))
		return
	}
	if err := h.svc.ActionFlag(c.Request.Context(), uid, c.Param("id"), body.Action, body.ReasonCode); err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, gin.H{"ok": true})
}

// AdminMetrics GET /admin/marketplace/metrics — live KPI snapshot for the
// admin dashboard.
func (h *Handler) AdminMetrics(c *gin.Context) {
	m, err := h.svc.repo.AdminMetrics(c.Request.Context())
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, m)
}

// AdminActivityFeed GET /admin/marketplace/activity-feed?limit= — recent
// marketplace activity, newest first.
func (h *Handler) AdminActivityFeed(c *gin.Context) {
	limit, _ := pageParams(c)
	rows, err := h.svc.repo.AdminActivityFeed(c.Request.Context(), limit)
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, rows)
}

// AdminAuditLog GET /admin/audit-log?target_type=&target_id=
func (h *Handler) AdminAuditLog(c *gin.Context) {
	limit, offset := pageParams(c)
	rows, err := h.svc.repo.AuditLog(c.Request.Context(), c.Query("target_type"), c.Query("target_id"), limit, offset)
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, rows)
}

// AdminListBoosts GET /admin/boosts?status=&limit=&offset= — platform-wide boost
// list for the admin console. Boosts are the one LIVE marketplace money path
// (§2.4), so admins must be able to list/moderate them. Read-scoped by
// marketplace.admin.moderation (same style as AdminModerationQueue / AdminFlags).
// Returns the uniform {"data":[...]} envelope (respond) with camel-free snake_case
// keys matching the member boost API + an additive listing_title per row.
func (h *Handler) AdminListBoosts(c *gin.Context) {
	limit, offset := pageParams(c)
	bs, err := h.svc.repo.ListBoosts(c.Request.Context(), c.Query("status"), limit, offset)
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, bs)
}

// AdminRejectBoost POST /admin/boosts/:id/reject — reason_code MANDATORY (§2.4).
// (Not in the frozen route list explicitly, but exposed for the admin boost console;
// safe additive admin action following the exemplar.)
func (h *Handler) AdminRejectBoost(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	var body reasonBody
	if err := c.ShouldBindJSON(&body); err != nil {
		fail(c, fieldErr(CodeValidation, err.Error(), ""))
		return
	}
	b, err := h.svc.RejectBoost(c.Request.Context(), uid, c.Param("id"), body.ReasonCode)
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, b)
}

// ─── Boost pricing (ADM-002/MO-002) ────────────────────────────────────────────
// GET routes are read-scoped like the other dashboard-ish admin GETs; PUT routes
// require reason_code and RBAC guard("marketplace.admin.pricing"), applied at
// route registration (marketplace_routes.go), matching the moderation pattern.

// AdminListBoostPackages GET /admin/pricing/boosts
func (h *Handler) AdminListBoostPackages(c *gin.Context) {
	pkgs, err := h.svc.repo.ListBoostPackages(c.Request.Context())
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, pkgs)
}

// boostPackageBody is PUT /admin/pricing/boosts' request body — the
// MktBoostPackage shape (frontend-admin/src/types/marketplaceAdmin.ts) plus
// the mandatory reason_code the console merges into the same object.
type boostPackageBody struct {
	Tier         string  `json:"tier"`
	Label        string  `json:"label"`
	DurationDays int     `json:"duration_days"`
	PriceKobo    int64   `json:"price_kobo"`
	Weight       float64 `json:"weight"`
	IsActive     bool    `json:"is_active"`
	ReasonCode   string  `json:"reason_code"`
}

// AdminUpsertBoostPackage PUT /admin/pricing/boosts — reason_code MANDATORY.
func (h *Handler) AdminUpsertBoostPackage(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	var body boostPackageBody
	if err := c.ShouldBindJSON(&body); err != nil {
		fail(c, fieldErr(CodeValidation, err.Error(), ""))
		return
	}
	if body.Tier == "" || body.Label == "" {
		fail(c, fieldErr(CodeValidation, "tier and label are required", "tier"))
		return
	}
	if body.DurationDays <= 0 {
		fail(c, fieldErr(CodeValidation, "duration_days must be > 0", "duration_days"))
		return
	}
	if body.PriceKobo < 0 {
		fail(c, fieldErr(CodeValidation, "price_kobo must be >= 0", "price_kobo"))
		return
	}
	pkg, err := h.svc.UpsertBoostPackage(c.Request.Context(), uid, BoostPackage{
		Tier: body.Tier, Label: body.Label, DurationDays: body.DurationDays,
		PriceKobo: body.PriceKobo, Weight: body.Weight, IsActive: body.IsActive,
	}, body.ReasonCode)
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, pkg)
}

// AdminGetBoostDailyRate GET /admin/pricing/boosts/daily-rate
func (h *Handler) AdminGetBoostDailyRate(c *gin.Context) {
	r, err := h.svc.repo.GetBoostDailyRate(c.Request.Context())
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, r)
}

// AdminSetBoostDailyRate PUT /admin/pricing/boosts/daily-rate — reason_code MANDATORY.
func (h *Handler) AdminSetBoostDailyRate(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	var body struct {
		DailyRateKobo int64  `json:"daily_rate_kobo"`
		ReasonCode    string `json:"reason_code"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		fail(c, fieldErr(CodeValidation, err.Error(), ""))
		return
	}
	r, err := h.svc.SetBoostDailyRate(c.Request.Context(), uid, body.DailyRateKobo, body.ReasonCode)
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, r)
}
