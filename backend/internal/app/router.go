package app

import (
	"context"
	"log"
	"net/http"
	"time"

	sentrygin "github.com/getsentry/sentry-go/gin"
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"
	"go.opentelemetry.io/contrib/instrumentation/github.com/gin-gonic/gin/otelgin"
	"spotlight/backend/internal/config"
	"spotlight/backend/internal/handlers"
	"spotlight/backend/internal/integrations"
	"spotlight/backend/internal/middleware"
	platformDB "spotlight/backend/internal/platform/db"
	platformRedis "spotlight/backend/internal/platform/redis"
	"spotlight/backend/internal/repositories"
	"spotlight/backend/internal/services"
)

func NewRouter(cfg config.Config) *gin.Engine {
	r := gin.Default()
	r.Use(middleware.CORSMiddleware(cfg.CORSAllowOrigins))
	// Distributed tracing (no-op unless a TracerProvider is configured via
	// observability.Init) and Sentry panic capture (no-op unless SENTRY_DSN set).
	// Repanic lets gin's Recovery still return 500 after Sentry records the panic.
	r.Use(otelgin.Middleware("paymax-backend"))
	r.Use(sentrygin.New(sentrygin.Options{Repanic: true}))

	// Liveness (no dependencies): the orchestrator restarts the container if this
	// fails. Kept dependency-free so a slow DB/Redis never triggers a kill loop.
	r.GET("/healthz", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	health := handlers.NewHealthHandler()
	supabase := integrations.NewSupabaseRestClient(cfg.SupabaseURL, cfg.SupabaseServiceRoleKey)
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
	stem := handlers.NewStemHandler(services.NewStemService(stemRepo)).WithAudit(auditService)

	v1 := r.Group("/api/v1")
	{
		public := v1.Group("/public")
		public.GET("/health", health.PublicHealth)

		auth := v1.Group("/auth")
		auth.GET("/health", health.GenericHealth)

		apiAuth := r.Group("/api/auth")
		apiAuth.POST("/register", authHandler.Register)
		apiAuth.POST("/login", authHandler.Login)
		apiAuth.POST("/logout", authHandler.Logout)
		apiAuth.POST("/request-password-reset", authHandler.RequestPasswordReset)
		apiAuth.POST("/reset-password", authHandler.ResetPassword)
		apiAuth.GET("/verify-email", authHandler.VerifyEmail)
		apiAuth.POST("/resend-verification-link", authHandler.ResendVerificationLink)
		apiAuthProtected := apiAuth.Group("")
		apiAuthProtected.Use(middleware.RequireAuthContextWithSessions(supabase, rbacService, sessionService, cfg.FeatureSessionHardeningEnabled))
		apiAuthProtected.GET("/me", authHandler.Me)
		apiAuthProtected.POST("/change-password", authHandler.ChangePassword)
		apiAuthProtected.POST("/complete-profile", authHandler.CompleteProfile)
		// Self-service session management (feature-flagged; 503 when OFF).
		apiAuthProtected.GET("/sessions", sessionHandler.ListMySessions)
		apiAuthProtected.DELETE("/sessions/:id", sessionHandler.RevokeMySession)
		apiAuthProtected.POST("/sessions/revoke-all", sessionHandler.RevokeMyAllSessions)

		users := v1.Group("/users")
		users.GET("/health", health.GenericHealth)

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
		adminGroup.Use(middleware.RequireAdmin(cfg.AdminAPIKey))
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

		stemRead := adminGroup.Group("")
		stemRead.Use(middleware.StemRateLimit(120, time.Minute))
		stemRead.Use(middleware.RequireStemRoles(
			"SUPER_ADMIN",
			"ADMIN",
			"OPERATIONS_MANAGER",
			"CONTEST_MANAGER",
			"SCHOOL_ADMIN",
			"TEACHER_COACH",
			"JUDGE",
			"MENTOR",
			"SPONSOR",
		))
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

		stemManage := adminGroup.Group("")
		stemManage.Use(middleware.StemRateLimit(40, time.Minute))
		stemManage.Use(middleware.RequireStemRoles("SUPER_ADMIN", "ADMIN", "OPERATIONS_MANAGER", "CONTEST_MANAGER"))
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

		mobile := v1.Group("/mobile")
		mobile.GET("/health", health.GenericHealth)

		webhooks := v1.Group("/webhooks")
		webhooks.GET("/health", health.GenericHealth)
	}

	// Single shared pgx pool for all DB-backed module aggregators. Created once
	// here (was previously opened twice — finance + connect each called
	// platformDB.New). nil when DATABASE_URL is unset or the connection fails;
	// each aggregator skips its routes on a nil pool.
	var sharedPool *pgxpool.Pool
	if cfg.DatabaseURL != "" {
		if p, err := platformDB.New(context.Background(), cfg.DatabaseURL); err != nil {
			log.Printf("[router] WARN: could not connect to database: %v — DB-backed routes disabled", err)
		} else {
			sharedPool = p
		}
	}

	// Optionally run background worker loops in-process (RUN_WORKERS_INPROCESS) so a
	// single free-tier instance can drain the marketplace search outbox without a
	// separate always-on worker process. No-op unless the flag is on AND a search
	// cluster is configured. See ADR-026 / workers_inprocess.go.
	startInProcessWorkers(cfg, sharedPool)

	// Shared Redis client for idempotency fast-paths (arena ledger, etc.). nil when
	// REDIS_URL is unset or the connection fails — callers fall back to DB-unique
	// constraints, so Redis is a latency optimization, never a correctness dependency.
	var sharedRedis *goredis.Client
	if cfg.RedisURL != "" {
		if rc, err := platformRedis.New(cfg.RedisURL); err != nil {
			log.Printf("[router] WARN: could not connect to Redis: %v — idempotency uses DB-unique fallback", err)
		} else {
			sharedRedis = rc
		}
	}

	// Readiness: only take traffic when required dependencies are reachable. The DB
	// is required (money path); Redis is a latency optimization (never a correctness
	// dependency — see above), so it is reported but does not fail readiness.
	r.GET("/readyz", func(c *gin.Context) {
		ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
		defer cancel()
		checks := gin.H{}
		ready := true
		if cfg.DatabaseURL != "" {
			switch {
			case sharedPool == nil:
				checks["database"] = "unavailable"
				ready = false
			case sharedPool.Ping(ctx) != nil:
				checks["database"] = "error"
				ready = false
			default:
				checks["database"] = "ok"
			}
		}
		if cfg.RedisURL != "" {
			switch {
			case sharedRedis == nil:
				checks["redis"] = "unavailable"
			case sharedRedis.Ping(ctx).Err() != nil:
				checks["redis"] = "error"
			default:
				checks["redis"] = "ok"
			}
		}
		status := http.StatusOK
		if !ready {
			status = http.StatusServiceUnavailable
		}
		c.JSON(status, gin.H{"ready": ready, "checks": checks})
	})

	// Finance modules — wired only when the shared pool is present. Returns the
	// Direct Referral Rewards engine service (nil when flag-off) so Phase-1 revenue
	// modules wired below (Marketplace) can emit purchase events (PRD §2.5/§7.1).
	referralRewardsSvc := registerFinanceRoutes(r, cfg, supabase, rbacService, sharedPool)

	// Paymax Connect module — wired only when FEATURE_CONNECT_ENABLED + shared pool.
	registerConnectRoutes(r, cfg, supabase, rbacService, sharedPool)

	// Arena competition engine (ADR-014) — feature-flagged, default off. The merit
	// firewall lives inside: only the ScoringGateway holds signers. The shared Redis
	// client enables the ledger idempotency fast-path (DB-unique constraints remain
	// the correctness backstop when Redis is unavailable).
	if cfg.FeatureArenaEnabled {
		RegisterArena(r, cfg, supabase, sharedPool, rbacService, sharedRedis)
	}

	// Paymax Marketplace (Jiji-style classifieds + escrow checkout). Feature-flagged,
	// default off. Reuses the finance double-entry ledger for escrow; app-wiring
	// injects Agent B's *search.Client via svc.SetSearcher when search is available.
	if cfg.FeatureMarketplaceEnabled {
		RegisterMarketplace(r, cfg, supabase, rbacService, sharedPool, sharedRedis, referralRewardsSvc)
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

	return r
}
