package csr

import (
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Register wires the crowdfunding corporate-CSR routes onto the supplied router
// group, under a /csr prefix. The caller is responsible for mounting `rg` under
// the crowdfunding prefix and applying auth middleware that sets `user_id`.
//
// Routes (relative to rg):
//
//	GET  /csr/profile                → sponsor CSR profile (default row)
//	GET  /csr/campaigns              → matchable (active + verified) campaigns
//	GET  /csr/campaigns/:id          → a single matchable campaign
//	GET  /csr/matches                → sponsor's match offers
//	POST /csr/matches                → set up a match (PENDING_APPROVAL; reserves
//	                                   budget → requires Idempotency-Key)
//	POST /csr/matches/:id/approve    → guarded PENDING_APPROVAL → ACTIVE
//	GET  /csr/invoices               → sponsor's billing records
//	GET  /csr/impact                 → derived CSR impact summary
//	GET  /csr/employee-giving        → sponsor's employee-giving campaigns
func Register(rg *gin.RouterGroup, db *pgxpool.Pool) {
	h := NewHandler(NewService(db))

	csr := rg.Group("/csr")

	csr.GET("/profile", h.GetProfile)
	csr.GET("/campaigns", h.GetMatchableCampaigns)
	csr.GET("/campaigns/:id", h.GetMatchableCampaign)

	csr.GET("/matches", h.GetMatches)
	csr.POST("/matches", h.SetupMatch)
	csr.POST("/matches/:id/approve", h.ApproveMatch)

	csr.GET("/invoices", h.GetInvoices)
	csr.GET("/impact", h.GetImpactSummary)
	csr.GET("/employee-giving", h.GetEmployeeGiving)
}
