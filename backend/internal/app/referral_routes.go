package app

import (
	"context"
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"log"
	"spotlight/backend/internal/config"
	"spotlight/backend/internal/finance/commission"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/referrals"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/handlers"
	"spotlight/backend/internal/middleware"
	referralanalytics "spotlight/backend/internal/referral/analytics"
	"spotlight/backend/internal/referral/attribution"
	"spotlight/backend/internal/referral/campaigns"
	"spotlight/backend/internal/referral/commissionsplit"
	referralcompliance "spotlight/backend/internal/referral/compliance"
	referralconfig "spotlight/backend/internal/referral/config"
	referralevents "spotlight/backend/internal/referral/events"
	referralfinance "spotlight/backend/internal/referral/finance"
	"spotlight/backend/internal/referral/gamification"
	referralhouse "spotlight/backend/internal/referral/house"
	"spotlight/backend/internal/referral/invite"
	referralledger "spotlight/backend/internal/referral/ledger"
	"spotlight/backend/internal/referral/merchant"
	"spotlight/backend/internal/referral/network"
	referralrisk "spotlight/backend/internal/referral/risk"
	"spotlight/backend/internal/services"
	"time"
)

// RegisterReferral wires the §7A Referral Earning core onto the finance member
// group and a referral admin group. The orchestrator (finance_routes.go) calls
// this — this file is the only one wired in; it edits no existing file.
//   - member: /api/finance/referral/*  (member-authenticated; user_id mirrored)
//   - admin : /api/referral/admin/*    (member-authenticated; per-route RBAC referral.*)
//
// FeatureReferralsEnabled is enforced upstream by the parent finance group, so
// these routes inherit the same gate. Money path reuses the finance ledger: real
// payouts post balanced double-entries with idempotency keys; house accruals are
// notional (non-withdrawable), excluded from override chains and K-factor.
// NewSignupAttributor builds the §7A attribution service and returns it as the
// narrow function the auth handler needs. Registration is where attribution has
// to happen — the web route did it and the Go route did not, which is one of the
// reasons the two implementations could not simply be merged.
// Returns nil on a nil pool, and the handler then skips attribution rather than
// failing signup.
func NewSignupAttributor(pool *pgxpool.Pool) handlers.ReferralAttributor {
	if pool == nil {
		return nil
	}
	svc := newAttributionService(pool)
	return func(ctx context.Context, userID, referralCode string) error {
		_, err := svc.ResolveReferrer(ctx, userID, attribution.ResolveOpts{CodeEntered: referralCode})
		return err
	}
}

// newAttributionService assembles the §7A dependency graph. Extracted so signup
// and the referral routes build it the same way instead of drifting.
func newAttributionService(pool *pgxpool.Pool) *attribution.Service {
	financeLedgerSvc := ledger.NewService(ledger.NewRepository(pool), nil)
	// REF-002: resolve codes through the Direct Referral Rewards Engine
	// (finance/referrals.RewardService), which checks referral_links (the
	// engine's canonical code table) THEN falls back to the legacy
	// finance_referral_codes seed. The older referrals.Service only ever
	// checked the legacy table, so codes minted via the newer engine were
	// invisible to signup attribution and got routed to the house with
	// RiskInvalidCode. RewardService.ResolveCodeToReferrer adapts its
	// resolveCode() to the same CodeResolver interface, so this is a
	// drop-in swap — no duplicate lookup logic.
	codeSvc := referrals.NewRewardService(pool, financeLedgerSvc)
	cfgSvc := referralconfig.NewService(pool)
	eventsSvc := referralevents.NewService(pool)
	houseSvc := referralhouse.NewService(pool)
	rewardSvc := referralledger.NewService(pool, financeLedgerSvc)
	return attribution.NewService(pool, codeSvc, houseSvc, rewardSvc, cfgSvc, eventsSvc)
}

func RegisterReferral(member *gin.RouterGroup, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService) {
	if pool == nil {
		log.Println("[referral] nil pool — skipping referral routes")
		return
	}

	// Finance ledger (reused for real reward payouts; Redis nil → ledger unique
	// constraint still enforces idempotency).
	financeLedgerSvc := ledger.NewService(ledger.NewRepository(pool), nil)

	// REF-002: resolve codes via RewardService (referral_links THEN the legacy
	// finance_referral_codes seed) — see newAttributionService for the full
	// rationale. Kept identical between both wiring sites so they don't drift.
	codeSvc := referrals.NewRewardService(pool, financeLedgerSvc)

	// §7A core services.
	cfgSvc := referralconfig.NewService(pool)
	eventsSvc := referralevents.NewService(pool)
	houseSvc := referralhouse.NewService(pool)
	rewardSvc := referralledger.NewService(pool, financeLedgerSvc)
	// Durable audit for the withdraw money mutation → referral events sink.
	rewardSvc.SetAuditSink(func(ctx context.Context, event, userID string, payload map[string]any, idem string) error {
		return eventsSvc.Record(ctx, referralevents.Input{
			EventType:      event,
			UserID:         userID,
			Payload:        payload,
			IdempotencyKey: idem,
		})
	})
	attribSvc := attribution.NewService(pool, codeSvc, houseSvc, rewardSvc, cfgSvc, eventsSvc)

	cfgHandler := referralconfig.NewHandler(cfgSvc)
	houseHandler := referralhouse.NewHandler(houseSvc, pool)
	rewardHandler := referralledger.NewHandler(rewardSvc)
	attribHandler := attribution.NewHandler(attribSvc, pool)
	inviteHandler := invite.NewHandler(pool)

	// `member` is ALREADY the /referral group (see finance_routes.go); grouping
	// "/referral" again mounted these eight routes at
	// /api/finance/referral/referral/*, which no client could reach — the sibling
	// Register fns (Econ, Trust) correctly use `member` directly.
	mg := member
	mg.GET("/config", cfgHandler.Get)                      // config-read
	mg.GET("/my-attribution", attribHandler.MyAttribution) // M-ONB-10 result
	mg.POST("/claim-code", attribHandler.ClaimCode)        // M-INV-10 late claim
	mg.GET("/my-rewards", rewardHandler.MySummary)         // M-HOME-03 summary
	mg.GET("/withdraw-eligible", rewardHandler.MyEligible) // eligible balance
	mg.POST("/withdraw", rewardHandler.MyWithdraw)         // sweep eligible → wallet
	mg.GET("/invite/vanity", inviteHandler.ListVanity)     // M-INV-05 list vanity links
	mg.POST("/invite/vanity", inviteHandler.CreateVanity)  // M-INV-05 create vanity link

	guard := func(permission string) gin.HandlerFunc {
		return middleware.RequirePermission(rbac, permission)
	}
	ag := admin.Group("")
	ag.GET("/config",
		guard("referral.config.view"), cfgHandler.Get)
	ag.PUT("/config",
		guard("referral.config.manage"), cfgHandler.Update)
	ag.GET("/house",
		guard("referral.house.view"), houseHandler.GetGlobal)
	ag.GET("/house/ledger",
		guard("referral.house.view"), houseHandler.Ledger)
	ag.GET("/reassignments",
		guard("referral.attribution.reassign"), attribHandler.ListReassignments)
	ag.POST("/reassignments",
		guard("referral.attribution.reassign"), attribHandler.Reassign)
	ag.GET("/ledger",
		guard("referral.ledger.view"), rewardHandler.AdminList)

	log.Println("[referral] routes registered — §7A attribution/house/ledger/config live")
}

// RegisterReferralRewards wires the Direct Referral Rewards ENGINE (single-level,
// purchase-triggered) onto the ROOT engine at NEW prefixes, leaving the older §7A
// /api/finance/referral routes intact (additive brownfield rule):
//   - user   : /v1/referrals/*                 (Bearer; object-level authZ = own data)
//   - admin  : /v1/admin/referrals/*           (Bearer; per-route RBAC referral.admin.*)
//   - internal:/internal/referrals/*           (service-to-service; X-Internal-Secret)
//
// Gated upstream by FeatureReferralRewardsEnabled + a non-nil pool (see
// finance_routes.go). The money path REUSES the finance ledger: ongoing-share
// rewards CREDIT the referrer wallet with a balanced double-entry keyed on the
// reward id; refunds post a balanced REVERSAL; milestone bonuses credit once,
// idempotently. Nothing here edits an existing file beyond the single call site.
// internalSecret guards the /internal hooks (empty ⇒ hooks fail closed). authMW is
// RequireAuthContext (validates the bearer + mirrors user_id).
func RegisterReferralRewards(
	r *gin.Engine,
	pool *pgxpool.Pool,
	rbac services.RBACService,
	authMW gin.HandlerFunc,
	internalSecret string,
) *referrals.RewardService {
	if pool == nil {
		log.Println("[referral-rewards] nil pool — skipping engine routes")
		return nil
	}

	// Reused finance ledger (Redis nil here → the ledger unique idempotency
	// constraint still enforces at-most-once postings).
	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), nil)
	svc := referrals.NewRewardService(pool, ledgerSvc)
	h := referrals.NewRewardHandler(svc, internalSecret)

	user := r.Group("/v1/referrals")
	user.Use(authMW)
	user.Use(requireUserID())
	user.POST("/link", h.PostLink)
	user.POST("/attribute", h.PostAttribute)
	user.GET("/me/dashboard", h.GetDashboard)
	user.GET("/me/referrals", h.GetReferrals)
	user.GET("/me/earnings", h.GetEarnings)
	user.GET("/me/milestones", h.GetMilestones)

	guard := func(permission string) gin.HandlerFunc {
		return middleware.RequirePermission(rbac, permission)
	}
	admin := r.Group("/v1/admin/referrals")
	admin.Use(authMW)
	admin.Use(requireUserID())
	admin.GET("/config", guard("referral.admin.config"), h.AdminGetConfig)           // A1
	admin.PUT("/config", guard("referral.admin.config"), h.AdminPutConfig)           // A1
	admin.GET("/analytics", guard("referral.admin.analytics"), h.AdminAnalytics)     // A2
	admin.GET("/fraud-queue", guard("referral.admin.fraud"), h.AdminFraudQueue)      // A3
	admin.POST("/fraud-queue", guard("referral.admin.fraud"), h.AdminFraudAction)    // A3
	admin.GET("/ledger", guard("referral.admin.ledger"), h.AdminLedger)              // A4
	admin.GET("/:referrerId/case", guard("referral.admin.case"), h.AdminGetCase)     // A5
	admin.POST("/:referrerId/case", guard("referral.admin.case"), h.AdminAdjustCase) // A5
	// Guarded by referral.admin.case ("referrer case view + manual adjustment"),
	// which is exactly this action's shape: an admin changing one referrer's
	// record. A new referral.admin.code permission would need seeding AND role
	// grants in a migration; until those exist RequirePermission fails closed and
	// the route would 403 for everyone, including a full admin.
	admin.PUT("/:referrerId/code", guard("referral.admin.case"), h.AdminSetCode)
	admin.GET("/milestones-log", guard("referral.admin.milestones"), h.AdminMilestonesLog) // A6
	admin.GET("/module-status", guard("referral.admin.module"), h.AdminModuleStatus)       // A7

	// Both the in-process Service.OnPurchase{Settled,Refunded} hooks AND these HTTP
	// endpoints are the integration contract (PRD §7). No user auth; X-Internal-Secret
	// verified inside the handler (fail-closed when unset).
	internal := r.Group("/internal/referrals")
	internal.POST("/purchase-settled", h.PostPurchaseSettled)
	internal.POST("/purchase-refunded", h.PostPurchaseRefunded)
	internal.POST("/recalc-tiers", h.PostRecalcTiers)

	// No shared cron scheduler exists for this concern (the FX StartReconScheduler is
	// module-local), so we start a ctx-scoped daily ticker here, mirroring the
	// StartTreasuryMonitor / StartReconScheduler pattern in finance_routes.go. The
	// POST /internal/referrals/recalc-tiers trigger above remains available for an
	// external cron. NOTE: in a multi-instance deployment, run the recalc from ONE
	// instance (external cron hitting recalc-tiers) to avoid duplicate sweeps; the
	// milestone/tier writes are idempotent so a double-run is safe but wasteful.
	startReferralRecalcScheduler(context.Background(), svc, 24*time.Hour)

	log.Println("[referral-rewards] engine routes registered — /v1/referrals + /v1/admin/referrals + /internal/referrals; nightly recalc ticker started")
	return svc
}

// startReferralRecalcScheduler runs RecalculateTiers on a fixed interval until ctx
// is cancelled. First run fires after one interval (not at boot) to avoid competing
// with startup. Errors are logged, not fatal.
func startReferralRecalcScheduler(ctx context.Context, svc *referrals.RewardService, every time.Duration) {
	go func() {
		t := time.NewTicker(every)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				if err := svc.RecalculateTiers(ctx); err != nil {
					log.Printf("[referral-rewards] nightly recalc error: %v", err)
				}
			}
		}
	}()
}

// RegisterReferralEcon wires the Referral ECONOMY half (RB1) onto the same finance
// member group and referral admin group RB0 uses. The orchestrator calls this —
// it edits no existing file; it provides only this aggregator.
//   - member: /api/finance/referral/{campaigns,gamification,network}/*
//   - admin : /api/referral/admin/{campaigns,gamification,network,merchants}/*
//
// FeatureReferralsEnabled is enforced upstream by the parent finance group, so
// these routes inherit the same gate. Money paths reuse the finance + RB0 reward
// ledgers: campaign/mission/override rewards accrue via RB0 ledger.Accrue
// (idempotent); merchant funding posts a balanced double-entry with an
// Idempotency-Key. Gamification points are NON-CASH and never touch a wallet.
// Overrides are activity-based, capped server-side, and exclude house-attributed
// signups (referral_attributions.is_house) from the override base.
func RegisterReferralEcon(member *gin.RouterGroup, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService) {
	if pool == nil {
		log.Println("[referral-econ] nil pool — skipping referral economy routes")
		return
	}

	// Shared services (reuse RB0 + finance).
	financeLedgerSvc := ledger.NewService(ledger.NewRepository(pool), nil)
	eventsSvc := referralevents.NewService(pool)
	rewardSvc := referralledger.NewService(pool, financeLedgerSvc)

	// 1) Campaigns + budget governor.
	campaignSvc := campaigns.NewService(campaigns.NewRepository(pool), eventsSvc)
	campaigns.Register(member, admin, campaignSvc, rbac)

	// 2) Gamification (cash rewards via RB0 ledger; points non-cash).
	gamSvc := gamification.NewService(gamification.NewRepository(pool), rewardSvc)
	gamification.Register(member, admin, gamSvc, rbac)
	// Streak (M-GAM-03) — member read on the same /gamification group.
	gamHandler := gamification.NewHandler(gamSvc)
	member.Group("/gamification").GET("/streak", gamHandler.Streak)

	// 3) Ambassador/agent overrides (activity-based, capped, house-excluded).
	netSvc := network.NewService(network.NewRepository(pool), rewardSvc, eventsSvc)
	network.Register(member, admin, netSvc, rbac)

	// 4) Merchant-funded campaigns + partner API (settlement hook nil stub).
	merchantSvc := merchant.NewService(merchant.NewRepository(pool), financeLedgerSvc, nil).
		WithTiers(tiers.NewService(pool))
	merchant.Register(admin, merchantSvc, rbac)
	// Read-only member merchant self-view (dashboard/performance) on /merchant/*.
	merchant.RegisterMember(member, merchantSvc)

	log.Println("[referral-econ] routes registered — campaigns/gamification/network/merchant live")
}

// RegisterReferralTrust wires the Referral TRUST/FINANCE half (RB2) onto the same
// finance member group and referral admin group RB0/RB1 use. The orchestrator
// calls this — it edits no existing file; it provides only this aggregator
// (mirrors RegisterReferral / RegisterReferralEcon exactly).
//   - member: /api/finance/referral/{risk,compliance}/*
//   - admin : /api/referral/admin/{risk,compliance,finance,analytics,users}/*
//
// FeatureReferralsEnabled is enforced upstream by the parent finance group, so
// these routes inherit the same gate. Money paths reuse the finance + RB0 reward
// ledgers: clawbacks post reversing entries through the RB0 ledger (audited);
// payouts post a balanced double-entry to the beneficiary wallet with a unique
// Idempotency-Key. ANALYTICS/K-factor EXCLUDE house rows (excluded_from_kfactor =
// true OR is_house = true) per §7A.6 — house_default is a separate segment.
func RegisterReferralTrust(member *gin.RouterGroup, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService) {
	if pool == nil {
		log.Println("[referral-trust] nil pool — skipping referral trust routes")
		return
	}

	// Shared services (reuse RB0 + finance). Redis nil → ledger unique constraint
	// still enforces idempotency on every posting.
	financeLedgerSvc := ledger.NewService(ledger.NewRepository(pool), nil)
	eventsSvc := referralevents.NewService(pool)
	rewardSvc := referralledger.NewService(pool, financeLedgerSvc)

	// 1) Risk / fraud — rules engine, alerts, cases, blocklist, review queue,
	//    clawbacks via the RB0 reward ledger.
	riskSvc := referralrisk.NewService(referralrisk.NewRepository(pool), rewardSvc, eventsSvc)
	referralrisk.Register(member, admin, riskSvc, rbac)

	// 2) Compliance — versioned disclosures, NDPC consents, AML, structural policy,
	//    earnings-claim review, regulatory export.
	compSvc := referralcompliance.NewService(referralcompliance.NewRepository(pool))
	referralcompliance.Register(member, admin, compSvc, rbac)

	// 3) Finance / payouts — Tier/KYC-gated idempotent payout queue posting to the
	//    wallet via the finance ledger; reconciliation; budgets/burn; float; LTV.
	finSvc := referralfinance.NewService(referralfinance.NewRepository(pool), financeLedgerSvc, eventsSvc)
	referralfinance.Register(admin, finSvc, rbac)

	// 4) Analytics — K-factor (house-excluded), funnel, CAC, cohorts, channels,
	//    organic-vs-referred segmentation, user-360.
	anaSvc := referralanalytics.NewService(referralanalytics.NewRepository(pool))
	referralanalytics.Register(admin, anaSvc, rbac)

	log.Println("[referral-trust] routes registered — risk/compliance/finance/analytics live")
}

// withReferralSplit wires the referral purchase-commission-split hook (20% of
// Spotlight's realized commission to the payer's referrer, capped per referral
// code — see referral/commissionsplit) onto a freshly constructed
// commission.Service, and returns the SAME instance so every one of this
// package's ~18 `commission.NewService(commission.NewRepository(pool), X)`
// call sites gets it by wrapping the constructor call, with no change to any
// function signature.
// Constructs its OWN throwaway ledger.Service (nil Redis — Credit falls back
// to the DB's unique idempotency_key constraint, which is the durable
// mechanism anyway; Redis is only ever a fast-path there) rather than reusing
// whatever ledger a given call site passed to commission.NewService itself
// (many pass nil there deliberately, because THAT module posts its own ledger
// entries elsewhere and doesn't want commission.go's internal revenue-post).
// The referral credit is a DIFFERENT ledger leg (paying the referrer) that must
// happen regardless of that choice.
func withReferralSplit(svc *commission.Service, pool *pgxpool.Pool, cfg config.Config) *commission.Service {
	referralLedger := ledger.NewService(ledger.NewRepository(pool), nil)
	svc.SetReferralHook(commissionsplit.NewService(pool, referralLedger, cfg.FeatureReferralCommissionSplitEnabled))
	return svc
}
