package edtechfees_test

// ---------------------------------------------------------------------------
// LIVE-DB integration tests for the EdTech School-Fees INVOICE money path.
//
// The invoice service (feesinvoice.NewService(pool)) talks to a concrete
// *pgxpool.Pool for every mutation (Issue, RecordPayment) and wires the REAL
// feeschedule.Service for the SF-1 lock on first issue. None of this can run
// without a migrated Postgres, so every test here is SKIPPED whenever
// TEST_DATABASE_URL is unset (same env-gate + seedUser pattern as
// backend/tests/crypto/live_db_integration_test.go and
// backend/tests/association/live_db_integration_test.go). The skip is NOT a stub:
// every step drives the real Service against real tables and asserts DB state.
//
// Invariants proven here (build-spec §4):
//   SF-2  Invoice balance is DERIVED (total_amount_minor − SUM(succeeded
//         payments)); academy_invoices has NO balance/amount_paid column and none
//         is written. Status advances draft→issued→partially_paid→paid only via
//         the guarded state machine.
//   Money-path idempotency: RecordPayment is idempotent on the globally-UNIQUE
//         idempotency_key — a replay inserts NO second academy_invoice_payments
//         row and re-advances no status.
//   SF-1  Issuing an invoice LOCKS the referenced fee schedule (locked=true).
//
// ── Bring-up note (read before running) ───────────────────────────────────
//  1. Apply migrations (supabase db reset), in particular:
//       20260815001100_academy_spine_edupay.sql       (academy_schools, academy_fee_schedules)
//       20260815001000_academy_commerce_audit.sql     (academy_commerce_audit)
//       20260918000000_academy_fees_edtech.sql         (academy_students, academy_invoices,
//                                                       academy_invoice_payments, fee-schedule lock)
//     Confirm the core tables landed:
//       psql "$TEST_DATABASE_URL" -c "\d academy_invoices"
//       psql "$TEST_DATABASE_URL" -c "\d academy_invoice_payments"
//  2. Point TEST_DATABASE_URL at a DISPOSABLE test database —
//     `supabase db reset` (local, port 54322) is the safest target:
//       export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//  3. Run:
//       cd backend && go test ./tests/edtechfees/... -run LiveDB -v
//
// Every row a test touches is created by that test with a fresh uuid.New() id and
// torn down via t.Cleanup — no shared fixtures, safe to re-run.
// ---------------------------------------------------------------------------

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	feesinvoice "spotlight/backend/internal/academy/fees/invoice"

	"spotlight/backend/internal/testsupport"
)

// TestLiveDB_Invoice_IdempotencyKeyScopedToInvoice is the ledger-auditor F1 regression:
// a globally-unique payment idempotency key belongs to exactly ONE invoice, so replaying
// it against a DIFFERENT invoice must fail closed (ErrIdempotencyKeyConflict) rather than
// pair a foreign payment with the wrong invoice's derived state.
func TestLiveDB_Invoice_IdempotencyKeyScopedToInvoice(t *testing.T) {
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)
	svc := feesinvoice.NewService(pool)
	ctx := context.Background()

	const total = int64(100_000)
	guardianID := seedUser(t, ctx, pool)
	actorID := seedUser(t, ctx, pool)
	schoolID := seedSchool(t, ctx, pool)
	studentA := seedStudent(t, ctx, pool, schoolID, guardianID)
	studentB := seedStudent(t, ctx, pool, schoolID, guardianID)

	invA, err := svc.Issue(ctx, actorID, feesinvoice.IssueInvoiceRequest{
		StudentID: studentA, FeeScheduleID: seedFeeSchedule(t, ctx, pool, schoolID, total), TotalAmountMinor: total,
	})
	if err != nil {
		t.Fatalf("Issue A: %v", err)
	}
	cleanupInvoice(t, pool, invA.ID)
	invB, err := svc.Issue(ctx, actorID, feesinvoice.IssueInvoiceRequest{
		StudentID: studentB, FeeScheduleID: seedFeeSchedule(t, ctx, pool, schoolID, total), TotalAmountMinor: total,
	})
	if err != nil {
		t.Fatalf("Issue B: %v", err)
	}
	cleanupInvoice(t, pool, invB.ID)

	// Record a payment on invoice A with a key.
	key := newIdemKey(t, "cross-invoice")
	if _, err := svc.RecordPayment(ctx, actorID, invA.ID, guardianID, 40_000, "", "", key); err != nil {
		t.Fatalf("RecordPayment A: %v", err)
	}
	// The SAME key against invoice B must be rejected (not silently return A's payment).
	if _, err := svc.RecordPayment(ctx, actorID, invB.ID, guardianID, 40_000, "", "", key); !errors.Is(err, feesinvoice.ErrIdempotencyKeyConflict) {
		t.Fatalf("cross-invoice key reuse: want ErrIdempotencyKeyConflict, got %v", err)
	}
	// And replaying it against A (its rightful invoice) is still an idempotent success.
	res, err := svc.RecordPayment(ctx, actorID, invA.ID, guardianID, 40_000, "", "", key)
	if err != nil || !res.Replayed {
		t.Fatalf("same-invoice replay should be idempotent: replayed=%v err=%v", res != nil && res.Replayed, err)
	}
}

// TestLiveDB_Invoice_RejectsOverpayment proves the invoice money invariant: a payment
// that would push the derived paid amount above the invoice total is rejected with
// ErrOverpayment BEFORE any row is recorded — you cannot pay more than you owe. An
// exact-full payment (bringing balance to 0) is still accepted.
func TestLiveDB_Invoice_RejectsOverpayment(t *testing.T) {
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)
	svc := feesinvoice.NewService(pool)
	ctx := context.Background()

	const total = int64(100_000)
	guardianID := seedUser(t, ctx, pool)
	actorID := seedUser(t, ctx, pool)
	schoolID := seedSchool(t, ctx, pool)
	studentID := seedStudent(t, ctx, pool, schoolID, guardianID)
	inv, err := svc.Issue(ctx, actorID, feesinvoice.IssueInvoiceRequest{
		StudentID: studentID, FeeScheduleID: seedFeeSchedule(t, ctx, pool, schoolID, total), TotalAmountMinor: total,
	})
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	cleanupInvoice(t, pool, inv.ID)

	// Pay 60,000 → partially_paid (balance 40,000).
	if _, err := svc.RecordPayment(ctx, actorID, inv.ID, guardianID, 60_000, "", "", newIdemKey(t, "op-1")); err != nil {
		t.Fatalf("RecordPayment 60k: %v", err)
	}
	// A further 60,000 (→ 120,000 > 100,000) must be rejected as overpayment, recording NOTHING.
	if _, err := svc.RecordPayment(ctx, actorID, inv.ID, guardianID, 60_000, "", "", newIdemKey(t, "op-over")); !errors.Is(err, feesinvoice.ErrOverpayment) {
		t.Fatalf("overpayment: want ErrOverpayment, got %v", err)
	}
	// The rejected payment left the balance untouched (still 40,000 owed).
	if _, balance, derr := svc.DerivedBalance(ctx, inv.ID); derr != nil || balance != 40_000 {
		t.Fatalf("after rejected overpayment, balance=%d (err %v), want 40000", balance, derr)
	}
	// The exact remaining 40,000 IS accepted → paid, balance 0.
	res, err := svc.RecordPayment(ctx, actorID, inv.ID, guardianID, 40_000, "", "", newIdemKey(t, "op-exact"))
	if err != nil {
		t.Fatalf("exact-full payment: %v", err)
	}
	if res.Invoice.Status != "paid" || res.Invoice.Balance != 0 {
		t.Fatalf("after exact-full payment: status=%s balance=%d, want paid/0", res.Invoice.Status, res.Invoice.Balance)
	}
}

// liveDBPool connects using TEST_DATABASE_URL, or skips. Same gate
// and precedence as backend/tests/crypto + backend/tests/association.
func liveDBPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping live-DB edtech-fees integration test; see bring-up note in invoice_live_db_test.go")
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

func newIdemKey(t *testing.T, label string) string {
	t.Helper()
	return label + "-" + uuid.New().String()
}

// seedUser inserts a synthetic auth.users row so FKs (student_user_id,
// guardian_user_id, ledger wallet user_id) resolve on a fresh Supabase DB. email
// is required by the handle_new_user trigger (user_profiles.email NOT NULL) —
// identical to the crypto/association seedUser helpers.
func seedUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool) string {
	t.Helper()
	id := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT DO NOTHING`, id, id+"@seed.test"); err != nil {
		t.Fatalf("seed auth.users: %v", err)
	}
	testsupport.CleanupUser(t, pool, id)
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM auth.users WHERE id=$1`, id)
	})
	return id
}

// seedSchool inserts a minimal academy_schools row and returns its id.
func seedSchool(t *testing.T, ctx context.Context, pool *pgxpool.Pool) string {
	t.Helper()
	id := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO public.academy_schools (id, name, status) VALUES ($1,$2,'active')`, id, "Test School "+id[:8]); err != nil {
		t.Fatalf("seed academy_schools: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM public.academy_schools WHERE id=$1`, id)
	})
	return id
}

// seedStudent inserts a per-school academy_students row (the invoice's student_id
// FK) with guardianID recorded on guardian_user_ids, and returns its id. The
// uuid[] column is built in SQL (ARRAY[$3]::uuid[]) to avoid client-side array
// type-encoding ambiguity.
func seedStudent(t *testing.T, ctx context.Context, pool *pgxpool.Pool, schoolID, guardianID string) string {
	t.Helper()
	id := uuid.New().String()
	if _, err := pool.Exec(ctx, `
		INSERT INTO public.academy_students (id, school_id, guardian_user_ids, status, minor_flag)
		VALUES ($1,$2,ARRAY[$3]::uuid[],'active',true)`, id, schoolID, guardianID); err != nil {
		t.Fatalf("seed academy_students: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM public.academy_students WHERE id=$1`, id)
	})
	return id
}

// seedFeeSchedule inserts an UNLOCKED academy_fee_schedules row (the invoice's
// fee_schedule_id FK) and returns its id. locked defaults false so we can assert
// it flips true on issue (SF-1).
func seedFeeSchedule(t *testing.T, ctx context.Context, pool *pgxpool.Pool, schoolID string, amountMinor int64) string {
	t.Helper()
	id := uuid.New().String()
	if _, err := pool.Exec(ctx, `
		INSERT INTO public.academy_fee_schedules (id, school_id, name, amount_minor, currency, status)
		VALUES ($1,$2,$3,$4,'NGN','active')`, id, schoolID, "Term 1 Fees", amountMinor); err != nil {
		t.Fatalf("seed academy_fee_schedules: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM public.academy_fee_schedules WHERE id=$1`, id)
	})
	return id
}

// cleanupInvoice removes an invoice and its payment rows after the test.
func cleanupInvoice(t *testing.T, pool *pgxpool.Pool, invoiceID string) {
	t.Cleanup(func() {
		ctx := context.Background()
		_, _ = pool.Exec(ctx, `DELETE FROM public.academy_invoice_payments WHERE invoice_id=$1`, invoiceID)
		_, _ = pool.Exec(ctx, `DELETE FROM public.academy_invoices WHERE id=$1`, invoiceID)
	})
}

// ---------------------------------------------------------------------------
// Issue → SF-1 lock; RecordPayment partial → paid; derived balance (SF-2);
// idempotent replay.
// ---------------------------------------------------------------------------

// TestLiveDB_Invoice_IssueLocksSchedule_PartialThenFull_DerivedBalance_Idempotent
// drives the full invoice money path end-to-end and proves:
//
//	(a) issuing an invoice against a fee schedule LOCKS that schedule (SF-1);
//	(b) a 40,000-kobo partial payment flips status → partially_paid and the
//	    DERIVED balance is 60,000 (read straight from academy_invoice_payments —
//	    there is NO stored balance column, SF-2);
//	(c) a further 60,000-kobo payment flips → paid with balance 0;
//	(d) REPLAYING the partial payment with the SAME idempotency_key inserts NO
//	    second payment row and leaves status + derived balance unchanged.
func TestLiveDB_Invoice_IssueLocksSchedule_PartialThenFull_DerivedBalance_Idempotent(t *testing.T) {
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)
	svc := feesinvoice.NewService(pool)
	ctx := context.Background()

	const total = int64(100_000) // 100,000 kobo
	guardianID := seedUser(t, ctx, pool)
	actorID := seedUser(t, ctx, pool)
	schoolID := seedSchool(t, ctx, pool)
	studentID := seedStudent(t, ctx, pool, schoolID, guardianID)
	feeScheduleID := seedFeeSchedule(t, ctx, pool, schoolID, total)

	// ── Issue (draft → issued) ──────────────────────────────────────────────
	inv, err := svc.Issue(ctx, actorID, feesinvoice.IssueInvoiceRequest{
		StudentID:        studentID,
		FeeScheduleID:    feeScheduleID,
		TotalAmountMinor: total,
	})
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	cleanupInvoice(t, pool, inv.ID)
	if inv.Status != "issued" {
		t.Fatalf("issued invoice status = %s, want issued", inv.Status)
	}
	if inv.Balance != total {
		t.Errorf("freshly-issued derived balance = %d, want %d (no payments yet)", inv.Balance, total)
	}

	// SF-1: the referenced fee schedule must be LOCKED now.
	var locked bool
	if err := pool.QueryRow(ctx, `SELECT locked FROM public.academy_fee_schedules WHERE id=$1`, feeScheduleID).Scan(&locked); err != nil {
		t.Fatalf("read fee schedule locked: %v", err)
	}
	if !locked {
		t.Error("fee schedule was NOT locked on invoice issue — SF-1 violated")
	}

	// Structural SF-2 guard: academy_invoices carries no balance/amount_paid column.
	assertNoStoredBalanceColumn(t, ctx, pool)

	// ── Partial payment: 40,000 → partially_paid, derived balance 60,000 ─────
	const partial = int64(40_000)
	partialKey := newIdemKey(t, "inv-partial")
	res1, err := svc.RecordPayment(ctx, actorID, inv.ID, guardianID, partial, "", "", partialKey)
	if err != nil {
		t.Fatalf("RecordPayment (partial): %v", err)
	}
	if res1.Replayed {
		t.Error("first partial payment reported Replayed=true — must be a fresh insert")
	}
	if res1.Invoice.Status != "partially_paid" {
		t.Errorf("status after partial payment = %s, want partially_paid", res1.Invoice.Status)
	}

	// SF-2: balance is DERIVED from the payment rows, not a stored column.
	paid, balance, err := svc.DerivedBalance(ctx, inv.ID)
	if err != nil {
		t.Fatalf("DerivedBalance after partial: %v", err)
	}
	if paid != partial {
		t.Errorf("derived amount paid = %d, want %d", paid, partial)
	}
	if balance != total-partial {
		t.Errorf("derived balance = %d, want %d (100000 − 40000)", balance, total-partial)
	}
	// Independently confirm the derivation source is academy_invoice_payments.
	if got := sumSucceededPayments(t, ctx, pool, inv.ID); got != partial {
		t.Errorf("SUM(succeeded academy_invoice_payments) = %d, want %d", got, partial)
	}

	// ── Full payment: +60,000 → paid, derived balance 0 ─────────────────────
	const rest = int64(60_000)
	res2, err := svc.RecordPayment(ctx, actorID, inv.ID, guardianID, rest, "", "", newIdemKey(t, "inv-rest"))
	if err != nil {
		t.Fatalf("RecordPayment (rest): %v", err)
	}
	if res2.Invoice.Status != "paid" {
		t.Errorf("status after full payment = %s, want paid", res2.Invoice.Status)
	}
	if res2.Invoice.Balance != 0 {
		t.Errorf("derived balance after full payment = %d, want 0", res2.Invoice.Balance)
	}

	// ── Idempotent replay of the PARTIAL payment: no second row, no change ───
	res1b, err := svc.RecordPayment(ctx, actorID, inv.ID, guardianID, partial, "", "", partialKey)
	if err != nil {
		t.Fatalf("RecordPayment (partial replay): %v", err)
	}
	if !res1b.Replayed {
		t.Error("replay of the partial payment reported Replayed=false — idempotency signal missing")
	}
	if res1b.Payment.ID != res1.Payment.ID {
		t.Errorf("replay returned a DIFFERENT payment id: first=%s replay=%s", res1.Payment.ID, res1b.Payment.ID)
	}

	// Exactly TWO payment rows total (one partial + one rest) — the replay added none.
	if n := countPayments(t, ctx, pool, inv.ID); n != 2 {
		t.Errorf("academy_invoice_payments rows = %d, want exactly 2 (partial + rest; replay must not insert)", n)
	}
	// Status is still paid, balance still 0 — the replay changed nothing.
	var status string
	if err := pool.QueryRow(ctx, `SELECT status FROM public.academy_invoices WHERE id=$1`, inv.ID).Scan(&status); err != nil {
		t.Fatalf("read invoice status after replay: %v", err)
	}
	if status != "paid" {
		t.Errorf("invoice status after replay = %s, want paid (unchanged)", status)
	}
	if _, bal, _ := svc.DerivedBalance(ctx, inv.ID); bal != 0 {
		t.Errorf("derived balance after replay = %d, want 0 (unchanged)", bal)
	}
}

// TestLiveDB_Invoice_RecordPayment_RequiresIdempotencyKey proves the fail-closed
// money-path guard end-to-end: an empty Idempotency-Key is rejected before any
// academy_invoice_payments row is written.
func TestLiveDB_Invoice_RecordPayment_RequiresIdempotencyKey(t *testing.T) {
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)
	svc := feesinvoice.NewService(pool)
	ctx := context.Background()

	guardianID := seedUser(t, ctx, pool)
	actorID := seedUser(t, ctx, pool)
	schoolID := seedSchool(t, ctx, pool)
	studentID := seedStudent(t, ctx, pool, schoolID, guardianID)
	feeScheduleID := seedFeeSchedule(t, ctx, pool, schoolID, 50_000)

	inv, err := svc.Issue(ctx, actorID, feesinvoice.IssueInvoiceRequest{
		StudentID: studentID, FeeScheduleID: feeScheduleID, TotalAmountMinor: 50_000,
	})
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	cleanupInvoice(t, pool, inv.ID)

	if _, err := svc.RecordPayment(ctx, actorID, inv.ID, guardianID, 10_000, "", "", ""); err != feesinvoice.ErrIdempotencyRequired {
		t.Fatalf("RecordPayment with empty key: err = %v, want ErrIdempotencyRequired", err)
	}
	if n := countPayments(t, ctx, pool, inv.ID); n != 0 {
		t.Errorf("a keyless RecordPayment must write no payment row, found %d", n)
	}
}

// ── small DB assertion helpers ────────────────────────────────────────────

func countPayments(t *testing.T, ctx context.Context, pool *pgxpool.Pool, invoiceID string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM public.academy_invoice_payments WHERE invoice_id=$1`, invoiceID).Scan(&n); err != nil {
		t.Fatalf("count payments: %v", err)
	}
	return n
}

func sumSucceededPayments(t *testing.T, ctx context.Context, pool *pgxpool.Pool, invoiceID string) int64 {
	t.Helper()
	var sum int64
	if err := pool.QueryRow(ctx, `SELECT COALESCE(SUM(amount_minor),0) FROM public.academy_invoice_payments WHERE invoice_id=$1 AND status='succeeded'`, invoiceID).Scan(&sum); err != nil {
		t.Fatalf("sum payments: %v", err)
	}
	return sum
}

// assertNoStoredBalanceColumn is the STRUCTURAL SF-2 guard: academy_invoices must
// have NO balance / amount_paid column. If one is ever added, this fails loudly so
// the SF-2 discipline is reviewed rather than silently regressed.
func assertNoStoredBalanceColumn(t *testing.T, ctx context.Context, pool *pgxpool.Pool) {
	t.Helper()
	var n int
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM information_schema.columns
		WHERE table_schema='public' AND table_name='academy_invoices'
		  AND column_name IN ('balance','amount_paid','amount_paid_minor','balance_minor')`).Scan(&n); err != nil {
		t.Fatalf("inspect academy_invoices columns: %v", err)
	}
	if n != 0 {
		t.Errorf("SF-2 STRUCTURAL VIOLATION: academy_invoices has %d stored balance/amount_paid column(s); balance must be derived from academy_invoice_payments only", n)
	}
}
