package utilitybills_test

// ---------------------------------------------------------------------------
// LIVE-DB integration suite for the Utility Bills money path (Phase 1).
//
// Skipped unless TEST_DATABASE_URL is set (the pattern from
// backend/internal/restaurant/availability_live_db_test.go). Requires the utility
// migrations plus 20270206000000_utility_provider_bind.sql.
//
// What it proves, and why each one is here:
//
//	1. A successful purchase debits the wallet exactly once, posts a BALANCED
//	   ledger pair, persists the vended token, and records commission with a
//	   non-null ledger_ref.
//	2. A replay of the same Idempotency-Key returns the ORIGINAL transaction and
//	   posts NO further ledger entries. (Two layers: the pre-check and the unique
//	   constraint. This exercises the pre-check; the constraint is what holds under
//	   real concurrency.)
//	3. A DEFINITE provider failure auto-reverses: the debit and reversal legs
//	   cancel to a NET ZERO effect on the member's wallet.
//	4. A provider timeout/pending lands in provider_pending and does NOT reverse —
//	   the money correctly stays out pending resolution.
//	5. The outbound bind registry blocks a retry of an UNKNOWN outcome instead of
//	   double-purchasing.
//	6. The wallet's tier daily-limit still fires (it is the ONLY limit this module
//	   enforces on the wallet).
//
// The provider is the real vtpass adapter in SANDBOX mode, which simulates the
// documented EKEDC meter outcomes locally — no network, no credentials.
// ---------------------------------------------------------------------------

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"

	"spotlight/backend/internal/finance/commission"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/finance/wallet"
	providerInterfaces "spotlight/backend/internal/provider"
	"spotlight/backend/internal/provider/vtpass"
	"spotlight/backend/internal/testsupport"
	"spotlight/backend/internal/utilitybills"
)

// VTpass's published EKEDC sandbox meters (see provider/vtpass/vtpass.go).
const (
	meterSuccessPrepaid = "1111111111111"
	meterFailAnomaly    = "500000000000"
	meterTimeout        = "300000000000"
)

func livePool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping live-DB utility bills test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping: %v", err)
	}
	// Registered FIRST so it runs LAST — testsupport.CleanupUser's teardown needs
	// the pool still open (cleanups are LIFO).
	t.Cleanup(pool.Close)
	return pool
}

type fixture struct {
	pool       *pgxpool.Pool
	svc        *utilitybills.Service
	ledger     *ledger.Service
	userID     string
	billerID   string
	productID  string
	providerID string
	clearingID string
	walletID   string
}

// newFixture seeds a self-contained catalogue (provider → biller → product →
// mapping) plus a funded member at the given KYC tier, and builds the service
// over the real sandbox vtpass adapter.
//
// requiresValidation is a parameter rather than a constant because it changes
// which sandbox meters are REACHABLE. VTpass's sandbox merchant-verify only
// recognises the two "good" meters, so on a biller that requires validation the
// failure/timeout meters are rejected at the verification step and never reach
// the purchase call at all. That is faithful to the TS source (payUtility runs
// validateCustomer before the debit, and a false result is a 400), so exercising
// the provider-failure and provider-pending paths needs a biller that does not
// require validation — which is exactly how the airtime/data billers are seeded
// in production.
//
// Every seeded row is uniquely suffixed so concurrent runs on the shared local
// database cannot collide on the UNIQUE(code) constraints.
func newFixture(t *testing.T, tier int, fundKobo int64, requiresValidation bool) *fixture {
	t.Helper()
	pool := livePool(t)
	ctx := context.Background()
	suffix := uuid.New().String()[:8]

	userID := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
		userID, userID+"@seed.test"); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	testsupport.CleanupUser(t, pool, userID)

	// The tier gate reads user_profiles.kyc_tier. A handle_new_user trigger may
	// already have created the row, so this upserts rather than inserts.
	if _, err := pool.Exec(ctx, `
		INSERT INTO public.user_profiles (id, kyc_tier) VALUES ($1,$2)
		ON CONFLICT (id) DO UPDATE SET kyc_tier = EXCLUDED.kyc_tier`, userID, tier); err != nil {
		t.Fatalf("seed profile: %v", err)
	}

	var providerID, billerID, productID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO public.utility_providers
			(name, code, adapter_code, status, supported_categories, priority, health_status)
		VALUES ('VTpass Test', $1, 'vtpass', 'active', ARRAY['electricity'], 10, 'healthy')
		RETURNING id`, "vtpass-test-"+suffix).Scan(&providerID); err != nil {
		t.Fatalf("seed provider: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO public.utility_billers
			(category, name, code, status, requires_validation, customer_reference_label)
		VALUES ('electricity', 'Eko Electric Test', $1, 'active', $2, 'Meter number')
		RETURNING id`, "vtpass-eko-electric-"+suffix, requiresValidation).Scan(&billerID); err != nil {
		t.Fatalf("seed biller: %v", err)
	}
	// Variable-amount product: markup 0 bps, ₦100 convenience fee, 2% provider
	// discount. Deliberately simple so the expected kobo figures below can be
	// written out by hand rather than recomputed by the code under test.
	if err := pool.QueryRow(ctx, `
		INSERT INTO public.utility_products
			(biller_id, category, name, code, amount_type, min_amount_kobo, max_amount_kobo,
			 convenience_fee_kobo, markup_bps, provider_discount_bps, status)
		VALUES ($1, 'electricity', 'Eko Prepaid Test', $2, 'variable', 100000, 10000000,
		        10000, 0, 200, 'active')
		RETURNING id`, billerID, "eko-prepaid-test-"+suffix).Scan(&productID); err != nil {
		t.Fatalf("seed product: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO public.utility_provider_product_mappings
			(provider_id, product_id, provider_product_code, provider_biller_code,
			 provider_discount_bps, status)
		VALUES ($1, $2, 'prepaid', 'eko-electric', 200, 'active')`, providerID, productID); err != nil {
		t.Fatalf("seed mapping: %v", err)
	}
	t.Cleanup(func() {
		// Catalogue rows are not user-scoped, so CleanupUser does not reach them.
		// Order matters: mappings/products reference the biller and provider.
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM public.utility_provider_product_mappings WHERE provider_id=$1`, providerID)
		_, _ = pool.Exec(bg, `DELETE FROM public.utility_products WHERE id=$1`, productID)
		_, _ = pool.Exec(bg, `DELETE FROM public.utility_billers WHERE id=$1`, billerID)
		_, _ = pool.Exec(bg, `DELETE FROM public.utility_providers WHERE id=$1`, providerID)
	})

	// --- Finance primitives (nil Redis: the DB unique constraint is the durable
	// idempotency layer, and the tests must exercise THAT, not a cache) ---
	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	tiersSvc := tiers.NewService(pool)
	walletSvc := wallet.NewService(ledgerSvc, tiersSvc)

	clearing, err := ledgerSvc.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
	if err != nil {
		t.Fatalf("clearing account: %v", err)
	}
	userWallet, err := ledgerSvc.GetOrCreateUserWallet(ctx, userID)
	if err != nil {
		t.Fatalf("user wallet: %v", err)
	}
	if fundKobo > 0 {
		if err := ledgerSvc.Credit(ctx, userID, "test:fund:"+suffix, "test:fund:"+suffix, clearing.ID, fundKobo); err != nil {
			t.Fatalf("fund wallet: %v", err)
		}
	}

	sandbox := vtpass.New("test-api-key", "test-public-key", "test-secret-key", vtpass.EnvironmentSandbox, "")
	svc := utilitybills.NewService(utilitybills.Deps{
		Repo:               utilitybills.NewRepository(pool),
		Beneficiaries:      utilitybills.NewBeneficiaryRepository(pool),
		Binds:              utilitybills.NewBindRegistry(pool),
		Providers:          utilitybills.NewProviderRegistry(map[string]providerInterfaces.BillsProvider{"vtpass": sandbox}),
		Wallet:             walletSvc,
		Ledger:             ledgerSvc,
		Commission:         commission.NewService(commission.NewRepository(pool), ledgerSvc),
		DefaultTimeoutMs:   15_000,
		SandboxValidation:  true,
		SandboxAdapterCode: "vtpass",
	})

	return &fixture{
		pool: pool, svc: svc, ledger: ledgerSvc, userID: userID,
		billerID: billerID, productID: productID, providerID: providerID,
		clearingID: clearing.ID, walletID: userWallet.ID,
	}
}

// walletNet returns the SIGNED sum over the member's wallet account, using the
// same sign rule as the balance projection: CREDIT / REVERSAL_DEBIT add,
// DEBIT / REVERSAL_CREDIT subtract.
func (f *fixture) walletNet(t *testing.T) int64 {
	t.Helper()
	var net int64
	err := f.pool.QueryRow(context.Background(), `
		SELECT COALESCE(SUM(CASE WHEN type IN ('CREDIT','REVERSAL_DEBIT') THEN amount_kobo
		                         ELSE -amount_kobo END), 0)
		FROM ledger_entries WHERE account_id = $1`, f.walletID).Scan(&net)
	if err != nil {
		t.Fatalf("wallet net: %v", err)
	}
	return net
}

// entriesForReference counts ledger entries written under one reference, on BOTH
// legs. A balanced posting always writes exactly two.
func (f *fixture) entriesForReference(t *testing.T, reference string) int {
	t.Helper()
	var n int
	if err := f.pool.QueryRow(context.Background(),
		`SELECT count(*) FROM ledger_entries WHERE reference = $1`, reference).Scan(&n); err != nil {
		t.Fatalf("count entries: %v", err)
	}
	return n
}

func (f *fixture) totalWalletEntries(t *testing.T) int {
	t.Helper()
	var n int
	if err := f.pool.QueryRow(context.Background(),
		`SELECT count(*) FROM ledger_entries WHERE account_id = $1`, f.walletID).Scan(&n); err != nil {
		t.Fatalf("count wallet entries: %v", err)
	}
	return n
}

func (f *fixture) pay(t *testing.T, meter string, amountKobo int64, key string) (*utilitybills.PayResult, error) {
	t.Helper()
	return f.svc.PayUtility(context.Background(), f.userID, utilitybills.PayInput{
		Category:          "electricity",
		BillerID:          f.billerID,
		ProductID:         f.productID,
		CustomerReference: meter,
		AmountKobo:        &amountKobo,
		PaymentSource:     "wallet",
	}, key)
}

// ── 1 + 2: success, balanced ledger, token, commission, idempotent replay ────

func TestLiveDB_UtilityPay_SuccessAndIdempotentReplay(t *testing.T) {
	f := newFixture(t, 2 /* Tier2: ₦200k/day */, 2_000_000 /* ₦20,000 float */, true /* requires validation */)
	ctx := context.Background()

	const amountKobo = int64(500_000) // ₦5,000 bill
	// fee 10,000 + markup 0 ⇒ retail 510,000; provider cost = 500,000 - 2% = 490,000
	const wantRetail = int64(510_000)

	before := f.walletNet(t)
	key := "test-util-" + uuid.New().String()

	res, err := f.pay(t, meterSuccessPrepaid, amountKobo, key)
	if err != nil {
		t.Fatalf("pay: %v", err)
	}
	if res.AlreadyProcessed {
		t.Fatal("a first purchase must not report already_processed")
	}
	txn := res.Transaction

	if txn.Status != string(utilitybills.StatusSuccessful) {
		t.Fatalf("status = %s, want successful (failure_reason=%v)", txn.Status, deref(txn.FailureReason))
	}
	if txn.RetailAmountKobo != wantRetail {
		t.Fatalf("retail = %d, want %d", txn.RetailAmountKobo, wantRetail)
	}
	if txn.ProviderCostKobo != 490_000 {
		t.Fatalf("provider cost = %d, want 490000", txn.ProviderCostKobo)
	}
	// The vended token IS the deliverable for prepaid electricity. Dropping it
	// strands the customer with a paid-for, undeliverable purchase.
	if txn.Token == nil || *txn.Token == "" {
		t.Fatal("no token persisted on a successful prepaid electricity purchase")
	}
	if txn.ProviderReference == nil || *txn.ProviderReference == "" {
		t.Fatal("no provider reference persisted — requery would have nothing to ask about")
	}

	// Wallet moved by exactly the retail amount, once.
	if got := before - f.walletNet(t); got != wantRetail {
		t.Fatalf("wallet moved by %d, want %d", got, wantRetail)
	}

	// The debit is a BALANCED pair: one DEBIT on the wallet, one CREDIT on
	// provider-clearing, under the receipt reference.
	receipt := deref(txn.ReceiptNumber)
	if n := f.entriesForReference(t, receipt); n != 2 {
		t.Fatalf("debit posted %d ledger entries under %q, want exactly 2 (a balanced pair)", n, receipt)
	}
	var debitLegs, creditLegs int
	if err := f.pool.QueryRow(ctx, `
		SELECT
		  count(*) FILTER (WHERE account_id = $1 AND type = 'DEBIT'),
		  count(*) FILTER (WHERE account_id = $2 AND type = 'CREDIT')
		FROM ledger_entries WHERE reference = $3`,
		f.walletID, f.clearingID, receipt).Scan(&debitLegs, &creditLegs); err != nil {
		t.Fatalf("leg query: %v", err)
	}
	if debitLegs != 1 || creditLegs != 1 {
		t.Fatalf("legs: %d wallet DEBIT / %d clearing CREDIT, want 1 / 1", debitLegs, creditLegs)
	}

	// Commission: the earning row exists AND carries a ledger_ref. Recording it
	// with a null ledger_ref is exactly the gap this phase closes.
	//
	// The recorded revenue is NOT asserted to equal gross profit. When an active
	// commission_config row matches (the local database seeds one for every
	// Utility_Bills service — e.g. Electricity/Eko at 100 bps + ₦100 convenience),
	// the config-derived figure is the realized revenue and is legitimately LOWER
	// than the catalogue's gross profit. What must hold is that the earning row and
	// the ledger leg agree, and that both are positive.
	var revenueKobo int64
	var ledgerRef *string
	if err := f.pool.QueryRow(ctx, `
		SELECT spotlight_revenue_kobo, ledger_ref FROM public.commission_earnings
		WHERE source_module = 'utility' AND source_ref = $1`, txn.ID).Scan(&revenueKobo, &ledgerRef); err != nil {
		t.Fatalf("commission earning not recorded: %v", err)
	}
	if ledgerRef == nil || *ledgerRef == "" {
		t.Fatal("commission_earnings.ledger_ref is null — the revenue-recognition leg was not posted")
	}
	if revenueKobo <= 0 {
		t.Fatalf("commission revenue = %d, want > 0", revenueKobo)
	}
	if revenueKobo > txn.GrossProfitKobo {
		t.Fatalf("commission revenue %d exceeds gross profit %d — we cannot book more than we made",
			revenueKobo, txn.GrossProfitKobo)
	}
	if n := f.entriesForReference(t, *ledgerRef); n != 2 {
		t.Fatalf("commission posted %d entries under %q, want a balanced pair", n, *ledgerRef)
	}
	// Both legs of the revenue recognition carry exactly the recorded revenue.
	var legAmounts []int64
	rows, err := f.pool.Query(ctx, `SELECT amount_kobo FROM ledger_entries WHERE reference = $1`, *ledgerRef)
	if err != nil {
		t.Fatalf("commission legs: %v", err)
	}
	for rows.Next() {
		var a int64
		if err := rows.Scan(&a); err != nil {
			t.Fatalf("scan leg: %v", err)
		}
		legAmounts = append(legAmounts, a)
	}
	rows.Close()
	for _, a := range legAmounts {
		if a != revenueKobo {
			t.Fatalf("commission ledger leg %d != recorded revenue %d", a, revenueKobo)
		}
	}

	// ── 2. Idempotent replay ────────────────────────────────────────────────
	entriesBefore := f.totalWalletEntries(t)
	netBefore := f.walletNet(t)

	replay, err := f.pay(t, meterSuccessPrepaid, amountKobo, key)
	if err != nil {
		t.Fatalf("replay: %v", err)
	}
	if !replay.AlreadyProcessed {
		t.Fatal("replay must report already_processed")
	}
	if replay.Transaction.ID != txn.ID {
		t.Fatalf("replay returned a DIFFERENT transaction (%s vs %s) — a second purchase was made",
			replay.Transaction.ID, txn.ID)
	}
	if got := f.totalWalletEntries(t); got != entriesBefore {
		t.Fatalf("replay wrote %d new wallet ledger entries — the member was double-debited", got-entriesBefore)
	}
	if got := f.walletNet(t); got != netBefore {
		t.Fatalf("replay moved the wallet by %d, want 0", netBefore-got)
	}
}

// ── 3: definite provider failure → auto-reversed, NET ZERO ──────────────────

func TestLiveDB_UtilityPay_ProviderFailureAutoReverses(t *testing.T) {
	f := newFixture(t, 2, 2_000_000, false /* no validation: the failure meters must reach the purchase call */)

	before := f.walletNet(t)
	key := "test-util-fail-" + uuid.New().String()

	res, err := f.pay(t, meterFailAnomaly, 500_000, key)
	if err != nil {
		t.Fatalf("pay: %v", err)
	}
	txn := res.Transaction

	// 'reversed' is the expected landing state; 'failed' is tolerated ONLY if the
	// reversal could not be posted, which the net-effect assertion below catches.
	if txn.Status != string(utilitybills.StatusReversed) && txn.Status != string(utilitybills.StatusFailed) {
		t.Fatalf("status = %s, want reversed (or failed)", txn.Status)
	}
	if txn.Status != string(utilitybills.StatusReversed) {
		t.Fatalf("status = failed, want reversed — the auto-reverse did not complete (reason=%v)", deref(txn.FailureReason))
	}

	// THE invariant: debit + reversal cancel out. The member is never left debited
	// for a bill that definitively did not happen.
	if got := f.walletNet(t) - before; got != 0 {
		t.Fatalf("net wallet effect = %d kobo, want 0 — the member is out of pocket for a failed bill", got)
	}

	// And the reversal is itself a balanced pair.
	reversalRef := "utility:reversal:" + txn.ID
	if n := f.entriesForReference(t, reversalRef); n != 2 {
		t.Fatalf("reversal posted %d entries under %q, want a balanced pair", n, reversalRef)
	}

	// No commission on a failed/reversed transaction — we earned nothing.
	var earnings int
	if err := f.pool.QueryRow(context.Background(),
		`SELECT count(*) FROM public.commission_earnings WHERE source_module='utility' AND source_ref=$1`,
		txn.ID).Scan(&earnings); err != nil {
		t.Fatalf("commission count: %v", err)
	}
	if earnings != 0 {
		t.Fatalf("%d commission earnings recorded for a reversed transaction, want 0", earnings)
	}
}

// ── 4: pending/timeout → provider_pending, NOT reversed ────────────────────

func TestLiveDB_UtilityPay_PendingDoesNotReverse(t *testing.T) {
	f := newFixture(t, 2, 2_000_000, false /* no validation: the timeout meter must reach the purchase call */)

	before := f.walletNet(t)
	key := "test-util-pending-" + uuid.New().String()

	res, err := f.pay(t, meterTimeout, 500_000, key)
	if err != nil {
		t.Fatalf("pay: %v", err)
	}
	txn := res.Transaction

	if txn.Status != string(utilitybills.StatusProviderPending) {
		t.Fatalf("status = %s, want provider_pending — an unresolved purchase must never be called failed", txn.Status)
	}

	// The money correctly STAYS debited: VTpass may still deliver. Reversing here
	// would hand the member both the electricity and a refund.
	if got := before - f.walletNet(t); got != txn.RetailAmountKobo {
		t.Fatalf("wallet moved by %d, want %d — a pending purchase must not be reversed",
			got, txn.RetailAmountKobo)
	}
	if n := f.entriesForReference(t, "utility:reversal:"+txn.ID); n != 0 {
		t.Fatalf("a reversal was posted for a PENDING transaction (%d entries)", n)
	}

	// A pending transaction IS settled for commission purposes (the money left the
	// member and the provider accepted the request).
	var earnings int
	if err := f.pool.QueryRow(context.Background(),
		`SELECT count(*) FROM public.commission_earnings WHERE source_module='utility' AND source_ref=$1`,
		txn.ID).Scan(&earnings); err != nil {
		t.Fatalf("commission count: %v", err)
	}
	if earnings != 1 {
		t.Fatalf("%d commission earnings for a provider_pending transaction, want 1", earnings)
	}
}

// ── 5: an UNKNOWN outbound outcome blocks a retry ──────────────────────────

func TestLiveDB_BindRegistry_UnknownOutcomeBlocksRetry(t *testing.T) {
	pool := livePool(t)
	ctx := context.Background()
	reg := utilitybills.NewBindRegistry(pool)
	key := "test-bind-" + uuid.New().String()
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM public.utility_provider_bind WHERE idempotency_key=$1`, key)
	})

	claim, err := reg.Claim(ctx, key, "vtpass", "eko-electric", "prepaid", "")
	if err != nil {
		t.Fatalf("first claim: %v", err)
	}
	if !claim.Fresh {
		t.Fatal("a brand-new key must be claimed fresh")
	}

	// A second claim while in flight must be refused — not silently allowed.
	if _, err := reg.Claim(ctx, key, "vtpass", "eko-electric", "prepaid", ""); err == nil {
		t.Fatal("an in-flight key was re-claimed — a concurrent duplicate could double-purchase")
	}

	// Record the ambiguous outcome. From here the key is LOCKED for good.
	reg.Unknown(ctx, key, "context deadline exceeded")
	_, err = reg.Claim(ctx, key, "vtpass", "eko-electric", "prepaid", "")
	if err == nil {
		t.Fatal("an unknown-outcome key was re-claimed — this is the double-purchase path")
	}
	if !errors.Is(err, utilitybills.ErrBindOutcomeUnknown) {
		t.Fatalf("got %v, want ErrBindOutcomeUnknown", err)
	}

	n, err := reg.UnresolvedCount(ctx)
	if err != nil {
		t.Fatalf("unresolved count: %v", err)
	}
	if n < 1 {
		t.Fatal("the unknown bind is not visible in the reconciliation backlog")
	}

	// A REFUSED outcome, by contrast, re-arms the key: nothing was created, so a
	// retry (or a failover to the next provider) is safe.
	otherKey := "test-bind-failed-" + uuid.New().String()
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM public.utility_provider_bind WHERE idempotency_key=$1`, otherKey)
	})
	if _, err := reg.Claim(ctx, otherKey, "vtpass", "eko-electric", "prepaid", ""); err != nil {
		t.Fatalf("claim: %v", err)
	}
	reg.Failed(ctx, otherKey, "provider rejected")
	again, err := reg.Claim(ctx, otherKey, "vtpass", "eko-electric", "prepaid", "")
	if err != nil {
		t.Fatalf("re-claim after a definite refusal should succeed: %v", err)
	}
	if !again.Fresh || again.Attempts != 2 {
		t.Fatalf("re-armed claim = %+v, want Fresh with Attempts=2", again)
	}
}

// ── 6: the wallet tier daily limit still fires ─────────────────────────────

func TestLiveDB_UtilityPay_WalletDailyLimitStillFires(t *testing.T) {
	// Tier 1 caps daily wallet debits at ₦50,000 (5,000,000 kobo). Fund well above
	// that so the refusal can only come from the LIMIT, never from the balance.
	f := newFixture(t, 1, 20_000_000, true)

	before := f.walletNet(t)
	// Retail = 5,000,000 + 10,000 fee = 5,010,000 kobo, just over the Tier-1 cap.
	_, err := f.pay(t, meterSuccessPrepaid, 5_000_000, "test-util-limit-"+uuid.New().String())
	if err == nil {
		t.Fatal("a purchase over the Tier-1 daily wallet limit was allowed")
	}
	if !containsAny(err.Error(), "daily debit limit", "daily limit") {
		t.Fatalf("got %v, want the tier daily-limit refusal", err)
	}
	if got := f.walletNet(t); got != before {
		t.Fatalf("wallet moved by %d on a refused purchase, want 0", before-got)
	}

	// And the same amount under the cap goes through, proving the refusal was the
	// limit and not something incidental about the fixture.
	if _, err := f.pay(t, meterSuccessPrepaid, 1_000_000, "test-util-limit-ok-"+uuid.New().String()); err != nil {
		t.Fatalf("a purchase inside the Tier-1 limit was refused: %v", err)
	}
}

// ── helpers ────────────────────────────────────────────────────────────────

func deref(s *string) string {
	if s == nil {
		return "<nil>"
	}
	return *s
}

func containsAny(haystack string, needles ...string) bool {
	for _, n := range needles {
		if n != "" && strings.Contains(haystack, n) {
			return true
		}
	}
	return false
}
