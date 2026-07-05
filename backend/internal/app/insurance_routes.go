package app

import (
	"log"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/kyc"
	financeledger "spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/finance/wallet"
	"spotlight/backend/internal/insurance/catalog"
	"spotlight/backend/internal/insurance/consent"
	"spotlight/backend/internal/insurance/gateway"
	"spotlight/backend/internal/insurance/policy"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/provider/mycover"
	"spotlight/backend/internal/provider/octamile"
	"spotlight/backend/internal/services"
)

// RegisterInsurance wires the §6–§12 Insurance / Protection core onto the finance
// member group and an insurance admin group. The orchestrator (finance_routes.go)
// calls this — this file is the only one wired in; it edits no existing file.
//
//   - member: /api/finance/insurance/*   (member-authenticated; user_id mirrored)
//   - admin : /api/insurance/admin/*      (member-authenticated; per-route RBAC insurance.*)
//
// FeatureInsuranceEnabled is enforced UPSTREAM by the parent finance group, so
// these routes inherit the same gate. Money path REUSES the finance ledger/wallet:
// the premium debit posts a balanced double-entry with an idempotency key to the
// provider-clearing pass-through account, the commission posts to the SEPARATE
// commission account, and a failed bind auto-reverses the premium. The gateway is
// provider-agnostic (MyCover/Octamile adapters resolved from the catalog).
//
// Provider credentials are read from the environment (NEVER hard-coded / logged):
//
//	INSURANCE_MYCOVER_API_KEY (secret) / INSURANCE_MYCOVER_PUBLIC_KEY / INSURANCE_MYCOVER_WEBHOOK_SECRET / INSURANCE_MYCOVER_BASE_URL
//	INSURANCE_OCTAMILE_API_KEY (secret) / INSURANCE_OCTAMILE_PUBLIC_KEY / INSURANCE_OCTAMILE_WEBHOOK_SECRET / INSURANCE_OCTAMILE_BASE_URL
func RegisterInsurance(member *gin.RouterGroup, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService) {
	if pool == nil {
		log.Println("[insurance] nil pool — skipping insurance routes")
		return
	}

	// --- Reused finance primitives (money path) ---
	ledgerSvc := financeledger.NewService(financeledger.NewRepository(pool), nil)
	tiersSvc := tiers.NewService(pool)
	walletSvc := wallet.NewService(ledgerSvc, tiersSvc)
	kycSvc := kyc.NewService(pool)

	// --- Insurance domain services ---
	catalogSvc := catalog.NewService(pool)
	consentSvc := consent.NewService(pool)

	// --- Provider adapters (sandbox keys from env; empty => sandbox defaults) ---
	mycoverGW := mycover.New(
		os.Getenv("INSURANCE_MYCOVER_API_KEY"),     // secret key
		os.Getenv("INSURANCE_MYCOVER_PUBLIC_KEY"),  // publishable key
		os.Getenv("INSURANCE_MYCOVER_WEBHOOK_SECRET"),
		os.Getenv("INSURANCE_MYCOVER_BASE_URL"),
	)
	octamileGW := octamile.New(
		os.Getenv("INSURANCE_OCTAMILE_API_KEY"),    // secret key
		os.Getenv("INSURANCE_OCTAMILE_PUBLIC_KEY"), // publishable key
		os.Getenv("INSURANCE_OCTAMILE_WEBHOOK_SECRET"),
		os.Getenv("INSURANCE_OCTAMILE_BASE_URL"),
	)

	// Router resolves an adapter from the data-driven catalog (product.provider).
	router := gateway.NewRouter(catalogSvc, mycoverGW, octamileGW)

	// Policy service: lifecycle + thin quote engine + premium-bind saga.
	policySvc := policy.NewService(policy.Deps{
		Repo:    policy.NewRepository(pool),
		Router:  router,
		Catalog: catalogSvc,
		Consent: consentSvc,
		Wallet:  walletSvc,
		Ledger:  ledgerSvc,
		// Notifier / Auditor are optional (nil-safe); IB1/orchestrator may inject
		// the real notifications + audit sinks.
	})

	catalogHandler := catalog.NewHandler(catalogSvc, kycSvc)
	consentHandler := consent.NewHandler(consentSvc)
	// signRef is nil for now — the certificate route returns the stored ref until
	// the orchestrator injects the R2 signer. (TODO: wire r2 presign.)
	policyHandler := policy.NewHandler(policySvc, nil)

	// --- Member routes (/api/finance/insurance) ---
	mg := member.Group("/insurance")
	// Products: KYC-tier + context filtered.
	mg.GET("/products", catalogHandler.ListProducts)
	// NDPA consent (gate before any provider data-share).
	mg.GET("/consent", consentHandler.Status)
	mg.POST("/consent", consentHandler.Grant)
	// Quotes.
	mg.POST("/quotes", policyHandler.CreateQuote)
	mg.GET("/quotes/:id", policyHandler.GetQuote)
	// Policies — Idempotency-Key REQUIRED on bind (enforced in handler).
	mg.POST("/policies", policyHandler.Bind)
	mg.GET("/policies", policyHandler.List)
	mg.GET("/policies/:id", policyHandler.Get)
	mg.GET("/policies/:id/certificate", policyHandler.Certificate)
	mg.POST("/policies/:id/cancel", policyHandler.Cancel)
	mg.GET("/policies/:id/beneficiaries", policyHandler.ListBeneficiaries)
	mg.POST("/policies/:id/beneficiaries", policyHandler.AddBeneficiary)

	// --- Admin routes (/api/insurance/admin, per-route RBAC insurance.*) ---
	guard := func(permission string) gin.HandlerFunc {
		return middleware.RequirePermission(rbac, permission)
	}
	ag := admin.Group("")
	// Catalog management.
	ag.GET("/catalog", guard("insurance.catalog.view"), catalogHandler.AdminList)
	ag.PATCH("/catalog/:code/active", guard("insurance.catalog.manage"), catalogHandler.AdminSetActive)
	// Routing / provider config (product → aggregator).
	ag.PATCH("/routing/:code", guard("insurance.routing.manage"), catalogHandler.AdminSetRouting)
	// Policy search.
	ag.GET("/policies", guard("insurance.policy.view"), policyHandler.AdminSearch)

	log.Println("[insurance] routes registered — catalog/quotes/policies/consent + premium-bind saga live")
}
