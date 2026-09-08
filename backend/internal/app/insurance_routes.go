package app

import (
	"context"
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
//
// InsuranceServices exposes the subset of the insurance module other verticals
// may reuse directly (in-process Go calls, not HTTP) — e.g. transport's parcel
// flow binding real Goods-in-Transit cover. Nil-safe: a caller that gets a nil
// *InsuranceServices (pool was nil) must treat the feature as unavailable
// rather than dereference it.
type InsuranceServices struct {
	Policy  *policy.Service
	Catalog *catalog.Service
	Consent *consent.Service
}

func RegisterInsurance(member *gin.RouterGroup, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService) *InsuranceServices {
	if pool == nil {
		log.Println("[insurance] nil pool — skipping insurance routes")
		return nil
	}

	// --- Reused finance primitives (money path) ---
	ledgerSvc := financeledger.NewService(financeledger.NewRepository(pool), nil)
	tiersSvc := tiers.NewService(pool)
	walletSvc := wallet.NewService(ledgerSvc, tiersSvc)
	kycSvc := kyc.NewService(pool)

	// --- Insurance domain services ---
	catalogSvc := catalog.NewService(pool)
	consentSvc := consent.NewService(pool)
	// Prefunded-provider-float breaker. MyCover settles binds from a distributor
	// float, so an empty float fails EVERY bind at once; this stops the queue
	// before members are debited for cover that cannot be issued.
	floatSvc := catalog.NewFloatService(pool)

	// --- Provider adapters (sandbox keys from env; empty => sandbox defaults) ---
	mycoverGW := mycover.New(
		os.Getenv("INSURANCE_MYCOVER_API_KEY"),    // secret key
		os.Getenv("INSURANCE_MYCOVER_PUBLIC_KEY"), // publishable key
		os.Getenv("INSURANCE_MYCOVER_WEBHOOK_SECRET"),
		os.Getenv("INSURANCE_MYCOVER_BASE_URL"),
	)
	octamileGW := octamile.New(
		os.Getenv("INSURANCE_OCTAMILE_API_KEY"),    // secret key
		os.Getenv("INSURANCE_OCTAMILE_PUBLIC_KEY"), // publishable key
		os.Getenv("INSURANCE_OCTAMILE_WEBHOOK_SECRET"),
		os.Getenv("INSURANCE_OCTAMILE_BASE_URL"),
	)

	// Remote-options dropdowns: catalog resolves the field's options_url from the
	// stored schema, the adapter fetches it. Adapted rather than passed directly
	// so catalog keeps its narrow OptionsFetcher and does not import the provider.
	catalogSvc.WithOptionsFetcher(mycoverOptions{mycoverGW})

	// Router resolves an adapter from the data-driven catalog (product.provider).
	router := gateway.NewRouter(catalogSvc, mycoverGW, octamileGW)

	// Catalog sync. Form schemas are FETCHED from the provider's public
	// per-product schema endpoint rather than maintained here, so adding a
	// product is a sync run and nothing in this repo needs editing.
	catalogSyncer := catalog.NewSyncer(catalogSvc, mycoverGW.Name(), mycoverGW, mycoverGW)

	// Policy service: lifecycle + thin quote engine + premium-bind saga.
	policySvc := policy.NewService(policy.Deps{
		Repo:    policy.NewRepository(pool),
		Router:  router,
		Catalog: catalogSvc,
		Consent: consentSvc,
		Wallet:  walletSvc,
		Ledger:  ledgerSvc,
		Float:   floatSvc,
		// Outbound purchase idempotency. MyCover has none of its own, so this is
		// what stops a retried bind buying a second policy with real money.
		Binds: policy.NewBindRegistry(pool),
		// Notifier / Auditor are optional (nil-safe); IB1/orchestrator may inject
		// the real notifications + audit sinks.
	})

	catalogHandler := catalog.NewHandler(catalogSvc, kycSvc).
		WithAdmin(catalogSyncer, floatSvc, func() any {
			// PRESENCE and configuration only — never a credential value.
			return []map[string]any{
				{
					"aggregator":             mycoverGW.Name(),
					"base_url":               mycoverGW.BaseURL(),
					"api_key_present":        mycoverGW.Configured(),
					"webhook_secret_present": mycoverGW.WebhookConfigured(),
					"webhook_verification": map[string]any{
						"enabled": mycoverGW.WebhookConfigured(),
						"note": "Signature verification fails CLOSED. With no secret configured " +
							"every inbound webhook is rejected — a real signing secret is needed from the provider.",
					},
					"quote_path": mycover.QuotePath,
					"buy_path":   mycover.BuyPath,
				},
				{
					"aggregator":      octamileGW.Name(),
					"api_key_present": os.Getenv("INSURANCE_OCTAMILE_API_KEY") != "",
				},
			}
		})
	consentHandler := consent.NewHandler(consentSvc)
	// signRef is nil for now — the certificate route returns the stored ref until
	// the orchestrator injects the R2 signer. (TODO: wire r2 presign.)
	policyHandler := policy.NewHandler(policySvc, nil)

	// --- Member routes (/api/finance/insurance) ---
	mg := member.Group("/insurance")
	// Products: KYC-tier + context filtered.
	mg.GET("/products", catalogHandler.ListProducts)
	mg.GET("/products/:code", catalogHandler.GetProduct)
	// Dynamic purchase form. MyCover validates a bespoke field set per purchase
	// family, so the app renders from this rather than a hardcoded form.
	mg.GET("/products/:code/schema", catalogHandler.GetProductSchema)
	// Remote-options dropdowns the schema points at (options_url). The client
	// asks by product + field; the URL is resolved from our stored schema, so
	// this is not an open proxy.
	mg.GET("/products/:code/options/:field", catalogHandler.GetFieldOptions)
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
	// KPI dashboard. Figures we do not compute come back as null, never 0 — the
	// console renders them differently and a confident zero on a money screen is
	// worse than an honest gap.
	ag.GET("/dashboard", guard("insurance.catalog.view"), catalogHandler.AdminDashboard)
	ag.GET("/catalog", guard("insurance.catalog.view"), catalogHandler.AdminList)
	// Pull the live provider catalog into the DB. Idempotent; new products land
	// INACTIVE so a sync never puts an unreviewed product in front of members.
	ag.POST("/catalog/sync", guard("insurance.catalog.manage"), catalogHandler.AdminSync)
	// Bulk-activate everything the provider can actually sell. Never activates an
	// unsellable product, and skips any an admin has already ruled on.
	ag.POST("/catalog/activate-purchasable", guard("insurance.catalog.manage"), catalogHandler.AdminActivateAllPurchasable)
	// Adapter health, last sync, and the prefunded-float launch gate.
	ag.GET("/providers", guard("insurance.catalog.view"), catalogHandler.AdminProviders)
	ag.POST("/providers/:provider/float/reset", guard("insurance.catalog.manage"), catalogHandler.AdminResetFloat)
	ag.PATCH("/catalog/:code/active", guard("insurance.catalog.manage"), catalogHandler.AdminSetActive)
	// Routing / provider config (product → aggregator).
	ag.PATCH("/routing/:code", guard("insurance.routing.manage"), catalogHandler.AdminSetRouting)
	// Policy search.
	ag.GET("/policies", guard("insurance.policy.view"), policyHandler.AdminSearch)

	log.Println("[insurance] routes registered — catalog/quotes/policies/consent + premium-bind saga live")

	return &InsuranceServices{Policy: policySvc, Catalog: catalogSvc, Consent: consentSvc}
}

// mycoverOptions adapts the MyCover client to catalog.OptionsFetcher, mapping the
// provider's Option to the catalog's own type so neither package depends on the
// other's shape.
type mycoverOptions struct{ c *mycover.Client }

func (m mycoverOptions) FetchUtilityOptions(ctx context.Context, optionsURL, query string) ([]catalog.FieldOption, error) {
	opts, err := m.c.FetchUtilityOptions(ctx, optionsURL, query)
	if err != nil {
		return nil, err
	}
	out := make([]catalog.FieldOption, 0, len(opts))
	for _, o := range opts {
		out = append(out, catalog.FieldOption{Value: o.Value, Label: o.Label})
	}
	return out, nil
}
