package estate

// ---------------------------------------------------------------------------
// LIVE-DB UAT for the Estate module's PayDues money path (docs/qa/modules/estate.md
// ESTATE-INT-001/002, ESTATE-VAL-001/002, ESTATE-AUTHZ-004/005, ESTATE-IDEM-001,
// ESTATE-CONC-001). This is the first time PayDues has been exercised against a
// live database — every prior estate test either nil-DB-guards the money path
// (isolation_test.go, modules_test.go) or documents the isolation contract
// without a live DB (isolation_test.go's TestCrossEstateIsolationContract).
//
// Follows the pattern used by internal/restaurant/payout_double_payment_live_db_test.go
// and internal/property/context_test.go: TEST_DATABASE_URL-gated, pgxpool via
// t.Cleanup, real ledger wired via ledger.NewService(ledger.NewRepository(pool), nil),
// wallets funded through the ledger (never a direct balance UPDATE — wallet
// balances are a ledger projection, never mutated directly, per CLAUDE.md).
//
// Package `estate` (not `estate_test`) so the tests can call the unexported
// helpers (existingReceipt) directly when proving the CONC-001 fix.
//
// Run:
//
//	TEST_DATABASE_URL='postgresql://postgres:postgres@localhost:54322/postgres' \
//	  go test ./internal/estate/... -run TestLiveDB -v
// ---------------------------------------------------------------------------

import (
	"context"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/testsupport"
)

// ── pool / service wiring ─────────────────────────────────────────────────

func estateDuesTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping live-DB estate dues tests")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect test db: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping test db: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func newDuesTestService(pool *pgxpool.Pool) (*Service, *ledger.Service) {
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	svc := NewService(pool, nil).WithLedger(led).WithTiers(tiers.NewService(pool))
	return svc, led
}

// ── fixture helpers ─────────────────────────────────────────────────────────

// seedDuesUser inserts a throwaway auth.users row + a KYC tier-3 user_profiles
// row (so EnforceCheckoutDebitLimit's Tier-0 checkout-allowance branch never
// gates these tests — mirrors internal/restaurant/tierlimit_live_db_test.go's
// seedKYCTier) and registers cleanup.
func seedDuesUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool) string {
	t.Helper()
	id := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, id, id+"@seed.test"); err != nil {
		t.Fatalf("seed auth.users: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO user_profiles (id, email, kyc_tier) VALUES ($1,$2,3)
		 ON CONFLICT (id) DO UPDATE SET kyc_tier = EXCLUDED.kyc_tier`, id, id+"@seed.test"); err != nil {
		t.Fatalf("seed user_profiles kyc tier: %v", err)
	}
	testsupport.CleanupUser(t, pool, id)
	return id
}

// seedEstate creates an estate owned by adminID and makes adminID an
// estate_admin resident (assertRoles resolves membership from estate_residents
// only — estates.admin_id is just the FK owner, not itself a role grant).
func seedEstate(t *testing.T, ctx context.Context, pool *pgxpool.Pool, adminID string) string {
	t.Helper()
	estateID := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO estates (id, name, admin_id) VALUES ($1,'Dues Test Estate',$2)`, estateID, adminID); err != nil {
		t.Fatalf("seed estate: %v", err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM estates WHERE id=$1`, estateID) })
	seedResident(t, ctx, pool, estateID, adminID, "estate_admin")
	return estateID
}

func seedResident(t *testing.T, ctx context.Context, pool *pgxpool.Pool, estateID, userID, role string) {
	t.Helper()
	if _, err := pool.Exec(ctx,
		`INSERT INTO estate_residents (estate_id, user_id, unit, role) VALUES ($1,$2,'',$3)
		 ON CONFLICT (estate_id, user_id) DO UPDATE SET role=EXCLUDED.role`,
		estateID, userID, role); err != nil {
		t.Fatalf("seed estate_residents: %v", err)
	}
}

// fundWallet credits userID's wallet from the platform revenue standing
// account — the same pattern internal/restaurant's live-DB tests use to fund a
// payer, and the only sanctioned way to give a test wallet a balance (never a
// direct UPDATE of a balance column: wallet balances are ledger projections).
func fundWallet(t *testing.T, ctx context.Context, led *ledger.Service, userID string, amountKobo int64) {
	t.Helper()
	revAcc, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		t.Fatalf("standing revenue acct: %v", err)
	}
	if err := led.Credit(ctx, userID, "seed-fund", "dues-fund-"+uuid.New().String(), revAcc.ID, amountKobo); err != nil {
		t.Fatalf("fund wallet for %s: %v", userID, err)
	}
}

func walletBalance(t *testing.T, ctx context.Context, pool *pgxpool.Pool, userID string) int64 {
	t.Helper()
	var bal int64
	if err := pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(CASE WHEN e.type IN ('CREDIT','REVERSAL_CREDIT') THEN e.amount_kobo ELSE -e.amount_kobo END),0)
		FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id
		WHERE a.user_id=$1`, userID).Scan(&bal); err != nil {
		t.Fatalf("wallet balance for %s: %v", userID, err)
	}
	return bal
}

func standingBalance(t *testing.T, ctx context.Context, pool *pgxpool.Pool, accountType string) int64 {
	t.Helper()
	var bal int64
	if err := pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(CASE WHEN e.type IN ('CREDIT','REVERSAL_CREDIT') THEN e.amount_kobo ELSE -e.amount_kobo END),0)
		FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id
		WHERE a.user_id IS NULL AND a.type=$1`, accountType).Scan(&bal); err != nil {
		t.Fatalf("standing balance for %s: %v", accountType, err)
	}
	return bal
}

// seedInvoice inserts a pending dues invoice directly (CreateInvoice's own
// validation/authz is exercised elsewhere; here we just need a known,
// deterministic amount_kobo on a known resident).
func seedInvoice(t *testing.T, ctx context.Context, pool *pgxpool.Pool, estateID, residentID string, amountKobo int64, status string) string {
	t.Helper()
	if status == "" {
		status = "pending"
	}
	invID := uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO estate_dues_invoices (id, estate_id, resident_id, category, amount_kobo, due_date, status)
		 VALUES ($1,$2,$3,'service_charge',$4,NOW()+interval '7 days',$5)`,
		invID, estateID, residentID, amountKobo, status); err != nil {
		t.Fatalf("seed invoice: %v", err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM estate_dues_invoices WHERE id=$1`, invID) })
	return invID
}

func paymentCount(t *testing.T, ctx context.Context, pool *pgxpool.Pool, invoiceID string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM estate_payments WHERE invoice_id=$1 AND status='successful'`, invoiceID).Scan(&n); err != nil {
		t.Fatalf("payment count: %v", err)
	}
	return n
}

func invoiceStatus(t *testing.T, ctx context.Context, pool *pgxpool.Pool, invoiceID string) string {
	t.Helper()
	var s string
	if err := pool.QueryRow(ctx, `SELECT status FROM estate_dues_invoices WHERE id=$1`, invoiceID).Scan(&s); err != nil {
		t.Fatalf("invoice status: %v", err)
	}
	return s
}

func auditCount(t *testing.T, ctx context.Context, pool *pgxpool.Pool, estateID, subjectID, action string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM estate_audit_log WHERE estate_id=$1 AND subject_id=$2 AND action=$3`, estateID, subjectID, action).Scan(&n); err != nil {
		t.Fatalf("audit count: %v", err)
	}
	return n
}

// ── ESTATE-INT-001 / ESTATE-INT-002 ─────────────────────────────────────────

// TestLiveDB_PayDues_HappyPath_DebitsPayerCreditsSettlement_LiftsRestriction
// covers ESTATE-INT-001 (balanced DEBIT payer / CREDIT settlement, invoice ->
// paid, audit DUES_PAY) and ESTATE-INT-002 (paying dues lifts an active
// restriction) in one settlement, since INT-002's own steps are "pay the
// invoice per INT-001".
func TestLiveDB_PayDues_HappyPath_DebitsPayerCreditsSettlement_LiftsRestriction(t *testing.T) {
	pool := estateDuesTestPool(t)
	ctx := context.Background()
	svc, led := newDuesTestService(pool)

	admin := seedDuesUser(t, ctx, pool)
	resident := seedDuesUser(t, ctx, pool)
	estateID := seedEstate(t, ctx, pool, admin)
	seedResident(t, ctx, pool, estateID, resident, "resident")

	const amount int64 = 5_000_000
	fundWallet(t, ctx, led, resident, amount*2)
	invID := seedInvoice(t, ctx, pool, estateID, resident, amount, "pending")

	// ESTATE-INT-002 precondition: an active HARD restriction on the resident.
	if _, err := pool.Exec(ctx,
		`INSERT INTO estate_dues_restrictions (id, estate_id, resident_id, level, reason, active, applied_by)
		 VALUES ($1,$2,$3,'hard','defaulted',TRUE,$4)`,
		uuid.New().String(), estateID, resident, admin); err != nil {
		t.Fatalf("seed restriction: %v", err)
	}

	payerBalBefore := walletBalance(t, ctx, pool, resident)
	settleBalBefore := standingBalance(t, ctx, pool, string(ledger.AccountSettlement))

	receipt, err := svc.PayDues(ctx, estateID, resident, PayDuesRequest{
		InvoiceID:      invID,
		IdempotencyKey: "int001-" + invID,
	})
	if err != nil {
		t.Fatalf("PayDues: %v", err)
	}
	if receipt.Status != "successful" {
		t.Errorf("receipt.Status = %q, want successful", receipt.Status)
	}
	if receipt.AmountKobo != amount {
		t.Errorf("receipt.AmountKobo = %d, want %d", receipt.AmountKobo, amount)
	}

	// Invoice -> paid.
	if got := invoiceStatus(t, ctx, pool, invID); got != "paid" {
		t.Errorf("invoice status = %q, want paid", got)
	}

	// Balanced double-entry, kobo-exact.
	payerBalAfter := walletBalance(t, ctx, pool, resident)
	settleBalAfter := standingBalance(t, ctx, pool, string(ledger.AccountSettlement))
	if payerBalBefore-payerBalAfter != amount {
		t.Errorf("payer debited %d, want %d", payerBalBefore-payerBalAfter, amount)
	}
	if settleBalAfter-settleBalBefore != amount {
		t.Errorf("settlement credited %d, want %d", settleBalAfter-settleBalBefore, amount)
	}

	// Audit DUES_PAY written.
	if n := auditCount(t, ctx, pool, estateID, invID, "DUES_PAY"); n != 1 {
		t.Errorf("DUES_PAY audit rows = %d, want 1", n)
	}

	// ESTATE-INT-002: restriction lifted.
	var active bool
	var liftedAt *time.Time
	if err := pool.QueryRow(ctx,
		`SELECT active, lifted_at FROM estate_dues_restrictions WHERE estate_id=$1 AND resident_id=$2 ORDER BY created_at DESC LIMIT 1`,
		estateID, resident).Scan(&active, &liftedAt); err != nil {
		t.Fatalf("read restriction: %v", err)
	}
	if active {
		t.Error("restriction still active after PayDues — ESTATE-INT-002 not satisfied")
	}
	if liftedAt == nil {
		t.Error("restriction lifted_at not set")
	}
}

// ── ESTATE-VAL-001 ──────────────────────────────────────────────────────────

// TestLiveDB_PayDues_RejectsAmountOverride covers ESTATE-VAL-001: the server
// re-prices to the invoice's own stored amount and never trusts a client
// override that disagrees with it. A negative override is rejected with the
// exact re-pricing error. An override of exactly 0 is the documented
// "no override, use the invoice amount" sentinel (model_modules.go
// PayDuesRequest.AmountKobo doc comment: "optional override; 0 => use invoice
// amount") — so 0 must NOT error; it must settle at the invoice's own amount.
// This is deliberately asserted here rather than assumed, because the doc
// table's wording for this case is compressed enough to read as "reject 0",
// which the code correctly does not do (0 rejecting would make the field
// impossible to omit).
func TestLiveDB_PayDues_RejectsAmountOverride(t *testing.T) {
	pool := estateDuesTestPool(t)
	ctx := context.Background()
	svc, led := newDuesTestService(pool)

	admin := seedDuesUser(t, ctx, pool)
	resident := seedDuesUser(t, ctx, pool)
	estateID := seedEstate(t, ctx, pool, admin)
	seedResident(t, ctx, pool, estateID, resident, "resident")

	const amount int64 = 250_000
	fundWallet(t, ctx, led, resident, amount*3)

	t.Run("negative_override_rejected", func(t *testing.T) {
		invID := seedInvoice(t, ctx, pool, estateID, resident, amount, "pending")
		_, err := svc.PayDues(ctx, estateID, resident, PayDuesRequest{
			InvoiceID: invID, IdempotencyKey: "val001-neg-" + invID, AmountKobo: -100,
		})
		if err == nil {
			t.Fatal("expected rejection for negative amount override")
		}
		wantErr := "estate: amount must equal the invoice amount 250000 kobo"
		if err.Error() != wantErr {
			t.Errorf("error = %q, want %q", err.Error(), wantErr)
		}
		if got := invoiceStatus(t, ctx, pool, invID); got != "pending" {
			t.Errorf("invoice status = %q after rejected pay, want still pending", got)
		}
		if n := paymentCount(t, ctx, pool, invID); n != 0 {
			t.Errorf("payment rows = %d after rejected pay, want 0", n)
		}
	})

	t.Run("mismatched_positive_override_rejected", func(t *testing.T) {
		invID := seedInvoice(t, ctx, pool, estateID, resident, amount, "pending")
		_, err := svc.PayDues(ctx, estateID, resident, PayDuesRequest{
			InvoiceID: invID, IdempotencyKey: "val001-mismatch-" + invID, AmountKobo: amount + 1,
		})
		if err == nil {
			t.Fatal("expected rejection for a mismatched override")
		}
		if n := paymentCount(t, ctx, pool, invID); n != 0 {
			t.Errorf("payment rows = %d after rejected pay, want 0", n)
		}
	})

	t.Run("zero_override_is_no_override_and_succeeds", func(t *testing.T) {
		invID := seedInvoice(t, ctx, pool, estateID, resident, amount, "pending")
		receipt, err := svc.PayDues(ctx, estateID, resident, PayDuesRequest{
			InvoiceID: invID, IdempotencyKey: "val001-zero-" + invID, AmountKobo: 0,
		})
		if err != nil {
			t.Fatalf("PayDues with AmountKobo=0 (no override) should succeed at the invoice amount: %v", err)
		}
		if receipt.AmountKobo != amount {
			t.Errorf("receipt.AmountKobo = %d, want invoice amount %d", receipt.AmountKobo, amount)
		}
	})

	// CreateInvoice's own validation independently rejects non-positive amounts
	// (service_dues.go:55-57) — confirms the OTHER half of VAL-001's row.
	t.Run("create_invoice_rejects_non_positive", func(t *testing.T) {
		for _, amt := range []int64{0, -100} {
			_, err := svc.CreateInvoice(ctx, estateID, admin, CreateInvoiceRequest{
				ResidentID: resident, Category: "service_charge", AmountKobo: amt, DueDate: time.Now().Add(24 * time.Hour),
			})
			if err == nil {
				t.Errorf("CreateInvoice(amount=%d) should be rejected", amt)
			}
		}
	})
}

// ── ESTATE-VAL-002 ──────────────────────────────────────────────────────────

func TestLiveDB_PayDues_RejectsWaivedInvoice(t *testing.T) {
	pool := estateDuesTestPool(t)
	ctx := context.Background()
	svc, led := newDuesTestService(pool)

	admin := seedDuesUser(t, ctx, pool)
	resident := seedDuesUser(t, ctx, pool)
	estateID := seedEstate(t, ctx, pool, admin)
	seedResident(t, ctx, pool, estateID, resident, "resident")
	fundWallet(t, ctx, led, resident, 1_000_000)

	invID := seedInvoice(t, ctx, pool, estateID, resident, 250_000, "waived")

	_, err := svc.PayDues(ctx, estateID, resident, PayDuesRequest{
		InvoiceID: invID, IdempotencyKey: "val002-" + invID,
	})
	if err == nil {
		t.Fatal("expected rejection paying a waived invoice")
	}
	wantErr := "estate: invoice has been waived"
	if err.Error() != wantErr {
		t.Errorf("error = %q, want %q", err.Error(), wantErr)
	}
	if n := paymentCount(t, ctx, pool, invID); n != 0 {
		t.Errorf("payment rows = %d after rejected pay, want 0 (no ledger posting)", n)
	}
}

// ── ESTATE-AUTHZ-004 (same-estate IDOR) ─────────────────────────────────────

func TestLiveDB_PayDues_RejectsPayingAnotherResidentsInvoice(t *testing.T) {
	pool := estateDuesTestPool(t)
	ctx := context.Background()
	svc, led := newDuesTestService(pool)

	admin := seedDuesUser(t, ctx, pool)
	residentX := seedDuesUser(t, ctx, pool)
	residentY := seedDuesUser(t, ctx, pool)
	estateID := seedEstate(t, ctx, pool, admin)
	seedResident(t, ctx, pool, estateID, residentX, "resident")
	seedResident(t, ctx, pool, estateID, residentY, "resident")
	fundWallet(t, ctx, led, residentX, 1_000_000)

	invY := seedInvoice(t, ctx, pool, estateID, residentY, 250_000, "pending")

	_, err := svc.PayDues(ctx, estateID, residentX, PayDuesRequest{
		InvoiceID: invY, IdempotencyKey: "authz004-" + invY,
	})
	if err == nil {
		t.Fatal("expected rejection: resident X must not pay resident Y's invoice")
	}
	wantErr := "estate: cannot pay another resident's invoice"
	if err.Error() != wantErr {
		t.Errorf("error = %q, want %q", err.Error(), wantErr)
	}
	if n := paymentCount(t, ctx, pool, invY); n != 0 {
		t.Errorf("payment rows = %d, want 0 (no ledger posting)", n)
	}
	if got := invoiceStatus(t, ctx, pool, invY); got != "pending" {
		t.Errorf("invoice status = %q, want still pending", got)
	}
}

// ── ESTATE-AUTHZ-005 (cross-estate IDOR) ────────────────────────────────────

func TestLiveDB_PayDues_RejectsCrossEstateInvoice(t *testing.T) {
	pool := estateDuesTestPool(t)
	ctx := context.Background()
	svc, led := newDuesTestService(pool)

	adminA := seedDuesUser(t, ctx, pool)
	adminB := seedDuesUser(t, ctx, pool)
	residentA := seedDuesUser(t, ctx, pool)
	residentB := seedDuesUser(t, ctx, pool)
	estateA := seedEstate(t, ctx, pool, adminA)
	estateB := seedEstate(t, ctx, pool, adminB)
	seedResident(t, ctx, pool, estateA, residentA, "resident")
	seedResident(t, ctx, pool, estateB, residentB, "resident")
	fundWallet(t, ctx, led, residentA, 1_000_000)

	invB := seedInvoice(t, ctx, pool, estateB, residentB, 250_000, "pending")

	// residentA, scoped to estateA's URL, tries to pay estate-B's invoice id.
	_, err := svc.PayDues(ctx, estateA, residentA, PayDuesRequest{
		InvoiceID: invB, IdempotencyKey: "authz005-" + invB,
	})
	if err == nil {
		t.Fatal("expected rejection: estate-A caller must not settle an estate-B invoice by id-guessing")
	}
	wantErr := "estate: invoice not found in this estate"
	if err.Error() != wantErr {
		t.Errorf("error = %q, want %q", err.Error(), wantErr)
	}
	if n := paymentCount(t, ctx, pool, invB); n != 0 {
		t.Errorf("payment rows = %d, want 0", n)
	}
	if got := invoiceStatus(t, ctx, pool, invB); got != "pending" {
		t.Errorf("estate-B invoice status = %q, want still pending (untouched by the estate-A caller)", got)
	}
}

// ── ESTATE-IDEM-001 ──────────────────────────────────────────────────────────

func TestLiveDB_PayDues_IdempotentReplayReturnsCanonicalReceipt(t *testing.T) {
	pool := estateDuesTestPool(t)
	ctx := context.Background()
	svc, led := newDuesTestService(pool)

	admin := seedDuesUser(t, ctx, pool)
	resident := seedDuesUser(t, ctx, pool)
	estateID := seedEstate(t, ctx, pool, admin)
	seedResident(t, ctx, pool, estateID, resident, "resident")

	const amount int64 = 250_000
	fundWallet(t, ctx, led, resident, amount*2)
	invID := seedInvoice(t, ctx, pool, estateID, resident, amount, "pending")

	key := "idem001-" + invID
	settleBefore := standingBalance(t, ctx, pool, string(ledger.AccountSettlement))

	first, err := svc.PayDues(ctx, estateID, resident, PayDuesRequest{InvoiceID: invID, IdempotencyKey: key})
	if err != nil {
		t.Fatalf("first PayDues: %v", err)
	}

	second, err := svc.PayDues(ctx, estateID, resident, PayDuesRequest{InvoiceID: invID, IdempotencyKey: key})
	if err != nil {
		t.Fatalf("replay PayDues: %v", err)
	}

	if second.ID != first.ID {
		t.Errorf("replay receipt ID = %s, want the canonical receipt ID %s", second.ID, first.ID)
	}
	if second.AmountKobo != first.AmountKobo {
		t.Errorf("replay AmountKobo = %d, want %d", second.AmountKobo, first.AmountKobo)
	}

	if n := paymentCount(t, ctx, pool, invID); n != 1 {
		t.Errorf("estate_payments rows for invoice = %d, want exactly 1", n)
	}

	settleAfter := standingBalance(t, ctx, pool, string(ledger.AccountSettlement))
	if settleAfter-settleBefore != amount {
		t.Errorf("settlement credited %d across both calls, want exactly %d once (no second ledger entry)", settleAfter-settleBefore, amount)
	}
}

// ── ESTATE-CONC-001 ──────────────────────────────────────────────────────────

// TestLiveDB_PayDues_ConcurrentSameKeySettlesExactlyOnce fires two GENUINELY
// concurrent PayDues calls (real goroutines + sync.WaitGroup, not sequential
// calls dressed up as concurrent) with the SAME Idempotency-Key against the
// SAME pending invoice, and proves the settlement posts exactly once.
//
// This uncovered a real bug (see the regression-guard proof in the task
// report): before the fix, a caller that lost the race — its
// `INSERT INTO estate_payments ... ON CONFLICT (idempotency_key) DO NOTHING`
// affected 0 rows because the other goroutine's insert had already committed —
// fell through to update the (already-updated) invoice, lift the (already-
// lifted) restriction, write a SECOND DUES_PAY audit row, and return a
// LOCALLY-CONSTRUCTED DuesPayment struct carrying a freshly generated UUID
// that was never persisted — a phantom receipt ID with no matching
// estate_payments row. The fix mirrors vendor.go's RequestPayout: check
// RowsAffected() on the payment insert and, on a lost race, return the
// canonical persisted receipt instead.
func TestLiveDB_PayDues_ConcurrentSameKeySettlesExactlyOnce(t *testing.T) {
	pool := estateDuesTestPool(t)
	ctx := context.Background()
	svc, led := newDuesTestService(pool)

	admin := seedDuesUser(t, ctx, pool)
	resident := seedDuesUser(t, ctx, pool)
	estateID := seedEstate(t, ctx, pool, admin)
	seedResident(t, ctx, pool, estateID, resident, "resident")

	const amount int64 = 500_000
	fundWallet(t, ctx, led, resident, amount*2)
	invID := seedInvoice(t, ctx, pool, estateID, resident, amount, "pending")

	key := "conc001-" + invID
	settleBefore := standingBalance(t, ctx, pool, string(ledger.AccountSettlement))

	const n = 2
	var wg sync.WaitGroup
	results := make([]*DuesPayment, n)
	errs := make([]error, n)
	wg.Add(n)
	for i := 0; i < n; i++ {
		go func(i int) {
			defer wg.Done()
			results[i], errs[i] = svc.PayDues(ctx, estateID, resident, PayDuesRequest{
				InvoiceID: invID, IdempotencyKey: key,
			})
		}(i)
	}
	wg.Wait()

	var successIDs []string
	for i := 0; i < n; i++ {
		if errs[i] == nil {
			successIDs = append(successIDs, results[i].ID)
		}
	}
	if len(successIDs) == 0 {
		t.Fatalf("both concurrent calls failed: %v, %v", errs[0], errs[1])
	}

	// Exactly one real settlement: one estate_payments row, settlement credited
	// exactly once. This is the money-safety invariant and held even before the
	// fix (the ledger's own idempotency_key uniqueness enforces it).
	if got := paymentCount(t, ctx, pool, invID); got != 1 {
		t.Fatalf("estate_payments rows = %d, want exactly 1", got)
	}
	settleAfter := standingBalance(t, ctx, pool, string(ledger.AccountSettlement))
	if settleAfter-settleBefore != amount {
		t.Fatalf("settlement credited %d across both concurrent calls, want exactly %d once", settleAfter-settleBefore, amount)
	}

	// Every successful caller must receive the SAME canonical receipt ID — the
	// specific bug this test guards against (a phantom, unpersisted receipt ID
	// returned to the race loser).
	canonicalID := successIDs[0]
	for _, id := range successIDs {
		if id != canonicalID {
			t.Errorf("concurrent callers received DIFFERENT receipt IDs (%v) — a losing caller returned a phantom receipt not backed by the persisted estate_payments row", successIDs)
			break
		}
	}
	var dbID string
	if err := pool.QueryRow(ctx, `SELECT id FROM estate_payments WHERE invoice_id=$1 AND status='successful'`, invID).Scan(&dbID); err != nil {
		t.Fatalf("read persisted receipt: %v", err)
	}
	if canonicalID != dbID {
		t.Errorf("returned receipt ID %s does not match the persisted estate_payments row id %s", canonicalID, dbID)
	}

	// No duplicate audit trail from the losing goroutine.
	if got := auditCount(t, ctx, pool, estateID, invID, "DUES_PAY"); got != 1 {
		t.Errorf("DUES_PAY audit rows = %d, want exactly 1 (race loser must not write a second audit entry)", got)
	}
}
