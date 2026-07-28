package reconciliation

import (
	"github.com/gin-gonic/gin"
)

// Register wires the admin reconciliation workbench + commission ledger view.
//
//   - admin (per-route RBAC):
//       POST /reconciliation/match            (insurance.reconciliation.resolve)
//       GET  /reconciliation                  (insurance.reconciliation.view)
//       POST /reconciliation/:id/resolve      (insurance.reconciliation.resolve)
//       GET  /commission                      (insurance.commission.view)
//       POST /commission/:policy_id/confirm   (insurance.reconciliation.resolve)
//       POST /commission/:policy_id/reverse   (insurance.reconciliation.resolve)
func Register(admin *gin.RouterGroup, h *Handler, guard func(permission string) gin.HandlerFunc) {
	rg := admin.Group("/reconciliation")
	rg.GET("", guard("insurance.reconciliation.view"), h.ListRecords)
	rg.POST("/match", guard("insurance.reconciliation.resolve"), h.MatchStatement)
	rg.POST("/:id/resolve", guard("insurance.reconciliation.resolve"), h.ResolveBreak)

	cg := admin.Group("/commission")
	cg.GET("", guard("insurance.commission.view"), h.ListCommission)
	cg.POST("/:policy_id/confirm", guard("insurance.reconciliation.resolve"), h.ConfirmCommission)
	cg.POST("/:policy_id/reverse", guard("insurance.reconciliation.resolve"), h.ReverseCommission)
}
