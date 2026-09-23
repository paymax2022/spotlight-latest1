package restaurant

// ---------------------------------------------------------------------------
// LIVE-DB integration tests for FOOD-005: the merchant/rider WITHDRAWAL money
// path (withdrawal.go RequestWithdrawal / MarkWithdrawalPaid / MarkWithdrawalFailed)
// had zero test coverage — the service existed but was never exercised end to
// end, and (separately, fixed alongside this) was never reachable via any route.
//
// What these tests pin:
//
//  1. RequestWithdrawal reserves funds: a balanced ledger DEBIT wallet / CREDIT
//     suspense pair posts, the wallet balance drops by the withdrawn amount, and
//     a `processing` restaurant_withdrawals row is created.
//  2. A withdrawal larger than the real available wallet balance is refused
//     (ledger.ErrInsufficientFunds) — proving withdrawal.go's own balance check,
//     not a bolt-on validator (the task explicitly asked NOT to add new logic
//     beyond what the existing service enforces; this only asserts it).
//  3. A replay of the same Idempotency-Key is a safe no-op: exactly one reserve
//     posts, and the second call returns the same row with AlreadyProcessed=true.
//  4. MarkWithdrawalPaid settles the reserve: a second balanced leg (suspense →
//     provider_clearing) posts, the row flips to `paid`, and the wallet is NOT
//     touched again (its balance stays at the post-reserve level).
//  5. MarkWithdrawalFailed on an independent withdrawal reverses the reserve: the
//     wallet balance is restored to its PRE-withdrawal level and the row flips to
//     `reversed`.
//  6. AdminListWithdrawals (unscoped by owner) finds a withdrawal that
//     ListWithdrawals (owner-scoped) would also find for its own caller — and a
//     status filter narrows correctly; an invalid filter value errors rather than
//     silently matching nothing.
//  7. RequestWithdrawal refuses outright while FEATURE_RESTAURANT_WITHDRAWALS_ENABLED
//     is off (WithWithdrawals(false)/unset) — the whole point of the flag.
//
// Skipped unless TEST_DATABASE_URL is set.
// ---------------------------------------------------------------------------

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/settlement"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/testsupport"
)

func withdrawalPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping withdrawal live-DB tests")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping: %v", err)
	}
	return pool
}

// withdrawalFixture seeds a funded merchant with a saved bank account and returns
// a withdrawals-enabled service, the ledger, the merchant id and their bank
// account id.
func withdrawalFixture(t *testing.T, ctx context.Context, pool *pgxpool.Pool, fundKobo int64) (*Service, *ledger.Service, string, string) {
	t.Helper()
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	svc := NewService(pool, settlement.NewService(pool, led)).
		WithLedger(led).
		WithTiers(tiers.NewService(pool)).
		WithWithdrawals(true)

	merchant := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, merchant, merchant+"@seed.test"); err != nil {
		t.Fatalf("seed merchant: %v", err)
	}
	testsupport.CleanupUser(t, pool, merchant)
	// Tier 3 is unlimited — these tests are about the withdrawal reserve/settle
	// mechanics, not the tier cap (that is covered separately, e.g. tierlimit_live_db_test.go).
	seedKYCTier(t, ctx, pool, merchant, 3)

	if fundKobo > 0 {
		revAcc, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
		if err != nil {
			t.Fatalf("standing acct: %v", err)
		}
		if err := led.Credit(ctx, merchant, "seed-fund", "withdrawfund-"+merchant, revAcc.ID, fundKobo); err != nil {
			t.Fatalf("fund merchant: %v", err)
		}
	}

	bank, err := svc.AddBankAccount(ctx, merchant, AddBankAccountRequest{
		BankName: "Test Bank", BankCode: "999", AccountNumber: "0123456789", AccountName: "Merchant Test",
	})
	if err != nil {
		t.Fatalf("add bank account: %v", err)
	}
	return svc, led, merchant, bank.ID
}

// reserveLegs counts the ledger entries posted for a withdrawal's reserve leg —
// mirrors escrowLegs in tierlimit_live_db_test.go.
func reserveLegs(t *testing.T, ctx context.Context, pool *pgxpool.Pool, idemKey string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM ledger_entries WHERE idempotency_key LIKE $1`, idemKey+":%").Scan(&n); err != nil {
		t.Fatalf("count withdrawal ledger entries: %v", err)
	}
	return n
}

func TestRequestWithdrawal_ReservesBalancedLegAndDebitsWallet(t *testing.T) {
	pool := withdrawalPool(t)
	defer pool.Close()
	ctx := context.Background()

	svc, led, merchant, bankID := withdrawalFixture(t, ctx, pool, 1_000_00) // ₦1,000
	before, err := led.GetBalance(ctx, merchant)
	if err != nil {
		t.Fatalf("balance before: %v", err)
	}

	idem := "wd-reserve-" + uuid.New().String()
	w, err := svc.RequestWithdrawal(ctx, merchant, RequestWithdrawalInput{
		AmountKobo: 40_000, BankAccountID: bankID, IdempotencyKey: idem,
	})
	if err != nil {
		t.Fatalf("RequestWithdrawal: %v", err)
	}
	if w.Status != WithdrawalStatusProcessing {
		t.Errorf("status = %q, want processing", w.Status)
	}
	if w.AlreadyProcessed {
		t.Error("fresh reserve reported AlreadyProcessed=true")
	}
	if n := reserveLegs(t, ctx, pool, idem); n != 2 {
		t.Errorf("%d ledger legs posted for the reserve, want 2 (balanced debit/credit)", n)
	}
	after, err := led.GetBalance(ctx, merchant)
	if err != nil {
		t.Fatalf("balance after: %v", err)
	}
	if want := before - 40_000; after != want {
		t.Errorf("wallet balance = %d, want %d (reserved 40000 out of %d)", after, want, before)
	}
}

func TestRequestWithdrawal_InsufficientFundsRefusesAndMovesNothing(t *testing.T) {
	pool := withdrawalPool(t)
	defer pool.Close()
	ctx := context.Background()

	svc, led, merchant, bankID := withdrawalFixture(t, ctx, pool, 10_000) // ₦100
	before, err := led.GetBalance(ctx, merchant)
	if err != nil {
		t.Fatalf("balance before: %v", err)
	}

	idem := "wd-insuff-" + uuid.New().String()
	_, err = svc.RequestWithdrawal(ctx, merchant, RequestWithdrawalInput{
		AmountKobo: before + 100, BankAccountID: bankID, IdempotencyKey: idem,
	})
	if !errors.Is(err, ledger.ErrInsufficientFunds) {
		t.Fatalf("err = %v, want ErrInsufficientFunds", err)
	}
	if n := reserveLegs(t, ctx, pool, idem); n != 0 {
		t.Errorf("%d ledger legs posted for a REFUSED withdrawal, want 0", n)
	}
	after, err := led.GetBalance(ctx, merchant)
	if err != nil {
		t.Fatalf("balance after: %v", err)
	}
	if after != before {
		t.Errorf("wallet balance moved on a refused withdrawal: %d -> %d", before, after)
	}
	var rows int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM restaurant_withdrawals WHERE idempotency_key=$1`, idem).Scan(&rows); err != nil {
		t.Fatalf("count withdrawal rows: %v", err)
	}
	if rows != 0 {
		t.Errorf("%d withdrawal rows created for a refused request, want 0", rows)
	}
}

func TestRequestWithdrawal_IdempotentReplayIsSafeNoOp(t *testing.T) {
	pool := withdrawalPool(t)
	defer pool.Close()
	ctx := context.Background()

	svc, _, merchant, bankID := withdrawalFixture(t, ctx, pool, 1_000_00)
	idem := "wd-replay-" + uuid.New().String()
	in := RequestWithdrawalInput{AmountKobo: 25_000, BankAccountID: bankID, IdempotencyKey: idem}

	first, err := svc.RequestWithdrawal(ctx, merchant, in)
	if err != nil {
		t.Fatalf("first request: %v", err)
	}
	second, err := svc.RequestWithdrawal(ctx, merchant, in)
	if err != nil {
		t.Fatalf("replay request: %v", err)
	}
	if !second.AlreadyProcessed {
		t.Error("replay did not report AlreadyProcessed=true")
	}
	if second.ID != first.ID {
		t.Errorf("replay returned a different withdrawal id: %s != %s", second.ID, first.ID)
	}
	if n := reserveLegs(t, ctx, pool, idem); n != 2 {
		t.Errorf("%d ledger legs posted across original + replay, want exactly 2 (no double-reserve)", n)
	}
}

func TestMarkWithdrawalPaid_SettlesReserveWithoutTouchingWallet(t *testing.T) {
	pool := withdrawalPool(t)
	defer pool.Close()
	ctx := context.Background()

	svc, led, merchant, bankID := withdrawalFixture(t, ctx, pool, 1_000_00)
	idem := "wd-paid-" + uuid.New().String()
	w, err := svc.RequestWithdrawal(ctx, merchant, RequestWithdrawalInput{
		AmountKobo: 50_000, BankAccountID: bankID, IdempotencyKey: idem,
	})
	if err != nil {
		t.Fatalf("RequestWithdrawal: %v", err)
	}
	afterReserve, err := led.GetBalance(ctx, merchant)
	if err != nil {
		t.Fatalf("balance after reserve: %v", err)
	}

	paid, err := svc.MarkWithdrawalPaid(ctx, w.ID, "prov-ref-123", "")
	if err != nil {
		t.Fatalf("MarkWithdrawalPaid: %v", err)
	}
	if paid.Status != WithdrawalStatusPaid {
		t.Errorf("status = %q, want paid", paid.Status)
	}
	if paid.ProviderReference == nil || *paid.ProviderReference != "prov-ref-123" {
		t.Errorf("provider_reference not stamped: %+v", paid.ProviderReference)
	}
	if n := reserveLegs(t, ctx, pool, withdrawLegKey(idem, "settle")); n != 2 {
		t.Errorf("%d settle legs posted, want 2 (balanced debit/credit pair)", n)
	}
	afterSettle, err := led.GetBalance(ctx, merchant)
	if err != nil {
		t.Fatalf("balance after settle: %v", err)
	}
	if afterSettle != afterReserve {
		t.Errorf("wallet balance changed on settle (suspense→clearing must not touch the wallet): %d -> %d", afterReserve, afterSettle)
	}

	// Idempotent replay of the webhook: second call is a no-op, not a second settle leg.
	if _, err := svc.MarkWithdrawalPaid(ctx, w.ID, "prov-ref-123", ""); err != nil {
		t.Fatalf("MarkWithdrawalPaid replay: %v", err)
	}
	if n := reserveLegs(t, ctx, pool, withdrawLegKey(idem, "settle")); n != 2 {
		t.Errorf("%d settle legs posted after a duplicate webhook, want still 2 (no re-post)", n)
	}

	// A withdrawal already paid cannot then be reversed.
	if _, err := svc.MarkWithdrawalFailed(ctx, w.ID, "too late", ""); !errors.Is(err, ErrWithdrawNotReady) {
		t.Errorf("reversing a PAID withdrawal: err = %v, want ErrWithdrawNotReady", err)
	}
}

func TestMarkWithdrawalFailed_ReversesReserveAndRestoresWallet(t *testing.T) {
	pool := withdrawalPool(t)
	defer pool.Close()
	ctx := context.Background()

	svc, led, merchant, bankID := withdrawalFixture(t, ctx, pool, 1_000_00)
	before, err := led.GetBalance(ctx, merchant)
	if err != nil {
		t.Fatalf("balance before: %v", err)
	}

	idem := "wd-failed-" + uuid.New().String()
	w, err := svc.RequestWithdrawal(ctx, merchant, RequestWithdrawalInput{
		AmountKobo: 60_000, BankAccountID: bankID, IdempotencyKey: idem,
	})
	if err != nil {
		t.Fatalf("RequestWithdrawal: %v", err)
	}

	reversed, err := svc.MarkWithdrawalFailed(ctx, w.ID, "bank rejected", "")
	if err != nil {
		t.Fatalf("MarkWithdrawalFailed: %v", err)
	}
	if reversed.Status != WithdrawalStatusReversed {
		t.Errorf("status = %q, want reversed", reversed.Status)
	}
	if reversed.FailureReason == nil || *reversed.FailureReason != "bank rejected" {
		t.Errorf("failure_reason not recorded: %+v", reversed.FailureReason)
	}
	after, err := led.GetBalance(ctx, merchant)
	if err != nil {
		t.Fatalf("balance after reversal: %v", err)
	}
	if after != before {
		t.Errorf("wallet not restored after reversal: before=%d after=%d", before, after)
	}

	// A withdrawal already reversed cannot then be paid.
	if _, err := svc.MarkWithdrawalPaid(ctx, w.ID, "", ""); !errors.Is(err, ErrWithdrawNotReady) {
		t.Errorf("paying a REVERSED withdrawal: err = %v, want ErrWithdrawNotReady", err)
	}
}

func TestAdminListWithdrawals_UnscopedAndFilterable(t *testing.T) {
	pool := withdrawalPool(t)
	defer pool.Close()
	ctx := context.Background()

	svc, _, merchant, bankID := withdrawalFixture(t, ctx, pool, 1_000_00)
	idem := "wd-admin-" + uuid.New().String()
	w, err := svc.RequestWithdrawal(ctx, merchant, RequestWithdrawalInput{
		AmountKobo: 15_000, BankAccountID: bankID, IdempotencyKey: idem,
	})
	if err != nil {
		t.Fatalf("RequestWithdrawal: %v", err)
	}

	// Owner-scoped list (the merchant's own view) finds it.
	own, err := svc.ListWithdrawals(ctx, merchant, 50)
	if err != nil {
		t.Fatalf("ListWithdrawals: %v", err)
	}
	if !containsWithdrawalID(own, w.ID) {
		t.Errorf("owner-scoped ListWithdrawals did not find %s", w.ID)
	}

	// Unscoped admin list also finds it, with no status filter.
	all, err := svc.AdminListWithdrawals(ctx, "", 200)
	if err != nil {
		t.Fatalf("AdminListWithdrawals: %v", err)
	}
	if !containsWithdrawalID(all, w.ID) {
		t.Errorf("AdminListWithdrawals(unfiltered) did not find %s", w.ID)
	}

	// Filtered to its actual status: found.
	processing, err := svc.AdminListWithdrawals(ctx, WithdrawalStatusProcessing, 200)
	if err != nil {
		t.Fatalf("AdminListWithdrawals(processing): %v", err)
	}
	if !containsWithdrawalID(processing, w.ID) {
		t.Errorf("AdminListWithdrawals(processing) did not find %s", w.ID)
	}

	// Filtered to a status it is NOT in: not found.
	paid, err := svc.AdminListWithdrawals(ctx, WithdrawalStatusPaid, 200)
	if err != nil {
		t.Fatalf("AdminListWithdrawals(paid): %v", err)
	}
	if containsWithdrawalID(paid, w.ID) {
		t.Errorf("AdminListWithdrawals(paid) unexpectedly found a still-processing withdrawal")
	}

	// AdminGetWithdrawal is unscoped by owner — resolves regardless of caller.
	got, err := svc.AdminGetWithdrawal(ctx, w.ID)
	if err != nil {
		t.Fatalf("AdminGetWithdrawal: %v", err)
	}
	if got.ID != w.ID {
		t.Errorf("AdminGetWithdrawal returned %s, want %s", got.ID, w.ID)
	}

	// An invalid status filter errors rather than silently matching zero rows.
	if _, err := svc.AdminListWithdrawals(ctx, "not-a-real-status", 50); err == nil {
		t.Error("AdminListWithdrawals accepted an invalid status filter")
	}
}

func containsWithdrawalID(list []Withdrawal, id string) bool {
	for _, w := range list {
		if w.ID == id {
			return true
		}
	}
	return false
}

func TestRequestWithdrawal_RefusedWhenFeatureFlagOff(t *testing.T) {
	pool := withdrawalPool(t)
	defer pool.Close()
	ctx := context.Background()

	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	// Same as withdrawalFixture but WITHOUT WithWithdrawals(true) — mirrors an
	// unwired deployment (FEATURE_RESTAURANT_WITHDRAWALS_ENABLED off/unset).
	svc := NewService(pool, settlement.NewService(pool, led)).WithLedger(led).WithTiers(tiers.NewService(pool))

	merchant := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, merchant, merchant+"@seed.test"); err != nil {
		t.Fatalf("seed merchant: %v", err)
	}
	testsupport.CleanupUser(t, pool, merchant)

	_, err := svc.RequestWithdrawal(ctx, merchant, RequestWithdrawalInput{
		AmountKobo: 1_000, BankAccountID: uuid.New().String(), IdempotencyKey: "wd-flagoff-" + uuid.New().String(),
	})
	if !errors.Is(err, ErrWithdrawalsDisabled) {
		t.Fatalf("err = %v, want ErrWithdrawalsDisabled", err)
	}
}
