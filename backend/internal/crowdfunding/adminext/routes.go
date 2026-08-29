package adminext

import (
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	financekyc "spotlight/backend/internal/finance/kyc"
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
func RegisterAdmin(rg *gin.RouterGroup, db *pgxpool.Pool, ledgerSvc *financeledger.Service, kycSvc *financekyc.Service) {
	h := NewHandler(NewService(db).WithLedger(ledgerSvc).WithKYC(kycSvc))

	// Finance — refunds & settlement.
	rg.GET("/finance/summary", h.FinanceSummary)
	rg.GET("/refunds", h.ListRefunds)
	rg.POST("/refunds/:id/approve", h.ApproveRefund)
	rg.POST("/refunds/:id/reject", h.RejectRefund)
	rg.GET("/settlements", h.ListSettlements)

	// Disputes.
	rg.GET("/disputes", h.ListDisputes)
	rg.POST("/disputes/:id/resolve", h.ResolveDispute)

	// Withdrawals approval.
	rg.GET("/withdrawals", h.ListWithdrawals)
	rg.POST("/withdrawals/:id/approve", h.ApproveWithdrawal)
	rg.POST("/withdrawals/:id/reject", h.RejectWithdrawal)

	// Featured / trending / urgent placement (public discovery rails).
	rg.GET("/featured", h.ListFeatured)
	rg.GET("/featured/report", h.FeaturedReport)
	rg.PATCH("/campaigns/:id/flags", h.PatchCampaignFlags)

	// Owner-initiated featured-rail requests (the creator side writes these via
	// POST /api/v1/crowdfunding/creator/campaigns/:id/feature-request). Approval
	// is the only path from a request to a placement — see feature_requests.go.
	rg.GET("/feature-requests", h.ListFeatureRequests)
	rg.POST("/feature-requests/:id/approve", h.ApproveFeatureRequest)
	rg.POST("/feature-requests/:id/reject", h.RejectFeatureRequest)

	// Fraud & campaign freeze.
	rg.GET("/fraud-alerts", h.ListFraudAlerts)
	rg.POST("/campaigns/:id/freeze", h.FreezeCampaign)
	rg.POST("/campaigns/:id/unfreeze", h.UnfreezeCampaign)

	// KYC / KYB.
	rg.GET("/kyc", h.ListKyc)
	rg.POST("/kyc/:id/approve", h.ApproveKyc)
	rg.POST("/kyc/:id/reject", h.RejectKyc)

	// Compliance.
	rg.GET("/compliance/summary", h.ComplianceSummary)
	rg.GET("/compliance/audit-logs", h.ListAuditLogs)
	rg.GET("/compliance/data-requests", h.ListDataRequests)
	rg.POST("/compliance/data-requests/:id/fulfil", h.FulfilDataRequest)

	// Users.
	rg.GET("/users", h.ListUsers)
	rg.POST("/users/:id/status", h.SetUserStatus)

	// Platform configuration (settings) — categories / fees / feature flags.
	rg.GET("/config/categories", h.ListCategories)
	rg.PATCH("/config/categories/:id", h.PatchCategory)
	rg.GET("/config/fees", h.GetFees)
	rg.PUT("/config/fees", h.UpdateFees)
	rg.GET("/config/flags", h.ListFlags)
	rg.PATCH("/config/flags/:key", h.PatchFlag)
}
