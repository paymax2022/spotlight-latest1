package onboarding

import (
	"log"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/integrations"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// Deps carries the collaborators needed to wire onboarding routes.
type Deps struct {
	DB       *pgxpool.Pool
	Supabase *integrations.SupabaseRestClient
	RBAC     services.RBACService
	Enabled  bool // feature flag
}

// ReviewPermission is the RBAC slug required to reach reviewer/admin endpoints.
const ReviewPermission = "onboarding.review"

// ConfigurePermission gates catalogue configuration endpoints.
const ConfigurePermission = "onboarding.configure"

// Register mounts all onboarding routes under /api/v1 on the given engine.
// Customer routes require an authenticated session; admin routes additionally
// require the onboarding.review / onboarding.configure RBAC permission.
func Register(r *gin.Engine, d Deps) {
	if !d.Enabled {
		log.Println("[onboarding] FEATURE_ONBOARDING_ENABLED is false — skipping routes")
		return
	}
	if d.DB == nil {
		log.Println("[onboarding] no database pool — skipping routes")
		return
	}

	h := NewHandler(NewService(d.DB))

	// authn validates the bearer token and stores the AuthenticatedUser on the gin
	// context. Handlers read it via middleware.GetAuthenticatedUser (see userID()).
	// NOTE: RequireAuthContext calls c.Next() itself once auth succeeds, so any work
	// wrapped *after* base(c) would run only AFTER the downstream handler has already
	// executed — too late to mirror user_id into the context. Hence handlers source
	// the user directly from the auth context instead of a mirrored string key.
	authn := func() gin.HandlerFunc {
		return middleware.RequireAuthContext(d.Supabase, d.RBAC)
	}

	v1 := r.Group("/api/v1")

	// ─── Customer-facing onboarding ───────────────────────────────────────────
	ob := v1.Group("/onboarding")
	ob.Use(authn())
	{
		ob.GET("/modules", h.ListModules)
		ob.GET("/modules/:id/merchant-types", h.ListMerchantTypes)
		ob.GET("/merchant-types/:id", h.GetMerchantType)
		ob.GET("/form-schemas/:id", h.GetFormSchema)

		ob.POST("/applications", h.CreateApplication)
		ob.PATCH("/applications/:id", h.SaveDraft)
		ob.POST("/applications/:id/submit", h.Submit)
		ob.POST("/applications/:id/resubmit", h.Resubmit)
		ob.GET("/applications/:id", h.GetApplication)
	}

	// /me/capabilities
	me := v1.Group("/me")
	me.Use(authn())
	me.GET("/capabilities", h.Capabilities)

	// ─── Admin: review queue & decisions ──────────────────────────────────────
	// Admin routes use the engine-level /api/admin convention (matches the
	// shipped rbacAdmin group + the admin frontend's adminApiBase), NOT /api/v1/admin.
	admin := r.Group("/api/admin/onboarding")
	admin.Use(authn())
	{
		review := admin.Group("")
		review.Use(middleware.RequirePermission(d.RBAC, ReviewPermission))
		review.GET("/review-queue", h.ReviewQueue)
		review.GET("/applications/:id", h.AdminGetApplication)
		review.POST("/applications/:id/approve", h.Approve)
		review.POST("/applications/:id/reject", h.Reject)
		review.POST("/applications/:id/request-info", h.RequestInfo)
		review.POST("/applications/:id/escalate", h.Escalate)

		cfg := admin.Group("")
		cfg.Use(middleware.RequirePermission(d.RBAC, ConfigurePermission))
		cfg.POST("/modules", h.CreateModule)
		cfg.POST("/merchant-types", h.CreateMerchantType)
		cfg.POST("/merchant-types/:id/form-schemas", h.CreateFormSchema)
	}

	log.Println("[onboarding] routes registered under /api/v1/onboarding, /api/v1/me, /api/admin/onboarding")
}
