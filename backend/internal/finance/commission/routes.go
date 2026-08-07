package commission

import (
	"log"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// RBAC permission strings — match the finance naming style (finance.<mod>.<verb>).
const (
	PermRead   = "finance.commission.read"
	PermManage = "finance.commission.manage"
)

// RegisterCommission wires the central Commission & Profit management module.
//
//   - member: mounted under the finance member group as /api/finance/commission/*
//     (auth via the finance group's RequireAuthContext + requireUserID).
//   - admin : the module's config/report surface all live under the member prefix
//     per the API contract; the admin group is accepted for signature symmetry
//     with sibling finance registrations and reserved for future ops-only routes.
//
// Every write is RBAC-guarded (finance.commission.manage) and audited; reads and
// the integration-facing calculate endpoint require finance.commission.read.
// ledgerSvc may be nil (earnings still record; revenue recognition is skipped).
func RegisterCommission(member *gin.RouterGroup, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService, ledgerSvc *ledger.Service, enabled bool) {
	if !enabled {
		return
	}
	if pool == nil {
		log.Println("[commission] nil pool — skipping commission routes")
		return
	}

	// Avoid the typed-nil-interface trap: only assign a NON-nil concrete ledger so
	// the service's `!= nil` guard is meaningful.
	var ls ledgerService
	if ledgerSvc != nil {
		ls = ledgerSvc
	}

	svc := NewService(NewRepository(pool), ls)
	h := NewHandler(svc)

	guard := func(permission string) gin.HandlerFunc {
		return middleware.RequirePermission(rbac, permission)
	}

	grp := member.Group("/commission")
	grp.GET("/config", guard(PermRead), h.ListConfig)
	grp.POST("/config", guard(PermManage), h.CreateConfig)
	grp.PUT("/config/:id", guard(PermManage), h.UpdateConfig)
	grp.POST("/config/:id/toggle", guard(PermManage), h.ToggleConfig)
	grp.POST("/calculate", guard(PermRead), h.Calculate)
	grp.GET("/report", guard(PermRead), h.Report)
	grp.GET("/earnings", guard(PermRead), h.ListEarnings)

	log.Println("[commission] routes registered at /api/finance/commission — config / calculate / report / earnings")
}
