package claims

import (
	"github.com/gin-gonic/gin"
)

// Register wires the member + admin claim routes. The aggregator
// (insurance_claims_routes.go) constructs the handler and the per-route RBAC
// guards; this keeps the package self-describing about its own surface.
//
//   - member (object-level authZ; claimant owns claim):
//       POST   /claims                  (FNOL — Idempotency-Key REQUIRED)
//       GET    /claims
//       GET    /claims/:id
//       POST   /claims/:id/evidence
//       GET    /claims/:id/evidence
//   - admin (per-route RBAC insurance.claim.*):
//       GET    /claims                  (insurance.claim.view)
//       GET    /claims/:id              (insurance.claim.view)
//       POST   /claims/:id/decision     (insurance.claim.manage)
func Register(member *gin.RouterGroup, admin *gin.RouterGroup, h *Handler, guard func(permission string) gin.HandlerFunc) {
	// Member routes.
	mc := member.Group("/claims")
	mc.POST("", h.SubmitFNOL)
	mc.GET("", h.List)
	mc.GET("/:id", h.Get)
	mc.POST("/:id/evidence", h.AddEvidence)
	mc.GET("/:id/evidence", h.ListEvidence)

	// Admin routes (claim search + decisioning).
	ac := admin.Group("/claims")
	ac.GET("", guard("insurance.claim.view"), h.AdminSearch)
	ac.GET("/:id", guard("insurance.claim.view"), h.AdminGet)
	ac.POST("/:id/decision", guard("insurance.claim.manage"), h.AdminDecision)
}
