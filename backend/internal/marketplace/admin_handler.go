package marketplace

import (
	"net/http"
	"spotlight/backend/internal/domain"
	"strconv"

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
	rows, err := h.svc.repo.AuditLog(c.Request.Context(), c.Query(colTargetType), c.Query(colTargetId), limit, offset)
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
// validBoostStatusFilters mirrors the boost_status SQL ENUM exactly
// (20260905000000_marketplace_v1.sql). mkt_boosts.status is a real enum column,
// so an out-of-vocabulary ?status= value would abort the query with "invalid
// input value for enum boost_status" — a 500 for a caller bug. Refused as a
// 400 here instead. Note 'cancelled_by_seller' is a Go-side display status,
// NOT a stored enum value, so it is deliberately absent.
var validBoostStatusFilters = map[string]bool{
	"purchased":            true,
	"active":               true,
	"completed":            true,
	"rejected_with_reason": true,
	"auto_refunded":        true,
}

func (h *Handler) AdminListBoosts(c *gin.Context) {
	limit, offset := pageParams(c)
	if st := c.Query("status"); st != "" && !validBoostStatusFilters[st] {
		fail(c, fieldErr(CodeValidation, "status must be one of purchased, active, completed, rejected_with_reason, auto_refunded", "status"))
		return
	}
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

// AdminAnalytics — admin_analytics_handler.go — GET /admin/analytics?range_days=N (MKT-007,
// ADM-005). See repository_admin_analytics.go's package doc for exactly which
// fields are real vs. structurally-unavailable-and-disclosed-as-0.
// ⚠️ Bare JSON, not respond()'s {"data": ...} envelope — matches
// getMarketplaceAnalytics() in marketplaceAdminService.ts, which does
// `return res.json()` and the analytics page reads `data.gmv_kobo` etc.
// directly off the top-level object (same contract-matching rationale as
// admin_taxonomy_handler.go).
func (h *Handler) AdminAnalytics(c *gin.Context) {
	rangeDays, err := strconv.Atoi(c.DefaultQuery("range_days", "30"))
	if err != nil || rangeDays <= 0 {
		rangeDays = 30
	}
	if rangeDays > 365 {
		rangeDays = 365 // guard against an accidental multi-year full-table scan
	}
	a, err := h.svc.repo.AdminAnalytics(c.Request.Context(), DefaultMarketID, rangeDays)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, a)
}

// admin_handler_appeals.go — MKT-007 Appeals. FileAppeal (member-facing, no
// RBAC) lives here too since it shares the Appeal model/service with the admin
// routes; it's registered on the member group in marketplace_routes.go, not
// under /admin.

// FileAppeal POST /appeals (member, auth-only — createAppeal has no admin-only
// gate in the frontend service and no admin-only call site: a real user files
// their own appeal).
func (h *Handler) FileAppeal(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	var body CreateAppealInput
	if err := c.ShouldBindJSON(&body); err != nil {
		fail(c, fieldErr(CodeValidation, err.Error(), ""))
		return
	}
	out, err := h.svc.FileAppeal(c.Request.Context(), uid, body)
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusCreated, out)
}

// AdminListAppeals GET /admin/appeals?status=
func (h *Handler) AdminListAppeals(c *gin.Context) {
	limit, offset := pageParams(c)
	out, err := h.svc.ListAppealsAdmin(c.Request.Context(), c.Query("status"), limit, offset)
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, out)
}

// AdminGetAppeal GET /admin/appeals/:id
func (h *Handler) AdminGetAppeal(c *gin.Context) {
	out, err := h.svc.GetAppealAdmin(c.Request.Context(), c.Param("id"))
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, out)
}

// AdminSetAppealStatus PATCH /admin/appeals/:id/status
func (h *Handler) AdminSetAppealStatus(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	var body struct {
		Status     string `json:"status"`
		ReasonCode string `json:"reason_code"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		fail(c, fieldErr(CodeValidation, err.Error(), ""))
		return
	}
	out, err := h.svc.SetAppealStatusAdmin(c.Request.Context(), uid, adminRole(c), c.Param("id"), body.Status, body.ReasonCode)
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, out)
}

// AdminDecideAppeal POST /admin/appeals/:id/decide — propose (maker for
// 'overturn'; immediate for 'uphold').
func (h *Handler) AdminDecideAppeal(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	var body DecideAppealInput
	if err := c.ShouldBindJSON(&body); err != nil {
		fail(c, fieldErr(CodeValidation, err.Error(), ""))
		return
	}
	out, err := h.svc.DecideAppealAdmin(c.Request.Context(), uid, adminRole(c), c.Param("id"), body)
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, out)
}

// AdminApproveAppeal POST /admin/appeals/:id/approve — checker step.
func (h *Handler) AdminApproveAppeal(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	var body reasonBody
	if err := c.ShouldBindJSON(&body); err != nil {
		fail(c, fieldErr(CodeValidation, err.Error(), ""))
		return
	}
	out, err := h.svc.ApproveAppealAdmin(c.Request.Context(), uid, adminRole(c), c.Param("id"), body.ReasonCode)
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, out)
}

// admin_handler_users.go — MKT-007 Users/Trust&Safety admin handlers.
// adminRole reads the caller's first RBAC role off the domain.AuthenticatedUser
// RequireAuthContext middleware sets under "authUser" (middleware.AuthUserContextKey),
// for the audit trail's admin_role column (mkt_admin_audit_log.admin_role NOT NULL).
func adminRole(c *gin.Context) string {
	if v, ok := c.Get("authUser"); ok {
		if au, ok := v.(domain.AuthenticatedUser); ok && len(au.Roles) > 0 {
			return au.Roles[0]
		}
	}
	return "admin"
}

// AdminSearchUsers GET /admin/users?q=&status=&min_fraud=
func (h *Handler) AdminSearchUsers(c *gin.Context) {
	limit, offset := pageParams(c)
	q := c.Query("q")
	status := c.Query("status")
	minFraud := 0.0
	if v := c.Query("min_fraud"); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil {
			minFraud = f
		}
	}
	out, err := h.svc.SearchUsersAdmin(c.Request.Context(), q, status, minFraud, limit, offset)
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, out)
}

// AdminGetUser GET /admin/users/:id
func (h *Handler) AdminGetUser(c *gin.Context) {
	out, err := h.svc.GetUserAdmin(c.Request.Context(), c.Param("id"))
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, out)
}

// AdminSetUserStatus POST /admin/users/:id/status — propose (maker).
func (h *Handler) AdminSetUserStatus(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	var body SetUserStatusInput
	if err := c.ShouldBindJSON(&body); err != nil {
		fail(c, fieldErr(CodeValidation, err.Error(), ""))
		return
	}
	out, err := h.svc.ProposeUserStatus(c.Request.Context(), uid, adminRole(c), c.Param("id"), body)
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, out)
}

// AdminApproveUserAction POST /admin/users/:id/action/approve — checker step.
func (h *Handler) AdminApproveUserAction(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	var body reasonBody
	if err := c.ShouldBindJSON(&body); err != nil {
		fail(c, fieldErr(CodeValidation, err.Error(), ""))
		return
	}
	out, err := h.svc.ApproveUserAction(c.Request.Context(), uid, adminRole(c), c.Param("id"), body.ReasonCode)
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, out)
}

// AdminReviewKYC POST /admin/users/:id/kyc/review
func (h *Handler) AdminReviewKYC(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	var body KycReviewInput
	if err := c.ShouldBindJSON(&body); err != nil {
		fail(c, fieldErr(CodeValidation, err.Error(), ""))
		return
	}
	out, err := h.svc.ReviewKYC(c.Request.Context(), uid, adminRole(c), c.Param("id"), body)
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, out)
}

// AdminBlacklistUser POST /admin/users/:id/blacklist
func (h *Handler) AdminBlacklistUser(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	var body BlacklistInput
	if err := c.ShouldBindJSON(&body); err != nil {
		fail(c, fieldErr(CodeValidation, err.Error(), ""))
		return
	}
	out, err := h.svc.BlacklistUser(c.Request.Context(), uid, adminRole(c), c.Param("id"), body)
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, out)
}

// AdminLogViewAs POST /admin/users/:id/audit/view-as
func (h *Handler) AdminLogViewAs(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	var body reasonBody
	if err := c.ShouldBindJSON(&body); err != nil {
		fail(c, fieldErr(CodeValidation, err.Error(), ""))
		return
	}
	if err := h.svc.LogViewAs(c.Request.Context(), uid, adminRole(c), c.Param("id"), body.ReasonCode); err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, gin.H{"id": c.Param("id"), "view_as_logged": true})
}

// AdminFraudSignals GET /admin/fraud/signals?severity=
func (h *Handler) AdminFraudSignals(c *gin.Context) {
	out, err := h.svc.ListFraudSignals(c.Request.Context(), c.Query("severity"))
	if err != nil {
		fail(c, err)
		return
	}
	respond(c, http.StatusOK, out)
}
