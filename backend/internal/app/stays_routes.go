package app

import (
	"log"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/config"
	"spotlight/backend/internal/finance/commission"
	financeledger "spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/settlement"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
	"spotlight/backend/internal/stays/adapters"
	staysadmin "spotlight/backend/internal/stays/admin"
	staysagent "spotlight/backend/internal/stays/agent"
	"spotlight/backend/internal/stays/consent"
	"spotlight/backend/internal/stays/dedup"
	"spotlight/backend/internal/stays/discovery"
	"spotlight/backend/internal/stays/gateway"
	"spotlight/backend/internal/stays/pricing"
	"spotlight/backend/internal/stays/reservation"
	"spotlight/backend/internal/stays/search"
)

// RegisterStays wires the Stays / Hotel Booking core (Property Suite) onto the
// finance member group and a stays admin group. The orchestrator (finance_routes.go)
// calls this — this file is the only one wired in; it edits no existing file.
//
//   - member: /api/finance/stays/*   (member-authenticated; user_id mirrored)
//   - admin : /api/stays/admin/*      (member-authenticated; per-route RBAC stays.admin.*)
//
// FeatureStaysEnabled is enforced UPSTREAM by the parent finance group, so these
// routes inherit the same gate. The money path REUSES the finance ledger/settlement
// primitives: HOLD = settlement.Escrow → AccountEscrow at prebook/book; CHARGE =
// settle split (commission → AccountCommission, net → AccountProviderClearing) on
// confirm; RELEASE = settlement.Refund (reversing credit, no net debit) on
// BOOK_FAILED. Supply is own-inventory only: Spotlight owns all stays supply via
// the Direct Rail-B adapter (adapters.NewDirect, on-platform inventory). The
// third-party bedbank aggregator rail is retired and no longer wired.
func RegisterStays(member *gin.RouterGroup, adminGroup *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService, cfg config.Config) {
	if pool == nil {
		log.Println("[stays] nil pool — skipping stays routes")
		return
	}

	// --- Reused finance primitives (money path) ---
	ledgerSvc := financeledger.NewService(financeledger.NewRepository(pool), nil)
	settlementSvc := settlement.NewService(pool, ledgerSvc)

	// --- Own-supply gateway (OWN INVENTORY ONLY) ---
	// Spotlight builds hotels + shortlets in-house (a hotels.com-style marketplace),
	// NOT via any third-party bedbank/aggregator API. All supply is the DIRECT rail:
	// stays_property / stays_room_type / stays_rate_plan + the hotelier extranet
	// (ARI push). The gateway resolves every request to the Direct adapter.
	directGW := adapters.NewDirect(pool)
	resolver := gateway.StaticRailResolver{Bindings: map[gateway.SourceRail]string{
		gateway.RailDirect: directGW.Name(),
	}}
	router := gateway.NewRouter(resolver, directGW)

	// --- Pricing engine (config-driven markup/commission + controlled FX) ---
	pricingEngine := pricing.NewEngine(pricing.Config{
		DefaultMarkupBps:      1200, // 12% Rail-A markup default (D-2)
		DefaultCommissionBps:  1500, // 15% Rail-B commission default (D-2)
		MaxStackedDiscountBps: 2000, // loyalty + promo stacking cap (D-5)
		DisplayCurrency:       "NGN",
	}, nil) // fx nil until D-3 (FX source + spread) — cross-currency rates error, never silent.

	// --- Dedup + search ---
	dedupSvc := dedup.NewService(pool, 0) // default confidence threshold (D-7)
	searchSvc := search.NewService(router, dedupSvc, pricingEngine)

	// --- NDPA consent ---
	consentSvc := consent.NewService(pool)

	// --- Reservation saga ---
	reservationSvc := reservation.NewService(reservation.Deps{
		Repo:                reservation.NewRepository(pool),
		Router:              router,
		Pricing:             pricingEngine,
		Consent:             consentSvc,
		Settlement:          settlementSvc,
		Ledger:              ledgerSvc,
		DirectCommissionBps: 1500,
		// Notifier / Auditor are optional (nil-safe); the orchestrator may inject
		// the real notifications + audit sinks.
	})

	// ── Central Commission & Profit recording (§ profit registry) ──
	// When the commission feature is on, inject a nil-safe recorder so realized
	// stays profit (the CONFIRMED booking's charge/settle point) lands in
	// commission_earnings for the profit report under Property/Hotel (seeded 10%).
	// The recorder is built WITHOUT a ledger (nil) on purpose: stays' own settle
	// split already posts the commission cut to ledger.AccountCommission, so a second
	// ledger post would double-count — RecordFor therefore appends the earning ROW
	// only. Recording is best-effort + idempotent (reservation id as key) and can
	// never fail or reverse a booking/payout (see reservation.recordCommissionSafe).
	// Flag off ⇒ no recorder is set ⇒ the seam stays nil ⇒ silent no-op ⇒ stays
	// unchanged. Reuses the shared commissionRecorderAdapter (marketplace_routes.go).
	if cfg.FeatureCommissionEnabled {
		staysCommission := commission.NewService(commission.NewRepository(pool), nil)
		reservationSvc.SetCommissionRecorder(commissionRecorderAdapter{svc: staysCommission})
		log.Println("[stays] commission recording wired → Property/Hotel (earning-row only; no ledger re-post)")
	}

	searchHandler := search.NewHandler(searchSvc)
	consentHandler := consent.NewHandler(consentSvc)
	// Voucher presign: reuses the shared R2 SigV4 presigner (fail-closed — yields a
	// clear "voucher storage not configured" error if R2 env is absent, never a
	// broken URL). Reads R2_* from the environment.
	voucherSigner, err := reservation.NewR2VoucherSigner()
	if err != nil {
		log.Printf("[stays] voucher signer init: %v — vouchers will return an unconfigured error", err)
	}
	reservationHandler := reservation.NewHandler(reservationSvc, voucherSigner)
	// Enrich reservation responses with best-effort display content (name/city/
	// photo) so clients render bookings without a second content call. Nil-safe;
	// the reservation stores the supplier property ref as PropertyID.
	reservationHandler.SetContentResolver(searchSvc.GetContent)
	adminHandler := staysadmin.NewHandler(pool)

	// --- Member routes (/api/finance/stays) ---
	// member is ALREADY scoped to /api/finance/stays by the caller (see the doc
	// comment above) — grouping "/stays" again here doubled every path to
	// /api/finance/stays/stays/*, 404ing every real client while curl-shaped
	// manual testing against the doubled path masked it.
	mg := member
	// Search + content.
	mg.GET("/search", searchHandler.Search)
	mg.GET("/properties/:rail/:supplier/:ref", searchHandler.Content)
	// Discovery (destinations autocomplete over DIRECT inventory).
	discoveryHandler := discovery.NewHandler(pool)
	mg.GET("/destinations", discoveryHandler.Destinations)
	mg.GET("/home", discoveryHandler.Home)
	mg.GET("/deals", discoveryHandler.Deals)
	mg.GET("/loyalty", discoveryHandler.Loyalty)
	// Wishlist (saved property keys).
	mg.GET("/saved", discoveryHandler.Saved)
	mg.POST("/saved/:key/toggle", discoveryHandler.ToggleSaved)
	// Saved guests (traveller prefill profiles).
	mg.GET("/saved-guests", discoveryHandler.ListSavedGuests)
	mg.POST("/saved-guests", discoveryHandler.AddSavedGuest)
	mg.DELETE("/saved-guests/:id", discoveryHandler.RemoveSavedGuest)
	// NDPA consent (gate before any supplier data-share).
	mg.GET("/consent", consentHandler.Status)
	mg.POST("/consent", consentHandler.Grant)
	// Two-step booking.
	mg.POST("/prebook", reservationHandler.Prebook)
	mg.POST("/book", reservationHandler.Book) // Idempotency-Key REQUIRED (enforced in handler)
	// Reservations.
	mg.GET("/reservations", reservationHandler.List)
	mg.GET("/reservations/:id", reservationHandler.Get)
	mg.GET("/reservations/:id/voucher", reservationHandler.Voucher)
	mg.POST("/reservations/:id/cancel", reservationHandler.Cancel)
	mg.POST("/reservations/:id/modify", reservationHandler.Modify) // Idempotency-Key REQUIRED

	// Agent-assisted booking channel (a member with an agent role books on behalf
	// of a walk-in customer, earning the existing Direct commission split — no new
	// ledger account). Reuses the reservation saga; mounts /api/finance/stays/agent/*.
	agentSvc := staysagent.NewService(reservationSvc, reservation.NewRepository(pool))
	staysagent.RegisterStaysAgent(mg, agentSvc)

	// --- Admin routes (/api/stays/admin, per-route RBAC stays.admin.*) ---
	guard := func(permission string) gin.HandlerFunc {
		return middleware.RequirePermission(rbac, permission)
	}
	ag := adminGroup.Group("")
	// Supplier connectivity config.
	ag.GET("/suppliers", guard("stays.admin.supplier"), adminHandler.ListSuppliers)
	ag.POST("/suppliers", guard("stays.admin.supplier"), adminHandler.UpsertSupplier)
	// Dedup mapping queue.
	ag.GET("/mapping-queue", guard("stays.admin.mapping"), adminHandler.ListMappingQueue)
	ag.POST("/mapping-queue/:id/decision", guard("stays.admin.mapping"), adminHandler.DecideMapping)
	// Property moderation.
	ag.POST("/properties/:id/status", guard("stays.admin.moderation"), adminHandler.ModerateProperty)
	// Reservation search (ops support).
	ag.GET("/reservations", guard("stays.admin.reservation"), reservationHandler.AdminSearch)

	log.Println("[stays] routes registered — search/dedup/prebook→book saga + admin live")
}
