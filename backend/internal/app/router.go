package app

import (
	"context"
	"log"
	"net/http"
	"os"
	"spotlight/backend/internal/config"
	"spotlight/backend/internal/handlers"
	"spotlight/backend/internal/integrations"
	"spotlight/backend/internal/marketplace/search"
	"spotlight/backend/internal/middleware"
	platformDB "spotlight/backend/internal/platform/db"
	"spotlight/backend/internal/platform/realtime"
	platformRedis "spotlight/backend/internal/platform/redis"
	"spotlight/backend/internal/repositories"
	"spotlight/backend/internal/services"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"
)

// NewRouter builds the engine. Kept for callers/tests that have no lifecycle
// context; background loops started here (the durable-job poller) then live
// for the process lifetime.
func NewRouter(cfg config.Config) *gin.Engine {
	return NewRouterWithContext(context.Background(), cfg)
}

// NewRouterWithContext is NewRouter plus a lifecycle context: the durable-job
// poller (and any future in-process drain) stops ticking when ctx is
// cancelled. main() passes the signal context so SIGTERM shuts the poller down
// gracefully alongside the HTTP server.
func NewRouterWithContext(ctx context.Context, cfg config.Config) *gin.Engine {
	// gin.SetMode is a package-level global, so this must run before
	// gin.Default() constructs the engine's default logger. In DEBUG mode Gin
	// prints a route-registration line per route at boot — with the full module
	// set that is thousands of synchronous stdout writes, enough to trip the
	// deploy platform's log rate limit and stall init past the healthcheck
	// window (observed on a staging deploy). Debug logging stays on for local
	// development; every other environment gets the quiet release logger.
	if cfg.AppEnv != "development" {
		gin.SetMode(gin.ReleaseMode)
	}
	r := gin.Default()
	// Rate limits, audit records, and the suspicious-login engine all key on
	// c.ClientIP(); without this, Gin trusts X-Forwarded-For from anyone and
	// a caller can spoof it. Only configured proxy CIDRs may set it.
	proxies, err := middleware.ParseTrustedProxies(cfg.TrustedProxyCIDRs)
	if err != nil {
		log.Fatalf("invalid TRUSTED_PROXY_CIDRS: %v", err)
	}
	if err := r.SetTrustedProxies(proxies); err != nil {
		log.Fatalf("SetTrustedProxies: %v", err)
	}
	r.Use(middleware.RequestID())
	r.Use(middleware.CORSMiddleware(cfg.CORSAllowOrigins, cfg.AppEnv))

	// JSON 404 for every unmatched path. Gin's default NoRoute answers
	// "404 page not found" as text/plain, which is what every flag-off module
	// surface (crypto/invest/learn/doctor/onboarding/…) and every mistyped path
	// leaked through the BFF proxies — verbatim, but stamped
	// Content-Type: application/json by proxyToGoBackend, so clients calling
	// .json() on the 404 got a parse error instead of an envelope. One handler
	// here uniformizes the whole dark-surface tail: same status, JSON body,
	// same shape as the BFF's own no-route responder.
	r.NoRoute(func(c *gin.Context) {
		c.JSON(http.StatusNotFound, gin.H{
			"success": false,
			"error":   "No API route matches " + c.Request.Method + " " + c.Request.URL.Path,
		})
	})

	health := handlers.NewHealthHandler()
	// Shared Redis client for idempotency fast-paths (arena ledger, etc.). nil when
	// REDIS_URL is unset or the connection fails — callers fall back to DB-unique
	// constraints, so Redis is a latency optimization, never a correctness
	// dependency. Declared this early because the auth limiters (E2E-BE-032)
	// capture it by closure before their routes mount.
	var sharedRedis *goredis.Client
	if cfg.RedisURL != "" {
		if rc, err := platformRedis.New(cfg.RedisURL); err != nil {
			log.Printf("[router] WARN: could not connect to Redis: %v — idempotency uses DB-unique fallback", err)
		} else {
			sharedRedis = rc
		}
	}
	// E2E-BE-032: stem route limiters share their budgets across replicas when
	// Redis is up; resolved per request so a Redis outage degrades to the
	// bounded in-memory store rather than disabling the protection.
	middleware.BindStemRateRedis(func() *platformRedis.Client { return sharedRedis })
	supabase := integrations.NewSupabaseRestClient(cfg.SupabaseURL, cfg.SupabaseServiceRoleKey)
	configureLocalJWTVerify(cfg, supabase)
	adminRepo := repositories.NewAdminSupabaseRepository(supabase)
	rbacRepo := repositories.NewRBACSupabaseRepository(supabase)
	auditRepo := repositories.NewAuditSupabaseRepository(supabase)
	leadRepo := repositories.NewLeadSupabaseRepository(supabase)
	chatRepo := repositories.NewChatSupabaseRepository(supabase)
	handoffRepo := repositories.NewHandoffSupabaseRepository(supabase)
	analyticsRepo := repositories.NewAnalyticsSupabaseRepository(supabase)
	competitionRepo := repositories.NewCompetitionSupabaseRepository(supabase)
	realityTVRepo := repositories.NewRealityTVSupabaseRepository(supabase)
	stemRepo := repositories.NewStemSupabaseRepository(supabase)
	admin := handlers.NewAdminHandler(services.NewAdminService(adminRepo))
	auditService := services.NewAuditService(auditRepo)
	rbacService := services.NewRBACService(rbacRepo)
	// Optional short-TTL identity cache (AUTH_IDENTITY_CACHE_TTL_SECONDS):
	// RequireAuthContext issues 3 Supabase REST reads per request; under load
	// that is the next saturation point after GoTrue (ADR-PR395 follow-up).
	// 0 = live lookups, unchanged behavior.
	if cfg.AuthIdentityCacheTTLSeconds > 0 {
		rbacService = services.NewCachedRBACService(rbacService, time.Duration(cfg.AuthIdentityCacheTTLSeconds)*time.Second)
	}
	authService := services.NewAuthService(supabase, rbacService, cfg)
	// Session-hardening (#19): store + notifier + service, feature-flagged.
	sessionStore := repositories.NewSessionSupabaseRepository(supabase)
	securityNotifier := services.NewResendNotifier(cfg, supabase)
	sessionService := services.NewSessionService(sessionStore, securityNotifier, auditService, cfg)
	sessionHandler := handlers.NewSessionHandler(sessionService, auditService, cfg)
	authHandler := handlers.NewAuthHandler(authService, rbacService, auditService).
		WithSessions(sessionService, cfg.FeatureSessionHardeningEnabled)
	rbacHandler := handlers.NewRBACHandler(rbacService, auditService)
	auditHandler := handlers.NewAuditHandler(auditService)
	adminUsersHandler := handlers.NewAdminUsersHandler(rbacService, auditService).
		WithSessions(sessionService, cfg.FeatureSessionHardeningEnabled)
	leads := handlers.NewLeadHandler(services.NewLeadService(leadRepo))
	chats := handlers.NewChatHandler(services.NewChatService(chatRepo))
	handoffs := handlers.NewHandoffHandler(services.NewHandoffService(handoffRepo))
	analytics := handlers.NewAnalyticsHandler(services.NewAnalyticsService(analyticsRepo))
	competitions := handlers.NewCompetitionHandler(services.NewCompetitionService(competitionRepo)).WithAudit(auditService)
	realityTV := handlers.NewRealityTVHandler(services.NewRealityTVService(realityTVRepo))
	// #23 audit coverage: STEM sensitive mutations emit structured audit events
	// via the shared audit_service. Additive — read endpoints are unaffected.
	stem := handlers.NewStemHandler(services.NewStemService(stemRepo)).WithAudit(auditService).WithRBAC(rbacService)

	v1 := r.Group("/api/v1")
	{
		public := v1.Group("/public")
		public.GET("/health", health.PublicHealth)
		// Unauthenticated on purpose: the point is to verify a deploy from OUTSIDE,
		// which is exactly the situation where you have no credentials to hand.
		public.GET("/build", health.Build)
		RegisterPublicMedia(public, cfg)

		auth := v1.Group("/auth")
		auth.GET("/health", health.GenericHealth)

		apiAuth := r.Group("/api/auth")

		// These endpoints are unauthenticated and internet-facing, and had NO
		// throttle: account lockout defends one account being guessed at, but does
		// nothing about a client sweeping many accounts. Password reset gets a
		// tighter, hourly budget because each attempt spends from the project's
		// small verification-email quota, so flooding it is a denial of service
		// against everyone else's sign-up.
		loginLimiter := middleware.NewAuthRateLimiter(cfg.AuthRateLimitPerMin, time.Minute).
			WithRedis(func() *platformRedis.Client { return sharedRedis }, "login")
		resetLimiter := middleware.NewAuthRateLimiter(cfg.AuthResetRateLimitPerHour, time.Hour).
			WithRedis(func() *platformRedis.Client { return sharedRedis }, "reset")

		apiAuth.POST("/register", loginLimiter.Middleware(), authHandler.Register)
		apiAuth.POST("/login", loginLimiter.Middleware(), authHandler.Login)
		apiAuth.POST("/request-password-reset", resetLimiter.Middleware(), authHandler.RequestPasswordReset)
		apiAuth.POST("/reset-password", resetLimiter.Middleware(), authHandler.ResetPassword)
		// Email verification is OTP CODES, not links (decided 2026-08-25). The former
		// GET /verify-email and POST /resend-verification-link were removed: both were
		// backed by no-op service methods that reported success without verifying
		// anything, and neither had a single caller in web, mobile, or the contract.
		apiAuthProtected := apiAuth.Group("")
		apiAuthProtected.Use(middleware.RequireAuthContextWithSessions(supabase, rbacService, sessionService, cfg.FeatureSessionHardeningEnabled))
		apiAuthProtected.GET("/me", authHandler.Me)
		// Logout lives behind auth: it revokes the caller's GoTrue session
		// server-side (E2E-SEC-055), so an anonymous call has nothing to revoke.
		apiAuthProtected.POST("/logout", authHandler.Logout)
		apiAuthProtected.POST("/change-password", authHandler.ChangePassword)
		apiAuthProtected.POST("/complete-profile", authHandler.CompleteProfile)
		// Self-service session management (feature-flagged; 503 when OFF).
		apiAuthProtected.GET("/sessions", sessionHandler.ListMySessions)
		apiAuthProtected.DELETE("/sessions/:id", sessionHandler.RevokeMySession)
		apiAuthProtected.POST("/sessions/revoke-all", sessionHandler.RevokeMyAllSessions)

		users := v1.Group("/users")
		users.GET("/health", health.GenericHealth)

		// Registration endpoints will be registered after pool is created (see below)

		schools := v1.Group("/schools")
		schools.Use(middleware.StemRateLimit(25, time.Minute))
		schools.GET("", stem.Schools)
		schools.POST("", stem.CreateSchool)
		schools.GET("/:id/dashboard", stem.SchoolDashboard)

		schoolProfiles := v1.Group("/school-profiles")
		schoolProfiles.Use(middleware.StemRateLimit(30, time.Minute))
		schoolProfiles.GET("", stem.SchoolProfiles)
		schoolProfiles.POST("", stem.CreateSchoolProfile)

		schoolTeams := v1.Group("/school-teams")
		schoolTeams.Use(middleware.StemRateLimit(30, time.Minute))
		schoolTeams.GET("", stem.SchoolTeams)
		schoolTeams.POST("", stem.CreateSchoolTeam)

		emerging := v1.Group("/emerging-innovators")
		emerging.Use(middleware.StemRateLimit(25, time.Minute))
		emerging.GET("", stem.EmergingInnovators)
		emerging.POST("", stem.CreateEmergingInnovator)

		emergingTeams := v1.Group("/emerging-teams")
		emergingTeams.Use(middleware.StemRateLimit(30, time.Minute))
		emergingTeams.GET("", stem.EmergingTeams)
		emergingTeams.POST("", stem.CreateEmergingTeam)

		emergingProjects := v1.Group("/emerging-projects")
		emergingProjects.Use(middleware.StemRateLimit(30, time.Minute))
		emergingProjects.GET("", stem.EmergingProjects)
		emergingProjects.POST("", stem.CreateEmergingProject)

		contests := v1.Group("/stem-contests")
		contests.Use(middleware.StemRateLimit(20, time.Minute))
		contests.GET("", stem.Contests)
		contests.POST("", stem.CreateContest)

		eligibility := v1.Group("/stem-eligibility")
		eligibility.Use(middleware.StemRateLimit(20, time.Minute))
		eligibility.POST("/check", stem.CheckEligibility)

		leaderboard := v1.Group("/stem-leaderboard")
		leaderboard.Use(middleware.StemRateLimit(60, time.Minute))
		leaderboard.GET("", stem.Leaderboard)
		leaderboard.GET("/slices", stem.LeaderboardSlices)

		submissions := v1.Group("/stem-submissions")
		submissions.Use(middleware.StemRateLimit(20, time.Minute))
		submissions.GET("", stem.Submissions)
		submissions.PATCH("/:id/status", stem.UpdateSubmissionStatus)

		judging := v1.Group("/stem-judging")
		judging.Use(middleware.StemRateLimit(20, time.Minute))
		judging.GET("/scores", stem.JudgingScores)
		judging.POST("/scores", stem.CreateJudgingScore)
		judging.PATCH("/scores/:id/review-state", stem.UpdateJudgingScoreReviewState)
		judging.GET("/rubrics", stem.JudgingRubrics)
		judging.POST("/rubrics", stem.CreateJudgingRubric)
		judging.GET("/criteria", stem.JudgingCriteria)
		judging.GET("/assignments", stem.JudgeAssignments)
		judging.POST("/assignments", stem.CreateJudgeAssignment)
		judging.PATCH("/assignments/:id/conflict", stem.UpdateJudgeAssignmentConflict)

		voting := v1.Group("/stem-voting")
		voting.Use(middleware.StemRateLimit(30, time.Minute))
		voting.GET("/rules", stem.VotingRules)
		voting.POST("/rules", stem.UpsertVotingRule)
		voting.GET("/packages", stem.VotePackages)
		voting.POST("/packages", stem.CreateVotePackage)
		voting.GET("/transactions", stem.VoteTransactions)
		voting.POST("/transactions", stem.CreateVoteTransaction)

		bootcamp := v1.Group("/stem-bootcamp")
		bootcamp.Use(middleware.StemRateLimit(20, time.Minute))
		bootcamp.GET("/cohorts", stem.BootcampCohorts)
		bootcamp.POST("/cohorts", stem.CreateBootcampCohort)
		bootcamp.GET("/tasks", stem.BootcampTasks)
		bootcamp.POST("/tasks", stem.CreateBootcampTask)
		bootcamp.GET("/scores", stem.BootcampScores)
		bootcamp.POST("/scores", stem.UpsertBootcampScore)

		sponsors := v1.Group("/stem-sponsors")
		sponsors.Use(middleware.StemRateLimit(20, time.Minute))
		sponsors.GET("", stem.Sponsors)
		sponsors.POST("", stem.CreateSponsor)

		awards := v1.Group("/stem-awards")
		awards.Use(middleware.StemRateLimit(20, time.Minute))
		awards.GET("/certificates", stem.Certificates)
		awards.POST("/certificates", stem.CreateCertificate)
		awards.GET("/badges", stem.Badges)
		awards.POST("/badges", stem.CreateBadge)
		awards.GET("/badge-awards", stem.BadgeAwards)
		awards.POST("/badge-awards", stem.AwardBadge)

		reports := v1.Group("/stem-reports")
		reports.Use(middleware.StemRateLimit(30, time.Minute))
		reports.GET("/summary", stem.ReportSummary)
		reports.GET("/buckets", stem.ReportBuckets)

		adminGroup := v1.Group("/admin")
		adminGroup.Use(middleware.RequireAdmin(cfg.AdminAPIKey, cfg.AppEnv))
		// AUTH-010: this group (menu-counts, leads, chatbot sessions, handoffs,
		// analytics, competitions, reality-tv dashboard) was gated ONLY by
		// RequireAdmin, which is satisfied by the shared x-admin-api-key. That
		// key is attached unconditionally by frontend-admin's admin-proxy route
		// to every request it forwards, authenticated or not — so any anonymous
		// caller through the proxy (or anyone who obtains the key) reached real
		// PII (lead names/emails/phones, chatbot transcripts) with no identity
		// check at all. overviewGroup and adminConsole below already require a
		// real, RBAC-verified admin identity on top of RequireAdmin (see
		// RequireAdminConsoleRole); this group gets the same layering now, for
		// the same reason.
		// STEM routes (stemRead/stemManage) are deliberately NOT sub-groups of
		// this one — see ADR-057. consoleAdminRoleSlugs (super-admin/
		// system-admin only) is the right gate for this group's PII-bearing
		// routes, but it would make every STEM-specific role (JUDGE,
		// SCHOOL_ADMIN, ...) unreachable by anyone who isn't also a platform
		// admin, no matter what RequireStemRoles decided. STEM gets its own
		// sibling group below, gated by RequireVerifiedIdentity (real identity,
		// no role floor) + RequireStemRoles (the actual per-route role check).
		adminGroup.Use(middleware.RequireAdminConsoleRole(supabase, rbacService))
		adminGroup.GET("/menu-counts", admin.MenuCounts)
		adminGroup.GET("/leads", leads.List)
		adminGroup.PATCH("/leads/:id", leads.UpdateStatus)
		adminGroup.GET("/chatbot/sessions", chats.ListSessions)
		adminGroup.GET("/chatbot/sessions/:id", chats.GetSession)
		adminGroup.GET("/handoffs", handoffs.List)
		adminGroup.PATCH("/handoffs/:id", handoffs.UpdateStatus)
		adminGroup.GET("/analytics/summary", analytics.Summary)
		adminGroup.GET("/competitions/overview", competitions.Overview)
		adminGroup.GET("/competitions/open-mic", competitions.OpenMic)
		adminGroup.POST("/competitions/open-mic", competitions.CreateOpenMic)
		adminGroup.GET("/reality-tv/dashboard", realityTV.Dashboard)

		// Sibling of adminGroup, NOT a child — same "/admin" URL prefix (routes
		// registered below don't collide with adminGroup's own paths above) but
		// its own middleware chain, so RequireAdminConsoleRole's narrow
		// consoleAdminRoleSlugs floor never applies here. See ADR-057.
		stemGroup := v1.Group("/admin")
		stemGroup.Use(middleware.RequireAdmin(cfg.AdminAPIKey, cfg.AppEnv))
		stemGroup.Use(middleware.RequireVerifiedIdentity(supabase, rbacService))
		// Deliberately NOT behind RequireStemRoles — see StemHandler.MyRole's
		// doc comment. Any verified caller can ask "what STEM role do I have",
		// including one whose answer is "none".
		stemGroup.GET("/stem/my-role", stem.MyRole)

		stemRead := stemGroup.Group("")
		stemRead.Use(middleware.StemRateLimit(120, time.Minute))
		// The full set — every STEM role can read. middleware.AllStemRoleNames
		// is the single source of truth for "every STEM role name that exists";
		// StemHandler.MyRole filters against the same list.
		stemRead.Use(middleware.RequireStemRoles(rbacService, middleware.AllStemRoleNames...))
		stemRead.GET("/stem/overview", stem.Overview)
		stemRead.GET("/schools", stem.Schools)
		stemRead.GET("/schools/:id/dashboard", stem.SchoolDashboard)
		stemRead.GET("/school-profiles", stem.SchoolProfiles)
		stemRead.GET("/school-teams", stem.SchoolTeams)
		stemRead.GET("/emerging-innovators", stem.EmergingInnovators)
		stemRead.GET("/emerging-teams", stem.EmergingTeams)
		stemRead.GET("/emerging-projects", stem.EmergingProjects)
		stemRead.GET("/stem-contests", stem.Contests)
		stemRead.GET("/stem-leaderboard", stem.Leaderboard)
		stemRead.GET("/stem-leaderboard/slices", stem.LeaderboardSlices)
		stemRead.GET("/stem-submissions", stem.Submissions)
		stemRead.GET("/stem-judging/scores", stem.JudgingScores)
		stemRead.GET("/stem-judging/rubrics", stem.JudgingRubrics)
		stemRead.GET("/stem-judging/criteria", stem.JudgingCriteria)
		stemRead.GET("/stem-judging/assignments", stem.JudgeAssignments)
		stemRead.GET("/stem-voting/rules", stem.VotingRules)
		stemRead.GET("/stem-voting/packages", stem.VotePackages)
		stemRead.GET("/stem-voting/transactions", stem.VoteTransactions)
		stemRead.GET("/stem-bootcamp/cohorts", stem.BootcampCohorts)
		stemRead.GET("/stem-bootcamp/tasks", stem.BootcampTasks)
		stemRead.GET("/stem-bootcamp/scores", stem.BootcampScores)
		stemRead.GET("/stem-sponsors", stem.Sponsors)
		stemRead.GET("/stem-awards/certificates", stem.Certificates)
		stemRead.GET("/stem-awards/badges", stem.Badges)
		stemRead.GET("/stem-awards/badge-awards", stem.BadgeAwards)
		stemRead.GET("/stem-reports/summary", stem.ReportSummary)
		stemRead.GET("/stem-reports/buckets", stem.ReportBuckets)

		stemManage := stemGroup.Group("")
		stemManage.Use(middleware.StemRateLimit(40, time.Minute))
		stemManage.Use(middleware.RequireStemRoles(rbacService, "SUPER_ADMIN", "ADMIN", "OPERATIONS_MANAGER", "CONTEST_MANAGER"))
		stemManage.PATCH("/schools/:id/verification", stem.UpdateSchoolVerification)
		stemManage.POST("/stem-contests", stem.CreateContest)
		stemManage.POST("/stem-eligibility/check", stem.CheckEligibility)
		stemManage.PATCH("/stem-submissions/:id/status", stem.UpdateSubmissionStatus)
		stemManage.POST("/stem-judging/scores", stem.CreateJudgingScore)
		stemManage.PATCH("/stem-judging/scores/:id/review-state", stem.UpdateJudgingScoreReviewState)
		stemManage.POST("/stem-judging/rubrics", stem.CreateJudgingRubric)
		stemManage.POST("/stem-judging/assignments", stem.CreateJudgeAssignment)
		stemManage.PATCH("/stem-judging/assignments/:id/conflict", stem.UpdateJudgeAssignmentConflict)
		stemManage.POST("/stem-voting/rules", stem.UpsertVotingRule)
		stemManage.POST("/stem-voting/packages", stem.CreateVotePackage)
		stemManage.POST("/stem-voting/transactions", stem.CreateVoteTransaction)
		stemManage.POST("/stem-bootcamp/cohorts", stem.CreateBootcampCohort)
		stemManage.POST("/stem-bootcamp/tasks", stem.CreateBootcampTask)
		stemManage.POST("/stem-bootcamp/scores", stem.UpsertBootcampScore)
		stemManage.POST("/stem-sponsors", stem.CreateSponsor)
		stemManage.POST("/stem-awards/certificates", stem.CreateCertificate)
		stemManage.POST("/stem-awards/badges", stem.CreateBadge)
		stemManage.POST("/stem-awards/badge-awards", stem.AwardBadge)

		rbacAdmin := r.Group("/api/admin")
		rbacAdmin.Use(middleware.RequireAuthContext(supabase, rbacService))
		rbacAdmin.GET("/roles", middleware.RequirePermission(rbacService, "roles.view"), rbacHandler.ListRoles)
		rbacAdmin.POST("/roles", middleware.RequirePermission(rbacService, "roles.create"), rbacHandler.CreateRole)
		rbacAdmin.PATCH("/roles/:id", middleware.RequirePermission(rbacService, "roles.update"), rbacHandler.UpdateRole)
		rbacAdmin.POST("/roles/:id/clone", middleware.RequirePermission(rbacService, "roles.create"), rbacHandler.CloneRole)
		rbacAdmin.DELETE("/roles/:id", middleware.RequirePermission(rbacService, "roles.delete"), rbacHandler.DeleteRole)
		rbacAdmin.GET("/permissions", middleware.RequirePermission(rbacService, "permissions.view"), rbacHandler.ListPermissions)
		rbacAdmin.POST("/permissions", middleware.RequirePermission(rbacService, "permissions.assign"), rbacHandler.CreatePermission)
		rbacAdmin.PATCH("/permissions/:permissionId", middleware.RequirePermission(rbacService, "permissions.assign"), rbacHandler.UpdatePermission)
		rbacAdmin.GET("/permissions/matrix", middleware.RequirePermission(rbacService, "permissions.view"), rbacHandler.PermissionMatrix)
		rbacAdmin.DELETE("/permissions/:permissionId", middleware.RequirePermission(rbacService, "permissions.delete"), rbacHandler.DeletePermission)
		rbacAdmin.POST("/roles/:id/permissions", middleware.RequirePermission(rbacService, "permissions.assign"), rbacHandler.AssignPermissionToRole)
		rbacAdmin.DELETE("/roles/:id/permissions/:permissionId", middleware.RequirePermission(rbacService, "permissions.assign"), rbacHandler.RemovePermissionFromRole)
		rbacAdmin.POST("/users/:id/roles", middleware.RequirePermission(rbacService, "users.roles.assign"), rbacHandler.AssignRoleToUser)
		rbacAdmin.DELETE("/users/:id/roles/:roleId", middleware.RequirePermission(rbacService, "users.roles.assign"), rbacHandler.RemoveRoleFromUser)
		rbacAdmin.PATCH("/users/:id/suspend", middleware.RequirePermission(rbacService, "users.suspend"), rbacHandler.SuspendUser)
		rbacAdmin.PATCH("/users/:id/unsuspend", middleware.RequirePermission(rbacService, "users.suspend"), rbacHandler.UnsuspendUser)
		rbacAdmin.PATCH("/users/:id/lock", middleware.RequirePermission(rbacService, "users.update"), rbacHandler.LockUser)
		rbacAdmin.PATCH("/users/:id/unlock", middleware.RequirePermission(rbacService, "users.update"), rbacHandler.UnlockUser)
		rbacAdmin.GET("/audit-logs", middleware.RequirePermission(rbacService, "audit.logs.view"), auditHandler.AuditLogs)
		rbacAdmin.GET("/audit-logs/export", middleware.RequirePermission(rbacService, "audit.logs.export"), auditHandler.ExportAuditLogs)
		rbacAdmin.GET("/login-activity", middleware.RequirePermission(rbacService, "audit.logs.view"), auditHandler.LoginActivity)
		rbacAdmin.GET("/security-events", middleware.RequirePermission(rbacService, "audit.logs.view"), auditHandler.SecurityEvents)
		rbacAdmin.GET("/users", middleware.RequirePermission(rbacService, "users.view"), adminUsersHandler.List)
		rbacAdmin.GET("/users/export", middleware.RequirePermission(rbacService, "users.view"), adminUsersHandler.Export)
		// Bulk role assignment (one role → many users). Distinct static path placed
		// BEFORE the /users/:id param routes to avoid wildcard capture.
		rbacAdmin.POST("/users/bulk-roles", middleware.RequirePermission(rbacService, "users.roles.assign"), adminUsersHandler.BulkAssignRoleToUsers)
		rbacAdmin.GET("/users/:id", middleware.RequirePermission(rbacService, "users.view"), adminUsersHandler.Get)
		rbacAdmin.PATCH("/users/:id", middleware.RequirePermission(rbacService, "users.update"), adminUsersHandler.Update)
		// Read-only per-user session/security view (composes #19 session surface).
		rbacAdmin.GET("/users/:id/sessions", middleware.RequirePermission(rbacService, "users.view"), adminUsersHandler.Sessions)
		// Bulk role assignment (many roles → one user).
		rbacAdmin.POST("/users/:id/roles/bulk", middleware.RequirePermission(rbacService, "users.roles.assign"), adminUsersHandler.BulkAssignRoles)
		// Bulk permission assignment (many permissions → one role).
		rbacAdmin.POST("/roles/:id/permissions/bulk", middleware.RequirePermission(rbacService, "permissions.assign"), rbacHandler.BulkAssignPermissionsToRole)
		// Admin session controls (#19, feature-flagged). High-impact actions are
		// gated on users.suspend (a strong, super-admin-restricted-ish permission).
		rbacAdmin.POST("/users/:id/force-logout", middleware.RequirePermission(rbacService, "users.suspend"), sessionHandler.AdminForceLogout)
		rbacAdmin.POST("/users/:id/force-password-reset", middleware.RequirePermission(rbacService, "users.suspend"), sessionHandler.AdminForcePasswordReset)

		// Admin console routes will be registered after pool is created (see below)

		mobile := v1.Group("/mobile")
		mobile.GET("/health", health.GenericHealth)

		webhooks := v1.Group("/webhooks")
		webhooks.GET("/health", health.GenericHealth)
	}

	// Single shared pgx pool for all DB-backed module aggregators. nil when
	// DATABASE_URL is unset or the connection fails; each aggregator skips its
	// routes on a nil pool.
	// Outside development a nil pool is FATAL, not a warning: a degraded boot
	// still binds :8080 and serves 200 on the public health probe, so the
	// platform marks the deploy SUCCESS while every DB-backed route 404s.
	// Refusing to start yields a FAILED deploy that stays rolled back instead
	// (same doctrine as the ASSOC_CARD_SIGNING_SECRET guard: a missing
	// dependency must stop the process, not silently degrade it). Development,
	// "test" and the empty AppEnv unit tests construct keep the lenient path so
	// Supabase-only surfaces stay usable without a local Postgres.
	deployedTier := func() bool {
		e := strings.ToLower(strings.TrimSpace(cfg.AppEnv))
		return e == "staging" || cfg.IsProd()
	}()
	var sharedPool *pgxpool.Pool
	if cfg.DatabaseURL != "" {
		if p, err := platformDB.New(context.Background(), cfg.DatabaseURL); err != nil { //nolint:contextcheck // boot-scope ctx; no request exists yet
			if deployedTier {
				log.Fatalf("[router] could not open the database pool (APP_ENV=%q): %v — refusing to start with every DB-backed route disabled", cfg.AppEnv, err)
			}
			log.Printf("[router] WARN: could not connect to database: %v — DB-backed routes disabled", err)
		} else {
			sharedPool = p
		}
	} else if deployedTier {
		log.Fatalf("[router] DATABASE_URL is not set (APP_ENV=%q) — refusing to start with every DB-backed route disabled", cfg.AppEnv)
	}

	// Probe endpoints at root level, matching what deploy.yml, the Cloud Run
	// terraform probes (liveness_path/readiness_path), the uptime monitor and
	// the loadtest all curl. /healthz is liveness (process up); /readyz is
	// readiness (shared pool alive) — registered after the pool exists.
	health.WithPool(sharedPool)
	r.GET("/healthz", health.PublicHealth)
	r.GET("/readyz", health.Ready)

	// Signup referral attribution. Wired HERE rather than where authHandler is
	// built, because it needs the shared pool that is only created above — the
	// same ordering constraint WithSessions works around.
	if sharedPool != nil {
		if attributor := NewSignupAttributor(sharedPool); attributor != nil {
			authHandler.WithReferralAttribution(attributor)
		}
	}

	// E2E-FR-050: /readyz reports a per-component verdict for Redis too.
	// Required only when REDIS_REQUIRED=true — Redis is a latency optimization
	// with DB-unique fallbacks, so by default a Redis outage marks the component
	// "degraded" but does NOT fail readiness.
	health.WithRedis(sharedRedis, cfg.RedisRequired)

	// Shared SSE hub (one instance, one /api/v1/realtime/stream route regardless
	// of which module publishes) — the mobile client holds one SSE connection,
	// so every publishing module must reach the same hub. Nil-Redis-safe (falls
	// back to in-process fan-out); see platform/realtime.Hub's own doc comment.
	rtHub := realtime.NewHub(sharedRedis)

	// Server-issued email OTP (Brevo). Always registered so the surface answers
	// 503-with-a-reason rather than 404; the service inside is nil unless
	// FEATURE_OTP_EMAIL_ENABLED is on AND the pool, pepper and Brevo credentials
	// are all present. See otp_routes.go.
	// The returned issuer is what makes Register send a code. It is nil when the
	// feature is closed, and WithOTPIssuer(nil) leaves Register exactly as it
	// shipped — verification stays entirely with Supabase Auth.
	if issuer, verifier, setter, signupGate := registerOTPRoutes(r, cfg, sharedPool, supabase, authService, sessionService); issuer != nil {
		authHandler.
			WithOTPIssuer(issuer).
			WithOTPVerifier(verifier).
			WithPasswordSetter(setter).
			WithSignupGate(signupGate).
			// Login step-up is its own flag: server-issued OTP must not silently
			// become a second factor on every login.
			WithLoginMFA(cfg.FeatureOTPLoginMFAEnabled)

		// Registration may take the silent admin creation path ONLY now that the
		// OTP service actually exists. Keyed off the same signal the handler uses,
		// because branching on the flag alone created accounts with no
		// confirmation email AND no code — unverifiable forever.
		services.SetOTPOperational(authService, true)
	}

	// Finance modules — wired only when the shared pool is present. Returns the
	// Direct Referral Rewards engine service (nil when flag-off) so Phase-1 revenue
	// modules wired below (Marketplace) can emit purchase events (PRD §2.5/§7.1),
	// and the KYC verification gateway (nil unless FEATURE_KYC_VERIFY_ENABLED) so
	// registerConnectWalletRoutes below can run a real check for tier1 submissions.
	referralRewardsSvc, kycVerifySvc := registerFinanceRoutes(r, cfg, supabase, rbacService, sharedPool, rtHub)

	// Paymax Connect module — wired only when FEATURE_CONNECT_ENABLED + shared pool.
	registerConnectRoutes(r, cfg, supabase, rbacService, sharedPool, sharedRedis)

	// Paymax Connect wallet endpoints (/api/v1/wallet/*, /api/v1/kyc/*, etc.)
	// — member-facing wallet balance, gifting, tier progression, and payouts.
	// All endpoints require authentication (Bearer token). Requires shared pool.
	// E2E-SEC-064: honor FEATURE_CONNECT_ENABLED when it is EXPLICITLY set —
	// set-to-false unmounts the surface (404). When the flag is unset entirely
	// the surface stays mounted: these routes predate the flag and deployments
	// exist with it absent, so absence must not change behavior. An explicit
	// non-empty value that doesn't parse as true counts as "set to off"
	// (fail-closed for a money-touching surface).
	if sharedPool != nil && connectWalletKYCMountAllowed(cfg) {
		authMiddleware := middleware.RequireAuthContext(supabase, rbacService)
		registerConnectWalletRoutes(r, cfg, supabase, rbacService, authMiddleware, sharedPool, auditService, kycVerifySvc)
	} else if sharedPool != nil {
		log.Println("[connect] FEATURE_CONNECT_ENABLED is explicitly false — Connect wallet/KYC routes not mounted (E2E-SEC-064)")
	}

	// Admin console — unified /api/v1/admin/* endpoints for mobile admin UI
	// Gated by RBAC middleware (X-Admin-Role header). All endpoints are read-only
	// for Phase 1, wired to Supabase queries via AdminStore. Requires shared pool.
	if sharedPool != nil {
		v1 := r.Group("/api/v1")
		adminStore := handlers.NewAdminStore(sharedPool)
		adminConsoleHandler := handlers.NewAdminConsoleHandler(adminStore)

		// Cross-module operations overview for the web console dashboard.
		// Deliberately on RequireAdmin (the x-admin-api-key gate that
		// frontend-admin's server-side proxy attaches) rather than the
		// X-Admin-Role header the mobile admin console uses — the browser
		// never holds the key, and the proxy is what supplies it.
		// AUTH-003: RequireAdmin alone let this leak real financial/
		// operational data to fully anonymous requests whenever ADMIN_API_KEY
		// is unset with APP_ENV=development (the documented local-dev
		// convenience path in admin_auth.go — intentional there, but this
		// route had no OTHER gate to fall back on when it fires, unlike every
		// other route in this group). Layering the same real-identity check
		// used below closes that: the x-admin-api-key gate stays as-is
		// (untouched, still governs the frontend-admin proxy trust boundary),
		// and this adds an independent requirement for a real, verified admin
		// identity that an anonymous request can never satisfy.
		overviewGroup := v1.Group("/admin")
		overviewGroup.Use(middleware.RequireAdmin(cfg.AdminAPIKey, cfg.AppEnv))
		overviewGroup.Use(middleware.RequireAdminConsoleRole(supabase, rbacService))
		overviewGroup.GET("/overview", handlers.NewAdminOverviewHandler(sharedPool).Overview)

		adminConsole := v1.Group("/admin")
		adminConsole.Use(middleware.RequireAdminConsoleRole(supabase, rbacService))
		adminConsole.GET("/dashboard", adminConsoleHandler.Dashboard)
		adminConsole.GET("/users", adminConsoleHandler.GetUsers)
		adminConsole.GET("/users/:id", adminConsoleHandler.GetUser)
		adminConsole.GET("/kyc", adminConsoleHandler.GetKycQueue)
		adminConsole.POST("/kyc/:id/review", adminConsoleHandler.ReviewKyc)
		adminConsole.GET("/assets", adminConsoleHandler.GetAssetControls)
		adminConsole.PATCH("/assets/:id", adminConsoleHandler.UpdateAssetControl)
		adminConsole.GET("/orders", adminConsoleHandler.GetOrders)
		adminConsole.GET("/withdrawals", adminConsoleHandler.GetWithdrawalQueue)
		adminConsole.POST("/withdrawals/:ref/review", adminConsoleHandler.ReviewWithdrawal)
		adminConsole.GET("/reconciliation", adminConsoleHandler.GetReconciliation)
		adminConsole.GET("/providers", adminConsoleHandler.GetProviders)
		adminConsole.GET("/risk-limits", adminConsoleHandler.GetRiskLimits)
		adminConsole.PATCH("/risk-limits/:id", adminConsoleHandler.UpdateRiskLimit)
		adminConsole.GET("/fees", adminConsoleHandler.GetFees)
		adminConsole.PATCH("/fees/:id", adminConsoleHandler.UpdateFee)
		adminConsole.GET("/feature-flags", adminConsoleHandler.GetFeatureFlags)
		adminConsole.PATCH("/feature-flags/:key", adminConsoleHandler.SetFeatureFlag)
		adminConsole.GET("/approvals", adminConsoleHandler.GetApprovals)
		adminConsole.POST("/approvals/:id/approve", adminConsoleHandler.Approve)
		adminConsole.POST("/approvals/:id/reject", adminConsoleHandler.RejectApproval)
		adminConsole.GET("/audit", adminConsoleHandler.GetAudit)
		adminConsole.GET("/admins", adminConsoleHandler.GetAdmins)

		// Registration endpoints — contest applications with Supabase persistence
		// All endpoints require bearer token auth. Wired to RegistrationStore.
		registrationStore := handlers.NewRegistrationStore(sharedPool)
		registrationHandler := handlers.NewRegistrationHandler(registrationStore, auditService)
		registrationAuth := v1.Group("/registration")
		registrationAuth.Use(middleware.RequireAuthContext(supabase, rbacService))
		registrationAuth.GET("/contests", registrationHandler.ListContests)
		registrationAuth.GET("/applications", registrationHandler.ListApplications)
		registrationAuth.POST("/applications", registrationHandler.CreateApplication)
		registrationAuth.GET("/applications/:id", registrationHandler.GetApplication)
		registrationAuth.PATCH("/applications/:id", registrationHandler.SaveStep)
		registrationAuth.POST("/applications/:id/submit", registrationHandler.SubmitApplication)
		registrationAuth.GET("/applications/:id/status", registrationHandler.GetStatus)
		registrationAuth.POST("/applications/:id/withdraw", registrationHandler.WithdrawApplication)
		registrationAuth.POST("/applications/:id/payment/initiate", registrationHandler.InitiatePayment)
		registrationAuth.POST("/applications/:id/payment/verify", registrationHandler.VerifyPayment)

		// Admin review queue for the registration funnel. Approving here promotes
		// the entry onto the voting roster in one transaction (see
		// promote_registration_to_contestant), which is the seam that connects the
		// mobile entry flow to what voters actually see.
		// contestant.view gates the whole group; UpdateStatus additionally checks
		// contestant.approve or contestant.reject per target status.
		registrationAdminStore := handlers.NewRegistrationAdminStore(sharedPool)
		registrationAdminHandler := handlers.NewRegistrationAdminHandler(registrationAdminStore, rbacService, auditService)
		registrationAdmin := v1.Group("/admin/registrations")
		registrationAdmin.Use(middleware.RequireAuthContext(supabase, rbacService))
		registrationAdmin.Use(middleware.RequirePermission(rbacService, "contestant.view"))
		registrationAdmin.GET("", registrationAdminHandler.List)
		registrationAdmin.GET("/:id", registrationAdminHandler.Get)
		registrationAdmin.PATCH("/:id/status", registrationAdminHandler.UpdateStatus)
	}

	// Arena competition engine (ADR-014) — feature-flagged, default off. The merit
	// firewall lives inside: only the ScoringGateway holds signers. The shared Redis
	// client enables the ledger idempotency fast-path (DB-unique constraints remain
	// the correctness backstop when Redis is unavailable).
	if cfg.FeatureArenaEnabled {
		RegisterArena(r, cfg, supabase, sharedPool, rbacService, sharedRedis)
	}

	// Paymax Marketplace (Jiji-style classifieds + escrow checkout). Feature-flagged,
	// default off. Reuses the finance double-entry ledger for escrow; app-wiring
	// injects the *search.Client via svc.SetSearcher when search is available.
	if cfg.FeatureMarketplaceEnabled {
		RegisterMarketplace(r, cfg, supabase, rbacService, sharedPool, sharedRedis, rtHub, referralRewardsSvc)
	}

	// Paymax Invest · Learn Center (education-first literacy) under /api/v1/learn/*
	// and Spotlight Wealth (learn-and-earn growth surface) under /api/v1/spotlight/*
	// — the exact base paths the mobile learn / spotlightwealth features call.
	// Both are wired only when the shared pool is present (each is a no-op otherwise).
	if cfg.FeatureLearnEnabled {
		RegisterLearnRoutes(r, supabase, rbacService, sharedPool)
	}
	if cfg.FeatureSpotlightwealthEnabled {
		RegisterSpotlightwealthRoutes(r, supabase, rbacService, sharedPool)
	}

	// Paymax InvestAI education assistant under /api/v1/ai/invest/* — the exact base
	// path the mobile investai feature calls. Education-only (no money path); refuses
	// advice-seeking prompts and disclaimers every assistant turn. Reuses the aicare
	// Anthropic provider when a key is set, else a deterministic mock. Wired only when
	// the flag is on and the shared pool is present.
	if cfg.FeatureInvestaiEnabled {
		RegisterInvestAIRoutes(r, cfg, supabase, rbacService, sharedPool)
	}

	// Durable-job poller (E2E-BE-005) — the missing drain for scheduler_jobs.
	// Started LAST so every module's RegisterJobType has already landed before
	// the first tick; unhandled job types are never consumed (see RunDue), and
	// known handler-less producers get log-only stubs (scheduler_poller.go).
	startSchedulerPoller(ctx, cfg, sharedPool)

	// Optional in-process workers (RUN_WORKERS_INPROCESS, default OFF): the
	// marketplace search indexer for single-instance deploys that can't run
	// cmd/marketplace-indexer as its own process (ADR-026).
	startInProcessWorkers(ctx, cfg, sharedPool)

	return r
}

// configureLocalJWTVerify wires ADR-PR395 local JWT verification
// (AUTH_JWT_LOCAL_VERIFY). Removes the per-request GoTrue GET /auth/v1/user
// call — the measured capacity ceiling (200-VU run: ~50% 503 "authentication
// service unavailable" while Postgres was fine). ES256 tokens verify against
// Supabase's JWKS endpoint; HS256 tokens need SUPABASE_JWT_SECRET. Revocation
// staleness is bounded by the token TTL; platform_users status still gates
// suspended/locked/deleted per request. Enabling with no verification
// material is a fatal misconfig on deployed tiers — same doctrine as the
// nil-pool guard in NewRouterWithContext.
func configureLocalJWTVerify(cfg config.Config, supabase *integrations.SupabaseRestClient) {
	if !cfg.AuthJWTLocalVerify {
		return
	}
	if strings.TrimSpace(cfg.SupabaseURL) == "" && strings.TrimSpace(cfg.SupabaseJWTSecret) == "" {
		if e := strings.ToLower(strings.TrimSpace(cfg.AppEnv)); e == "staging" || cfg.IsProd() {
			log.Fatalf("[router] AUTH_JWT_LOCAL_VERIFY=true but neither SUPABASE_URL (for JWKS) nor SUPABASE_JWT_SECRET is set — refusing to start")
		}
		log.Printf("[router] WARN: AUTH_JWT_LOCAL_VERIFY set but no JWKS URL or JWT secret — remote GoTrue validation kept")
		return
	}
	supabase.EnableLocalJWTVerify(cfg.SupabaseJWTSecret)
	log.Printf("[router] AUTH_JWT_LOCAL_VERIFY: local JWT verification enabled (JWKS via SUPABASE_URL, HS256 secret %s)",
		map[bool]string{true: "set", false: "unset"}[cfg.SupabaseJWTSecret != ""])
}

// connectWalletKYCMountAllowed decides whether the Connect wallet/KYC surface
// mounts (E2E-SEC-064). The surface predate FEATURE_CONNECT_ENABLED: unmounted
// only when the flag is explicitly set to a false value. Unset ⇒ mounted —
// preserves every existing deployment that never had the variable.
func connectWalletKYCMountAllowed(cfg config.Config) bool {
	if !cfg.FeatureConnectFlagSet {
		return true // legacy behavior: flag absent → mount
	}
	return cfg.FeatureConnectEnabled
}

// startInProcessWorkers launches background worker loops INSIDE the API process when
// RUN_WORKERS_INPROCESS is on. This lets a single-instance / free-tier deploy (e.g.
// Render free, which has no always-on worker dynos — see ADR-026) run the marketplace
// search indexer without a separate `cmd/marketplace-indexer` process.
// It is NOT a substitute for dedicated worker processes at scale: a second API replica
// would run a second indexer. That is safe for the outbox drain (idempotent) but
// wasteful, so this stays OFF by default — promote to real worker processes off free
// tier. The goroutine rides the router's lifecycle ctx and stops on SIGTERM; the
// outbox drain is idempotent, so an abrupt stop re-processes on restart.
func startInProcessWorkers(ctx context.Context, cfg config.Config, pool *pgxpool.Pool) {
	if !cfg.RunWorkersInProcess {
		return
	}
	if pool == nil {
		log.Println("[workers] RUN_WORKERS_INPROCESS set but no DB pool — in-process workers disabled")
		return
	}

	// Marketplace search indexer — only useful when a search cluster is configured.
	// With Elasticsearch disabled (the free-tier default) there is nowhere to index,
	// so skip cleanly rather than spin a loop that logs ES errors every tick.
	if cfg.ElasticsearchURL == "" {
		log.Println("[workers] RUN_WORKERS_INPROCESS on, but ELASTICSEARCH_URL is empty — marketplace indexer skipped (search disabled)")
		return
	}

	interval := search.ResolveInterval(os.Getenv("MARKETPLACE_INDEXER_INTERVAL_MS"), search.DefaultIndexerInterval)
	log.Printf("[workers] starting in-process marketplace indexer (interval=%s, es=%s)", interval, cfg.ElasticsearchURL)
	go search.RunIndexerLoop(ctx, pool, cfg.ElasticsearchURL, interval)
}
