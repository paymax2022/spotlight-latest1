package app

import (
	"context"
	"log"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/cashtag"
	"spotlight/backend/internal/config"
	"spotlight/backend/internal/credential"
	"spotlight/backend/internal/escrow"
	"spotlight/backend/internal/finance/commission"
	financeledger "spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/settlement"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/finance/wallet"
	"spotlight/backend/internal/loyalty"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/points"
	"spotlight/backend/internal/services"
	"spotlight/backend/internal/top5events"
)

// RegisterEvents wires the Top-5 Phase-2 Event Ticketing + cashless Event Wallet
// module onto the finance member group + an events admin group. Mirrors the
// Register-aggregator pattern from top5_p1_routes.go (RegisterSavings/SocialPay);
// it edits no existing file. The orchestrator calls this under FeatureEventsEnabled.
//
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
func RegisterEvents(member *gin.RouterGroup, admin *gin.RouterGroup, cfg config.Config, pool *pgxpool.Pool, rbac services.RBACService) {
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
	var credAudit credential.Auditor = nil
	credSvc := credential.NewService(pool, credAudit) // rotating-QR / NFC, single-use + replay-reject
	tags := cashtag.NewService(pool)                  // ticket gift/transfer addressing
	_ = escrow.NewService(pool, ledgerSvc, nil)       // shared funds-hold core (residual-refund spine)

	var auditor top5events.Auditor = nil
	svc := top5events.NewService(pool, ledgerSvc, walletSvc, settlementSvc, tiersSvc, credSvc, tags, auditor)

	// ── Central Commission & Profit recording (§ profit registry) ──
	// When the commission feature is on, inject a nil-safe recorder so realized
	// ticket-sale profit lands in commission_earnings for the profit report. The
	// recorder is built WITHOUT a ledger (nil ledgerService) on purpose: the ticket
	// checkout debit already posts the money into escrow, so a second ledger post would
	// double-count. RecordFor therefore appends the earning ROW only. Recording is
	// best-effort and can never fail or reverse a ticket purchase (see
	// recordCommissionSafe). Flag off ⇒ no recorder is set ⇒ the seam stays nil ⇒ no-op.
	if cfg.FeatureCommissionEnabled {
		svc.SetCommissionRecorder(commissionRecorderAdapter{svc: commission.NewService(commission.NewRepository(pool), nil)})
		log.Println("[top5events] commission recording wired → Lifestyle/Event Tickets (earning-row only; no ledger re-post)")
	}

	// guard adapts the RBAC permission middleware to the module's GuardFunc type
	// (func(permission string) gin.HandlerFunc).
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
//
//   - member: /api/finance/loyalty/*  +  /api/finance/points/*  (member-authenticated)
//   - admin : /api/loyalty/admin/*     (member-authenticated; per-route RBAC loyalty.*)
//
// It builds the points ledger internally (append-only; NL-4 points ≠ cash; redeem
// only to airtime/bills/discount/perks). The loyalty service binds module triggers
// (payments / savings / tickets / referral §7A) to versioned earn rules, awards
// idempotently (NL-9), and re-evaluates membership tiers on earn. Auditing nil-safe.
func RegisterLoyalty(member *gin.RouterGroup, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService) {
	if pool == nil {
		log.Println("[loyalty] nil pool — skipping loyalty routes")
		return
	}

	var ptsAudit points.Auditor = nil
	ptsSvc := points.NewService(pool, ptsAudit) // append-only points ledger (NL-4)

	var loyAudit loyalty.Auditor = nil
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
