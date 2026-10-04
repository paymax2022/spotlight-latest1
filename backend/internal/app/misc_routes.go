package app

import (
	"log"
	"net/http"
	"regexp"
	"spotlight/backend/internal/arena"
	"spotlight/backend/internal/arena/adapters"
	arenahandler "spotlight/backend/internal/arena/handler"
	arenaquiz "spotlight/backend/internal/arena/quiz"
	arenarepo "spotlight/backend/internal/arena/repo"
	arenasvc "spotlight/backend/internal/arena/service"
	"spotlight/backend/internal/config"
	"spotlight/backend/internal/finance/kyc"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/finance/wallet"
	"spotlight/backend/internal/integrations"
	"spotlight/backend/internal/integrations/llm"
	"spotlight/backend/internal/investai"
	"spotlight/backend/internal/learn"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/nutrition"
	"spotlight/backend/internal/placement"
	"spotlight/backend/internal/platform/crypto"
	"spotlight/backend/internal/platform/r2"
	"spotlight/backend/internal/services"
	"spotlight/backend/internal/spotlightwealth"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"
)

// RegisterPublicMedia mounts read-only, unauthenticated access to a small,
// fixed set of marketing assets stored in the shared R2 bucket (health-module
// promo banners, to start). Every other object in that bucket is private and
// reached only through a per-request presigned URL (see health_routes.go,
// marketplace_routes.go, etc.) — this route intentionally serves ONLY the
// `health/banners/` prefix, matched against a strict filename shape, so it
// can never become a general-purpose reader for the rest of the bucket.
// filename -> R2 key is a flat mapping (health/banners/<filename>): there is
// no admin upload form yet, these are uploaded out-of-band and referenced by
// name from client code.
var publicMediaFilenameRe = regexp.MustCompile(`^[a-z0-9-]+\.(png|jpg|jpeg|webp)$`)

func RegisterPublicMedia(public *gin.RouterGroup, cfg config.Config) {
	presigner := r2.New(r2.Config{
		AccountEndpoint: cfg.R2AccountEndpoint,
		Bucket:          cfg.R2Bucket,
		AccessKeyID:     cfg.R2AccessKeyID,
		SecretAccessKey: cfg.R2SecretAccessKey,
		Region:          cfg.R2Region,
	})

	public.GET("/media/banners/:filename", func(c *gin.Context) {
		filename := c.Param("filename")
		if !publicMediaFilenameRe.MatchString(filename) {
			c.Status(http.StatusNotFound)
			return
		}
		url, err := presigner.PresignGet("health/banners/"+filename, 15*time.Minute)
		if err != nil {
			c.Status(http.StatusNotFound)
			return
		}
		c.Redirect(http.StatusFound, url)
	})
}

// registerNutritionRoutes wires the Nutrition Resolution Engine (NRE). It is the
// app-layer wrapper that builds the Tier-3 LLM client (claude-sonnet-4-6, per the
// playbook) the same way the estate/restaurant blocks do, then delegates to
// nutrition.RegisterNutrition. An empty ANTHROPIC_API_KEY yields a disabled
// client; the engine then falls back to the deterministic nutrition mock so it
// resolves end-to-end without a key.
// apiKey is cfg.AnthropicAPIKey (already present in config). member is the authed
// finance group; admin is /api/nutrition/admin (already carries requireUserID()).
func registerNutritionRoutes(member, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService, apiKey string) {
	llmClient := llm.NewAnthropicClient(apiKey).WithModel("claude-sonnet-4-6")
	nutrition.RegisterNutrition(member, admin, pool, rbac, llmClient)
}

// RegisterLearnRoutes wires the Paymax Invest · Learn Center module under
// /api/v1/learn/* — the exact base path the mobile learn feature calls
// (mobile-app/reactnative/src/features/learn/api/learn.api.ts). The route group
// carries RequireAuthContext, which validates the bearer token and mirrors
// user_id onto the gin context (the same convention the invest module uses).
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

// RegisterInvestAIRoutes wires the InvestAI education assistant under
// /api/v1/ai/invest/* — the exact base path the mobile investai feature calls
// (mobile-app/reactnative/src/features/investai/api/ai.api.ts). The route group
// carries RequireAuthContext, which validates the bearer token and mirrors
// user_id onto the gin context (OLA on every endpoint).
// The assistant is education-first: it explains how investing works and refuses
// advice-seeking prompts server-side. Every assistant turn is disclaimered. No
// money path is involved. The AIProvider is the real Anthropic client (reused from
// internal/aicare) when ANTHROPIC_API_KEY is set, otherwise a deterministic mock.
func RegisterInvestAIRoutes(r *gin.Engine, cfg config.Config, supabase *integrations.SupabaseRestClient, rbac services.RBACService, pool *pgxpool.Pool) {
	if pool == nil {
		log.Println("[investai] nil pool — skipping investai routes")
		return
	}

	svc := investai.NewService(pool, investai.NewProvider(cfg.AnthropicAPIKey))
	h := investai.NewHandler(svc)

	g := r.Group("/api/v1/ai/invest")
	g.Use(middleware.RequireAuthContext(supabase, rbac))
	investai.RegisterInvestAI(g, h)

	provider := "mock"
	if cfg.AnthropicAPIKey != "" {
		provider = "anthropic"
	}
	log.Printf("[investai] routes registered under /api/v1/ai/invest (provider=%s)", provider)
}

// RegisterSpotlightwealthRoutes wires the Spotlight Wealth module under
// /api/v1/spotlight/* — the exact base path the mobile spotlightwealth feature
// calls (mobile-app/reactnative/src/features/spotlightwealth/api/spotlight.api.ts).
// The group carries RequireAuthContext (bearer validated; user_id mirrored onto
// the gin context), matching the invest/learn convention.
// Reads (videos / challenges / leaderboard / reward-wallet / campaigns) are
// education-first. The one money path — completing a challenge — pays WALLET
// CREDIT redistributed from the paymax_revenue standing account through the
// shared finance double-entry ledger under an Idempotency-Key (never minted;
// NL-1/NL-8/NL-9). Leaderboards rank LEARNING points, never profit.
func RegisterSpotlightwealthRoutes(r *gin.Engine, supabase *integrations.SupabaseRestClient, rbac services.RBACService, pool *pgxpool.Pool) {
	if pool == nil {
		log.Println("[spotlightwealth] nil pool — skipping spotlight routes")
		return
	}

	// Reuse the finance ledger (money path) — challenge rewards are ledger-posted.
	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), nil)

	svc := spotlightwealth.NewService(pool, ledgerSvc, nil) // nil audit sink (nil-safe)
	h := spotlightwealth.NewHandler(svc)

	g := r.Group("/api/v1/spotlight")
	g.Use(middleware.RequireAuthContext(supabase, rbac))
	spotlightwealth.RegisterSpotlightwealth(g, h)

	// Content admin (RBAC-gated): create/update/delete videos, challenges,
	// campaigns. Requires the "spotlight.admin.manage" permission (grant via RBAC).
	adminSvc := spotlightwealth.NewAdminService(pool, nil)
	adminH := spotlightwealth.NewAdminHandler(adminSvc)
	ag := r.Group("/api/v1/spotlight/admin")
	ag.Use(middleware.RequireAuthContext(supabase, rbac))
	ag.Use(middleware.RequirePermission(rbac, "spotlight.admin.manage"))
	spotlightwealth.RegisterSpotlightwealthAdmin(ag, adminH)

	log.Println("[spotlightwealth] routes registered — videos / challenges / leaderboard / reward-wallet / campaigns live under /api/v1/spotlight[/admin]")
}

// RegisterPlacement wires the Featured Placement module (paid landing-page promotion)
// onto the member finance group, an admin group, and a PUBLIC (unauthenticated) group.
// The orchestrator (finance_routes.go) calls this; this file edits no existing module.
//   - member : /api/finance/placement/*  (member-authenticated; user_id mirrored upstream)
//   - admin  : /api/placement/admin/*     (member-authenticated; per-route RBAC placement.admin.*)
//   - public : /api/finance/placement/*   (NO auth — landing resolver + analytics ingest)
//
// FeaturePlacementEnabled is enforced UPSTREAM by the caller. The money path REUSES the
// finance ledger primitives: HOLD = wallet.Debit (tier-checked) → PLACEMENT_ESCROW;
// REFUND = ledger.PostReversal (escrow → merchant wallet); RECOGNIZE = ledger.PostJournal
// (escrow → PLACEMENT_REVENUE). The standing accounts auto-create on first use.
// Dependency note: ledger/wallet/tiers are passed in (they are constructed once in
// finance_routes.go); pool + rbac are the shared infra. Eligibility external hooks
// default to the permissive impl (dev/CI) — see ExternalEligibility TODO.
func RegisterPlacement(
	member *gin.RouterGroup,
	admin *gin.RouterGroup,
	public *gin.RouterGroup,
	pool *pgxpool.Pool,
	rbac services.RBACService,
	ledgerSvc *ledger.Service,
	walletSvc *wallet.Service,
	tiersSvc *tiers.Service,
) {
	if pool == nil {
		log.Println("[placement] nil pool — skipping placement routes")
		return
	}

	svc := placement.NewService(placement.Deps{
		Repo:   placement.NewRepository(pool),
		Ledger: ledgerSvc,
		Wallet: walletSvc,
		Tiers:  tiersSvc,
		// External eligibility defaults to permissive (KYC/subject wiring is a TODO);
		// Config defaults to DefaultEligibilityConfig (cap/cooldown/creative enforced).
	})
	h := placement.NewHandler(svc)

	mg := member.Group("/placement")
	mg.POST("/campaigns", h.CreateCampaign)
	mg.GET("/campaigns", h.ListCampaigns)
	mg.GET("/campaigns/:id", h.GetCampaign)
	mg.POST("/campaigns/:id/quote", h.Quote)
	mg.POST("/campaigns/:id/submit", h.Submit) // Idempotency-Key required
	mg.POST("/campaigns/:id/pay", h.Pay)       // Idempotency-Key required (PENDING_PAYMENT retry)
	mg.POST("/campaigns/:id/cancel", h.Cancel)
	mg.POST("/campaigns/:id/pause", h.Pause)
	mg.POST("/campaigns/:id/resume", h.Resume)
	mg.GET("/campaigns/:id/analytics", h.Analytics)
	mg.GET("/zones", h.Zones)

	guard := func(permission string) gin.HandlerFunc {
		return middleware.RequirePermission(rbac, permission)
	}
	ag := admin.Group("")
	ag.GET("/review-queue", guard("placement.admin.review"), h.AdminReviewQueue)
	ag.GET("/campaigns/:id", guard("placement.admin.review"), h.AdminGetCampaign)
	ag.POST("/campaigns/:id/approve", guard("placement.admin.approve"), h.AdminApprove)
	ag.POST("/campaigns/:id/reject", guard("placement.admin.reject"), h.AdminReject)
	ag.POST("/campaigns/:id/request-info", guard("placement.admin.review"), h.AdminRequestInfo)
	ag.POST("/campaigns/:id/suspend", guard("placement.admin.suspend"), h.AdminSuspend)

	// Mounted on the root engine group (copy of the restaurant public-WS pattern):
	// consumer landing pages cannot send a Bearer, so these are unauthenticated.
	pg := public.Group("/placement")
	pg.GET("/landing", h.Landing)
	pg.POST("/events", h.Events)

	// Scheduler jobs (RunActivations/RunExpirations/RunReminders/RunReconciliation)
	// are exposed on the service; the orchestrator should schedule them on a ticker.
	// See placement.Scheduler doc + the TODO in scheduler.go for the wiring point.

	log.Println("[placement] routes registered — campaigns/quote/submit/approve saga + public landing/events")
}

// RegisterArena wires the Arena competition engine (ADR-014) onto three groups:
//   - public : /api/arena/*            (no auth — catalogue, leaderboard, pot, verify)
//   - member : /api/arena/*            (member-authenticated via requireUserID)
//   - admin  : /api/arena/admin/*      (member-authenticated; per-route RBAC arena.*)
//
// The MERIT FIREWALL is preserved end-to-end (NDC-1):
//   - Only ScoringService holds the arena.ScoringGateway (the sole signer holder),
//     built here from cfg.ArenaSigningSeed{Theory,Practical,FirstAid}.
//   - The Support / Play-Along / Prediction / Pot rails receive ONLY the
//     LedgerPort + repos — no signer, no gateway — so they cannot mint merit.
//   - MeritService.Append verifies each entry against the competition's authorized
//     adapter public keys BEFORE insert (verify-before-append).
//
// FeatureArenaEnabled is enforced UPSTREAM by the caller (router.go).
func RegisterArena(
	r *gin.Engine,
	cfg config.Config,
	supabase *integrations.SupabaseRestClient,
	pool *pgxpool.Pool,
	rbac services.RBACService,
	redisClient *goredis.Client,
) {
	if pool == nil {
		log.Println("[arena] nil pool — skipping arena routes")
		return
	}

	// authMirror applies RequireAuthContext and mirrors the user id into
	// c.Set("user_id", ...) so both requireUserID and the RBAC middleware can read
	// the caller (mirrors the finance mapsAuth pattern).
	authMirror := func() gin.HandlerFunc {
		// RequireAuthContext validates the token and sets user_id/user_email before
		// it calls c.Next(); handlers read those directly, so no post-base mirror.
		return middleware.RequireAuthContext(supabase, rbac)
	}

	auditRepo := arenarepo.NewAuditRepo(pool)
	meritRepo := arenarepo.NewMeritRepo(pool)
	compRepo := arenarepo.NewCompetitionRepo(pool)
	contestantRepo := arenarepo.NewContestantRepo(pool)
	supportRepo := arenarepo.NewSupportRepo(pool)
	engagementRepo := arenarepo.NewEngagementRepo(pool)
	credentialRepo := arenarepo.NewCredentialRepo(pool)
	awardRepo := arenarepo.NewAwardRepo(pool)
	potRepo := arenarepo.NewPotRepo(pool)

	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), redisClient)
	kycSvc := kyc.NewService(pool)
	ledgerPort := arenarepo.NewLedgerAdapter(ledgerSvc)
	tierPort := arenarepo.NewTierAdapter(kycSvc)

	gateway := arena.NewScoringGateway()
	var crownSigner *crypto.Signer
	if s, err := crypto.NewSignerFromSeed("theory-exam", cfg.ArenaSigningSeedTheory); err == nil {
		gateway.Register(adapters.NewTheoryExamAdapter(s))
	} else if cfg.ArenaSigningSeedTheory != "" {
		log.Printf("[arena] theory signing seed invalid: %v", err)
	}
	if s, err := crypto.NewSignerFromSeed("practical-judge", cfg.ArenaSigningSeedPractical); err == nil {
		gateway.Register(adapters.NewPracticalJudgeAdapter(s))
		crownSigner = s // fallback crown key (overridden by a dedicated award key below)
	} else if cfg.ArenaSigningSeedPractical != "" {
		log.Printf("[arena] practical signing seed invalid: %v", err)
	}
	if s, err := crypto.NewSignerFromSeed("first-aid", cfg.ArenaSigningSeedFirstAid); err == nil {
		gateway.Register(adapters.NewFirstAidAdapter(s))
	} else if cfg.ArenaSigningSeedFirstAid != "" {
		log.Printf("[arena] first-aid signing seed invalid: %v", err)
	}

	// Crown-award signing (NDC-1 defense-in-depth): prefer a DEDICATED award key so
	// the crown signature never shares a key with a merit adapter. The award key is
	// NOT registered in the ScoringGateway — it can sign awards but never a merit
	// entry. Falls back to the practical signer when ARENA_AWARD_SIGNING_SEED is unset.
	if s, err := crypto.NewSignerFromSeed("crown-award", cfg.ArenaAwardSigningSeed); err == nil {
		crownSigner = s
	} else if cfg.ArenaAwardSigningSeed != "" {
		log.Printf("[arena] award signing seed invalid: %v — falling back to the practical signer", err)
	} else {
		log.Printf("[arena] WARN: ARENA_AWARD_SIGNING_SEED unset — crown award falls back to the practical merit key; set a dedicated key for NDC-1 defense-in-depth")
	}

	compSvc := arenasvc.NewCompetitionService(compRepo, auditRepo)
	meritSvc := arenasvc.NewMeritService(meritRepo, auditRepo)
	scoringSvc := arenasvc.NewScoringService(gateway, meritSvc, auditRepo)
	credentialSvc := arenasvc.NewCredentialService(credentialRepo, auditRepo)
	supportSvc := arenasvc.NewSupportService(supportRepo, ledgerPort, tierPort, compSvc, auditRepo).
		WithDebitLimiter(arenarepo.NewDebitLimitAdapter(tiers.NewService(pool)))
	potSvc := arenasvc.NewPotDisbursementService(potRepo, supportRepo, ledgerPort, compSvc, auditRepo)
	playAlongSvc := arenasvc.NewPlayAlongService(engagementRepo, credentialSvc, ledgerPort, compSvc, auditRepo)
	predictionSvc := arenasvc.NewPredictionService(engagementRepo, auditRepo)
	contestantSvc := arenasvc.NewContestantService(
		contestantRepo, meritSvc, awardRepo, credentialSvc, potSvc, tierPort, compSvc, auditRepo, crownSigner)
	screeningSvc := arenasvc.NewScreeningService(contestantRepo, auditRepo)

	// The quiz service holds NO signer (NDC-1): Play-Along delegates engagement/
	// credential/cashback to playAlongSvc; the exam records an append-only attempt
	// and advances the lifecycle but mints NO merit (NDC-2 — merit is minted only
	// at proctor attestation, sourced from the stored attempt).
	quizRepo := arenaquiz.NewRepository(pool)
	quizSvc := arenaquiz.NewService(quizRepo, playAlongSvc, contestantSvc)

	h := arenahandler.New(arenahandler.Services{
		Competition: compSvc,
		Contestant:  contestantSvc,
		Screening:   screeningSvc,
		Scoring:     scoringSvc,
		Merit:       meritSvc,
		Support:     supportSvc,
		PlayAlong:   playAlongSvc,
		Prediction:  predictionSvc,
		Credential:  credentialSvc,
		Pot:         potSvc,
		Quiz:        quizSvc,
		QuizRepo:    quizRepo,
	})

	pub := r.Group("/api/arena")
	pub.GET("/competitions", h.ListCompetitions)
	pub.GET("/competitions/:id", h.GetCompetition)
	pub.GET("/competitions/:id/leaderboard/merit", h.MeritLeaderboard)
	pub.GET("/competitions/:id/pot", h.Pot)
	pub.GET("/credentials/:hash/verify", h.VerifyCredential)

	member := r.Group("/api/arena")
	member.Use(authMirror())
	member.Use(requireUserID())
	mg := member.Group("/competitions/:id")
	mg.POST("/applications", h.Apply)
	mg.GET("/me", h.Me)
	mg.GET("/me/merit", h.MyMerit)
	mg.POST("/support", h.Support)
	mg.GET("/playalong/questions", h.PlayAlongQuestions)
	mg.POST("/playalong/attempt", h.PlayAlongAttempt)
	mg.GET("/me/exam", h.MyExam)
	mg.POST("/me/exam/submit", h.SubmitExam)
	mg.POST("/predictions", h.Prediction)

	admin := r.Group("/api/arena/admin")
	admin.Use(authMirror())
	admin.Use(requireUserID())
	perm := func(p string) gin.HandlerFunc { return middleware.RequirePermission(rbac, p) }
	// Per-competition RBAC scoping uses the shared user_roles "contest" scope
	// (an arena competition IS a contest). The scope_id is the competition id.
	// "contest" is one of the values allowed by the user_roles.scope_type CHECK,
	// so a competition-scoped arena role can be granted without any destructive
	// migration; a 'global' arena role also satisfies these checks.
	scoped := func(p, param string) gin.HandlerFunc {
		return middleware.RequireScopedPermission(rbac, p, "contest", param)
	}

	admin.POST("/competitions", perm("arena.admin.config"), h.CreateCompetition)
	admin.POST("/competitions/:id/config/publish", perm("arena.admin.config"), h.PublishConfig)
	admin.GET("/competitions/:id/screening", scoped("arena.reviewer.screen", "id"), h.ScreeningQueue)
	admin.POST("/competitions/:id/screening/:cid/decide", perm("arena.reviewer.screen"), h.ScreeningDecide)
	admin.POST("/competitions/:id/proctor/attest", scoped("arena.proctor.attest", "id"), h.ProctorAttest)
	admin.POST("/competitions/:id/judge/score", scoped("arena.judge.score", "id"), h.JudgeScore)
	admin.POST("/competitions/:id/transitions/:cid", perm("arena.admin.transition"), h.Transition)
	admin.GET("/competitions/:id/merit", perm("arena.auditor.read"), h.AuditMerit)
	admin.POST("/competitions/:id/awards/finalize", perm("arena.admin.transition"), h.FinalizeAward)
	admin.POST("/competitions/:id/pot/disburse", perm("arena.admin.disburse"), h.PotDisburse)
	admin.POST("/competitions/:id/credentials/issue", perm("arena.admin.credential"), h.IssueCredential)
	admin.POST("/competitions/:id/credentials/:cid/revoke", perm("arena.admin.credential"), h.RevokeCredential)

	// Quiz bank admin (import/list/stats) — arena.admin.questions.
	admin.POST("/competitions/:id/questions/import", perm("arena.admin.questions"), h.ImportQuestions)
	admin.GET("/competitions/:id/questions", perm("arena.admin.questions"), h.ListQuestions)
	admin.GET("/competitions/:id/questions/stats", perm("arena.admin.questions"), h.QuestionStats)

	log.Println("[arena] routes registered — merit firewall active (signer only in ScoringGateway)")
}
