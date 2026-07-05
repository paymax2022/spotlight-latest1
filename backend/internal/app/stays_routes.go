package app

import (
	"log"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	financeledger "spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/settlement"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
	staysadmin "spotlight/backend/internal/stays/admin"
	"spotlight/backend/internal/stays/adapters"
	"spotlight/backend/internal/stays/consent"
	"spotlight/backend/internal/stays/dedup"
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
// BOOK_FAILED. The supply gateway is provider-agnostic (Bedbank Rail-A + Direct
// Rail-B adapters resolved from the supplier-config routing table).
//
// Supplier credentials are read from the environment (NEVER hard-coded / logged):
//
//	STAYS_BEDBANK_SUPPLIER_CODE / STAYS_BEDBANK_API_KEY (secret) / STAYS_BEDBANK_API_SECRET / STAYS_BEDBANK_BASE_URL
func RegisterStays(member *gin.RouterGroup, adminGroup *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService) {
	if pool == nil {
		log.Println("[stays] nil pool — skipping stays routes")
		return
	}

	// --- Reused finance primitives (money path) ---
	ledgerSvc := financeledger.NewService(financeledger.NewRepository(pool), nil)
	settlementSvc := settlement.NewService(pool, ledgerSvc)

	// --- Provider adapters (Rail A sandbox keys from env; Rail B reads ari-svc) ---
	bedbankGW := adapters.NewBedbank(
		os.Getenv("STAYS_BEDBANK_SUPPLIER_CODE"),
		os.Getenv("STAYS_BEDBANK_API_KEY"),    // secret key — never logged
		os.Getenv("STAYS_BEDBANK_API_SECRET"), // HMAC secret — never logged
		os.Getenv("STAYS_BEDBANK_BASE_URL"),
	)
	directGW := adapters.NewDirect(pool)

	// Router resolves an adapter from the data-driven supplier-config table; a
	// static fallback keeps both rails active for sandbox bring-up.
	resolver := gateway.NewDBRailResolver(pool)
	router := gateway.NewRouter(resolver, bedbankGW, directGW)
	_ = gateway.StaticRailResolver{Bindings: map[gateway.SourceRail]string{
		gateway.RailBedbank: bedbankGW.Name(),
		gateway.RailDirect:  directGW.Name(),
	}} // available as a fallback resolver for tests/sandbox.

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

	searchHandler := search.NewHandler(searchSvc)
	consentHandler := consent.NewHandler(consentSvc)
	// signRef is nil for now — the voucher route returns the stored ref until the
	// orchestrator injects the R2 signer. (TODO: wire r2 presign.)
	reservationHandler := reservation.NewHandler(reservationSvc, nil)
	adminHandler := staysadmin.NewHandler(pool)

	// --- Member routes (/api/finance/stays) ---
	mg := member.Group("/stays")
	// Search + content.
	mg.GET("/search", searchHandler.Search)
	mg.GET("/properties/:rail/:supplier/:ref", searchHandler.Content)
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
	mg.POST("/reservations/:id/modify", reservationHandler.Modify)

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
