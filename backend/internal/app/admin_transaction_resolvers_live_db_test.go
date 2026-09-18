package app

// ---------------------------------------------------------------------------
// LIVE-DB suite for the per-module admin transaction-detail resolvers (see
// admin_transaction_resolvers.go) that back GET
// /api/finance/admin/transactions/:id's module_detail field.
//
// Priority per the build brief: Insurance-premium and FX-conversion are the
// most self-contained fixtures, so they're covered first and most
// thoroughly; marketplace-boost and utility-bill are also covered here.
//
// Each test seeds ONLY its own module's domain row(s) (no ledger_entries row
// is required — Resolve() only needs the reference string) under a random
// unique reference, proving:
//  1. A real seeded domain row resolves correctly — every field populated,
//     the REAL per-module status (not ledger Posted/Reversed), correct
//     reference matching.
//  2. A reference that doesn't match ANY module's pattern (a bare random
//     UUID, no colon/prefix) returns (nil, false, nil) from every resolver —
//     not an error.
//
// SKIPPED whenever TEST_DATABASE_URL is unset, so `go test ./...` without a
// DB stays green.
//
// Bring-up:
//   export TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
//   cd backend && go test ./internal/app/... -run TestAdminTransactionResolver -v -count=1
// ---------------------------------------------------------------------------

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func mustLiveResolverPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping live-DB test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect TEST_DATABASE_URL: %v", err)
	}
	t.Cleanup(pool.Close)
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping TEST_DATABASE_URL: %v", err)
	}
	return pool
}

// seedFixtureUser inserts a throwaway auth.users row (user_profiles is
// auto-created by the handle_new_user trigger) and returns its id, cleaned
// up on test completion.
func seedFixtureUser(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	ctx := context.Background()
	userID := uuid.NewString()
	email := "admtxresolver-" + uuid.NewString()[:8] + "@admin-tx-resolver-fixture.test"
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, userID, email); err != nil {
		t.Fatalf("seed auth.users: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM user_profiles WHERE id = $1`, userID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM auth.users WHERE id = $1`, userID)
	})
	return userID
}

// ── Insurance premium resolver ───────────────────────────────────────────────

func TestAdminTransactionResolver_InsurancePremium_Match(t *testing.T) {
	pool := mustLiveResolverPool(t)
	ctx := context.Background()
	userID := seedFixtureUser(t, pool)

	policyID := uuid.NewString()
	productCode := "test-product-" + uuid.NewString()[:8]
	provider := "mycover"
	underwriter := "AXA Mansard"
	state := "ACTIVE"
	if _, err := pool.Exec(ctx, `
		INSERT INTO insurance_policy (id, policyholder_user_id, product_code, provider, underwriter, state, premium_amount_kobo)
		VALUES ($1,$2,$3,$4,$5,$6,150000)`,
		policyID, userID, productCode, provider, underwriter, state); err != nil {
		t.Fatalf("seed insurance_policy: %v", err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM insurance_policy WHERE id = $1`, policyID) })

	reference := "insurance:premium:" + policyID
	idemKey := "idem-" + uuid.NewString()
	if _, err := pool.Exec(ctx, `
		INSERT INTO insurance_premium_transaction (policy_id, wallet_ledger_ref, idempotency_key, amount_kobo, direction, status)
		VALUES ($1,$2,$3,150000,'DEBIT','posted')`,
		policyID, reference, idemKey); err != nil {
		t.Fatalf("seed insurance_premium_transaction: %v", err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM insurance_premium_transaction WHERE policy_id = $1`, policyID) })

	r := NewInsurancePremiumResolver(pool)
	detail, found, err := r.Resolve(ctx, reference)
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if !found {
		t.Fatalf("expected found=true for a real seeded policy, got false")
	}
	if detail.Module != "insurance_premium" {
		t.Errorf("Module = %q, want insurance_premium", detail.Module)
	}
	if detail.Status != state {
		t.Errorf("Status = %q, want real policy state %q (not a generic ledger status)", detail.Status, state)
	}
	if detail.Category == nil || *detail.Category != productCode {
		t.Errorf("Category = %v, want %q", detail.Category, productCode)
	}
	if detail.PaymentMethod != "wallet" {
		t.Errorf("PaymentMethod = %q, want wallet (insurance has no payment_method column)", detail.PaymentMethod)
	}
	if detail.Provider == nil {
		t.Fatalf("Provider is nil, want non-nil (aggregator+underwriter)")
	}
	if detail.Merchant != nil {
		t.Errorf("Merchant = %v, want nil — insurance has no merchant concept", detail.Merchant)
	}
}

func TestAdminTransactionResolver_InsurancePremium_NoMatch(t *testing.T) {
	pool := mustLiveResolverPool(t)
	r := NewInsurancePremiumResolver(pool)
	detail, found, err := r.Resolve(context.Background(), uuid.NewString())
	if err != nil {
		t.Fatalf("Resolve on non-matching reference should not error, got: %v", err)
	}
	if found {
		t.Fatalf("expected found=false for a bare-UUID reference, got true (detail=%+v)", detail)
	}
	if detail != nil {
		t.Fatalf("expected nil detail on no-match, got %+v", detail)
	}
}

// ── FX conversion resolver ───────────────────────────────────────────────────

func TestAdminTransactionResolver_FXConversion_Match(t *testing.T) {
	pool := mustLiveResolverPool(t)
	ctx := context.Background()
	userID := seedFixtureUser(t, pool)

	reference := "fx:" + uuid.NewString()
	idemKey := "idem-" + uuid.NewString()
	status := "completed"
	if _, err := pool.Exec(ctx, `
		INSERT INTO fx_conversions (user_id, source_currency, target_currency, source_amount_kobo, target_amount_minor, rate, status, reference, idempotency_key)
		VALUES ($1,'NGN','USD',1000000,650,1538.46,$2,$3,$4)`,
		userID, status, reference, idemKey); err != nil {
		t.Fatalf("seed fx_conversions: %v", err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM fx_conversions WHERE reference = $1`, reference) })

	r := NewFXConversionResolver(pool)
	detail, found, err := r.Resolve(ctx, reference)
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if !found {
		t.Fatalf("expected found=true for a real seeded fx_conversions row, got false")
	}
	if detail.Module != "fx_conversion" {
		t.Errorf("Module = %q, want fx_conversion", detail.Module)
	}
	if detail.Status != status {
		t.Errorf("Status = %q, want real fx_conversions.status %q", detail.Status, status)
	}
	if detail.Category == nil || *detail.Category != "NGN→USD" {
		t.Errorf("Category = %v, want NGN→USD", detail.Category)
	}
	if detail.ServiceBought != "Currency conversion" {
		t.Errorf("ServiceBought = %q, want %q", detail.ServiceBought, "Currency conversion")
	}
	if detail.PaymentMethod != "wallet" {
		t.Errorf("PaymentMethod = %q, want wallet (fx_conversions has no payment_method column)", detail.PaymentMethod)
	}
	if detail.Provider != nil {
		t.Errorf("Provider = %v, want nil — fx_conversions has no provider/adapter column, must not be guessed", detail.Provider)
	}
}

func TestAdminTransactionResolver_FXConversion_NoMatch(t *testing.T) {
	pool := mustLiveResolverPool(t)
	r := NewFXConversionResolver(pool)
	detail, found, err := r.Resolve(context.Background(), uuid.NewString())
	if err != nil {
		t.Fatalf("Resolve on non-matching reference should not error, got: %v", err)
	}
	if found {
		t.Fatalf("expected found=false for a bare-UUID reference, got true (detail=%+v)", detail)
	}
	if detail != nil {
		t.Fatalf("expected nil detail on no-match, got %+v", detail)
	}
}

// fx:reversal:* references are a different posting shape and must NOT match
// the plain conversion resolver.
func TestAdminTransactionResolver_FXConversion_ExcludesReversalPrefix(t *testing.T) {
	pool := mustLiveResolverPool(t)
	r := NewFXConversionResolver(pool)
	detail, found, err := r.Resolve(context.Background(), "fx:reversal:"+uuid.NewString())
	if err != nil {
		t.Fatalf("Resolve should not error on a reversal reference, got: %v", err)
	}
	if found {
		t.Fatalf("expected found=false for an fx:reversal: reference, got true (detail=%+v)", detail)
	}
}

// ── Marketplace boost resolver ───────────────────────────────────────────────

func TestAdminTransactionResolver_MarketplaceBoost_Match(t *testing.T) {
	pool := mustLiveResolverPool(t)
	ctx := context.Background()
	sellerID := seedFixtureUser(t, pool)

	// mkt_boosts.listing_id has an FK to mkt_listings — seed a minimal listing
	// and its required category first.
	categoryID := uuid.NewString()
	if _, err := pool.Exec(ctx, `
		INSERT INTO mkt_categories (id, name, slug) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
		categoryID, "Resolver Test Category", "resolver-test-"+uuid.NewString()[:8]); err != nil {
		t.Fatalf("seed mkt_categories: %v", err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM mkt_categories WHERE id = $1`, categoryID) })

	listingID := uuid.NewString()
	if _, err := pool.Exec(ctx, `
		INSERT INTO mkt_listings (id, seller_id, category_id, title, description, price_kobo, state)
		VALUES ($1,$2,$3,'Resolver test listing','A listing seeded only for the admin transaction resolver live-DB test.',500000,'Lagos')`,
		listingID, sellerID, categoryID); err != nil {
		t.Fatalf("seed mkt_listings: %v", err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM mkt_listings WHERE id = $1`, listingID) })

	tier := "vip_gold"
	reference := "mkt:boost:" + sellerID + ":" + listingID + ":" + tier + ":charge"
	if _, err := pool.Exec(ctx, `
		INSERT INTO mkt_boosts (listing_id, seller_id, tier, duration_days, price_kobo, ledger_charge_ref, status)
		VALUES ($1,$2,$3,7,250000,$4,'active')`,
		listingID, sellerID, tier, reference); err != nil {
		t.Fatalf("seed mkt_boosts: %v", err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM mkt_boosts WHERE ledger_charge_ref = $1`, reference) })

	r := NewMarketplaceBoostResolver(pool)
	detail, found, err := r.Resolve(ctx, reference)
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if !found {
		t.Fatalf("expected found=true for a real seeded mkt_boosts row, got false")
	}
	if detail.Module != "marketplace_boost" {
		t.Errorf("Module = %q, want marketplace_boost", detail.Module)
	}
	if detail.Status != "active" {
		t.Errorf("Status = %q, want active (real boost_status)", detail.Status)
	}
	if detail.Category == nil || *detail.Category != tier {
		t.Errorf("Category = %v, want %q", detail.Category, tier)
	}
	if detail.PaymentMethod != "wallet" {
		t.Errorf("PaymentMethod = %q, want wallet (boosts are wallet-only)", detail.PaymentMethod)
	}
	if detail.Merchant != nil {
		t.Errorf("Merchant = %v, want nil — boost purchase has no third-party merchant", detail.Merchant)
	}
}

func TestAdminTransactionResolver_MarketplaceBoost_NoMatch(t *testing.T) {
	pool := mustLiveResolverPool(t)
	r := NewMarketplaceBoostResolver(pool)
	detail, found, err := r.Resolve(context.Background(), uuid.NewString())
	if err != nil {
		t.Fatalf("Resolve on non-matching reference should not error, got: %v", err)
	}
	if found {
		t.Fatalf("expected found=false for a bare-UUID reference, got true (detail=%+v)", detail)
	}
	if detail != nil {
		t.Fatalf("expected nil detail on no-match, got %+v", detail)
	}
}

// ── Utility bill resolver ────────────────────────────────────────────────────

func TestAdminTransactionResolver_UtilityBill_Match(t *testing.T) {
	pool := mustLiveResolverPool(t)
	ctx := context.Background()
	userID := seedFixtureUser(t, pool)

	billerID := uuid.NewString()
	billerCode := "resolver-test-biller-" + uuid.NewString()[:8]
	if _, err := pool.Exec(ctx, `
		INSERT INTO utility_billers (id, category, name, code) VALUES ($1,'airtime','Resolver Test Biller',$2)`,
		billerID, billerCode); err != nil {
		t.Fatalf("seed utility_billers: %v", err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM utility_billers WHERE id = $1`, billerID) })

	providerID := uuid.NewString()
	providerCode := "resolver-test-provider-" + uuid.NewString()[:8]
	if _, err := pool.Exec(ctx, `
		INSERT INTO utility_providers (id, name, code, adapter_code) VALUES ($1,'VTpass',$2,'vtpass')`,
		providerID, providerCode); err != nil {
		t.Fatalf("seed utility_providers: %v", err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM utility_providers WHERE id = $1`, providerID) })

	receipt := "UTL-20260918-" + uuid.NewString()[:8]
	idemKey := "idem-" + uuid.NewString()
	if _, err := pool.Exec(ctx, `
		INSERT INTO utility_transactions (
			user_id, category, biller_id, provider_id, customer_reference, customer_name,
			amount_kobo, retail_amount_kobo, provider_cost_kobo, status, receipt_number,
			idempotency_key, payment_source
		) VALUES ($1,'airtime',$2,$3,'08012345678','Test Customer',100000,100000,95000,'successful',$4,$5,'paystack')`,
		userID, billerID, providerID, receipt, idemKey); err != nil {
		t.Fatalf("seed utility_transactions: %v", err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM utility_transactions WHERE receipt_number = $1`, receipt) })

	r := NewUtilityBillResolver(pool)
	detail, found, err := r.Resolve(ctx, receipt)
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if !found {
		t.Fatalf("expected found=true for a real seeded utility_transactions row, got false")
	}
	if detail.Module != "utility_bill" {
		t.Errorf("Module = %q, want utility_bill", detail.Module)
	}
	if detail.Status != "successful" {
		t.Errorf("Status = %q, want successful (real utility_transactions.status)", detail.Status)
	}
	if detail.Category == nil || *detail.Category != "airtime" {
		t.Errorf("Category = %v, want airtime", detail.Category)
	}
	if detail.PaymentMethod != "paystack" {
		t.Errorf("PaymentMethod = %q, want paystack — the ONE module with a real non-wallet payment_source", detail.PaymentMethod)
	}
	if detail.Provider == nil || *detail.Provider != "VTpass" {
		t.Errorf("Provider = %v, want VTpass", detail.Provider)
	}
}

func TestAdminTransactionResolver_UtilityBill_NoMatch(t *testing.T) {
	pool := mustLiveResolverPool(t)
	r := NewUtilityBillResolver(pool)
	detail, found, err := r.Resolve(context.Background(), uuid.NewString())
	if err != nil {
		t.Fatalf("Resolve on non-matching reference should not error, got: %v", err)
	}
	if found {
		t.Fatalf("expected found=false for a bare-UUID reference, got true (detail=%+v)", detail)
	}
	if detail != nil {
		t.Fatalf("expected nil detail on no-match, got %+v", detail)
	}
}
