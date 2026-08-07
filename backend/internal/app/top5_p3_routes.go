package app

import (
	"log"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/cashtag"
	"spotlight/backend/internal/config"
	"spotlight/backend/internal/creators"
	"spotlight/backend/internal/credential"
	"spotlight/backend/internal/escrow"
	"spotlight/backend/internal/finance/commission"
	"spotlight/backend/internal/finance/kyc"
	financeledger "spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/finance/wallet"
	"spotlight/backend/internal/loyalty"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/p2pmarket"
	"spotlight/backend/internal/points"
	"spotlight/backend/internal/scheduler"
	"spotlight/backend/internal/services"
	"spotlight/backend/internal/spray"
)

// Phase-3 Top-5 aggregator. Mirrors the Register-aggregator pattern from
// top5_p1_routes.go / top5_p2_routes.go (RegisterEvents/RegisterLoyalty); it edits
// no existing file. Each Register* builds the shared spine internally (finance
// ledger/wallet/tiers/kyc, escrow + dispute extension, scheduler, cashtag,
// credential, spray) and is gated by the orchestrator under its feature flag:
// FeatureCreatorsEnabled / FeatureSocialPayEnabled / FeatureLoyaltyEnabled.

// guardFor adapts RBAC permission middleware to a module GuardFunc.
func guardFor(rbac services.RBACService) func(string) gin.HandlerFunc {
	return func(permission string) gin.HandlerFunc {
		return middleware.RequirePermission(rbac, permission)
	}
}

// RegisterCreators wires the Phase-3 Creators module (storefront, tip jar, paid
// content + entitlements, scheduler-driven subscription tiers, earnings ledger +
// KYC-gated payout, NL-11 moderation + age controls). Money REUSES the finance
// ledger/wallet (NL-8/NL-9); subscriptions REUSE the scheduler (recurring + retry);
// tips REUSE the cashtag directory; payouts are KYC-gated (NL-10). NL-5: creator
// income is payment-for-content, never a return. Called under FeatureCreatorsEnabled.
//
//   - member: /api/finance/creators/*
//   - admin : /api/creators/admin/*  (RBAC creators.*)
func RegisterCreators(member *gin.RouterGroup, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService, cfg config.Config) {
	if pool == nil {
		log.Println("[creators] nil pool — skipping creators routes")
		return
	}

	ledgerSvc := financeledger.NewService(financeledger.NewRepository(pool), nil)
	tiersSvc := tiers.NewService(pool)
	walletSvc := wallet.NewService(ledgerSvc, tiersSvc)
	tags := cashtag.NewService(pool)
	kycSvc := kyc.NewService(pool)

	// Scheduler drives recurring subscription billing (retry/backoff owned by it).
	// The worker/endpoint that calls RunDue lives in the orchestration layer; here we
	// only construct the service + register the creators job handler (in NewService).
	sched := scheduler.NewService(pool)

	var auditor creators.Auditor = nil
	var age creators.AgeProvider = nil // nil ⇒ age gate fails CLOSED for rated content (NL-11)
	svc := creators.NewService(pool, ledgerSvc, walletSvc, tags, sched, kycSvc, age, auditor)

	// ── Central Commission & Profit recording (§ profit registry) ──
	// When the commission feature is on, inject a nil-safe recorder so realized creator
	// profit (tips, content sales, subscription charges) lands in commission_earnings
	// for the profit report under 'Lifestyle / Creators'. The recorder is built WITHOUT
	// a ledger (nil) on purpose: creditCreator already posts the platform fee to the
	// ledger (fee → Paymax revenue), so a second ledger post would double count —
	// RecordFor therefore appends the earning ROW only. Recording is best-effort +
	// idempotent (the per-event reference as key) and can never fail or reverse a
	// creator earnings credit / payout (see creators.recordCommissionSafe). Flag off ⇒
	// no recorder is set ⇒ the seam stays nil ⇒ silent no-op ⇒ creators unchanged.
	if cfg.FeatureCommissionEnabled {
		creatorsCommission := commission.NewService(commission.NewRepository(pool), nil)
		svc.SetCommissionRecorder(commissionRecorderAdapter{svc: creatorsCommission})
		log.Println("[creators] commission recording wired → Lifestyle/Creators (earning-row only; no ledger re-post)")
	}

	handler := creators.NewHandler(svc)
	handler.Register(member, admin, creators.GuardFunc(guardFor(rbac)))

	log.Println("[creators] routes registered — storefront / tips / paid content / subscriptions / payouts live")
}

// RegisterP2PMarket wires the Phase-3 P2P escrow marketplace (listings, escrow
// checkout, dispute/arbitration loop, seller ratings). It consumes the shared escrow
// core + its Phase-3 dispute extension: checkout = Hold, confirm = Release, dispute =
// RaiseDispute, arbitration = Arbitrate (separation-of-duties enforced in escrow).
// NL-6 (holds, never lends), NL-9 idempotent checkout. Called under
// FeatureSocialPayEnabled. Also mounts the shared spray engine member endpoints.
//
//   - member: /api/finance/p2p/*  +  /api/finance/spray/*
//   - admin : /api/p2p/admin/*  +  /api/spray/admin/*  (RBAC p2p.* / spray.*)
func RegisterP2PMarket(member *gin.RouterGroup, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService, audit services.AuditService) {
	if pool == nil {
		log.Println("[p2pmarket] nil pool — skipping p2p routes")
		return
	}

	ledgerSvc := financeledger.NewService(financeledger.NewRepository(pool), nil)
	tiersSvc := tiers.NewService(pool)
	walletSvc := wallet.NewService(ledgerSvc, tiersSvc)

	// Shared escrow core + Phase-3 dispute extension (same package).
	escrowSvc := escrow.NewService(pool, ledgerSvc, nil)

	// Real immutable-audit sink (NL-12) injected by the orchestrator — nil-safe.
	p2pSvc := p2pmarket.NewService(pool, escrowSvc, audit)
	p2pHandler := p2pmarket.NewHandler(p2pSvc)
	p2pHandler.Register(member, admin, p2pmarket.GuardFunc(guardFor(rbac)))

	// Shared spray engine (reused by social lives + creators). AML velocity limits
	// (NL-10) set explicitly in NGN kobo, consistent with the tier/AML magnitudes used
	// by the social-pay AML (₦200k single) and the spray package defaults: a single
	// spray is capped at ₦500,000, rolling-24h spend at ₦2,000,000 across at most 500
	// sprays, and dust below ₦1 is rejected (anti-structuring). Admins can widen later.
	sprayAML := spray.AMLConfig{
		MaxSingleKobo: 500_000_00,   // ₦500,000 per spray
		MaxDailyKobo:  2_000_000_00, // ₦2,000,000 / rolling 24h
		MaxDailyCount: 500,          // ≤500 sprays / rolling 24h
		MinSingleKobo: 1_00,         // reject dust below ₦1
	}
	spraySvc := spray.NewService(pool, ledgerSvc, walletSvc, sprayAML, audit)
	sprayHandler := spray.NewHandler(spraySvc)
	sprayHandler.Register(member, admin, spray.GuardFunc(guardFor(rbac)))

	log.Println("[p2pmarket] routes registered — listings / escrow checkout / disputes / ratings / spray live")
}

// RegisterLoyaltyBlack wires the Phase-3 Paymax Black tier on top of the P2 loyalty
// engine (additive). Black is the top tier above TIER3: configurable perks redeemed
// via the shared credential primitive (single-use at event gates — early tickets,
// lounge) and partner-offer settlement. Perks are NON-CASH (NL-4/NL-5). Called under
// FeatureLoyaltyEnabled.
//
//   - member: /api/finance/loyalty/black/*
//   - admin : /api/loyalty/admin/black/*  (RBAC loyalty.black.*)
func RegisterLoyaltyBlack(member *gin.RouterGroup, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService) {
	if pool == nil {
		log.Println("[loyalty-black] nil pool — skipping black routes")
		return
	}

	var ptsAudit points.Auditor = nil
	ptsSvc := points.NewService(pool, ptsAudit)
	var loyAudit loyalty.Auditor = nil
	baseLoyalty := loyalty.NewService(pool, ptsSvc, loyAudit)

	// Credential primitive backs single-use perk redemption at event gates.
	var credAudit credential.Auditor = nil
	credSvc := credential.NewService(pool, credAudit)

	blackSvc := loyalty.NewBlackService(baseLoyalty, credSvc)
	blackHandler := loyalty.NewBlackHandler(blackSvc)
	blackHandler.Register(member, admin, loyalty.GuardFunc(guardFor(rbac)))

	log.Println("[loyalty-black] routes registered — Black tier / perks / credential redemption / partner settlement live")
}
