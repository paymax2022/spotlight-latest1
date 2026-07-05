package nutrition

import (
	"log"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// RBAC permission slugs for the admin surface.
const (
	PermNutritionManage  = "nutrition.admin.manage"  // composition + library curation
	PermNutritionResolve = "nutrition.admin.resolve" // force/batch resolve
)

// RegisterNutrition wires the Nutrition Resolution Engine routes.
//
//   member — the authed finance group (auth via the finance group's requireUserID;
//            vendor actions are object-level owner-checked inside the service).
//   admin  — the admin group (already has requireUserID); per-route RBAC is added
//            here via middleware.RequirePermission.
//   pool   — the pgx pool (money is N/A; this is read/write of NRE rows only).
//   rbac   — the RBAC service for the admin permission gates.
//   llm    — the Tier-3 AI estimator (an *llm.Client satisfies LLMGenerator); may
//            be nil/disabled, in which case the deterministic mock is used.
//
// The Tier-0 barcode/label source defaults to the deterministic MockLabelLookup
// so the engine resolves end-to-end without a network dependency.
func RegisterNutrition(member, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService, llm LLMGenerator) {
	if pool == nil {
		log.Println("[nutrition] nil pool — skipping nutrition routes")
		return
	}

	repo := NewRepository(pool)
	svc := NewService(repo).
		WithLLM(llm).
		WithLabelLookup(NewMockLabelLookup())
	h := NewHandler(svc)

	// ── Member group: buyer-readable reads + object-level-checked vendor actions.
	nut := member.Group("/nutrition")
	nut.GET("/dishes/:dishId", h.GetDish)                       // buyer-readable
	nut.POST("/dishes/:dishId/approve", h.Approve)             // vendor approve → RESTAURANT_CONFIRMED
	nut.POST("/dishes/:dishId/edit", h.Edit)                  // vendor portion+macro edit (no ingredients)
	nut.POST("/dishes/:dishId/allergens", h.AttestAllergens) // vendor allergen attest
	nut.POST("/dishes/:dishId/recipe", h.DeclareRecipe)      // HIDDEN power path → grounding RECIPE
	nut.POST("/menus/:menuId/auto-suggest", h.AutoSuggestMenu) // batch auto-estimate (menuId = restaurantId)
	nut.POST("/menus/:menuId/approve-all", h.ApproveAll)       // batch approve (menuId = restaurantId)
	nut.GET("/cart/summary", h.CartSummary)                    // ?ids=a,b,c
	nut.POST("/cart/summary", h.CartSummary)                   // body {dish_ids:[...]}

	// ── Admin group: RBAC per route (fail-closed).
	admin.POST("/composition", middleware.RequirePermission(rbac, PermNutritionManage), h.AdminUpsertComposition)
	admin.POST("/library", middleware.RequirePermission(rbac, PermNutritionManage), h.AdminUpsertLibrary)
	admin.POST("/reresolve", middleware.RequirePermission(rbac, PermNutritionResolve), h.AdminReresolve)
	admin.POST("/resolve", middleware.RequirePermission(rbac, PermNutritionResolve), h.AdminResolve)

	log.Println("[nutrition] NRE routes registered at /api/finance/nutrition + /api/nutrition/admin")
}
