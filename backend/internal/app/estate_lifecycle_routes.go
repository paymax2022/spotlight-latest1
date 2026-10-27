package app

import (
	"log"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/estate"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// RegisterEstatePlatformLifecycle mounts the platform estate lifecycle
// (ESTD-D025) and legacy-import (ESTD-D034) routes under /estate-admin/estates.
// Sibling of RegisterEstateAdmin (same /estate-admin prefix, see the routing
// note there); called inside the FeatureEstateEnabled block. Each surface has
// its own flag so either can ship dark.
//
//   - lifecycle: estate.admin.lifecycle RBAC (super-admin / system-admin).
//   - import:    estate.admin.import RBAC OR estate_admin of the target estate,
//     checked in the handler (estate.Handler.authorizeImport).
func RegisterEstatePlatformLifecycle(finance *gin.RouterGroup, h *estate.Handler, rbac services.RBACService, lifecycleOn, importOn bool) {
	if !lifecycleOn && !importOn {
		return
	}
	g := finance.Group("/estate-admin/estates")
	if lifecycleOn {
		guard := middleware.RequirePermission(rbac, "estate.admin.lifecycle")
		g.GET("", guard, h.PlatformListEstates)
		g.GET("/:estateId", guard, h.PlatformGetEstate)
		g.POST("/:estateId/lifecycle", guard, h.PlatformTransitionEstate)
		g.POST("/:estateId/legal-hold", guard, h.PlatformSetLegalHold)
		log.Println("[estate-admin] lifecycle routes registered (FEATURE_ESTATE_LIFECYCLE_ENABLED)")
	}
	if importOn {
		g.POST("/:estateId/imports", h.DryRunImport)
		g.GET("/:estateId/imports/:batchId", h.GetImportBatch)
		g.POST("/:estateId/imports/:batchId/commit", h.CommitImport)
		log.Println("[estate-admin] legacy import routes registered (FEATURE_ESTATE_IMPORT_ENABLED)")
	}
}
