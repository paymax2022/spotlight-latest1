package feesinvoice

import (
	"context"
	"errors"
	"testing"
	"time"

	feesfeeschedule "spotlight/backend/internal/academy/fees/feeschedule"
	feesstatemachine "spotlight/backend/internal/academy/fees/statemachine"
)

// PURE tests — no DB. The pgx Repository is replaced by an in-memory fakeStore and the
// fee-schedule locker by a fakeLocker, mirroring feeschedule_test.go / edupay_test.go.
//
// GREP-PROOF SF-2: the fakeStore below stores payment ROWS only and computes the balance by
// SUMMING succeeded rows in SumSucceededPayments — there is NO balance/amount_paid field on
// the stored invoice and NO Set-balance method anywhere. The Store interface (repository.go)
// likewise has no balance-setter. Balance is therefore structurally derived-only.

// ── fakes ─────────────────────────────────────────────────────────────────────

type fakeStore struct {
	invoices map[string]*Invoice
	payments map[string]*Payment // idempotency_key → payment
	seq      int
}

func newFakeStore() *fakeStore {
	return &fakeStore{invoices: map[string]*Invoice{}, payments: map[string]*Payment{}}
}

func (f *fakeStore) InsertInvoice(_ context.Context, inv Invoice, dueDate *time.Time) (*Invoice, error) {
	f.seq++
	inv.ID = "inv-" + itoa(f.seq)
	if inv.Status == "" {
		inv.Status = feesstatemachine.InvoiceDraft
	}
	inv.DueDate = dueDate
	inv.CreatedAt = time.Now()
	// Note: no balance/amount_paid stored — those are derived at read time.
	inv.AmountPaidMinor = 0
	inv.Balance = 0
	cp := inv
	f.invoices[inv.ID] = &cp
	return copyInvoice(&cp), nil
}

func (f *fakeStore) GetInvoice(_ context.Context, id string) (*Invoice, error) {
	inv, ok := f.invoices[id]
	if !ok {
		return nil, ErrNotFound
	}
	return copyInvoice(inv), nil
}

func (f *fakeStore) ListInvoicesByStudent(_ context.Context, studentID string) ([]Invoice, error) {
	out := []Invoice{}
	for _, inv := range f.invoices {
		if inv.StudentID == studentID {
			out = append(out, *copyInvoice(inv))
		}
	}
	return out, nil
}

func (f *fakeStore) SetInvoiceStatus(_ context.Context, id string, from, to feesstatemachine.InvoiceState, setIssuedAt bool) (*Invoice, error) {
	inv, ok := f.invoices[id]
	if !ok {
		return nil, ErrNotFound
	}
	if inv.Status != from {
		return nil, ErrIllegalTransition // guarded (WHERE status=$from)
	}
	inv.Status = to
	if setIssuedAt {
		now := time.Now()
		inv.IssuedAt = &now
	}
	return copyInvoice(inv), nil
}

func (f *fakeStore) AppendPayment(_ context.Context, p Payment) (*Payment, bool, error) {
	if ex, ok := f.payments[p.IdempotencyKey]; ok {
		// Idempotent replay: return the existing row, never a second insert.
		cp := *ex
		return &cp, false, nil
	}
	f.seq++
	p.ID = "pay-" + itoa(f.seq)
	if p.Status == "" {
		p.Status = PaymentSucceeded
	}
	p.CreatedAt = time.Now()
	cp := p
	f.payments[p.IdempotencyKey] = &cp
	out := cp
	return &out, true, nil
}

func (f *fakeStore) GetPaymentByIdempotencyKey(_ context.Context, key string) (*Payment, error) {
	p, ok := f.payments[key]
	if !ok {
		return nil, ErrNotFound
	}
	cp := *p
	return &cp, nil
}

// SumSucceededPayments is the SF-2 derived amount_paid — SUM over the append-only rows.
func (f *fakeStore) SumSucceededPayments(_ context.Context, invoiceID string) (int64, error) {
	var sum int64
	for _, p := range f.payments {
		if p.InvoiceID == invoiceID && p.Status == PaymentSucceeded {
			sum += p.AmountMinor
		}
	}
	return sum, nil
}

func (f *fakeStore) ListPayments(_ context.Context, invoiceID string) ([]Payment, error) {
	out := []Payment{}
	for _, p := range f.payments {
		if p.InvoiceID == invoiceID {
			out = append(out, *p)
		}
	}
	return out, nil
}

func (f *fakeStore) WriteAudit(_ context.Context, _, _, _, _, _ string, _ any) error { return nil }

func copyInvoice(inv *Invoice) *Invoice {
	cp := *inv
	return &cp
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[i:])
}

// fakeLocker records whether Lock was called and for which schedule (SF-1 interplay).
type fakeLocker struct {
	lockedIDs map[string]bool
	calls     int
}

func newFakeLocker() *fakeLocker { return &fakeLocker{lockedIDs: map[string]bool{}} }

func (f *fakeLocker) Lock(_ context.Context, _ /*actorID*/, id string) (*feesfeeschedule.FeeSchedule, error) {
	f.calls++
	f.lockedIDs[id] = true
	return &feesfeeschedule.FeeSchedule{ID: id, Locked: true}, nil
}

// fakeFeeReader returns a fixed amount for any schedule (price source of truth).
type fakeFeeReader struct{ amount int64 }

func (f *fakeFeeReader) Get(_ context.Context, id string) (*feesfeeschedule.FeeSchedule, error) {
	return &feesfeeschedule.FeeSchedule{ID: id, AmountMinor: f.amount}, nil
}

func newService(store Store, locker feeScheduleLocker) *Service {
	return NewServiceWithDeps(store, locker, &fakeFeeReader{amount: 100000})
}

// ── SF-1 interplay: issuing an invoice locks its fee schedule ─────────────────────

func TestSF1_IssueLocksFeeSchedule(t *testing.T) {
	f := newFakeStore()
	locker := newFakeLocker()
	svc := newService(f, locker)
	ctx := context.Background()

	inv, err := svc.Issue(ctx, "bursar-1", IssueInvoiceRequest{
		StudentID: "stu-1", FeeScheduleID: "fee-1", TotalAmountMinor: 100000,
	})
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	if inv.Status != feesstatemachine.InvoiceIssued {
		t.Fatalf("invoice must be issued, got %s", inv.Status)
	}
	// SF-1: the service MUST have locked the referenced fee schedule.
	if locker.calls == 0 {
		t.Fatal("SF-1: issuing an invoice must lock the fee schedule (Lock never called)")
	}
	if !locker.lockedIDs["fee-1"] {
		t.Fatal("SF-1: the correct fee schedule (fee-1) must be locked")
	}
}

// ── SF-2: balance is DERIVED from payment rows across a two-payment progression ───

func TestSF2_DerivedBalanceProgression(t *testing.T) {
	f := newFakeStore()
	svc := newService(f, newFakeLocker())
	ctx := context.Background()

	inv, err := svc.Issue(ctx, "bursar-1", IssueInvoiceRequest{
		StudentID: "stu-1", FeeScheduleID: "fee-1", TotalAmountMinor: 100000,
	})
	if err != nil {
		t.Fatalf("issue: %v", err)
	}

	// Freshly issued: derived balance = full total, nothing paid.
	if inv.AmountPaidMinor != 0 || inv.Balance != 100000 {
		t.Fatalf("issued invoice: paid=%d balance=%d, want 0/100000", inv.AmountPaidMinor, inv.Balance)
	}

	// Append 40000 → partially_paid, derived balance 60000.
	res, err := svc.RecordPayment(ctx, "guardian-1", inv.ID, "guardian-1", 40000, "", "", "idem-A")
	if err != nil {
		t.Fatalf("first payment: %v", err)
	}
	if res.Invoice.Status != feesstatemachine.InvoicePartiallyPaid {
		t.Fatalf("after 40000: status=%s, want partially_paid", res.Invoice.Status)
	}
	if res.Invoice.AmountPaidMinor != 40000 || res.Invoice.Balance != 60000 {
		t.Fatalf("after 40000: paid=%d balance=%d, want 40000/60000", res.Invoice.AmountPaidMinor, res.Invoice.Balance)
	}

	// Append 60000 → paid, derived balance 0.
	res2, err := svc.RecordPayment(ctx, "guardian-1", inv.ID, "guardian-1", 60000, "", "", "idem-B")
	if err != nil {
		t.Fatalf("second payment: %v", err)
	}
	if res2.Invoice.Status != feesstatemachine.InvoicePaid {
		t.Fatalf("after 100000 total: status=%s, want paid", res2.Invoice.Status)
	}
	if res2.Invoice.AmountPaidMinor != 100000 || res2.Invoice.Balance != 0 {
		t.Fatalf("after 100000 total: paid=%d balance=%d, want 100000/0", res2.Invoice.AmountPaidMinor, res2.Invoice.Balance)
	}

	// Cross-check the standalone derived-balance computation.
	paid, bal, err := svc.DerivedBalance(ctx, inv.ID)
	if err != nil {
		t.Fatalf("derived balance: %v", err)
	}
	if paid != 100000 || bal != 0 {
		t.Fatalf("DerivedBalance: paid=%d balance=%d, want 100000/0", paid, bal)
	}
}

// ── Idempotency (money path): same key twice = one payment, same result ────────────

func TestRecordPayment_Idempotent(t *testing.T) {
	f := newFakeStore()
	svc := newService(f, newFakeLocker())
	ctx := context.Background()

	inv, err := svc.Issue(ctx, "bursar-1", IssueInvoiceRequest{
		StudentID: "stu-1", FeeScheduleID: "fee-1", TotalAmountMinor: 100000,
	})
	if err != nil {
		t.Fatalf("issue: %v", err)
	}

	r1, err := svc.RecordPayment(ctx, "guardian-1", inv.ID, "guardian-1", 40000, "", "", "idem-SAME")
	if err != nil {
		t.Fatalf("first: %v", err)
	}
	if r1.Replayed {
		t.Fatal("first call must not be a replay")
	}

	// Replay with the SAME idempotency key: no second insert, same derived result.
	r2, err := svc.RecordPayment(ctx, "guardian-1", inv.ID, "guardian-1", 40000, "", "", "idem-SAME")
	if err != nil {
		t.Fatalf("replay: %v", err)
	}
	if !r2.Replayed {
		t.Fatal("second call with same key must be a replay")
	}
	if r2.Payment.ID != r1.Payment.ID {
		t.Fatalf("replay must return the SAME payment row: %s vs %s", r2.Payment.ID, r1.Payment.ID)
	}

	// Exactly ONE payment row exists, and the derived balance reflects a single 40000.
	pays, _ := svc.ListPayments(ctx, inv.ID)
	if len(pays) != 1 {
		t.Fatalf("idempotency: expected exactly 1 payment row, got %d", len(pays))
	}
	if r2.Invoice.AmountPaidMinor != 40000 || r2.Invoice.Balance != 60000 {
		t.Fatalf("after idempotent replay: paid=%d balance=%d, want 40000/60000 (never doubled)",
			r2.Invoice.AmountPaidMinor, r2.Invoice.Balance)
	}
}

// ── Guard: payments rejected on non-payable states ───────────────────────────────

func TestRecordPayment_RejectsUnpayable(t *testing.T) {
	f := newFakeStore()
	svc := newService(f, newFakeLocker())
	ctx := context.Background()

	inv, _ := svc.Issue(ctx, "bursar-1", IssueInvoiceRequest{
		StudentID: "stu-1", FeeScheduleID: "fee-1", TotalAmountMinor: 100000,
	})
	// Pay in full → paid (terminal).
	if _, err := svc.RecordPayment(ctx, "g", inv.ID, "g", 100000, "", "", "k1"); err != nil {
		t.Fatalf("pay full: %v", err)
	}
	// A further payment on a paid (terminal) invoice must be rejected.
	if _, err := svc.RecordPayment(ctx, "g", inv.ID, "g", 1, "", "", "k2"); !errors.Is(err, ErrInvoiceNotPayable) {
		t.Fatalf("payment on paid invoice must be rejected, got %v", err)
	}
}

// ── Idempotency-Key required (money path) ─────────────────────────────────────────

func TestRecordPayment_RequiresIdempotencyKey(t *testing.T) {
	f := newFakeStore()
	svc := newService(f, newFakeLocker())
	ctx := context.Background()
	inv, _ := svc.Issue(ctx, "bursar-1", IssueInvoiceRequest{
		StudentID: "stu-1", FeeScheduleID: "fee-1", TotalAmountMinor: 100000,
	})
	if _, err := svc.RecordPayment(ctx, "g", inv.ID, "g", 1000, "", "", ""); !errors.Is(err, ErrIdempotencyRequired) {
		t.Fatalf("missing idempotency key must be rejected, got %v", err)
	}
}

// ── Issue derives amount from fee schedule when total omitted ─────────────────────

func TestIssue_DerivesAmountFromSchedule(t *testing.T) {
	f := newFakeStore()
	svc := NewServiceWithDeps(f, newFakeLocker(), &fakeFeeReader{amount: 75000})
	ctx := context.Background()
	inv, err := svc.Issue(ctx, "bursar-1", IssueInvoiceRequest{StudentID: "stu-1", FeeScheduleID: "fee-1"})
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	if inv.TotalAmountMinor != 75000 {
		t.Fatalf("total must derive from schedule amount, got %d", inv.TotalAmountMinor)
	}
	if inv.Balance != 75000 {
		t.Fatalf("derived balance must equal total on a fresh invoice, got %d", inv.Balance)
	}
}
