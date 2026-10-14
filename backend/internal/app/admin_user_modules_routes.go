package app

import (
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/handlers"
	"spotlight/backend/internal/integrations"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// registerAdminUserModulesRoutes mounts GET /api/admin/users/:id/modules (the
// admin User 360 module-membership panel). It is registered separately from the
// main rbacAdmin group because it needs the shared pgx pool, which only exists
// after that group is built. No-op when pool is nil. The handler itself answers
// 404 while FEATURE_ADMIN_USER_MODULES_ENABLED is off (see WithModules), and the
// route always requires an authenticated actor holding users.view plus the
// handler's scope check — the admin API key alone never reaches it.
func registerAdminUserModulesRoutes(r *gin.Engine, supabase *integrations.SupabaseRestClient, rbac services.RBACService, h *handlers.AdminUsersHandler, pool *pgxpool.Pool) {
	if pool == nil || h == nil {
		return
	}
	g := r.Group("/api/admin")
	g.Use(middleware.RequireAuthContext(supabase, rbac))
	g.GET("/users/:id/modules", middleware.RequirePermission(rbac, "users.view"), h.Modules)
}
