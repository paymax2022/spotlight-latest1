package app

import (
	"context"
	"log"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	financeledger "spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/finance/wallet"
	"spotlight/backend/internal/insurance/catalog"
	"spotlight/backend/internal/insurance/claims"
	"spotlight/backend/internal/insurance/embedded"
	"spotlight/backend/internal/insurance/gateway"
	"spotlight/backend/internal/insurance/policy"
	"spotlight/backend/internal/insurance/reconciliation"
	"spotlight/backend/internal/insurance/webhooks"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/provider/mycover"
	"spotlight/backend/internal/provider/octamile"
	"spotlight/backend/internal/services"
)

// RegisterInsuranceClaims wires the IB-claims layer onto the same finance member
// group + insurance admin group IB0 uses, plus an UNAUTHENTICATED webhooks group
// for provider callbacks. It BUILDS ON the IB0 core (catalog/gateway/policy) —
// importing those packages, never editing them — and REUSES the finance
// ledger/wallet money primitives (no new money rails).
//
//   - member   : claims (FNOL/list/get/evidence) + embedded-engine test routes
//   - admin    : claim search/decision + reconciliation workbench + commission view
//   - webhooks : POST /internal/webhooks/{mycover,octamile} (signature-verified)
//
// FeatureInsuranceEnabled is enforced UPSTREAM by the parent finance group, so
// these routes inherit the same gate (mirrors RegisterInsurance). Money paths:
//   - claim payout  : wallet.Credit, idempotent on claim.idempotency_key+":payout".
//   - embedded bind : wallet.Debit hold + auto-release on failure, idempotent on
//                     source_event_id; commission on the SEPARATE commission acct.
//   - commission    : reversal posts a balanced entry on ledger.AccountCommission.
//
// Provider credentials come from the environment (NEVER hard-coded / logged):
//
//	INSURANCE_MYCOVER_API_KEY / INSURANCE_MYCOVER_WEBHOOK_SECRET / INSURANCE_MYCOVER_BASE_URL
//	INSURANCE_OCTAMILE_API_KEY / INSURANCE_OCTAMILE_WEBHOOK_SECRET / INSURANCE_OCTAMILE_BASE_URL
func RegisterInsuranceClaims(member *gin.RouterGroup, admin *gin.RouterGroup, webhookGroup *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService) {
	if pool == nil {
		log.Println("[insurance-claims] nil pool — skipping insurance claims routes")
		return
	}

	// --- Reused finance primitives (money path) ---
	ledgerSvc := financeledger.NewService(financeledger.NewRepository(pool), nil)
	tiersSvc := tiers.NewService(pool)
	walletSvc := wallet.NewService(ledgerSvc, tiersSvc)

	// --- IB0 domain services reused here ---
	catalogSvc := catalog.NewService(pool)

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
	router := gateway.NewRouter(catalogSvc, mycoverGW, octamileGW)

	policyRepo := policy.NewRepository(pool)

	// --- Claims ---
	claimsSvc := claims.NewService(claims.Deps{
		Repo:   claims.NewRepository(pool),
		Router: router,
		Policy: policyReaderAdapter{repo: policyRepo},
		Docs:   nil, // nil-safe: stores supplied storage_ref verbatim until R2 signer is injected.
		Wallet: walletSvc,
		Ledger: ledgerSvc,
	})
	claimsHandler := claims.NewHandler(claimsSvc)

	// --- Embedded-binding engine ---
	embeddedSvc := embedded.NewService(embedded.Deps{
		Repo:       embedded.NewRepository(pool),
		PolicyRepo: policyRepo,
		Router:     router,
		Wallet:     walletSvc,
		Ledger:     ledgerSvc,
	})
	embeddedHandler := embedded.NewHandler(embeddedSvc)

	// --- Provider webhook ingestion ---
	webhookSvc := webhooks.NewService(router, webhooks.NewRepository(pool), claimsSvc)
	webhookHandler := webhooks.NewHandler(webhookSvc)

	// --- Reconciliation + commission ---
	reconSvc := reconciliation.NewService(reconciliation.NewRepository(pool), ledgerSvc)
	reconHandler := reconciliation.NewHandler(reconSvc)

	// Per-route RBAC guard (mirrors insurance_routes.go).
	guard := func(permission string) gin.HandlerFunc {
		return middleware.RequirePermission(rbac, permission)
	}

	// --- Member routes (mounted on the finance/insurance member group) ---
	mg := member.Group("/insurance")
	claims.Register(mg, admin, claimsHandler, guard)
	embedded.Register(mg, embeddedHandler)

	// --- Admin routes (insurance admin group; per-route RBAC) ---
	reconciliation.Register(admin, reconHandler, guard)

	// --- Webhook routes (no auth; provider-signed) ---
	if webhookGroup != nil {
		webhooks.Register(webhookGroup, webhookHandler)
	}

	log.Println("[insurance-claims] routes registered — claims + embedded + webhooks + reconciliation/commission live")
}

// policyReaderAdapter adapts policy.Repository to claims.PolicyReader, enforcing
// object-level authZ (the claimant must own the policy). It reads the policy via
// the IB0 repository and never edits the policy package.
type policyReaderAdapter struct {
	repo *policy.Repository
}

func (a policyReaderAdapter) PolicyForClaim(ctx context.Context, userID, policyID string) (claims.PolicyView, error) {
	p, err := a.repo.Get(ctx, policyID)
	if err != nil {
		return claims.PolicyView{}, err
	}
	if p.PolicyholderID != userID {
		return claims.PolicyView{}, claims.ErrForbidden
	}
	ref := ""
	if p.ProviderPolicyRef != nil {
		ref = *p.ProviderPolicyRef
	}
	return claims.PolicyView{
		ID:                p.ID,
		PolicyholderID:    p.PolicyholderID,
		Provider:          p.Provider,
		ProviderPolicyRef: ref,
		State:             string(p.State),
		Currency:          p.Currency,
	}, nil
}
