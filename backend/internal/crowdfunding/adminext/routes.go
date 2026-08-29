package adminext

import (
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	financekyc "spotlight/backend/internal/finance/kyc"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
	financeledger "spotlight/backend/internal/finance/ledger"
)

// RegisterAdmin wires the crowdfunding admin domain onto an already-constructed
// admin router group (the /api/crowdfunding/admin group, which carries the
// requireUserID() middleware so c.GetString("user_id") is populated).
//
// ledgerSvc is the finance ledger used by the withdrawal-approval money-path; it
// may be nil (the payout path then fails closed). kycSvc is the platform's
// shared KYC service used by the KYC queue; nil fails that endpoint closed too.
//
// It is purely additive: it registers NEW sub-paths under the same group the
// campaign-review handlers already use, and never edits shared route files.
// Permissions. These routes carried NONE until now: the group's auth proved only
// that the caller was SIGNED IN, so any authenticated user — any campaign
// creator, any ordinary app user — could read this console's data and write
// through it. Verified against the running server before this change: a campaign
// owner's token returned 200 on GET /admin/withdrawals and successfully set
// `featured` via PATCH /admin/campaigns/:id/flags, self-promoting onto the public
// rail and bypassing the approval queue that exists to prevent exactly that.
//
// The four campaign-review routes registered alongside this call already carried
// RequirePermission and correctly answered 403 to the same token, which is what
// made the omission here invisible — the console worked, and the holes were the
// routes nobody had gated.
//
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
