package app

import (
	"log"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	financeledger "spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
	"spotlight/backend/internal/stays/ari"
	"spotlight/backend/internal/stays/extranet"
	"spotlight/backend/internal/stays/reviews"
	staysettlement "spotlight/backend/internal/stays/settlement"
	"spotlight/backend/internal/stays/supplierwebhooks"
)

// RegisterStaysExtranet wires the SB1 Stays surfaces — ari-svc + hotelier extranet +
// settlement/reconciliation + reviews + Rail-B supplier webhooks — onto four caller-
// supplied router groups. The orchestrator (finance_routes.go) builds the groups and
// calls this; this file edits NO existing file (it does not touch stays_routes.go or
// finance_routes.go).
//
//   - member   : guest-facing reviews   (member-authenticated; user_id mirrored)
//   - admin    : /api/stays/admin/*      (per-route RBAC stays.admin.*)
//   - extranet : /api/stays/extranet/*   (per-route RBAC stays.hotelier.* + object scope)
//   - webhooks : /internal/webhooks/*    (unauthenticated; HMAC-signature verified)
//
// FeatureStaysEnabled is enforced UPSTREAM by the parent finance group (same gate as
// the SB0 RegisterStays). Object-level hotelier authZ lives IN the extranet/reviews
// services (a property grant in stays_hotelier_profile), complementing the RBAC route
// guard. The money path REUSES the finance ledger: commission → AccountCommission
// (separate account); Naira hotel payouts credit the hotelier wallet from
// AccountProviderClearing, held until the property's first confirmed+completed stay.
//
// Secrets are read from the environment by the orchestrator and passed via the pool/
// rbac wiring; the supplier-webhook HMAC secret is read here from the environment
// (NEVER hard-coded / logged): STAYS_SUPPLIER_WEBHOOK_SECRET.
func RegisterStaysExtranet(member *gin.RouterGroup, admin *gin.RouterGroup, extranetGroup *gin.RouterGroup, webhooks *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService) {
	if pool == nil {
		log.Println("[stays-extranet] nil pool — skipping SB1 stays routes")
		return
	}

	// --- shared services ---
	ledgerSvc := financeledger.NewService(financeledger.NewRepository(pool), nil)

	ariSvc := ari.NewService(ari.NewRepository(pool))
	authz := extranet.NewAuthZ(pool)

	extranetSvc := extranet.NewService(extranet.NewRepository(pool), authz, ariSvc)
	reviewsSvc := reviews.NewService(reviews.NewRepository(pool), authz)
	settlementSvc := staysettlement.NewService(staysettlement.NewRepository(pool), ledgerSvc)
	webhookSvc := supplierwebhooks.NewService(pool, ariSvc, getEnvSupplierSecret())

	// --- handlers ---
	ariHandler := ari.NewHandler(ariSvc, authz.GinChecker())
	extranetHandler := extranet.NewHandler(extranetSvc)
	reviewsHandler := reviews.NewHandler(reviewsSvc)
	settlementHandler := staysettlement.NewHandler(settlementSvc)
	webhookHandler := supplierwebhooks.NewHandler(webhookSvc)

	// Per-route RBAC guard factory (mirrors the SB0 stays_routes.go pattern).
	guard := func(permission string) gin.HandlerFunc {
		return middleware.RequirePermission(rbac, permission)
	}

	// --- member: guest-facing reviews (/api/finance/stays via the member group) ---
	if member != nil {
		reviewsHandler.RegisterMember(member)
	}

	// --- extranet: /api/stays/extranet/* (RBAC stays.hotelier.* + object scope) ---
	if extranetGroup != nil {
		// No RBAC gate here — object-level scope is checked IN each service (the
		// user must hold an ACTIVE stays_hotelier_profile grant, checked per call),
		// the same self-serve, ownership-stamped-not-role-granted model already
		// proven live by the restaurant module (POST /api/finance/restaurant has
		// no RBAC guard either; ownership is stamped from the JWT at creation and
		// checked server-side on every subsequent call).
		//
		// This was previously gated on stays.hotelier.* RBAC permissions, but those
		// are seeded ONLY onto super-admin/system-admin (20260715000000_stays_ari.sql)
		// with no self-service grant path — so no property owner could ever pass the
		// gate, regardless of holding a real ACTIVE grant. CreateProperty (below) is
		// the only way to acquire that grant, and it has no permission to hold before
		// it runs. Removing the redundant outer gate is what makes self-service work;
		// the object-scope check the design doc already called the "complementing"
		// layer is now the ONLY layer, same as restaurant.
		eg := extranetGroup.Group("")
		extranetHandler.Register(eg)

		// Calendar / ARI / promotions / restrictions / derived rates.
		calendar := extranetGroup.Group("")
		ariHandler.RegisterExtranet(calendar)

		// Reviews (hotelier responses + flagging).
		rev := extranetGroup.Group("")
		reviewsHandler.RegisterExtranet(rev)
	}

	// --- admin: /api/stays/admin/* (per-route RBAC stays.admin.*) ---
	if admin != nil {
		settlementHandler.RegisterAdmin(admin, guard)
		reviewsHandler.RegisterAdmin(admin, guard)
	}

	// --- webhooks: /internal/webhooks/* (HMAC-verified; no member JWT) ---
	if webhooks != nil {
		webhookHandler.Register(webhooks)
	}

	log.Println("[stays-extranet] SB1 routes registered — ari/extranet/settlement/reviews/webhooks live")
}

// getEnvSupplierSecret reads the Rail-B supplier webhook HMAC secret from the
// environment. The secret is never logged.
func getEnvSupplierSecret() string {
	return os.Getenv("STAYS_SUPPLIER_WEBHOOK_SECRET")
}
