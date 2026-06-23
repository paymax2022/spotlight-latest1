package app

import (
	"context"
	"log"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/config"
	connectconfig "spotlight/backend/internal/connect/config"
	connectonboarding "spotlight/backend/internal/connect/onboarding"
	connectsafety "spotlight/backend/internal/connect/safety"
	"spotlight/backend/internal/integrations"
	"spotlight/backend/internal/middleware"
	platformDB "spotlight/backend/internal/platform/db"
	"spotlight/backend/internal/services"
)

// registerConnectRoutes wires the Paymax Connect module under /api/v1/connect/*
// (and admin under /api/connect/admin/*). Phase 0 scope: health + backend-owned
// config service only — no feature screens or matching logic.
//
// Gated behind FeatureConnectEnabled; skipped entirely if DATABASE_URL is unset.
// Reuses the existing auth + RBAC middleware and the pgx pool. See
// docs/prd/dating/{architecture.md, PHASE-0-PLAN.md §P0-B}.
func registerConnectRoutes(r *gin.Engine, cfg config.Config, supabase *integrations.SupabaseRestClient, rbac services.RBACService) {
	if !cfg.FeatureConnectEnabled {
		log.Println("[connect] FEATURE_CONNECT_ENABLED is off — skipping Connect routes")
		return
	}
	if cfg.DatabaseURL == "" {
		log.Println("[connect] DATABASE_URL not set — skipping Connect routes")
		return
	}

	ctx := context.Background()
	pool, err := platformDB.New(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Printf("[connect] WARN: could not connect to database: %v — Connect routes disabled", err)
		return
	}

	cfgSvc := connectconfig.NewService(pool)
	cfgHandler := connectconfig.NewHandler(cfgSvc)

	safetySvc := connectsafety.NewService(pool)
	safetyHandler := connectsafety.NewHandler(safetySvc)

	onboardingSvc := connectonboarding.NewService(pool, safetySvc)
	onboardingHandler := connectonboarding.NewHandler(onboardingSvc)

	// Auth wrapper: runs RequireAuthContext then mirrors the user id into
	// c.Set("user_id", ...) (same pattern finance routes use).
	connectAuth := func() gin.HandlerFunc {
		base := middleware.RequireAuthContext(supabase, rbac)
		return func(c *gin.Context) {
			base(c)
			if c.IsAborted() {
				return
			}
			if au, ok := middleware.GetAuthenticatedUser(c); ok {
				c.Set("user_id", au.ID)
			}
			c.Next()
		}
	}

	// --- Public/member routes ---
	cg := r.Group("/api/v1/connect")
	cg.GET("/health", cfgHandler.Health) // unauthenticated liveness probe

	member := cg.Group("")
	member.Use(connectAuth())
	member.GET("/config", cfgHandler.Config)
	member.POST("/onboarding/age-gate", onboardingHandler.AgeGate)
	member.POST("/onboarding/consent", onboardingHandler.Consent)
	member.GET("/onboarding/status", onboardingHandler.Status)
	// Safety report (invariant 7): always opens a connect_case, never fails silently.
	member.POST("/safety/report", safetyHandler.Report)

	// --- Admin routes (auth + per-route RBAC permission) ---
	adminCg := r.Group("/api/connect/admin")
	adminCg.Use(connectAuth())
	adminCg.GET("/config",
		middleware.RequirePermission(rbac, "connect.config.view"),
		cfgHandler.AdminConfig)
	adminCg.GET("/cases",
		middleware.RequirePermission(rbac, "connect.cases.view"),
		safetyHandler.ListCases)
	adminCg.GET("/cases/:id",
		middleware.RequirePermission(rbac, "connect.cases.view"),
		safetyHandler.GetCase)
	adminCg.PATCH("/cases/:id",
		middleware.RequirePermission(rbac, "connect.cases.manage"),
		safetyHandler.UpdateCase)
	adminCg.GET("/audit",
		middleware.RequirePermission(rbac, "connect.audit.view"),
		safetyHandler.ListAudit)

	log.Println("[connect] routes registered — config + safety (audit/cases) live")
}
