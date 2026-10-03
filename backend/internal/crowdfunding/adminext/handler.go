package adminext

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	financekyc "spotlight/backend/internal/finance/kyc"
	financeledger "spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// Handler exposes the crowdfunding admin domain over gin. The admin id is read
// from the gin context ("user_id"), populated by the requireUserID() middleware
// the admin group is registered with.
type Handler struct{ svc *Service }

var errMap = httperr.New(http.StatusBadRequest,
	httperr.R(http.StatusNotFound, ErrWithdrawalNotFound, ErrCampaignNotFound, ErrFeatureRequestNotFound),
	httperr.R(http.StatusConflict, ErrWithdrawalIllegalState, ErrInsufficientBalance, ErrCampaignNotActive, ErrFeatureRequestNotPending),
)

// NewHandler constructs the admin handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// FinanceSummary — GET /finance/summary (singleton, returned directly).
func (h *Handler) FinanceSummary(c *gin.Context) {
	res, err := h.svc.GetFinanceSummary(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, res)
}

// ListRefunds — GET /refunds.
func (h *Handler) ListRefunds(c *gin.Context) {
	items, err := h.svc.ListRefunds(c.Request.Context(), c.Query("status"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"refunds": items})
}

// ApproveRefund — POST /refunds/:id/approve.
func (h *Handler) ApproveRefund(c *gin.Context) { h.decideRefund(c, true) }

// RejectRefund — POST /refunds/:id/reject.
func (h *Handler) RejectRefund(c *gin.Context) { h.decideRefund(c, false) }

func (h *Handler) decideRefund(c *gin.Context, approve bool) {
	var req NoteRequest
	_ = c.ShouldBindJSON(&req)
	if err := h.svc.DecideRefund(c.Request.Context(), c.Param("id"), ginutil.UserID(c), approve, req.Note); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ListSettlements — GET /settlements.
func (h *Handler) ListSettlements(c *gin.Context) {
	items, err := h.svc.ListSettlements(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"batches": items})
}

// ListDisputes — GET /disputes.
func (h *Handler) ListDisputes(c *gin.Context) {
	items, err := h.svc.ListDisputes(c.Request.Context(), c.Query("status"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"disputes": items})
}

// ResolveDispute — POST /disputes/:id/resolve.
func (h *Handler) ResolveDispute(c *gin.Context) {
	var req ResolveDisputeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	if err := h.svc.ResolveDispute(c.Request.Context(), c.Param("id"), ginutil.UserID(c), req.Resolution, req.Note); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ListWithdrawals — GET /withdrawals.
func (h *Handler) ListWithdrawals(c *gin.Context) {
	items, err := h.svc.ListWithdrawals(c.Request.Context(), c.Query("status"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"withdrawals": items})
}

// ApproveWithdrawal — POST /withdrawals/:id/approve.
// MONEY-PATH: debits the creator's own settled wallet balance to the
// payout-clearing account and marks the withdrawal COMPLETED. Requires an
// Idempotency-Key header (fail-closed).
func (h *Handler) ApproveWithdrawal(c *gin.Context) {
	idempotencyKey := ginutil.IdempotencyKey(c)
	if idempotencyKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{keyError: "Idempotency-Key header is required"})
		return
	}
	res, err := h.svc.ApproveWithdrawal(c.Request.Context(), c.Param("id"), ginutil.UserID(c), idempotencyKey)
	if err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// RejectWithdrawal — POST /withdrawals/:id/reject.
func (h *Handler) RejectWithdrawal(c *gin.Context) { h.decideWithdrawal(c, false) }

func (h *Handler) decideWithdrawal(c *gin.Context, approve bool) {
	var req NoteRequest
	_ = c.ShouldBindJSON(&req)
	if err := h.svc.DecideWithdrawal(c.Request.Context(), c.Param("id"), ginutil.UserID(c), approve, req.Note); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ListFraudAlerts — GET /fraud-alerts.
func (h *Handler) ListFraudAlerts(c *gin.Context) {
	items, err := h.svc.ListFraudAlerts(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"alerts": items})
}

// FreezeCampaign — POST /campaigns/:id/freeze.
func (h *Handler) FreezeCampaign(c *gin.Context) { h.setFreeze(c, true) }

// UnfreezeCampaign — POST /campaigns/:id/unfreeze.
func (h *Handler) UnfreezeCampaign(c *gin.Context) { h.setFreeze(c, false) }

func (h *Handler) setFreeze(c *gin.Context, freeze bool) {
	var req NoteRequest
	_ = c.ShouldBindJSON(&req)
	if err := h.svc.SetCampaignFreeze(c.Request.Context(), c.Param("id"), ginutil.UserID(c), freeze, req.Note); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ListKyc — GET /kyc.
func (h *Handler) ListKyc(c *gin.Context) {
	items, err := h.svc.ListKyc(c.Request.Context(), c.Query("status"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"cases": items})
}

// ApproveKyc — POST /kyc/:id/approve.
func (h *Handler) ApproveKyc(c *gin.Context) { h.decideKyc(c, true) }

// RejectKyc — POST /kyc/:id/reject.
func (h *Handler) RejectKyc(c *gin.Context) { h.decideKyc(c, false) }

func (h *Handler) decideKyc(c *gin.Context, approve bool) {
	var req NoteRequest
	_ = c.ShouldBindJSON(&req)
	if err := h.svc.DecideKyc(c.Request.Context(), c.Param("id"), ginutil.UserID(c), approve, req.Note); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ComplianceSummary — GET /compliance/summary (singleton, returned directly).
func (h *Handler) ComplianceSummary(c *gin.Context) {
	res, err := h.svc.GetComplianceSummary(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, res)
}

// ListAuditLogs — GET /compliance/audit-logs.
func (h *Handler) ListAuditLogs(c *gin.Context) {
	items, err := h.svc.ListAuditLogs(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"logs": items})
}

// ListDataRequests — GET /compliance/data-requests.
func (h *Handler) ListDataRequests(c *gin.Context) {
	items, err := h.svc.ListDataRequests(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"requests": items})
}

// FulfilDataRequest — POST /compliance/data-requests/:id/fulfil.
func (h *Handler) FulfilDataRequest(c *gin.Context) {
	if err := h.svc.FulfilDataRequest(c.Request.Context(), c.Param("id"), ginutil.UserID(c)); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ListUsers — GET /users.
func (h *Handler) ListUsers(c *gin.Context) {
	page, err := h.svc.ListUsers(c.Request.Context(), c.Query("role"), c.Query("status"), c.Query("search"),
		atoiOr(c.Query("page"), 1), atoiOr(c.Query("limit"), 25))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	// The "users" key is preserved so any existing caller reading it keeps
	// working; total/page/limit are additive.
	c.JSON(http.StatusOK, gin.H{"users": page.Users, "total": page.Total, "page": page.Page, "limit": page.Limit})
}

// SetUserStatus — POST /users/:id/status.
func (h *Handler) SetUserStatus(c *gin.Context) {
	var req SetUserStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	if err := h.svc.SetUserStatus(c.Request.Context(), c.Param("id"), ginutil.UserID(c), req.Status, req.Note); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ListFeatured — GET /featured. The placement pool: every ACTIVE campaign plus
// anything still carrying a flag.
func (h *Handler) ListFeatured(c *gin.Context) {
	items, err := h.svc.ListFeaturedCandidates(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"campaigns": items})
}

// FeaturedReport — GET /featured/report (singleton, returned directly).
func (h *Handler) FeaturedReport(c *gin.Context) {
	res, err := h.svc.GetFeaturedReport(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, res)
}

// PatchCampaignFlags — PATCH /campaigns/:id/flags.
// Partial update: only the keys present in the body change. Promotion (setting a
// flag TRUE) on a campaign that is not ACTIVE is refused with 409 — the same
// illegal-state code ApproveWithdrawal uses. An empty/none-of-the-three body is
// 400 rather than a silent no-op success.
func (h *Handler) PatchCampaignFlags(c *gin.Context) {
	var req CampaignFlagsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	res, err := h.svc.SetCampaignFlags(c.Request.Context(), c.Param("id"), ginutil.UserID(c), req)
	if err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// ListFeatureRequests — GET /feature-requests. The owner-initiated placement
// queue, PENDING first. Optional ?status= filter.
func (h *Handler) ListFeatureRequests(c *gin.Context) {
	items, err := h.svc.ListFeatureRequests(c.Request.Context(), c.Query("status"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"requests": items})
}

// ApproveFeatureRequest — POST /feature-requests/:id/approve (no body).
// Sets campaigns.featured and marks the request APPROVED in ONE transaction.
func (h *Handler) ApproveFeatureRequest(c *gin.Context) { h.decideFeatureRequest(c, true) }

// RejectFeatureRequest — POST /feature-requests/:id/reject, body {"note": "..."}.
// Never touches campaigns.featured.
func (h *Handler) RejectFeatureRequest(c *gin.Context) { h.decideFeatureRequest(c, false) }

func (h *Handler) decideFeatureRequest(c *gin.Context, approve bool) {
	// The body is optional on both routes (approve takes none), so a missing or
	// malformed body must not fail the decision — only the note is read from it.
	var req NoteRequest
	_ = c.ShouldBindJSON(&req)

	res, err := h.svc.DecideFeatureRequest(c.Request.Context(), c.Param("id"), ginutil.UserID(c), approve, req.Note)
	if err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// RegisterAdmin wires the crowdfunding admin domain onto an already-constructed
// admin router group (the /api/crowdfunding/admin group, which carries the
// requireUserID() middleware so ginutil.UserID(c) is populated).
// ledgerSvc is the finance ledger used by the withdrawal-approval money-path; it
// may be nil (the payout path then fails closed). kycSvc is the platform's
// shared KYC service used by the KYC queue; nil fails that endpoint closed too.
// It is purely additive: it registers NEW sub-paths under the same group the
// campaign-review handlers already use, and never edits shared route files.
// Permissions. These routes carried NONE until now: the group's auth proved only
// that the caller was SIGNED IN, so any authenticated user — any campaign
// creator, any ordinary app user — could read this console's data and write
// through it. Verified against the running server before this change: a campaign
// owner's token returned 200 on GET /admin/withdrawals and successfully set
// `featured` via PATCH /admin/campaigns/:id/flags, self-promoting onto the public
// rail and bypassing the approval queue that exists to prevent exactly that.
// The four campaign-review routes registered alongside this call already carried
// RequirePermission and correctly answered 403 to the same token, which is what
// made the omission here invisible — the console worked, and the holes were the
// routes nobody had gated.
// Reads take crowdfunding.admin.review, mutations crowdfunding.admin.decide —
// the two permissions those review routes already use, so no new grant is needed
// and no operator loses access. Confirmed before applying: an admin passes both
// (200 / non-403) while a non-admin is refused both (403).
func RegisterAdmin(rg *gin.RouterGroup, db *pgxpool.Pool, ledgerSvc *financeledger.Service, kycSvc *financekyc.Service, rbac services.RBACService) {
	h := NewHandler(NewService(db).WithLedger(ledgerSvc).WithKYC(kycSvc))

	// Reading the console vs acting through it are separate grants, mirroring
	// crowdfunding.admin.review / .decide on the review routes.
	canRead := middleware.RequirePermission(rbac, "crowdfunding.admin.review")
	canWrite := middleware.RequirePermission(rbac, "crowdfunding.admin.decide")

	// Finance — refunds & settlement.
	rg.GET("/finance/summary", canRead, h.FinanceSummary)
	rg.GET("/refunds", canRead, h.ListRefunds)
	rg.POST("/refunds/:id/approve", canWrite, h.ApproveRefund)
	rg.POST("/refunds/:id/reject", canWrite, h.RejectRefund)
	rg.GET("/settlements", canRead, h.ListSettlements)

	// Disputes.
	rg.GET("/disputes", canRead, h.ListDisputes)
	rg.POST("/disputes/:id/resolve", canWrite, h.ResolveDispute)

	// Withdrawals approval.
	rg.GET("/withdrawals", canRead, h.ListWithdrawals)
	rg.POST("/withdrawals/:id/approve", canWrite, h.ApproveWithdrawal)
	rg.POST("/withdrawals/:id/reject", canWrite, h.RejectWithdrawal)

	// Featured / trending / urgent placement (public discovery rails).
	rg.GET("/featured", canRead, h.ListFeatured)
	rg.GET("/featured/report", canRead, h.FeaturedReport)
	rg.PATCH("/campaigns/:id/flags", canWrite, h.PatchCampaignFlags)

	// Campaign directory — every campaign, with the funding figures and backer
	// counts the review queue never carried. Mounted at /campaign-directory, not
	// /campaigns: that path is the review queue (AdminListPending), and Gin will
	// not accept a static sibling of the existing /campaigns/:id wildcard.
	rg.GET("/campaign-directory", canRead, h.CampaignDirectory)
	rg.GET("/campaigns/:id/backers", canRead, h.CampaignBackers)
	rg.GET("/campaigns/:id/funding", canRead, h.CampaignFundingHandler)

	// Owner-initiated featured-rail requests (the creator side writes these via
	// POST /api/v1/crowdfunding/creator/campaigns/:id/feature-request). Approval
	// is the only path from a request to a placement — see feature_requests.go.
	rg.GET("/feature-requests", canRead, h.ListFeatureRequests)
	rg.POST("/feature-requests/:id/approve", canWrite, h.ApproveFeatureRequest)
	rg.POST("/feature-requests/:id/reject", canWrite, h.RejectFeatureRequest)

	// Fraud & campaign freeze.
	rg.GET("/fraud-alerts", canRead, h.ListFraudAlerts)
	rg.POST("/campaigns/:id/freeze", canWrite, h.FreezeCampaign)
	rg.POST("/campaigns/:id/unfreeze", canWrite, h.UnfreezeCampaign)

	// KYC / KYB.
	rg.GET("/kyc", canRead, h.ListKyc)
	rg.POST("/kyc/:id/approve", canWrite, h.ApproveKyc)
	rg.POST("/kyc/:id/reject", canWrite, h.RejectKyc)

	// Compliance.
	rg.GET("/compliance/summary", canRead, h.ComplianceSummary)
	rg.GET("/compliance/audit-logs", canRead, h.ListAuditLogs)
	rg.GET("/compliance/data-requests", canRead, h.ListDataRequests)
	rg.POST("/compliance/data-requests/:id/fulfil", canWrite, h.FulfilDataRequest)

	// Users.
	rg.GET("/users", canRead, h.ListUsers)
	rg.POST("/users/:id/status", canWrite, h.SetUserStatus)

	// Platform configuration (settings) — categories / fees / feature flags.
	rg.GET("/config/categories", canRead, h.ListCategories)
	rg.PATCH("/config/categories/:id", canWrite, h.PatchCategory)
	rg.GET("/config/fees", canRead, h.GetFees)
	rg.PUT("/config/fees", canWrite, h.UpdateFees)
	rg.GET("/config/flags", canRead, h.ListFlags)
	rg.PATCH("/config/flags/:key", canWrite, h.PatchFlag)
}
