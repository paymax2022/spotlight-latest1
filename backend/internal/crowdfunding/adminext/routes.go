package adminext

import (
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

// RegisterAdmin wires the crowdfunding admin domain onto an already-constructed
// admin router group (the /api/crowdfunding/admin group, which carries the
// requireUserID() middleware so c.GetString("user_id") is populated).
//
// It is purely additive: it registers NEW sub-paths under the same group the
// campaign-review handlers already use, and never edits shared route files.
func RegisterAdmin(rg *gin.RouterGroup, db *pgxpool.Pool) {
	h := NewHandler(NewService(db))

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
