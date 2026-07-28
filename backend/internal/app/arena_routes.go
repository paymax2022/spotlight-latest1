package app

import (
	"log"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"

	"spotlight/backend/internal/arena"
	"spotlight/backend/internal/arena/adapters"
	arenahandler "spotlight/backend/internal/arena/handler"
	arenaquiz "spotlight/backend/internal/arena/quiz"
	arenarepo "spotlight/backend/internal/arena/repo"
	arenasvc "spotlight/backend/internal/arena/service"
	"spotlight/backend/internal/config"
	"spotlight/backend/internal/finance/kyc"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/integrations"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/platform/crypto"
	"spotlight/backend/internal/services"
)

// RegisterArena wires the Arena competition engine (ADR-014) onto three groups:
//
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

	// ── Repos (pgxpool implementations of every port) ────────────────────────
	auditRepo := arenarepo.NewAuditRepo(pool)
	meritRepo := arenarepo.NewMeritRepo(pool)
	compRepo := arenarepo.NewCompetitionRepo(pool)
	contestantRepo := arenarepo.NewContestantRepo(pool)
	supportRepo := arenarepo.NewSupportRepo(pool)
	engagementRepo := arenarepo.NewEngagementRepo(pool)
	credentialRepo := arenarepo.NewCredentialRepo(pool)
	awardRepo := arenarepo.NewAwardRepo(pool)
	potRepo := arenarepo.NewPotRepo(pool)

	// ── Money / identity ports (thin adapters over finance; NO signer) ───────
	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), redisClient)
	kycSvc := kyc.NewService(pool)
	ledgerPort := arenarepo.NewLedgerAdapter(ledgerSvc)
	tierPort := arenarepo.NewTierAdapter(kycSvc)

	// ── ScoringGateway — the ONLY holder of signers (NDC-2) ──────────────────
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

	// ── Services ─────────────────────────────────────────────────────────────
	compSvc := arenasvc.NewCompetitionService(compRepo, auditRepo)
	meritSvc := arenasvc.NewMeritService(meritRepo, auditRepo)
	scoringSvc := arenasvc.NewScoringService(gateway, meritSvc, auditRepo)
	credentialSvc := arenasvc.NewCredentialService(credentialRepo, auditRepo)
	supportSvc := arenasvc.NewSupportService(supportRepo, ledgerPort, tierPort, compSvc, auditRepo)
	potSvc := arenasvc.NewPotDisbursementService(potRepo, supportRepo, ledgerPort, compSvc, auditRepo)
	playAlongSvc := arenasvc.NewPlayAlongService(engagementRepo, credentialSvc, ledgerPort, compSvc, auditRepo)
	predictionSvc := arenasvc.NewPredictionService(engagementRepo, auditRepo)
	contestantSvc := arenasvc.NewContestantService(
		contestantRepo, meritSvc, awardRepo, credentialSvc, potSvc, tierPort, compSvc, auditRepo, crownSigner)
	screeningSvc := arenasvc.NewScreeningService(contestantRepo, auditRepo)

	// ── Quiz bank (Naija Driver) — Play-Along + Theory exam over one bank ─────
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

	// ── PUBLIC (no auth) ─────────────────────────────────────────────────────
	pub := r.Group("/api/arena")
	pub.GET("/competitions", h.ListCompetitions)
	pub.GET("/competitions/:id", h.GetCompetition)
	pub.GET("/competitions/:id/leaderboard/merit", h.MeritLeaderboard)
	pub.GET("/competitions/:id/pot", h.Pot)
	pub.GET("/credentials/:hash/verify", h.VerifyCredential)

	// ── MEMBER (authenticated: RequireAuthContext + user_id mirror) ──────────
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

	// ── ADMIN (member-auth + per-route RBAC arena.*) ─────────────────────────
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
