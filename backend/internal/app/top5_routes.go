package app

import (
	"context"
	"log"
	"spotlight/backend/internal/cashtag"
	"spotlight/backend/internal/config"
	"spotlight/backend/internal/creators"
	"spotlight/backend/internal/credential"
	"spotlight/backend/internal/escrow"
	"spotlight/backend/internal/finance/commission"
	"spotlight/backend/internal/finance/kyc"
	financeledger "spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/settlement"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/finance/wallet"
	"spotlight/backend/internal/loyalty"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/p2pmarket"
	"spotlight/backend/internal/platform/realtime"
	"spotlight/backend/internal/points"
	"spotlight/backend/internal/savings"
	"spotlight/backend/internal/scheduler"
	"spotlight/backend/internal/services"
	"spotlight/backend/internal/social"
	"spotlight/backend/internal/spray"
	"spotlight/backend/internal/top5events"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

// RegisterSavings wires the Top-5 Phase-1 Savings module (vaults / Ajo-Esusu /
// group-target) onto the finance member group + a savings admin group. The
// orchestrator (finance_routes.go) calls this under FeatureSavingsEnabled; this
// file is the only wiring point and edits no existing file.
//   - member: /api/finance/savings/*  (member-authenticated; user_id mirrored)
//   - admin : /api/savings/admin/*     (member-authenticated; per-route RBAC savings.admin.*)
//
// It internally builds the shared spine it needs (scheduler + the reused finance
// ledger). The money path REUSES finance ledger primitives: vault/target/Ajo
// balances are append-only ledger projections (NL-8); deposits/contributions
// debit the main wallet into the shared escrow standing account and credit the
// sub-balance ledger; withdrawals/payouts reverse — Paymax never lends (NL-1),
// never pays yield (NL-2), and Ajo is peer-rotation only (NL-7). Every money leg
// is idempotent (NL-9). Auditing is nil-safe (the orchestrator may inject a sink).
func RegisterSavings(member *gin.RouterGroup, adminGroup *gin.RouterGroup, cfg config.Config, pool *pgxpool.Pool, rbac services.RBACService, audit services.AuditService) {
	if pool == nil {
		log.Println("[savings] nil pool — skipping savings routes")
		return
	}

	// Reused finance ledger (money path) + shared scheduler (auto-save / Ajo cycles).
	ledgerSvc := financeledger.NewService(financeledger.NewRepository(pool), nil)
	sched := scheduler.NewService(pool)

	var auditor savings.Auditor = audit // real immutable-audit sink (NL-12)

	vaultSvc := savings.NewVaultService(pool, ledgerSvc, sched, auditor)

	// Early-break penalty rate: server-side policy, never caller input. Fails
	// closed — a bad config value is logged and the safe default is kept rather
	// than charging a nonsense rate.
	if err := vaultSvc.SetEarlyBreakPenaltyBps(int64(cfg.SavingsEarlyBreakPenaltyBps)); err != nil {
		log.Printf("[savings] %v — keeping default %d bps", err, savings.DefaultEarlyBreakPenaltyBps)
	}

	// Commission recording under Finance/Savings (nil-safe, flag-gated,
	// ledger-less — the penalty debit already posts to ledger.AccountPaymaxRevenue).
	// Only the early-withdrawal penalty earns a fee (deposits, withdrawals, target
	// & Ajo flows are fee-free — NL-2, no yield). recordCommissionSafe records the
	// EXACT penalty charged via RecordExact (SAVINGS_EARLY_BREAK_PENALTY_BPS),
	// so the registry does not depend on the configured rate.
	if cfg.FeatureCommissionEnabled {
		vaultSvc.SetCommissionRecorder(commissionRecorderAdapter{svc: withReferralSplit(commission.NewService(commission.NewRepository(pool), nil), pool, cfg)})
		log.Println("[savings] commission recording wired → Finance/Savings (early-break penalty; earning-row only; no ledger re-post)")
	}
	ajoSvc := savings.NewAjoService(pool, ledgerSvc, sched, auditor)
	targetSvc := savings.NewTargetService(pool, ledgerSvc, auditor)

	// Register durable scheduler job handlers (idempotent debits — NL-9).
	vaultSvc.RegisterAutoSave()
	ajoSvc.RegisterCycleRunner()

	guard := func(permission string) gin.HandlerFunc {
		return middleware.RequirePermission(rbac, permission)
	}

	handler := savings.NewHandler(vaultSvc, ajoSvc, targetSvc)
	handler.Register(member, adminGroup, guard)

	log.Println("[savings] routes registered — vaults / ajo / group-target + scheduler handlers live")
}

// RegisterSocialPay wires the Top-5 Phase-1 Social core (P2P send/request,
// split-bill, group pool) onto the finance member group + a social admin group.
// Called by the orchestrator under FeatureSocialPayEnabled.
//   - member: /api/finance/social/*        (member-authenticated; user_id mirrored)
//   - alias : /api/finance/social/social/* (E2E-FIN-043 — see below)
//   - admin : /api/social/admin/*           (member-authenticated; per-route RBAC social.admin.*)
//
// It internally builds the cashtag directory and an escrow core (both shared
// spine). P2P/split/pool money moves through the reused finance ledger (NL-8),
// is idempotent (NL-9), passes the fail-closed KYC-tier/debit-limit gate
// (tiers.EnforceWalletDebitLimit — the same gate the transfer rail runs;
// E2E-FIN-041) and is gated by AML velocity limits (NL-10). Object-level authZ
// is enforced in the service (the session id is always the acting identity, so
// a user can never request/pay/payout as someone else).
//
// E2E-FIN-043 double-mount: social.Handler.Register adds its own "/social"
// segment, so it must be called on the bare member group to land routes at the
// documented canonical /api/finance/social/* (what the Next.js proxy and mobile
// clients call). It is ALSO re-registered under member.Group("/social") as a
// backward-compatible alias — shipped e2e suites and clients still calling the
// doubled path keep working. The second Register call is safe: member routes on
// the doubled prefix are distinct paths (no gin duplicate-route panic) and admin
// routes are skipped (nil group) so social.admin.* is registered exactly once.
func RegisterSocialPay(member *gin.RouterGroup, adminGroup *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService, audit services.AuditService) {
	if pool == nil {
		log.Println("[social] nil pool — skipping social routes")
		return
	}

	ledgerSvc := financeledger.NewService(financeledger.NewRepository(pool), nil)
	tags := cashtag.NewService(pool)
	aml := social.NewAML(pool, social.DefaultAMLConfig())

	// Real immutable-audit sink (NL-12 / S5): social money paths emit events.
	var auditor social.Auditor = audit

	// Escrow core (shared spine) — built here so social can park funds-holds for
	// P2P escrow in P3; the funds-hold state machine is ledger-backed + audited.
	_ = escrow.NewService(pool, ledgerSvc, nil)

	svc := social.NewService(pool, ledgerSvc, tags, aml, auditor)

	guard := func(permission string) gin.HandlerFunc {
		return middleware.RequirePermission(rbac, permission)
	}

	handler := social.NewHandler(svc, tags)

	// Canonical mount: handler.Register adds "/social" itself, so registering on
	// the bare finance member group lands routes at /api/finance/social/*.
	handler.Register(member, adminGroup, guard)
	// Legacy alias: the doubled path the module was previously reachable at
	// only. Admin group intentionally nil — admin routes register once above.
	handler.Register(member.Group("/social"), nil, guard)

	log.Println("[social] routes registered — cashtag / p2p / split / pool live (canonical + /social/social alias)")
}

// adminGroupTop5 builds an admin route group for a Top-5 module at the given
// base path, applying the same authenticated-user guard the other admin groups
// use (per-route RBAC permissions are applied inside each module's Register fn).
//
// authMW MUST be the same RequireAuthContext middleware the finance group uses
// (mapsAuth() in finance_routes.go): it validates the bearer token and mirrors
// user_id into the gin context, and it must run BEFORE requireUserID —
// requireUserID only reads the user_id that RequireAuthContext populates, so
// mounting requireUserID alone 401s every admin route even with a valid token
// (E2E-SOC-034; the same auth-ordering bug the finance/referral/insurance/
// stays/events groups each hit and fixed). Taking authMW as a required
// parameter makes that ordering impossible to omit at a call site.
func adminGroupTop5(r *gin.Engine, basePath string, authMW gin.HandlerFunc) *gin.RouterGroup {
	g := r.Group(basePath)
	g.Use(authMW)
	g.Use(requireUserID())
	return g
}

// RegisterEvents wires the Top-5 Phase-2 Event Ticketing + cashless Event Wallet
// module onto the finance member group + an events admin group. Mirrors the
// Register-aggregator pattern from top5_p1_routes.go (RegisterSavings/SocialPay);
// it edits no existing file. The orchestrator calls this under FeatureEventsEnabled.
//   - member: /api/finance/events/*  (member-authenticated; user_id mirrored)
//   - admin : /api/events/admin/*     (member-authenticated; per-route RBAC events.*)
//
// It builds the shared spine internally: the reused finance ledger/wallet/settlement/
// tiers, the shared credential primitive (rotating-QR + NFC gate entry — single-use
// + replay-rejected), the shared cashtag directory (ticket gift/transfer), and an
// escrow core (residual-refund path). Money REUSES finance primitives: ticket
// checkout is wallet.Debit into escrow (NL-8, NL-9, tier-limit fail-closed); the
// cashless event wallet is a CLOSED-LOOP sub-balance whose residual refunds to the
// MAIN wallet on close (NL-3); points/event-wallet never cash out (NL-4); vendor
// payouts are KYC-gated (NL-10) and run net of fees through the ledger. Auditing is
// nil-safe (the orchestrator may inject a sink).
func RegisterEvents(member *gin.RouterGroup, admin *gin.RouterGroup, cfg config.Config, pool *pgxpool.Pool, rbac services.RBACService, rtHub *realtime.Hub, audit services.AuditService) {
	if pool == nil {
		log.Println("[top5events] nil pool — skipping events routes")
		return
	}

	// Reused finance spine (money path).
	ledgerSvc := financeledger.NewService(financeledger.NewRepository(pool), nil)
	tiersSvc := tiers.NewService(pool)
	walletSvc := wallet.NewService(ledgerSvc, tiersSvc)
	settlementSvc := settlement.NewService(pool, ledgerSvc)

	// Shared primitives (built internally).
	var credAudit credential.Auditor = audit
	credSvc := credential.NewService(pool, credAudit) // rotating-QR / NFC, single-use + replay-reject
	tags := cashtag.NewService(pool)                  // ticket gift/transfer addressing
	_ = escrow.NewService(pool, ledgerSvc, nil)       // shared funds-hold core (residual-refund spine)

	var auditor top5events.Auditor = audit
	svc := top5events.NewService(pool, ledgerSvc, walletSvc, settlementSvc, tiersSvc, credSvc, tags, auditor)

	// Live check-in push (organiser dashboard). Shared hub built once at the
	// router level (see router.go) — same instance marketplace's Deal Room
	// chat publishes through, so there is exactly one SSE connection
	// (/api/v1/realtime/stream) per client regardless of which module fires.
	// Nil-safe: ScanTicket's publish is a no-op if this is nil.
	svc.SetRealtime(rtHub)

	// Commission recording for ticket-sale profit. Ledger-less recorder — the
	// checkout debit already posts into escrow, so RecordFor appends the earning
	// ROW only; best-effort, never fails a purchase (recordCommissionSafe).
	// Flag off ⇒ nil-safe no-op.
	if cfg.FeatureCommissionEnabled {
		svc.SetCommissionRecorder(commissionRecorderAdapter{svc: withReferralSplit(commission.NewService(commission.NewRepository(pool), nil), pool, cfg)})
		log.Println("[top5events] commission recording wired → Lifestyle/Event Tickets (earning-row only; no ledger re-post)")
	}

	// guard adapts the RBAC permission middleware to the module's GuardFunc type
	guard := func(permission string) gin.HandlerFunc {
		return middleware.RequirePermission(rbac, permission)
	}

	handler := top5events.NewHandler(svc)
	handler.Register(member, admin, guard)

	// Money-path durability: sweep ticket checkouts left PENDING by a crash between
	// reservation and payment, charging/ticketing buyers who can pay and expiring
	// (releasing the seat) those who cannot. Idempotent + multi-instance safe.
	// Cadence/grace are ops-tunable; defaults 5-min tick, 15-min grace.
	top5events.StartPendingOrderReconciler(
		context.Background(), svc,
		time.Duration(envInt("EVENTS_RECONCILE_INTERVAL_MINUTES", 5))*time.Minute,
		time.Duration(envInt("EVENTS_PENDING_GRACE_MINUTES", 15))*time.Minute,
	)

	log.Println("[top5events] routes registered — event CMS / tickets / cashless wallet / vendor settlement live")
}

// RegisterLoyalty wires the Top-5 Phase-2 Loyalty module (points earn-rules engine
// bound to live modules, membership tier engine, rewards catalog + non-cash
// redemption) onto the finance member group + a loyalty admin group. Mirrors the
// P1 aggregator pattern; edits no existing file. Called under FeatureLoyaltyEnabled.
//   - member: /api/finance/loyalty/*  +  /api/finance/points/*  (member-authenticated)
//   - admin : /api/loyalty/admin/*     (member-authenticated; per-route RBAC loyalty.*)
//
// It builds the points ledger internally (append-only; NL-4 points ≠ cash; redeem
// only to airtime/bills/discount/perks). The loyalty service binds module triggers
// (payments / savings / tickets / referral §7A) to versioned earn rules, awards
// idempotently (NL-9), and re-evaluates membership tiers on earn. Auditing nil-safe.
func RegisterLoyalty(member *gin.RouterGroup, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService, audit services.AuditService) {
	if pool == nil {
		log.Println("[loyalty] nil pool — skipping loyalty routes")
		return
	}

	var ptsAudit points.Auditor = audit
	ptsSvc := points.NewService(pool, ptsAudit) // append-only points ledger (NL-4)

	var loyAudit loyalty.Auditor = audit
	loySvc := loyalty.NewService(pool, ptsSvc, loyAudit)

	g := func(permission string) gin.HandlerFunc {
		return middleware.RequirePermission(rbac, permission)
	}

	// Member points endpoints (balance / catalog / redeem) live alongside loyalty.
	pointsHandler := points.NewHandler(ptsSvc)
	pointsHandler.Register(member)

	loyaltyHandler := loyalty.NewHandler(loySvc)
	loyaltyHandler.Register(member, admin, g)

	log.Println("[loyalty] routes registered — points ledger / earn-rules / tiers / rewards live")
}

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
//   - member: /api/finance/creators/*
//   - admin : /api/creators/admin/*  (RBAC creators.*)
func RegisterCreators(member *gin.RouterGroup, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService, cfg config.Config, audit services.AuditService) {
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

	var auditor creators.Auditor = audit
	var age creators.AgeProvider = nil // nil ⇒ age gate fails CLOSED for rated content (NL-11)
	svc := creators.NewService(pool, ledgerSvc, walletSvc, tags, sched, kycSvc, age, auditor)

	// Commission recording for creator profit under 'Lifestyle / Creators'
	// (tips, content sales, subscription charges). Ledger-less recorder —
	// creditCreator already posts the platform fee, so RecordFor appends the
	// earning ROW only; best-effort + idempotent, never fails an earnings
	// credit (creators.recordCommissionSafe). Flag off ⇒ nil-safe no-op.
	if cfg.FeatureCommissionEnabled {
		creatorsCommission := withReferralSplit(commission.NewService(commission.NewRepository(pool), nil), pool, cfg)
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
// FeatureP2PMarketEnabled. Also mounts the shared spray engine member endpoints.
// The p2p handler self-prefixes /p2p, so `member` must be the bare finance group
// (mounting it under /p2p again produced /api/finance/p2p/p2p/* — E2E-SOC-036);
// spray is mounted on member.Group("/p2p") to keep its documented path.
//   - member: /api/finance/p2p/*  (incl. spray → /api/finance/p2p/spray* — the
//     BFF /api/v1/spray proxies here)
//   - admin : /api/p2p/admin/*  (both p2p AND spray admin routes share this one
//     group — spray has no admin group of its own) (RBAC p2p.* / spray.*)
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
	sprayHandler.Register(member.Group("/p2p"), admin, spray.GuardFunc(guardFor(rbac)))

	log.Println("[p2pmarket] routes registered — listings / escrow checkout / disputes / ratings / spray live")
}

// RegisterLoyaltyBlack wires the Phase-3 Paymax Black tier on top of the P2 loyalty
// engine (additive). Black is the top tier above TIER3: configurable perks redeemed
// via the shared credential primitive (single-use at event gates — early tickets,
// lounge) and partner-offer settlement. Perks are NON-CASH (NL-4/NL-5). Called under
// FeatureLoyaltyEnabled.
//   - member: /api/finance/loyalty/black/*
//   - admin : /api/loyalty/admin/black/*  (RBAC loyalty.black.*)
func RegisterLoyaltyBlack(member *gin.RouterGroup, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService, audit services.AuditService) {
	if pool == nil {
		log.Println("[loyalty-black] nil pool — skipping black routes")
		return
	}

	var ptsAudit points.Auditor = audit
	ptsSvc := points.NewService(pool, ptsAudit)
	var loyAudit loyalty.Auditor = audit
	baseLoyalty := loyalty.NewService(pool, ptsSvc, loyAudit)

	// Credential primitive backs single-use perk redemption at event gates.
	var credAudit credential.Auditor = audit
	credSvc := credential.NewService(pool, credAudit)

	blackSvc := loyalty.NewBlackService(baseLoyalty, credSvc)
	blackHandler := loyalty.NewBlackHandler(blackSvc)
	blackHandler.Register(member, admin, loyalty.GuardFunc(guardFor(rbac)))

	log.Println("[loyalty-black] routes registered — Black tier / perks / credential redemption / partner settlement live")
}
