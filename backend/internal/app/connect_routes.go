package app

import (
	"context"
	"errors"
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"log"
	"os"
	"spotlight/backend/internal/config"
	connectaccount "spotlight/backend/internal/connect/account"
	connectaml "spotlight/backend/internal/connect/aml"
	connectchat "spotlight/backend/internal/connect/chat"
	connectconfig "spotlight/backend/internal/connect/config"
	connectcreator "spotlight/backend/internal/connect/creator"
	connectcredits "spotlight/backend/internal/connect/credits"
	connectdatesafety "spotlight/backend/internal/connect/datesafety"
	connectdiscovery "spotlight/backend/internal/connect/discovery"
	connectevents "spotlight/backend/internal/connect/events"
	connectgamification "spotlight/backend/internal/connect/gamification"
	connectgifting "spotlight/backend/internal/connect/gifting"
	connectlive "spotlight/backend/internal/connect/live"
	connectmatching "spotlight/backend/internal/connect/matching"
	connectmoderation "spotlight/backend/internal/connect/moderation"
	connectmonetization "spotlight/backend/internal/connect/monetization"
	connectassess "spotlight/backend/internal/connect/networking/assessments"
	connectfeed "spotlight/backend/internal/connect/networking/feed"
	connectjobs "spotlight/backend/internal/connect/networking/jobs"
	connectmentor "spotlight/backend/internal/connect/networking/mentorship"
	connectnetprofile "spotlight/backend/internal/connect/networking/profile"
	connectonboarding "spotlight/backend/internal/connect/onboarding"
	connectpayouts "spotlight/backend/internal/connect/payouts"
	connectprofessional "spotlight/backend/internal/connect/professional"
	connectprofile "spotlight/backend/internal/connect/profile"
	connectsafety "spotlight/backend/internal/connect/safety"
	connecttrust "spotlight/backend/internal/connect/trust"
	connectverification "spotlight/backend/internal/connect/verification"
	connectvoting "spotlight/backend/internal/connect/voting"
	"spotlight/backend/internal/finance/commission"
	"spotlight/backend/internal/finance/kyc"
	"spotlight/backend/internal/finance/kycverify"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/finance/wallet"
	"spotlight/backend/internal/handlers"
	"spotlight/backend/internal/integrations"
	"spotlight/backend/internal/loyalty"
	"spotlight/backend/internal/middleware"
	platformRedis "spotlight/backend/internal/platform/redis"
	"spotlight/backend/internal/points"
	"spotlight/backend/internal/services"
	"strconv"
	"time"
)

// registerConnectRoutes wires the Paymax Connect module under /api/v1/connect/*
// (and admin under /api/connect/admin/*). Phase 0 scope: health + backend-owned
// config service only — no feature screens or matching logic.
// Gated behind FeatureConnectEnabled; skipped entirely if DATABASE_URL is unset.
// Reuses the existing auth + RBAC middleware and the pgx pool. See
// docs/prd/dating/{architecture.md, PHASE-0-PLAN.md §P0-B}.
func registerConnectRoutes(r *gin.Engine, cfg config.Config, supabase *integrations.SupabaseRestClient, rbac services.RBACService, pool *pgxpool.Pool, redisClient *platformRedis.Client) {
	if !cfg.FeatureConnectEnabled {
		log.Println("[connect] FEATURE_CONNECT_ENABLED is off — skipping Connect routes")
		return
	}
	if cfg.DatabaseURL == "" {
		log.Println("[connect] DATABASE_URL not set — skipping Connect routes")
		return
	}
	if pool == nil {
		log.Println("[connect] no database pool — skipping Connect routes")
		return
	}

	cfgSvc := connectconfig.NewService(pool)
	cfgHandler := connectconfig.NewHandler(cfgSvc)

	safetySvc := connectsafety.NewService(pool)
	safetyHandler := connectsafety.NewHandler(safetySvc)

	onboardingSvc := connectonboarding.NewService(pool, safetySvc)
	onboardingHandler := connectonboarding.NewHandler(onboardingSvc)

	accountHandler := connectaccount.NewHandler(connectaccount.NewService(pool))

	// Auth wrapper: runs RequireAuthContext then mirrors the user id into
	// c.Set("user_id", ...) (same pattern finance routes use).
	connectAuth := func() gin.HandlerFunc {
		// RequireAuthContext validates the token and sets user_id/user_email before
		// it calls c.Next(); handlers read those directly, so no post-base mirror.
		return middleware.RequireAuthContext(supabase, rbac)
	}

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
	// Account deletion / DSR (ON-010, EC-011): self-serve, subject = authed user.
	member.DELETE("/account", accountHandler.Delete)

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

	// member already has connectAuth() applied; adminCg too. Each register fn
	// adds per-route RBAC on its admin endpoints.
	registerConnectPhase1Routes(member, adminCg, pool, rbac)       // profiles, verification, matching, discovery, search
	registerConnectSafetyRoutes(member, adminCg, pool, rbac)       // chat, blocks, date-safety, moderation, AI trust
	registerConnectGrowthRoutes(member, adminCg, pool, rbac)       // professional, events, creator, monetization
	registerConnectNetworkRoutes(member, adminCg, cfg, pool, rbac) // Phase 6 networking: jobs/feed/profile/assessments/mentorship under /networking

	RegisterConnectMoney(member, adminCg, cg, cfg, pool, rbac, redisClient) // gifting (wallet→wallet), paid voting, AML/NFIU, payouts
	RegisterConnectLiveGame(member, adminCg, pool, rbac)                    // live streaming sessions/co-host/PK + gamification (non-cash)

	log.Println("[connect] routes registered — config + safety + phases 1–6 + money + live/game live")
}

// RegisterConnectLiveGame wires the Paymax Connect live-streaming and gamification
// modules onto the member + admin route groups created by the Connect orchestrator
// (connect_routes.go, not edited here). Both groups already carry
// RequireAuthContext + the c.Set("user_id", ...) mirror; the parent enforces the
// FeatureConnectEnabled gate. Admin routes add per-route RBAC inside each package
// (connect.live.* / connect.gamification.*).
//   - Live: 1:many sessions, co-host, PK battles (non-cash scores), moderation and
//     RTC-token issuance. Provider secrets are read from env/config HERE and passed
//     into the package — never hard-coded inside the package.
//   - Gamification: XP / missions / streaks / leaderboards / seasons. NON-CASH:
//     points live in their own tables and NEVER touch the finance ledger.
func RegisterConnectLiveGame(member *gin.RouterGroup, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService) {
	if pool == nil {
		log.Println("[connect-live-game] nil pool — skipping Connect live/gamification routes")
		return
	}

	// Shared audit hook (reuses the Phase 0 connect_audit_log writer via the
	// auditAdapter defined in connect_growth_routes.go — same package).
	safetySvc := connectsafety.NewService(pool)
	audit := &auditAdapter{svc: safetySvc}

	// RTC provider config — secrets come from env, never hard-coded. When the
	// secret is unset, NewRTCIssuer returns nil and token issuance refuses
	// fail-closed (HTTP 503) rather than minting an unsigned credential.
	ttl := time.Hour
	if v := os.Getenv("CONNECT_RTC_TOKEN_TTL_SECONDS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			ttl = time.Duration(n) * time.Second
		}
	}
	rtc := connectlive.NewRTCIssuer(connectlive.RTCConfig{
		Provider:  os.Getenv("CONNECT_RTC_PROVIDER"),
		AppID:     os.Getenv("CONNECT_RTC_APP_ID"),
		AppSecret: os.Getenv("CONNECT_RTC_APP_SECRET"),
		TokenTTL:  ttl,
	})
	if rtc == nil {
		log.Println("[connect-live-game] CONNECT_RTC_APP_SECRET unset — RTC token issuance disabled (fail-closed)")
	}

	connectlive.Register(member, admin, pool, rbac, audit, rtc)
	connectgamification.Register(member, admin, pool, rbac, audit)

	log.Println("[connect-live-game] routes registered — live streaming + gamification live")
}

// registerConnectWalletRoutes wires up all /api/v1/wallet/* and /api/v1/kyc/* endpoints
// for the Paymax Connect module (wallet, gifting, KYC tier progression, payouts).
// All endpoints are protected by RequireAuthContext + requireUserID.
// kycVerify is the KYC verification gateway (nil unless FEATURE_KYC_VERIFY_ENABLED
// — see registerFinanceRoutes), threaded through so SubmitTier1 can run a real
// Dojah/Smile ID/Youverify check instead of writing an unverified pending status.
// SubmitTier2/3 stay on the old no-check path (see kyc_connect_handler.go):
// their kycverify equivalents need real camera/SDK capture the app lacks —
// wiring them today would submit fake bytes to a real provider.
//
// POST /wallet/fund is additionally gated on cfg.FeatureConnectWalletFundEnabled
// (FEATURE_CONNECT_WALLET_FUND_ENABLED, default OFF) — E2E-SEC-052. The handler
// credits the user wallet from provider_clearing with no payment proof: any
// authenticated user could mint money. The documented funding rail was never
// implemented — the route stays unmounted (404) until a verified source lands.
func registerConnectWalletRoutes(r *gin.Engine, cfg config.Config, _ any, _ services.RBACService, authMiddleware gin.HandlerFunc, db *pgxpool.Pool, auditSvc services.AuditService, kycVerify *kycverify.Service) {
	walletStore := handlers.NewWalletStore(db)
	giftingStore := handlers.NewGiftingStore(db)
	payoutsStore := handlers.NewPayoutsStore(db)

	// Money mutations route through the shared finance services so every one of
	// them posts a balanced double-entry journal and passes tier limits fail-closed.
	ledgerSvc := ledger.NewService(ledger.NewRepository(db), nil)
	tiersSvc := tiers.NewService(db)
	walletSvc := wallet.NewService(ledgerSvc, tiersSvc)

	walletHandler := handlers.NewWalletConnectHandler(walletStore, walletSvc, tiersSvc, auditSvc)
	giftingHandler := handlers.NewGiftingConnectHandler(giftingStore, walletSvc, ledgerSvc, tiersSvc, auditSvc)
	kycHandler := handlers.NewKYCConnectHandler(kyc.NewService(db), tiersSvc, auditSvc, kycVerify)
	payoutsHandler := handlers.NewPayoutsConnectHandler(payoutsStore, walletSvc, ledgerSvc, auditSvc)

	// Base v1 group (all routes require auth)
	v1 := r.Group("/api/v1")
	v1.Use(authMiddleware) // RequireAuthContext sets user_id
	v1.Use(requireUserID())

	walletGroup := v1.Group("/wallet")
	walletGroup.GET("/summary", walletHandler.GetSummary)
	if cfg.FeatureConnectWalletFundEnabled {
		walletGroup.POST("/fund", walletHandler.FundWallet)
	}
	walletGroup.GET("/history", walletHandler.GetHistory)
	walletGroup.GET("/history/:id", walletHandler.GetHistoryEntry)

	gifting := v1.Group("/wallet/gifting")
	gifting.GET("/catalog", giftingHandler.GetCatalog)
	gifting.GET("/catalog/:id", giftingHandler.GetProduct)
	gifting.GET("/recipients", giftingHandler.GetRecipients)
	gifting.GET("/quote", giftingHandler.QuoteGift)
	gifting.POST("/send", giftingHandler.SendGift)
	gifting.GET("/sent", giftingHandler.GetSentGifts)
	gifting.GET("/received", giftingHandler.GetReceivedGifts)
	gifting.GET("/transactions/:id", giftingHandler.GetGiftTransaction)

	kyc := v1.Group("/kyc")
	kyc.GET("/status", kycHandler.GetStatus)
	kyc.GET("/limits", kycHandler.GetLimits)
	kyc.POST("/tier1", kycHandler.SubmitTier1)
	kyc.POST("/tier2", kycHandler.SubmitTier2)
	kyc.POST("/tier3", kycHandler.SubmitTier3)

	me := v1.Group("/me")
	me.GET("/tier", kycHandler.GetTierStatus)

	payouts := v1.Group("/wallet/payouts")
	payouts.GET("/eligibility", payoutsHandler.GetEligibility)
	payouts.POST("/request", payoutsHandler.RequestPayout)
	payouts.GET("/history", payoutsHandler.GetHistory)
}

// registerConnectSafetyRoutes wires the Phase-1 safety + Phase-5 trust surface
// for Paymax Connect: chat (mutual-match-gated), report/block, the date-safety
// center, the guardrailed AI assistant, scam-shield, and the admin moderation
// queues. The orchestrator (registerConnectRoutes in connect_routes.go) calls
// this with the already-auth-wrapped member group and the admin group, so this
// function does NOT re-create auth — it adds per-route RBAC for admin routes only.
// Gating: the whole Connect surface is already behind cfg.FeatureConnectEnabled
// and the 18+/consent onboarding gate at the orchestrator level; these routes
// inherit that. Admin routes are deny-by-default via RequirePermission.
// Signature is fixed by the build contract:
func registerConnectSafetyRoutes(member *gin.RouterGroup, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService) {
	// Shared backbones.
	safetySvc := connectsafety.NewService(pool)
	safetyHandler := connectsafety.NewHandler(safetySvc)

	cfgReader := connecttrust.NewConfigReader(pool)
	shield := connecttrust.NewShieldStore(pool, cfgReader, safetySvc)
	coach := connecttrust.NewAICoach(pool, connecttrust.NewStubLLM())
	trustHandler := connecttrust.NewHandler(coach, shield)

	chatSvc := connectchat.NewService(pool, cfgReader, shield, safetySvc)
	chatHandler := connectchat.NewHandler(chatSvc)

	dateSvc := connectdatesafety.NewService(pool, safetySvc)
	dateHandler := connectdatesafety.NewHandler(dateSvc)

	modSvc := connectmoderation.NewService(pool, safetySvc)
	modHandler := connectmoderation.NewHandler(modSvc)

	// Chat: available ONLY after a mutual match (enforced in the chat service).
	member.POST("/matches/:matchId/conversation", chatHandler.OpenConversation)
	member.GET("/conversations/:id/messages", chatHandler.ListMessages)
	member.POST("/conversations/:id/messages", chatHandler.SendMessage)

	// Report/block (report handler is the existing one; block is the additive one).
	member.POST("/safety/block", safetyHandler.Block)
	member.DELETE("/safety/block/:blockedId", safetyHandler.Unblock)

	// Date-safety center.
	member.GET("/safety/trusted-contacts", dateHandler.ListContacts)
	member.POST("/safety/trusted-contacts", dateHandler.AddContact)
	member.DELETE("/safety/trusted-contacts/:id", dateHandler.DeleteContact)
	member.POST("/date-plans", dateHandler.CreatePlan)
	member.POST("/date-plans/:id/share", dateHandler.Share)
	member.POST("/date-plans/:id/checkin", dateHandler.CheckIn)
	member.POST("/date-plans/:id/feedback", dateHandler.Feedback)

	// Guardrailed AI assistant (Phase 5).
	member.POST("/ai/assist", trustHandler.AIGenerate)

	admin.GET("/moderation/conversations",
		middleware.RequirePermission(rbac, "connect.moderation.view"),
		modHandler.ListFlaggedConversations)
	admin.GET("/moderation/messages",
		middleware.RequirePermission(rbac, "connect.moderation.view"),
		modHandler.ListFlaggedMessages)
	admin.GET("/moderation/decisions",
		middleware.RequirePermission(rbac, "connect.moderation.view"),
		modHandler.ListDecisions)
	admin.POST("/moderation/decisions",
		middleware.RequirePermission(rbac, "connect.moderation.manage"),
		modHandler.RecordDecision)
	admin.PATCH("/moderation/conversations/:id",
		middleware.RequirePermission(rbac, "connect.moderation.manage"),
		modHandler.SetConversationState)
	admin.GET("/scam-shield",
		middleware.RequirePermission(rbac, "connect.moderation.view"),
		trustHandler.ListShieldFlags)

	log.Println("[connect] safety+trust routes registered — chat, block, date-safety, AI, moderation")
}

// registerConnectNetworkRoutes wires Paymax Connect Phase 6 networking (jobs/company
// pages/referral bounties, content feed, network profile + recommendations, skill
// assessments, mentorship) onto the member + admin route groups created by the
// Connect orchestrator (connect_routes.go). Both groups already carry
// RequireAuthContext + the c.Set("user_id", ...) mirror; the parent enforces the
// FeatureConnectEnabled gate before calling here.
// All five packages are normalized to the single base prefix /networking:
//
//	member: /api/v1/connect/networking/*
//	admin : /api/connect/admin/networking/*
//
// Money path (jobs paid-posting fee + referral bounty payout) REUSES the finance
// ledger/wallet: balanced double-entry, Idempotency-Key required, tier-limit
// fail-closed, audited. The loyalty rail is the single Paymax Black emit seam (PN-8) —
// no second currency. This file edits no existing package; it only constructs the
// narrow ports and calls each package's Register.
func registerConnectNetworkRoutes(member, admin *gin.RouterGroup, cfg config.Config, pool *pgxpool.Pool, rbac services.RBACService) {
	if pool == nil {
		log.Println("[connect-network] nil pool — skipping Connect networking routes")
		return
	}

	// auditAdapter defined in connect_growth_routes.go — same package). It satisfies
	// every networking package's Auditor (WriteAudit) interface.
	safetySvc := connectsafety.NewService(pool)
	audit := &auditAdapter{svc: safetySvc}

	// is enforced by the ledger unique constraint (idempotency_key); the Redis
	// fast-path is an optimisation only. *wallet.Service.Debit and *ledger.Service.Credit
	// structurally satisfy connectjobs.WalletDebiter / connectjobs.LedgerCrediter, so
	// the concrete services are passed directly (no adapter needed).
	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), nil)
	tiersSvc := tiers.NewService(pool)
	walletSvc := wallet.NewService(ledgerSvc, tiersSvc)

	// own audit sink (LogAction, distinct from connect WriteAudit); we pass nil here as
	// the top-5 loyalty wiring does — the connect audit trail is the injected auditAdapter.
	ptsSvc := points.NewService(pool, nil)
	loySvc := loyalty.NewService(pool, ptsSvc, nil)
	loyaltyPort := &networkLoyaltyAdapter{svc: loySvc}

	revenue := &networkRevenueResolver{ledger: ledgerSvc}

	// Commission recording for a paid job activation's realized profit under
	// Community/Job. Ledger-less recorder — the posting fee debit already books
	// into paymax_revenue, so RecordFor appends the earning ROW only. Flag off ⇒
	// nil-safe no-op. Declared via connectjobs.CommissionRecorder so the zero
	// value is a true nil interface (avoids the typed-nil trap).
	var jobsCommission connectjobs.CommissionRecorder
	if cfg.FeatureCommissionEnabled {
		jobsCommission = commissionRecorderAdapter{svc: withReferralSplit(commission.NewService(commission.NewRepository(pool), nil), pool, cfg)}
		log.Println("[connect-network] commission recording wired → Community/Job (earning-row only; no ledger re-post)")
	}

	connectjobs.Register(member, admin, pool, rbac, walletSvc, ledgerSvc, revenue, loyaltyPort, audit, jobsCommission)
	connectfeed.Register(member, admin, pool, rbac, audit)
	connectnetprofile.Register(member, admin, pool, rbac, audit)
	connectassess.Register(member, admin, pool, rbac, loyaltyPort, audit)
	connectmentor.Register(member, admin, pool, rbac, loyaltyPort, audit)

	log.Println("[connect-network] routes registered — jobs/feed/profile/assessments/mentorship under /networking")
}

// networkRevenueResolver resolves the standing ledger accounts the jobs module posts
// against: paymax_revenue (credited when a paid job-posting fee debits the poster's
// wallet) and referral_reward_expense (debited as the counterpart of the CREDIT to a
// referrer's wallet when a bounty is paid out). Implements connectjobs.RevenueResolver.
type networkRevenueResolver struct{ ledger *ledger.Service }

func (r *networkRevenueResolver) RevenueAccountID(ctx context.Context) (string, error) {
	acc, err := r.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		return "", err
	}
	return acc.ID, nil
}

func (r *networkRevenueResolver) ReferralExpenseAccountID(ctx context.Context) (string, error) {
	acc, err := r.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountReferralReward)
	if err != nil {
		return "", err
	}
	return acc.ID, nil
}

// networkLoyaltyAdapter is the single Paymax Black emit seam (PN-8). It wraps
// loyalty.Service.AwardFor (which returns *points.Entry) behind the narrow
// AwardFor(ctx, userID, module, trigger, ref) error port shared by the jobs,
// assessments, and mentorship packages, discarding the entry.
type networkLoyaltyAdapter struct{ svc *loyalty.Service }

func (l *networkLoyaltyAdapter) AwardFor(ctx context.Context, userID, module, trigger, ref string) error {
	_, err := l.svc.AwardFor(ctx, userID, module, trigger, points.EarnContext{
		Module:    module,
		Reference: ref,
	})
	return err
}

// registerConnectGrowthRoutes wires Paymax Connect Phases 2,3,4,6 onto the
// member + admin route groups created by the Connect orchestrator
// (connect_routes.go, read-only here for the auth/RBAC patterns). Both groups
// already have RequireAuthContext applied and c.Set("user_id", ...) populated.
//   - member: /api/v1/connect  (member-authenticated)
//   - admin : /api/connect/admin (member-authenticated; per-route RBAC added here)
//
// Money path (Phase 6) reuses the finance ledger/wallet: balanced double-entry,
// idempotency-keyed, tier-checked, audited. No money is mutated outside the
// ledger; entitlements are enforced server-side.
func registerConnectGrowthRoutes(member *gin.RouterGroup, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService) {
	if pool == nil {
		log.Println("[connect-growth] nil pool — skipping Connect growth routes")
		return
	}

	safetySvc := connectsafety.NewService(pool)
	audit := &auditAdapter{svc: safetySvc}

	// Redis is nil here: idempotency is still enforced by the ledger unique
	// constraint (idempotency_key) — the Redis fast-path is an optimisation only.
	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), nil)
	tiersSvc := tiers.NewService(pool)
	walletSvc := wallet.NewService(ledgerSvc, tiersSvc)
	revenue := &revenueAdapter{ledger: ledgerSvc}

	proSvc := connectprofessional.NewService(pool, audit)
	pro := connectprofessional.NewHandler(proSvc)
	p := member.Group("/professional")
	p.GET("/profile", pro.GetProfile)
	p.PATCH("/profile", pro.UpsertProfile)
	p.POST("/verification", pro.RequestVerification) // encrypted evidence_ref only
	p.GET("/discovery", pro.Discover)
	p.POST("/intro", pro.SendIntro) // consent-before-messaging
	p.POST("/intro/:id/respond", pro.RespondIntro)
	p.PATCH("/business-card", pro.UpsertCard)
	p.POST("/contacts", pro.ExchangeCard) // requires accepted intro
	p.GET("/contacts", pro.ListContacts)
	p.POST("/rooms", pro.CreateRoom)
	p.POST("/rooms/:id/join", pro.JoinRoom)
	p.POST("/rooms/:id/moderate", pro.ModerateRoom)

	evSvc := connectevents.NewService(pool, audit)
	ev := connectevents.NewHandler(evSvc)
	e := member.Group("/events")
	e.POST("/:id/networking/opt-in", ev.OptIn) // explicit opt-in
	e.GET("/:id/attendees", ev.Attendees)      // opt-in-privacy discovery
	e.POST("/:id/checkin", ev.CheckIn)
	e.POST("/:id/qr/scan", ev.ScanQR) // organiser scans ticket QR
	e.POST("/:id/contacts", ev.SaveContact)
	e.GET("/contacts", ev.ListContacts) // follow-up

	crSvc := connectcreator.NewService(pool, audit)
	cr := connectcreator.NewHandler(crSvc)
	cg := member.Group("/creator")
	cg.GET("/profile", cr.GetProfile)
	cg.PATCH("/profile", cr.UpsertProfile)
	cg.POST("/portfolio", cr.AddPortfolio) // moderated before public
	cg.GET("/portfolio", cr.ListPortfolio)
	cg.POST("/verification", cr.RequestVerification) // encrypted evidence_ref only
	cg.PATCH("/fan-messages", cr.SetFanPolicy)       // server-side fan control
	cg.POST("/collab-requests", cr.SubmitCollab)
	cg.GET("/collab-requests", cr.ListCollabs)
	cg.POST("/collab-requests/:id/respond", cr.RespondCollab)

	refunder := &connectRefundAdapter{ledger: ledgerSvc}
	monSvc := connectmonetization.NewService(pool, walletSvc, revenue, audit, refunder)
	// PAY-008: consumable credits (super-likes/InMail). Grant on pass purchase; read balance.
	creditsSvc := connectcredits.NewService(pool)
	monSvc.SetCreditGranter(creditsSvc)
	credits := connectcredits.NewHandler(creditsSvc)
	mon := connectmonetization.NewHandler(monSvc)
	mg := member.Group("/")
	mg.GET("/plans", mon.ListPlans)
	mg.POST("/subscriptions", mon.Subscribe)                 // Idempotency-Key required
	mg.POST("/subscriptions/cancel", mon.CancelSubscription) // PAY-006 cancel (end-of-period or immediate+proration)
	mg.POST("/boosts", mon.BuyBoost)                         // Idempotency-Key required
	mg.POST("/passes", mon.BuyPass)                          // Idempotency-Key required
	mg.GET("/entitlements", mon.Entitlements)
	mg.GET("/credits", credits.Balances)                // PAY-008 consumable credit balances
	mg.POST("/date-plans/:id/ride", mon.BookRide)       // reuses Mobility + wallet
	mg.POST("/date-plans/:id/tickets", mon.BookTickets) // reuses Events + wallet

	admin.POST("/business/verification",
		middleware.RequirePermission(rbac, "connect.business.review"), pro.AdminReviewVerification)
	admin.GET("/creator/verification",
		middleware.RequirePermission(rbac, "connect.creator.view"), cr.AdminVerificationQueue)
	admin.POST("/creator/verification",
		middleware.RequirePermission(rbac, "connect.creator.review"), cr.AdminReviewVerification)
	admin.POST("/plans",
		middleware.RequirePermission(rbac, "connect.plans.manage"), mon.AdminUpsertPlan)
	admin.GET("/orders",
		middleware.RequirePermission(rbac, "connect.payments.reconcile"), mon.AdminListOrders)
	admin.POST("/orders/:id/refund",
		middleware.RequirePermission(rbac, "connect.payments.refund"), mon.AdminRefund)
	admin.POST("/subscriptions/run-renewals",
		middleware.RequirePermission(rbac, "connect.payments.reconcile"), mon.AdminRunRenewals)

	log.Println("[connect-growth] routes registered — professional/events/creator/monetization live")
}

// auditAdapter bridges the per-package Auditor interface to the Phase 0
// connect_audit_log writer (connect_safety.Service.WriteAudit). Every money
// mutation and admin decision flows through here.
type auditAdapter struct{ svc *connectsafety.Service }

func (a *auditAdapter) WriteAudit(ctx context.Context, action, actorID, entityType, entityID string, newValue map[string]any) error {
	return a.svc.WriteAudit(ctx, connectsafety.AuditInput{
		ActorID:    actorID,
		Action:     action,
		EntityType: entityType,
		EntityID:   entityID,
		NewValue:   newValue,
	})
}

// revenueAdapter resolves the standing paymax_revenue ledger account that Connect
// purchases credit (the debit side is the buyer's user wallet).
type revenueAdapter struct{ ledger *ledger.Service }

func (r *revenueAdapter) RevenueAccountID(ctx context.Context) (string, error) {
	acc, err := r.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		return "", err
	}
	return acc.ID, nil
}

// connectRefundAdapter reverses a Connect purchase: a balanced double-entry
// DR paymax_revenue → CR buyer user_wallet (the mirror of the purchase debit),
// keyed by idempotencyKey. A duplicate key means the refund already posted, which
// is mapped to success so the refund is SINGLE under retries/concurrency (PAY-007).
type connectRefundAdapter struct{ ledger *ledger.Service }

func (r *connectRefundAdapter) Refund(ctx context.Context, userID, reference, idempotencyKey string, amountKobo int64) error {
	if amountKobo <= 0 {
		return ledger.ErrInsufficientFunds
	}
	rev, err := r.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		return err
	}
	w, err := r.ledger.GetOrCreateUserWallet(ctx, userID)
	if err != nil {
		return err
	}
	err = r.ledger.PostJournal(ctx, ledger.JournalEntry{
		Reference:       reference,
		IdempotencyKey:  idempotencyKey,
		AmountKobo:      amountKobo,
		DebitAccountID:  rev.ID, // revenue gives the money back…
		CreditAccountID: w.ID,   // …to the buyer's wallet
	})
	if errors.Is(err, ledger.ErrDuplicate) {
		return nil // already refunded — idempotent success
	}
	return err
}

// Discovery RBAC permission slugs. Seeded by the connect discovery migration
// (see connect_boosts migration + rbac_permissions seed). Enforced per-route in
// ADDITION to the inherited member auth. If unseeded, RequirePermission fails
// closed (403) — deliberately: the gate must be seeded before go-live.
const (
	permDiscoveryAccess = "connect.discovery.access"
	permBoostPurchase   = "connect.boost.purchase"
)

// registerConnectPhase1Routes wires the Paymax Connect Phase-1 core slice
// (profiles + per-mode visibility, L0–L1 selfie/liveness verification + badge,
// curated daily discovery with match-reason cards, idempotent likes/super-likes
// with mutual-only matches, and privacy-preserving search) onto the already
// auth-gated member/admin groups created by registerConnectRoutes.
// The orchestrator (connect_routes.go) calls this with the shared member group
// (RequireAuthContext + user_id mirror already applied), the admin group, the pgx
// pool, and the RBAC service. All routes inherit the FeatureConnectEnabled gate
// from the parent group; admin routes add per-route RBAC permission checks.
// Tunables (daily/anti-fatigue limits, ranking weights, distance buckets, badge
// min level) are read from the backend-owned connect_config table — never
// hard-coded and never new env config.
func registerConnectPhase1Routes(member *gin.RouterGroup, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService) {
	// Verification provider (Phase 1 stub — no real SDK, no network). The pepper is
	// the existing CONNECT_VERIFICATION_PEPPER env (read here so we neither edit
	// config.go nor depend on it being threaded through the signature). If unset,
	// verification endpoints are skipped fail-closed rather than hashing with no key.
	var verifSvc *connectverification.StatusService
	if pepper := os.Getenv("CONNECT_VERIFICATION_PEPPER"); pepper != "" {
		hasher, err := connectverification.NewHasher(pepper)
		if err != nil {
			log.Printf("[connect:phase1] verification disabled: %v", err)
		} else if stub, err := connectverification.NewStubProvider(hasher); err != nil {
			log.Printf("[connect:phase1] verification disabled: %v", err)
		} else {
			badgeMin := connectverification.VerificationLevel(
				connectConfigString(pool, "verification.badge_min_level", "l1"))
			verifSvc = connectverification.NewStatusService(pool, stub, badgeMin)
		}
	} else {
		log.Println("[connect:phase1] CONNECT_VERIFICATION_PEPPER unset — verification endpoints disabled")
	}

	// Profile service surfaces the verified badge via the verification service when
	// available (nil-safe: badge defaults false otherwise).
	var badgeChecker connectprofile.BadgeChecker
	if verifSvc != nil {
		badgeChecker = verifSvc
	}
	profileSvc := connectprofile.NewService(pool, badgeChecker)
	profileHandler := connectprofile.NewHandler(profileSvc)

	matchSvc := connectmatching.NewService(pool)
	matchSvc.SetCreditConsumer(connectcredits.NewService(pool)) // PAY-003: super-like spends a credit
	matchHandler := connectmatching.NewHandler(matchSvc)

	discoverySvc := connectdiscovery.NewService(pool)
	discoveryHandler := connectdiscovery.NewHandler(discoverySvc)

	// rewind/boosts). Reuses the SAME discovery ranking + the SAME matching
	// mutual-match transaction underneath; boosts reuse the finance ledger/wallet
	// money path (identical pattern to paid voting: DR wallet, CR paymax_revenue). ---
	// Money stack (REUSED from internal/finance — no hand-rolled ledger SQL):
	//   ledger.Service → wallet.Service.Debit (tier-checked, balanced double-entry,
	//   idempotent on the ledger unique idempotency_key). Redis nil: the DB unique
	//   constraint remains the durable idempotency backstop.
	discLedger := ledger.NewService(ledger.NewRepository(pool), nil)
	discTiers := tiers.NewService(pool)
	discWallet := wallet.NewService(discLedger, discTiers)
	discAudit := &connectDiscoveryAuditAdapter{svc: connectsafety.NewService(pool)}

	boostSvc := connectdiscovery.NewBoostService(
		connectdiscovery.NewBoostRepo(pool),
		discWallet, // WalletDebiter (tier-checked debit → credit account)
		&connectDiscoveryRevenueAdapter{ledger: discLedger}, // paymax_revenue resolver
		discTiers, // TierGuard (fail-closed, BEFORE the charge)
		discAudit, // immutable audit event per purchase
		nil,       // AML boost flagger wired in production
		connectdiscovery.NewConfigReader(pool),
	)

	memberDiscovery := connectdiscovery.NewMemberHandler(
		discoverySvc,
		&connectLikeRecorderAdapter{svc: matchSvc}, // reuse the mutual-match tx
		boostSvc,
	)

	member.GET("/profile", profileHandler.Get)
	member.PATCH("/profile", profileHandler.Update)
	member.GET("/profile/modes", profileHandler.GetModes)
	member.PATCH("/profile/modes/:mode", profileHandler.UpsertMode)
	member.POST("/profile/media", profileHandler.AddMedia)

	if verifSvc != nil {
		verifHandler := connectverification.NewHandler(verifSvc)
		member.POST("/verification/selfie", verifHandler.Selfie)
		member.GET("/verification/status", verifHandler.Status)
	}

	member.GET("/discovery", discoveryHandler.Discovery)
	member.POST("/likes", matchHandler.Like)
	member.GET("/matches", matchHandler.ListMatches)
	member.GET("/search", discoveryHandler.Search)

	// every route, IN ADDITION to the inherited member auth; the boost POST adds
	// connect.boost.purchase). ---
	discoveryGate := middleware.RequirePermission(rbac, permDiscoveryAccess)
	member.GET("/discovery/stack", discoveryGate, memberDiscovery.Stack)
	member.POST("/discovery/swipe", discoveryGate, memberDiscovery.Swipe)
	member.GET("/discovery/likes-you", discoveryGate, memberDiscovery.LikesYou)
	member.GET("/discovery/nearby", discoveryGate, memberDiscovery.Nearby)
	member.POST("/discovery/rewind", discoveryGate, memberDiscovery.Rewind) // premium action
	member.GET("/discovery/boosts", discoveryGate, memberDiscovery.BoostInfo)
	member.POST("/discovery/boosts",
		discoveryGate,
		middleware.RequirePermission(rbac, permBoostPurchase),
		memberDiscovery.BuyBoost) // MONEY PATH — Idempotency-Key required

	// Verification review read (admin reads its own session status here as a stub;
	// the full admin queue with user_id param lands in the admin sub-package).
	if verifSvc != nil {
		verifHandler := connectverification.NewHandler(verifSvc)
		admin.GET("/verification/status",
			middleware.RequirePermission(rbac, "connect.verification.view"),
			verifHandler.Status)
	}

	log.Println("[connect:phase1] routes registered — profile/modes/media, verification, discovery, likes, matches, search, discovery stack/swipe/likes-you/nearby/rewind/boosts")
}

// connectLikeRecorderAdapter adapts connectmatching.Service.Like (which returns
// *connectmatching.LikeResult) to the discovery LikeRecorder seam. Swipe delegates
// like/superlike through here so the idempotent mutual-match transaction stays in
// ONE place (the matching package) and is never re-implemented in discovery.
type connectLikeRecorderAdapter struct{ svc *connectmatching.Service }

func (a *connectLikeRecorderAdapter) Like(ctx context.Context, fromUserID, toProfileID, kind string) (connectdiscovery.SwipeResult, error) {
	res, err := a.svc.Like(ctx, fromUserID, toProfileID, kind)
	if err != nil {
		return connectdiscovery.SwipeResult{}, err
	}
	return connectdiscovery.SwipeResult{Matched: res.Matched, MatchID: res.MatchID}, nil
}

// connectDiscoveryRevenueAdapter resolves the standing paymax_revenue ledger
// account that boost purchases credit (same account paid-vote revenue credits).
type connectDiscoveryRevenueAdapter struct{ ledger *ledger.Service }

func (r *connectDiscoveryRevenueAdapter) RevenueAccountID(ctx context.Context) (string, error) {
	acc, err := r.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		return "", err
	}
	return acc.ID, nil
}

// connectDiscoveryAuditAdapter bridges the discovery BoostAuditor interface to the
// Phase 0 connect_audit_log writer (connect/safety.Service.WriteAudit) — the same
// immutable audit trail the money path uses elsewhere.
type connectDiscoveryAuditAdapter struct{ svc *connectsafety.Service }

func (a *connectDiscoveryAuditAdapter) WriteAudit(ctx context.Context, action, actorID, entityType, entityID string, newValue map[string]any) error {
	return a.svc.WriteAudit(ctx, connectsafety.AuditInput{
		ActorID:    actorID,
		Action:     action,
		EntityType: entityType,
		EntityID:   entityID,
		NewValue:   newValue,
	})
}

// connectConfigString reads a string-valued connect_config key (JSON string) with
// a fallback, so verification badge level stays backend-owned. Best-effort: any
// error returns the default.
func connectConfigString(pool *pgxpool.Pool, key, def string) string {
	var raw []byte
	if err := pool.QueryRow(context.Background(),
		`SELECT value FROM connect_config WHERE key = $1`, key).Scan(&raw); err != nil {
		return def
	}
	s := string(raw)
	// Stored as a JSON string e.g. "l1" — strip the surrounding quotes if present.
	if len(s) >= 2 && s[0] == '"' && s[len(s)-1] == '"' {
		return s[1 : len(s)-1]
	}
	return def
}

// RegisterConnectMoney wires the Paymax Connect money path (gifting, voting,
// AML, payouts) onto the member + admin route groups created by the Connect
// orchestrator (connect_routes.go). Both groups already have RequireAuthContext
// applied and c.Set("user_id", ...) populated; FeatureConnectEnabled is enforced
// upstream by the parent group, so these routes inherit the same gate.
//   - member: /api/v1/connect      (member-authenticated)
//   - admin : /api/connect/admin   (member-authenticated; per-route RBAC added here)
//   - public: /api/v1/connect      (NO auth — same path prefix as member, but
//     the parent group itself, before connectAuth() was applied to member)
//
// Money path reuses the finance ledger/wallet: every mutation posts a balanced
// double-entry, requires an Idempotency-Key, is tier-checked fail-closed, emits
// an audit event, and is reported to AML. No money is mutated outside the ledger
// and no balance column is ever written.
// The orchestrator (connect_routes.go) calls this; this file is the only one the
// orchestrator wires in. It edits no existing file.
func RegisterConnectMoney(member *gin.RouterGroup, admin *gin.RouterGroup, public *gin.RouterGroup, cfg config.Config, pool *pgxpool.Pool, rbac services.RBACService, redisClient *platformRedis.Client) {
	if pool == nil {
		log.Println("[connect-money] nil pool — skipping Connect money routes")
		return
	}

	safetySvc := connectsafety.NewService(pool)
	audit := &connectMoneyAuditAdapter{svc: safetySvc}

	// Redis is nil here: idempotency is still enforced by the ledger unique
	// constraint (idempotency_key); the Redis fast-path is an optimisation only.
	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), nil)
	tiersSvc := tiers.NewService(pool)
	walletSvc := wallet.NewService(ledgerSvc, tiersSvc)

	revenue := &connectRevenueAdapter{ledger: ledgerSvc}
	settlement := &connectSettlementAdapter{ledger: ledgerSvc}
	transfer := &connectWalletTransferAdapter{ledger: ledgerSvc}
	tierGate := &connectTierGateAdapter{tiers: tiersSvc}
	payoutReverser := &connectPayoutReverseAdapter{ledger: ledgerSvc}

	amlSvc := connectaml.NewService(
		connectaml.NewRepository(pool),
		audit,
		connectaml.NoopScreener{}, // production wires a real sanctions/PEP screener
		connectaml.DefaultThresholds(),
	)

	giftSvc := connectgifting.NewService(
		connectgifting.NewRepository(pool), transfer, tiersSvc, audit, amlSvc)
	// Admin-reporting-only tier lookup (read-only; see gifting/admin.go).
	giftSvc.SetTierReader(&connectTierGateAdapter{tiers: tiersSvc})
	connectgifting.Register(member, giftSvc)

	voteSvc := connectvoting.NewService(
		connectvoting.NewRepository(pool), walletSvc, revenue, audit, amlSvc)
	// Commission recording for realized paid-vote profit. Ledger-less recorder —
	// the vote debit already posts into paymax_revenue, so RecordFor appends the
	// earning ROW only; best-effort, never fails a vote (recordCommissionSafe).
	// Flag off ⇒ nil-safe no-op.
	if cfg.FeatureCommissionEnabled {
		voteSvc.SetCommissionRecorder(commissionRecorderAdapter{svc: withReferralSplit(commission.NewService(commission.NewRepository(pool), nil), pool, cfg)})
		log.Println("[connect-money] commission recording wired → Contest/Voting (earning-row only; no ledger re-post)")
	}
	connectvoting.Register(member, voteSvc, cfg, redisClient)
	connectvoting.RegisterPublic(public, voteSvc, cfg)
	// Contest expiry loop — closes contests past their voting deadline so a
	// finished contest stops advertising itself as LIVE on the phone and in the
	// web list. Votes were already refused correctly by the closes_at window; this
	// makes the STATUS agree with that. House pattern for periodic work is a
	// background ticker (no pg_cron, no asynq scheduler in this repo).
	// context.Background(): this ticker lives for the process, and
	// RegisterConnectMoney takes no ctx — the same choice finance_routes.go makes
	// for StartReconScheduler. Widening the signature would ripple to the
	// orchestrator for no behavioural gain.
	connectvoting.StartExpiryCloser(context.Background(), pool, connectvoting.DefaultExpiryInterval)

	payoutSvc := connectpayouts.NewService(
		connectpayouts.NewRepository(pool), walletSvc, settlement, tierGate,
		nil, // settlement provider hook wired in production (stub: no auto-settle)
		audit, amlSvc, payoutReverser)
	connectpayouts.Register(member, payoutSvc)

	guard := func(permission string) gin.HandlerFunc {
		return middleware.RequirePermission(rbac, permission)
	}
	// Voting admin routes (eviction management, stage progression)
	connectvoting.RegisterAdmin(admin, voteSvc, guard, cfg)
	// AML admin routes
	connectaml.Register(admin, amlSvc, guard)
	// Gifting admin routes (CONNECT-001: gift-transactions ledger, read-only)
	connectgifting.RegisterAdmin(admin, giftSvc, guard)
	// Payouts admin routes (CONNECT-001: the member group only ever exposed
	// creator-facing POST/GET /payouts — there was no admin list/detail/
	// settle/reject surface at all, so the admin payout queue 404'd in
	// production). List/detail read-only; settle/reject are money-adjacent
	// (settle stamps the row only, reject reverses the parked ledger debit).
	connectpayouts.RegisterAdmin(admin, payoutSvc, guard)

	log.Println("[connect-money] routes registered — gifting/voting (+ eviction/stages)/aml/payouts (+ admin) live")
}

// connectMoneyAuditAdapter bridges the per-package Auditor interface to the
// Phase 0 connect_audit_log writer (connect_safety.Service.WriteAudit).
type connectMoneyAuditAdapter struct{ svc *connectsafety.Service }

func (a *connectMoneyAuditAdapter) WriteAudit(ctx context.Context, action, actorID, entityType, entityID string, newValue map[string]any) error {
	return a.svc.WriteAudit(ctx, connectsafety.AuditInput{
		ActorID:    actorID,
		Action:     action,
		EntityType: entityType,
		EntityID:   entityID,
		NewValue:   newValue,
	})
}

// connectRevenueAdapter resolves the standing paymax_revenue ledger account that
// paid-vote revenue credits.
type connectRevenueAdapter struct{ ledger *ledger.Service }

func (r *connectRevenueAdapter) RevenueAccountID(ctx context.Context) (string, error) {
	acc, err := r.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		return "", err
	}
	return acc.ID, nil
}

// connectSettlementAdapter resolves the standing settlement account that creator
// payout debits are parked in pending bank settlement.
type connectSettlementAdapter struct{ ledger *ledger.Service }

func (s *connectSettlementAdapter) SettlementAccountID(ctx context.Context) (string, error) {
	acc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountSettlement)
	if err != nil {
		return "", err
	}
	return acc.ID, nil
}

// connectWalletTransferAdapter performs a wallet→wallet transfer as a single
// balanced double-entry via the ledger: DR sender user_wallet, CR recipient
// user_wallet, keyed by idempotencyKey. It checks the sender's available balance
// first and posts immutable entries — it never writes a balance column.
type connectWalletTransferAdapter struct{ ledger *ledger.Service }

func (t *connectWalletTransferAdapter) Transfer(ctx context.Context, fromUserID, toUserID, reference, idempotencyKey string, amountKobo int64) error {
	if amountKobo <= 0 {
		return ledger.ErrInsufficientFunds
	}
	fromAcc, err := t.ledger.GetOrCreateUserWallet(ctx, fromUserID)
	if err != nil {
		return err
	}
	toAcc, err := t.ledger.GetOrCreateUserWallet(ctx, toUserID)
	if err != nil {
		return err
	}
	// Available-balance check on the sender (ledger projection; no balance column).
	balance, err := t.ledger.GetBalance(ctx, fromUserID)
	if err != nil {
		return err
	}
	if balance < amountKobo {
		return ledger.ErrInsufficientFunds
	}
	// Balanced double-entry, idempotent (ledger unique constraint on the key).
	return t.ledger.PostJournal(ctx, ledger.JournalEntry{
		Reference:       reference,
		IdempotencyKey:  idempotencyKey,
		AmountKobo:      amountKobo,
		DebitAccountID:  fromAcc.ID,
		CreditAccountID: toAcc.ID,
	})
}

// connectTierGateAdapter adapts tiers.Service.GetUserTier (returns tiers.Tier) to
// the payouts TierGate interface (returns int).
type connectTierGateAdapter struct{ tiers *tiers.Service }

func (g *connectTierGateAdapter) GetUserTier(ctx context.Context, userID string) (int, error) {
	t, err := g.tiers.GetUserTier(ctx, userID)
	if err != nil {
		return 0, err
	}
	return int(t), nil
}

// connectPayoutReverseAdapter implements connectpayouts.PayoutReverser for the
// admin reject action. It reverses the parked settlement debit a payout
// Request() posted: a balanced REVERSAL_DEBIT/REVERSAL_CREDIT pair via
// ledger.PostReversal — money moves BACK from the standing settlement account
// to the creator's user_wallet. This is the mirror of connectSettlementAdapter
// (which resolves the same settlement account for the forward debit) and reuses
// the same ledger.Service — no new money-movement code, per CLAUDE.md.
// The idempotency key is deterministic (not a client-supplied header) so a
// retried admin request — or a double-click in the console — can never reverse
// the same payout twice; the ledger's own unique-constraint dedup makes the
// second call a safe no-op (see ledger.ErrDuplicate handling below).
type connectPayoutReverseAdapter struct{ ledger *ledger.Service }

func (r *connectPayoutReverseAdapter) ReversePayout(ctx context.Context, creatorID, payoutID string, amountKobo int64) error {
	if amountKobo <= 0 {
		return ledger.ErrInsufficientFunds
	}
	settleAcc, err := r.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountSettlement)
	if err != nil {
		return err
	}
	creatorWallet, err := r.ledger.GetOrCreateUserWallet(ctx, creatorID)
	if err != nil {
		return err
	}
	ref := "connect:payout:reject:" + payoutID
	idem := "connect:payout:reject:" + payoutID
	err = r.ledger.PostReversal(ctx, creatorWallet.ID, settleAcc.ID, amountKobo, ref, idem)
	if errors.Is(err, ledger.ErrDuplicate) {
		return nil // already reversed — idempotent success, mirrors connectRefundAdapter
	}
	return err
}
