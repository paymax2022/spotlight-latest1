package app

import (
	"log"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/config"
	"spotlight/backend/internal/integrations"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
	"spotlight/backend/internal/stepup"
	"spotlight/backend/internal/supportimpersonation"
)

// platformGuards carries the two platform-wide guards (ADR-PR<pr-number>) into
// the route registrars that mount high-risk or impersonation-honouring routes.
//
// Both resolve their store per request through the holder, because NewRouter
// registers the /api/admin tree before the shared pool and OTP service exist.
type platformGuards struct {
	holder *platformGuardHolder
	cfg    config.Config
}

// platformGuardHolder is filled in once the pool / OTP service are built.
// Fields stay nil when a dependency is missing; the guards then fail closed.
type platformGuardHolder struct {
	stepUp        middleware.StepUpVerifier
	impersonation middleware.ImpersonationSessions
}

func newPlatformGuards(cfg config.Config) platformGuards {
	return platformGuards{holder: &platformGuardHolder{}, cfg: cfg}
}

func (g platformGuards) impersonationOptions() middleware.SupportImpersonationOptions {
	h := g.holder
	return middleware.SupportImpersonationOptions{
		Enabled:  g.cfg.FeatureSupportImpersonationEnabled,
		Sessions: func() middleware.ImpersonationSessions { return h.impersonation },
	}
}

// stepUp is the ESTD-D014 gate for one high-risk action, honouring
// FEATURE_STEP_UP_ENFORCED.
func (g platformGuards) stepUp(action string) gin.HandlerFunc {
	return g.stepUpWith(action, g.cfg.FeatureStepUpEnforced)
}

// stepUpAlways is the gate for capabilities that are new in this change (no
// prior behaviour to preserve), so it is enforced regardless of the flag.
func (g platformGuards) stepUpAlways(action string) gin.HandlerFunc {
	return g.stepUpWith(action, true)
}

func (g platformGuards) stepUpWith(action string, enforce bool) gin.HandlerFunc {
	h := g.holder
	return middleware.RequireStepUp(middleware.StepUpOptions{
		Enforce:  enforce,
		Verifier: func() middleware.StepUpVerifier { return h.stepUp },
		Action:   action,
	})
}

// guardEngine mounts the engine-wide read-only impersonation gate. Call it
// before ANY route is registered (gin applies Use only to later routes).
func (g platformGuards) guardEngine(r *gin.Engine) {
	r.Use(middleware.GuardSupportImpersonation(g.impersonationOptions()))
}

// applyImpersonation is mounted on the group hosting the allow-listed reads.
func (g platformGuards) applyImpersonation() gin.HandlerFunc {
	return middleware.ApplySupportImpersonation(g.impersonationOptions())
}

// registerStepUpRoutes wires /api/auth/step-up/* and, when the OTP service and
// pool both exist, arms the gate's verifier. Routes are always registered so a
// misconfigured deployment answers 503 step_up_unavailable rather than 404.
func registerStepUpRoutes(r *gin.Engine, g platformGuards, supabase *integrations.SupabaseRestClient, rbac services.RBACService, pool *pgxpool.Pool, issue stepup.CodeIssuer, verify stepup.CodeVerifier, audit services.AuditSink) {
	var svc *stepup.Service
	if store := stepup.NewPostgresStore(pool); store != nil && issue != nil && verify != nil {
		svc = stepup.NewService(store, issue, verify, audit, time.Duration(g.cfg.StepUpTTLSeconds)*time.Second)
		g.holder.stepUp = store
		log.Printf("[stepup] enabled — ttl=%s enforce=%v", svc.TTL(), g.cfg.FeatureStepUpEnforced)
	} else {
		log.Printf("[stepup] UNAVAILABLE (pool=%v otp=%v) — gated privileged routes answer 503 step_up_unavailable while FEATURE_STEP_UP_ENFORCED=%v",
			pool != nil, issue != nil && verify != nil, g.cfg.FeatureStepUpEnforced)
	}
	h := stepup.NewHandler(svc)
	grp := r.Group("/api/auth/step-up")
	grp.Use(middleware.RequireAuthContext(supabase, rbac))
	grp.POST("/challenge", h.Challenge)
	grp.POST("/verify", h.Verify)
	grp.GET("/status", h.Status)
}

// registerSupportImpersonationRoutes wires the support view-as surface
// (ESTD-D028) and the impersonated user's notice.
func registerSupportImpersonationRoutes(r *gin.Engine, g platformGuards, supabase *integrations.SupabaseRestClient, rbac services.RBACService, pool *pgxpool.Pool, audit services.AuditSink, notifier services.SecurityNotifier) {
	var svc *supportimpersonation.Service
	if store := supportimpersonation.NewPostgresStore(pool); store != nil {
		g.holder.impersonation = store
		svc = supportimpersonation.NewService(store, rbac, audit, notifier,
			time.Duration(g.cfg.SupportImpersonationMaxMinutes)*time.Minute)
	}
	h := supportimpersonation.NewHandler(svc, g.cfg.FeatureSupportImpersonationEnabled)
	log.Printf("[impersonation] enabled=%v store=%v", g.cfg.FeatureSupportImpersonationEnabled, svc != nil)

	auth := middleware.RequireAuthContext(supabase, rbac)
	grp := r.Group("/api/support/impersonation")
	grp.Use(auth)
	grp.POST("",
		middleware.RequireExplicitPermission(supportimpersonation.Permission),
		g.stepUpAlways("support.impersonation.start"),
		h.Start)
	grp.POST("/:id/stop", h.Stop)
	grp.GET("/active", h.Active)

	r.GET("/api/auth/support-access", auth, h.MyNotices)
}
