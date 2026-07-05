package app

import (
	"log"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/integrations"
	"spotlight/backend/internal/learn"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// RegisterLearnRoutes wires the Paymax Invest · Learn Center module under
// /api/v1/learn/* — the exact base path the mobile learn feature calls
// (mobile-app/reactnative/src/features/learn/api/learn.api.ts). The route group
// carries RequireAuthContext, which validates the bearer token and mirrors
// user_id onto the gin context (the same convention the invest module uses).
//
// The Learn Center is an education-first, read-mostly surface: paths / lessons /
// quiz / glossary are GETs; the only mutation (submitQuiz) is scored
// authoritatively on the server. No money path is involved.
func RegisterLearnRoutes(r *gin.Engine, supabase *integrations.SupabaseRestClient, rbac services.RBACService, pool *pgxpool.Pool) {
	if pool == nil {
		log.Println("[learn] nil pool — skipping learn routes")
		return
	}

	svc := learn.NewService(pool, nil) // optional immutable-audit sink (nil-safe)
	h := learn.NewHandler(svc)

	g := r.Group("/api/v1/learn")
	g.Use(middleware.RequireAuthContext(supabase, rbac))
	learn.RegisterLearn(g, h)

	// Content admin (RBAC-gated): create/update/delete paths, lessons, quizzes,
	// glossary. Requires the "learn.admin.manage" permission (grant via RBAC).
	adminSvc := learn.NewAdminService(pool, nil)
	adminH := learn.NewAdminHandler(adminSvc)
	ag := r.Group("/api/v1/learn/admin")
	ag.Use(middleware.RequireAuthContext(supabase, rbac))
	ag.Use(middleware.RequirePermission(rbac, "learn.admin.manage"))
	learn.RegisterLearnAdmin(ag, adminH)

	log.Println("[learn] routes registered — member GET surface + content admin under /api/v1/learn[/admin]")
}
