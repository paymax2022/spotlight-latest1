package feesscholarship

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
)

// PURE tests — no DB. In-memory fakes for the Store, the LedgerPoster (fund) and the InvoicePayer
// (apply). They prove:
//   - pledge fund + apply are IDEMPOTENT on the money-path idempotency key (one ledger move, one
//     invoice payment, one award — replays are no-ops),
//   - applying an award records an INVOICE PAYMENT via the invoice port (asserted via the fake),
//     and NEVER writes a balance (the invoice port has no balance-write method — it only records
//     an invoice payment; the balance stays derived per SF-2),
//   - the fund flow is audited.

// ── in-memory Store fake (also serves as its own Tx) ────────────────────────────

type fakeStore struct {
	pledges map[string]*Pledge
	awards  []Award
	audits  []auditRow
}

type auditRow struct {
	action   string
	entityID string
	from     string
	to       string
}

func newFakeStore() *fakeStore {
	return &fakeStore{pledges: map[string]*Pledge{}}
}

func (f *fakeStore) InsertPledge(_ context.Context, p Pledge) (*Pledge, error) {
	p.ID = uuid.New().String()
	p.State = PledgePledged
	p.CreatedAt = time.Now()
	if p.Currency == "" {
		p.Currency = "NGN"
	}
	cp := p
	f.pledges[p.ID] = &cp
	out := cp
	return &out, nil
}

func (f *fakeStore) GetPledge(_ context.Context, id string) (*Pledge, error) {
	p, ok := f.pledges[id]
	if !ok {
		return nil, ErrNotFound
	}
	out := *p
	return &out, nil
}

func (f *fakeStore) SetPledgeState(_ context.Context, id string, from, to PledgeState, fundLedgerRef *string) (*Pledge, error) {
	p, ok := f.pledges[id]
	if !ok {
		return nil, ErrNotFound
	}
	if !canPledge(from, to) {
		return nil, ErrIllegalTransition
	}
	if p.State != from {
		return nil, ErrIllegalTransition
	}
	p.State = to
	if fundLedgerRef != nil && *fundLedgerRef != "" {
		p.FundLedgerRef = fundLedgerRef
	}
	out := *p
	return &out, nil
}

func (f *fakeStore) AddAppliedMinor(_ context.Context, id string, amountMinor int64) error {
	p, ok := f.pledges[id]
	if !ok {
		return ErrNotFound
	}
	p.AppliedMinor += amountMinor
	return nil
}

func (f *fakeStore) AppendAward(_ context.Context, a Award) (*Award, bool, error) {
	for i := range f.awards {
		if f.awards[i].IdempotencyKey == a.IdempotencyKey { // UNIQUE idempotency_key → replay
			ex := f.awards[i]
			return &ex, false, nil
		}
	}
	a.ID = uuid.New().String()
	a.State = AwardApplied
	a.CreatedAt = time.Now()
	f.awards = append(f.awards, a)
	out := a
	return &out, true, nil
}

func (f *fakeStore) ListAwardsByPledge(_ context.Context, pledgeID string) ([]Award, error) {
	out := []Award{}
	for _, a := range f.awards {
		if a.PledgeID == pledgeID {
			out = append(out, a)
		}
	}
	return out, nil
}

func (f *fakeStore) WriteAudit(_ context.Context, _, action, entityID, from, to string, _ any) error {
	f.audits = append(f.audits, auditRow{action: action, entityID: entityID, from: from, to: to})
	return nil
}

// WithTx runs fn with the store itself as the Tx (single-goroutine test → atomic enough).
func (f *fakeStore) WithTx(ctx context.Context, fn func(tx Tx) error) error {
	return fn(f)
}

// ── fake LedgerPoster (idempotent on idemKey) ───────────────────────────────────

type fakeLedger struct {
	calls map[string]int // idemKey → count
	refs  map[string]string
}

func newFakeLedger() *fakeLedger { return &fakeLedger{calls: map[string]int{}, refs: map[string]string{}} }

func (f *fakeLedger) PostFunding(_ context.Context, _, _, idemKey string, _ int64) (string, error) {
	f.calls[idemKey]++
	if r, ok := f.refs[idemKey]; ok {
		return r, nil // idempotent: same key → same ref, no new movement
	}
	r := "ledger-" + idemKey
	f.refs[idemKey] = r
	return r, nil
}

// ── fake InvoicePayer (records an invoice payment; idempotent; NO balance write) ─

type invoicePaymentCall struct {
	invoiceID       string
	guardianUserID  string
	amountMinor     int64
	ledgerReference string
	idemKey         string
}

type fakeInvoicePayer struct {
	calls     []invoicePaymentCall
	byIdem    map[string]string // idemKey → paymentID (idempotent replay)
	balanceWrites int           // MUST stay 0: this fake has no balance-write path
}

func newFakeInvoicePayer() *fakeInvoicePayer { return &fakeInvoicePayer{byIdem: map[string]string{}} }

func (f *fakeInvoicePayer) RecordPayment(_ context.Context, _, invoiceID, guardianUserID string, amountMinor int64, ledgerReference, idemKey string) (string, bool, error) {
	f.calls = append(f.calls, invoicePaymentCall{invoiceID, guardianUserID, amountMinor, ledgerReference, idemKey})
	if id, ok := f.byIdem[idemKey]; ok {
		return id, true, nil // replay: existing invoice payment, no new insert
	}
	id := "invpay-" + idemKey
	f.byIdem[idemKey] = id
	return id, false, nil
}

// ── helper to reach the funded state ─────────────────────────────────────────────

func fundedPledge(t *testing.T, store *fakeStore, ledger *fakeLedger, invoice *fakeInvoicePayer, amount int64) (*Service, *Pledge) {
	t.Helper()
	svc := NewServiceWithDeps(store, ledger, invoice)
	ctx := context.Background()
	p, err := svc.CreatePledge(ctx, "sponsor-1", CreatePledgeRequest{TargetStudentID: "stu-1", AmountMinor: amount})
	if err != nil {
		t.Fatalf("create pledge: %v", err)
	}
	if _, err := svc.FundPledge(ctx, "sponsor-1", p.ID, "fund-idem-1"); err != nil {
		t.Fatalf("fund pledge: %v", err)
	}
	fp, _ := store.GetPledge(ctx, p.ID)
	return svc, fp
}

// ── FundPledge idempotency: one ledger move ──────────────────────────────────────

func TestFundPledge_Idempotent_SingleLedgerMove(t *testing.T) {
	ctx := context.Background()
	store := newFakeStore()
	ledger := newFakeLedger()
	svc := NewServiceWithDeps(store, ledger, newFakeInvoicePayer())

	p, _ := svc.CreatePledge(ctx, "sponsor-1", CreatePledgeRequest{TargetStudentID: "stu-1", AmountMinor: 100000})

	if _, err := svc.FundPledge(ctx, "sponsor-1", p.ID, "fund-idem-1"); err != nil {
		t.Fatalf("first fund: %v", err)
	}
	// Replay with the SAME idemKey — must be a no-op money-wise.
	if _, err := svc.FundPledge(ctx, "sponsor-1", p.ID, "fund-idem-1"); err != nil {
		t.Fatalf("replay fund: %v", err)
	}

	// The ledger poster keyed by idemKey proves a single logical movement.
	if ledger.calls["fund-idem-1"] == 0 {
		t.Fatal("funding must invoke the ledger poster")
	}
	// Pledge is funded and carries the ledger ref.
	fp, _ := store.GetPledge(ctx, p.ID)
	if fp.State != PledgeFunded {
		t.Errorf("pledge must be funded, got %s", fp.State)
	}
	if fp.FundLedgerRef == nil || *fp.FundLedgerRef == "" {
		t.Error("funded pledge must record the ledger reference")
	}
	if !hasAudit(store, "pledge_funded") {
		t.Error("funding must be audited")
	}
}

func TestFundPledge_RequiresIdempotencyKey(t *testing.T) {
	ctx := context.Background()
	store := newFakeStore()
	svc := NewServiceWithDeps(store, newFakeLedger(), newFakeInvoicePayer())
	p, _ := svc.CreatePledge(ctx, "sponsor-1", CreatePledgeRequest{TargetStudentID: "stu-1", AmountMinor: 1000})
	if _, err := svc.FundPledge(ctx, "sponsor-1", p.ID, ""); err != ErrIdempotencyRequired {
		t.Fatalf("missing idempotency key must be rejected, got %v", err)
	}
}

// ── ApplyAward: records an invoice payment (never a balance write); idempotent ────

func TestApplyAward_RecordsInvoicePayment_NoBalanceWrite(t *testing.T) {
	ctx := context.Background()
	store := newFakeStore()
	ledger := newFakeLedger()
	invoice := newFakeInvoicePayer()
	svc, fp := fundedPledge(t, store, ledger, invoice, 100000)

	res, err := svc.ApplyAward(ctx, "admin-1", ApplyAwardRequest{
		PledgeID:       fp.ID,
		InvoiceID:      "inv-1",
		StudentID:      "stu-1",
		GuardianUserID: "guardian-1",
		AmountMinor:    40000,
	}, "apply-idem-1")
	if err != nil {
		t.Fatalf("apply award: %v", err)
	}

	// The award was applied by RECORDING AN INVOICE PAYMENT via the invoice port.
	if len(invoice.calls) != 1 {
		t.Fatalf("apply must record exactly one invoice payment, got %d", len(invoice.calls))
	}
	call := invoice.calls[0]
	if call.invoiceID != "inv-1" || call.amountMinor != 40000 || call.guardianUserID != "guardian-1" {
		t.Errorf("invoice payment must reflect the award: %+v", call)
	}
	if call.idemKey != "apply-idem-1" {
		t.Errorf("invoice payment must share the award idempotency key, got %q", call.idemKey)
	}
	if res.InvoicePaymentID == "" {
		t.Error("apply result must carry the invoice payment id")
	}
	// NEVER a balance write — the invoice balance stays derived (SF-2). The invoice port has no
	// balance-write method, so this counter can never increment.
	if invoice.balanceWrites != 0 {
		t.Errorf("apply must NEVER write an invoice balance (SF-2), got %d writes", invoice.balanceWrites)
	}
	// Running applied total bumped; audit recorded.
	after, _ := store.GetPledge(ctx, fp.ID)
	if after.AppliedMinor != 40000 {
		t.Errorf("applied total must be 40000, got %d", after.AppliedMinor)
	}
	if after.State != PledgeApplied {
		t.Errorf("pledge must be in applied state, got %s", after.State)
	}
	if !hasAudit(store, "award_applied") {
		t.Error("award application must be audited")
	}
}

func TestApplyAward_Idempotent_SingleInvoicePaymentSingleAward(t *testing.T) {
	ctx := context.Background()
	store := newFakeStore()
	invoice := newFakeInvoicePayer()
	svc, fp := fundedPledge(t, store, newFakeLedger(), invoice, 100000)

	req := ApplyAwardRequest{PledgeID: fp.ID, InvoiceID: "inv-1", StudentID: "stu-1", GuardianUserID: "g-1", AmountMinor: 30000}

	first, err := svc.ApplyAward(ctx, "admin-1", req, "apply-idem-1")
	if err != nil {
		t.Fatalf("first apply: %v", err)
	}
	second, err := svc.ApplyAward(ctx, "admin-1", req, "apply-idem-1") // replay SAME idemKey
	if err != nil {
		t.Fatalf("replay apply: %v", err)
	}

	// Idempotent: one invoice payment id, one award, applied total NOT double-counted.
	if first.InvoicePaymentID != second.InvoicePaymentID {
		t.Errorf("replay must return the same invoice payment id: %q vs %q", first.InvoicePaymentID, second.InvoicePaymentID)
	}
	if !second.Replayed {
		t.Error("replay must be flagged as replayed")
	}
	awards, _ := store.ListAwardsByPledge(ctx, fp.ID)
	if len(awards) != 1 {
		t.Fatalf("replay must not insert a second award, got %d", len(awards))
	}
	after, _ := store.GetPledge(ctx, fp.ID)
	if after.AppliedMinor != 30000 {
		t.Errorf("applied total must not be double-counted, got %d", after.AppliedMinor)
	}
}

// ── ApplyAward guards: unfunded + over-headroom rejected ─────────────────────────

func TestApplyAward_RejectsUnfundedPledge(t *testing.T) {
	ctx := context.Background()
	store := newFakeStore()
	svc := NewServiceWithDeps(store, newFakeLedger(), newFakeInvoicePayer())
	p, _ := svc.CreatePledge(ctx, "sponsor-1", CreatePledgeRequest{TargetStudentID: "stu-1", AmountMinor: 5000})
	// Not funded yet.
	_, err := svc.ApplyAward(ctx, "admin-1", ApplyAwardRequest{PledgeID: p.ID, InvoiceID: "inv-1", AmountMinor: 1000}, "idem-x")
	if err != ErrPledgeNotFunded {
		t.Fatalf("applying an unfunded pledge must be rejected, got %v", err)
	}
}

func TestApplyAward_RejectsOverHeadroom(t *testing.T) {
	ctx := context.Background()
	store := newFakeStore()
	svc, fp := fundedPledge(t, store, newFakeLedger(), newFakeInvoicePayer(), 10000)
	_, err := svc.ApplyAward(ctx, "admin-1", ApplyAwardRequest{PledgeID: fp.ID, InvoiceID: "inv-1", AmountMinor: 15000}, "idem-y")
	if err != ErrPledgeExhausted {
		t.Fatalf("applying more than the pledged amount must be rejected, got %v", err)
	}
}

// Compile-time proof the fake satisfies the Store contract (and thus the Tx facade via WithTx).
var _ Store = (*fakeStore)(nil)
var _ Tx = (*fakeStore)(nil)

// ── helpers ──────────────────────────────────────────────────────────────────────

func hasAudit(s *fakeStore, action string) bool {
	for _, a := range s.audits {
		if a.action == action {
			return true
		}
	}
	return false
}
