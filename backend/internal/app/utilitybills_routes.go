package app

import (
	"log"
	"os"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/config"
	"spotlight/backend/internal/finance/commission"
	financeledger "spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/wallet"
	"spotlight/backend/internal/middleware"
	providerInterfaces "spotlight/backend/internal/provider"
	"spotlight/backend/internal/provider/vtpass"
	"spotlight/backend/internal/services"
	"spotlight/backend/internal/utilitybills"
)

// RegisterUtilityBills wires the Utility Bills DOMAIN money path (electricity /
// airtime / data / cable TV / internet / education purchases) — Phase 1 of the
// Next.js → Go migration.
//
//	member : /api/finance/utilitybills/*        (auth via the finance group)
//	admin  : /api/finance/admin/utilitybills/*  (RBAC finance.admin.utilitybills)
//
// The WHOLE thing is inside one `if cfg.FeatureUtilityBillsEnabled && pool != nil`
// block, cloned from the Maplerad wiring in finance_routes.go: no flag, no money
// path, and nothing to roll back but the flag.
//
// Phase 1 mounts only the MONEY-affecting admin actions (get / requery / reverse
// / unresolved-bind count). The full 24-route admin surface is Phase 4. They are
// here now so Phase 2's Next.js proxy has a single writer to call, instead of a
// second independent implementation deciding transitions on the same rows.
//
// Provider credentials come from the environment (NEVER hard-coded, never logged),
// following RegisterInsurance's convention:
//
//	VTPASS_API_KEY / VTPASS_PUBLIC_KEY / VTPASS_SECRET_KEY / VTPASS_ENVIRONMENT / VTPASS_BASE_URL
//	UTILITY_PROVIDER_TIMEOUT_MS          (default 15000, per provider-timeout.ts)
//	UTILITY_PROVIDER_CREDENTIALS_KEY     (AES-256-GCM key for utility_providers.credentials)
//
// authMW must be the SAME RequireAuthContext middleware the finance group uses.
// It has to run BEFORE requireUserID on the admin group: requireUserID only reads
// the user_id that RequireAuthContext populates, so mounting it alone 401s every
// admin route even with a valid token (the bug documented three times over in
// finance_routes.go).
func RegisterUtilityBills(
	r *gin.Engine,
	member *gin.RouterGroup,
	cfg config.Config,
	pool *pgxpool.Pool,
	rbac services.RBACService,
	authMW gin.HandlerFunc,
	ledgerSvc *financeledger.Service,
	walletSvc *wallet.Service,
) {
	if !cfg.FeatureUtilityBillsEnabled || pool == nil {
		return
	}

	// --- Provider adapters (keyed by utility_providers.adapter_code) ---
	environment := vtpass.EnvironmentLive
	if os.Getenv("VTPASS_ENVIRONMENT") == "sandbox" {
		environment = vtpass.EnvironmentSandbox
	}
	vtpassClient := vtpass.New(
		os.Getenv("VTPASS_API_KEY"),
		os.Getenv("VTPASS_PUBLIC_KEY"),
		os.Getenv("VTPASS_SECRET_KEY"),
		environment,
		os.Getenv("VTPASS_BASE_URL"),
	)
	providers := utilitybills.NewProviderRegistry(map[string]providerInterfaces.BillsProvider{
		"vtpass": vtpassClient,
	})

	// --- Commission with a REAL ledger ---
	// This is the deliberate behaviour change Phase 1 makes explicit: a settled
	// utility transaction now posts a balanced revenue-recognition leg
	// (DR provider_clearing → CR commission) and the commission_earnings row
	// carries its ledger_ref. The Next.js path left ledger_ref null with a
	// standing TODO. Passing nil here would silently preserve that gap.
	commissionSvc := commission.NewService(commission.NewRepository(pool), ledgerSvc)

	svc := utilitybills.NewService(utilitybills.Deps{
		Repo:             utilitybills.NewRepository(pool),
		Beneficiaries:    utilitybills.NewBeneficiaryRepository(pool),
		Binds:            utilitybills.NewBindRegistry(pool),
		Providers:        providers,
		Wallet:           walletSvc,
		Ledger:           ledgerSvc,
		Commission:       commissionSvc,
		DefaultTimeoutMs: utilityProviderTimeoutMs(),
		// The sandbox validation safety net exists so the documented VTpass test
		// meters validate even in an environment with no seeded provider route. It
		// is tied to the adapter being in sandbox mode, so it can never be reached
		// by a live deployment.
		SandboxValidation:  environment == vtpass.EnvironmentSandbox,
		SandboxAdapterCode: "vtpass",
	})
	handler := utilitybills.NewHandler(svc)

	// --- Member routes (auth inherited from the finance group) ---
	ub := member.Group("/utilitybills")
	ub.GET("/categories", handler.ListCategories)
	ub.GET("/billers", handler.ListBillers)
	ub.GET("/products", handler.ListProducts)
	ub.POST("/validate", handler.Validate)
	ub.POST("/quote", handler.Quote)
	// Idempotency-Key REQUIRED (enforced in the service, not middleware).
	ub.POST("/pay", handler.Pay)
	ub.GET("/transactions", handler.ListTransactions)
	ub.GET("/transactions/:id", handler.GetTransaction)
	ub.GET("/transactions/:id/attempts", handler.ListTransactionAttempts)
	ub.POST("/transactions/:id/requery", handler.Requery)
	ub.POST("/transactions/:id/dispute", handler.CreateDispute)
	ub.GET("/beneficiaries", handler.ListBeneficiaries)
	ub.POST("/beneficiaries", handler.SaveBeneficiary)
	ub.DELETE("/beneficiaries/:id", handler.DeleteBeneficiary)

	// --- Admin routes (money-affecting only in Phase 1) ---
	// Mounted on the ROOT engine so they sit outside the member group, with
	// RequireAuthContext BEFORE requireUserID and per-route RBAC fail-closed.
	// RequirePermission — NOT RequireAdminConsoleRole, which is an explicit stub.
	admin := r.Group("/api/finance/admin/utilitybills")
	admin.Use(authMW)
	admin.Use(requireUserID())
	perm := middleware.RequirePermission(rbac, "finance.admin.utilitybills")
	admin.GET("/transactions/:id", perm, handler.AdminGetTransaction)
	admin.POST("/transactions/:id/requery", perm, handler.AdminRequery)
	admin.POST("/transactions/:id/reverse", perm, handler.AdminReverse)
	admin.GET("/unresolved", perm, handler.AdminUnresolvedBinds)

	log.Printf("[finance] Utility Bills domain routes registered at /api/finance/utilitybills (vtpass env=%s, configured=%t, adapters=%v)",
		environment, vtpassClient.Configured(), providers.AdapterCodes())
}

// utilityProviderTimeoutMs ports provider-timeout.ts's env fallback: an integer
// >= 1000 in UTILITY_PROVIDER_TIMEOUT_MS, capped at 120s, else 15s. The
// per-provider config.timeout_ms override is applied later, per call.
func utilityProviderTimeoutMs() int {
	const def = 15_000
	raw := os.Getenv("UTILITY_PROVIDER_TIMEOUT_MS")
	if raw == "" {
		return def
	}
	v, err := strconv.Atoi(raw)
	if err != nil || v < 1000 {
		return def
	}
	if v > 120_000 {
		return 120_000
	}
	return v
}
