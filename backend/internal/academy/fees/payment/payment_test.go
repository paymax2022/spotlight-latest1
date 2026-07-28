package feespayment

import (
	"context"
	"errors"
	"testing"

	"spotlight/backend/internal/provider"
)

// PURE tests — no live gateway / DB / ledger. The provider, ledger, invoice recorder and intent
// store are all in-memory fakes so the money-path invariants are exercised in isolation:
//   - Idempotency (money path): same key twice = one ledger move + one invoice payment.
//   - SF-2: confirmation RECORDS a payment via the invoice recorder; it NEVER writes a balance
//     (the fake invoice exposes only RecordPayment — there is structurally no balance setter).
// Tests actively attempt the violations they claim to guard.

// ── fakeGateway ─────────────────────────────────────────────────────────────────────

type fakeGateway struct {
	initCalls   int
	verifyCalls int
	// verifyStatus / verifyAmount control what VerifyPayment returns.
	verifyStatus string
	verifyAmount int64
	initErr      error
	verifyErr    error
	lastRef      string
}

func (g *fakeGateway) InitializePayment(_ context.Context, req provider.InitializePaymentRequest) (*provider.InitializePaymentResponse, error) {
	g.initCalls++
	g.lastRef = req.Reference
	if g.initErr != nil {
		return nil, g.initErr
	}
	return &provider.InitializePaymentResponse{
		Reference:        req.Reference,
		AuthorizationURL: "https://pay.example/" + req.Reference,
		AccessCode:       "ac_" + req.Reference,
	}, nil
}

func (g *fakeGateway) VerifyPayment(_ context.Context, reference string) (*provider.PaymentStatus, error) {
	g.verifyCalls++
	if g.verifyErr != nil {
		return nil, g.verifyErr
	}
	status := g.verifyStatus
	if status == "" {
		status = "success"
	}
	return &provider.PaymentStatus{Reference: reference, Status: status, AmountKobo: g.verifyAmount}, nil
}

// ── fakeLedger: records the guardian→school moves; idempotent on key ─────────────────

type ledgerMove struct {
	guardian string
	school   string
	amount   int64
	idem     string
}

type fakeLedger struct {
	moves    []ledgerMove
	idemSeen map[string]string // idemKey → ledgerRef (idempotency guard)
	// If set, the fake records the count of DISTINCT money movements (one per unique key).
}

func newFakeLedger() *fakeLedger { return &fakeLedger{idemSeen: map[string]string{}} }

func (l *fakeLedger) MoveGuardianToSchool(_ context.Context, guardianUserID, schoolID, reference, idempotencyKey string, amountMinor int64) (string, error) {
	if ref, ok := l.idemSeen[idempotencyKey]; ok {
		// Idempotent replay: no second money movement; return the same ledger ref.
		return ref, nil
	}
	ref := "ledger:" + idempotencyKey
	l.idemSeen[idempotencyKey] = ref
	l.moves = append(l.moves, ledgerMove{guardian: guardianUserID, school: schoolID, amount: amountMinor, idem: idempotencyKey})
	return ref, nil
}

// ── fakeInvoice: exposes ONLY RecordPayment (+ metadata) — NO balance setter (SF-2) ──

type fakeInvoice struct {
	// recorded is keyed by idempotency key → amount, enforcing one payment per key.
	recorded    map[string]int64
	recordCalls int
	schoolID    string
	hasPolicy   bool
	priorPay    bool
}

func newFakeInvoice(schoolID string) *fakeInvoice {
	return &fakeInvoice{recorded: map[string]int64{}, schoolID: schoolID}
}

func (i *fakeInvoice) RecordPayment(_ context.Context, invoiceID, guardianUserID string, amountMinor int64, gatewayRef, ledgerReference, idempotencyKey string) (string, bool, error) {
	i.recordCalls++
	if _, ok := i.recorded[idempotencyKey]; ok {
		// Replay: existing idempotency key. No second record. Status derives to the same value.
		return statusFor(i, amountMinor), true, nil
	}
	i.recorded[idempotencyKey] = amountMinor
	return statusFor(i, amountMinor), false, nil
}

// statusFor is a crude derived-status stand-in: full amount ⇒ paid, else partially_paid. It reads
// nothing but the payment amount vs a notional total of 50000 used in tests.
func statusFor(_ *fakeInvoice, amountMinor int64) string {
	if amountMinor >= 50000 {
		return "paid"
	}
	return "partially_paid"
}

func (i *fakeInvoice) SchoolIDForInvoice(_ context.Context, _ string) (string, error) {
	return i.schoolID, nil
}

func (i *fakeInvoice) InstallmentPolicyForInvoice(_ context.Context, _ string) (bool, error) {
	return i.hasPolicy, nil
}

func (i *fakeInvoice) HasAnyPayment(_ context.Context, _ string) (bool, error) {
	return i.priorPay || len(i.recorded) > 0, nil
}

// ── fakeIntentStore: in-memory, idempotent on idempotency key ────────────────────────

type fakeIntentStore struct {
	byRef  map[string]*intentRecord
	byIdem map[string]*intentRecord
	puts   int
}

func newFakeIntentStore() *fakeIntentStore {
	return &fakeIntentStore{byRef: map[string]*intentRecord{}, byIdem: map[string]*intentRecord{}}
}

func (s *fakeIntentStore) PutIntent(_ context.Context, in intentRecord) (*intentRecord, bool, error) {
	s.puts++
	if ex, ok := s.byIdem[in.IdempotencyKey]; ok {
		return ex, false, nil // replay
	}
	rec := in
	s.byIdem[in.IdempotencyKey] = &rec
	s.byRef[in.Reference] = &rec
	return &rec, true, nil
}

func (s *fakeIntentStore) GetByReference(_ context.Context, reference string) (*intentRecord, error) {
	if r, ok := s.byRef[reference]; ok {
		return r, nil
	}
	return nil, ErrUnknownReference
}

func (s *fakeIntentStore) MarkConfirmed(_ context.Context, reference string) error {
	if r, ok := s.byRef[reference]; ok {
		r.Confirmed = true
	}
	return nil
}

// ── harness ───────────────────────────────────────────────────────────────────────

func newTestService(t *testing.T, verifyAmount int64) (*Service, *fakeGateway, *fakeLedger, *fakeInvoice, *fakeIntentStore) {
	t.Helper()
	gw := &fakeGateway{verifyAmount: verifyAmount, verifyStatus: "success"}
	led := newFakeLedger()
	inv := newFakeInvoice("school-1")
	store := newFakeIntentStore()
	return NewService(gw, led, inv, store), gw, led, inv, store
}

// ═══════════════════════════════════════════════════════════════════════════════════
// Intent creation.
// ═══════════════════════════════════════════════════════════════════════════════════

func TestCreateIntent_ReturnsAuthURL(t *testing.T) {
	svc, gw, _, _, _ := newTestService(t, 50000)
	ctx := context.Background()

	out, err := svc.CreatePaymentIntent(ctx, "guardian-1", CreatePaymentIntentRequest{
		InvoiceID: "inv-1", AmountMinor: 50000, Email: "g@example.com",
	}, "idem-intent-1")
	if err != nil {
		t.Fatalf("create intent: %v", err)
	}
	if out.AuthorizationURL == "" {
		t.Fatal("intent must return an authorization URL for the parent app")
	}
	if out.Reference == "" {
		t.Fatal("intent must return a reference")
	}
	if gw.initCalls != 1 {
		t.Fatalf("expected 1 gateway init, got %d", gw.initCalls)
	}
}

func TestCreateIntent_RequiresIdempotencyKey(t *testing.T) {
	svc, _, _, _, _ := newTestService(t, 50000)
	if _, err := svc.CreatePaymentIntent(context.Background(), "g", CreatePaymentIntentRequest{InvoiceID: "inv-1", AmountMinor: 100}, ""); !errors.Is(err, ErrIdempotencyRequired) {
		t.Fatalf("money path must require Idempotency-Key, got %v", err)
	}
}

// Same idempotency key twice → one intent record, one reference (idempotent intent).
func TestCreateIntent_IdempotentOnKey(t *testing.T) {
	svc, gw, _, _, store := newTestService(t, 50000)
	ctx := context.Background()

	first, err := svc.CreatePaymentIntent(ctx, "g", CreatePaymentIntentRequest{InvoiceID: "inv-1", AmountMinor: 50000}, "idem-dup")
	if err != nil {
		t.Fatalf("first: %v", err)
	}
	second, err := svc.CreatePaymentIntent(ctx, "g", CreatePaymentIntentRequest{InvoiceID: "inv-1", AmountMinor: 50000}, "idem-dup")
	if err != nil {
		t.Fatalf("replay: %v", err)
	}
	if first.Reference != second.Reference {
		t.Fatalf("idempotent intent must reuse the same reference, got %q then %q", first.Reference, second.Reference)
	}
	if len(store.byIdem) != 1 {
		t.Fatalf("idempotency: expected 1 stored intent, got %d", len(store.byIdem))
	}
	_ = gw
}

// ═══════════════════════════════════════════════════════════════════════════════════
// Confirmation: confirm-and-record; end-to-end idempotent; SF-2 (record, never balance).
// ═══════════════════════════════════════════════════════════════════════════════════

func TestConfirm_PostsLedgerMoveAndRecordsInvoice(t *testing.T) {
	svc, _, led, inv, _ := newTestService(t, 50000)
	ctx := context.Background()

	intent, err := svc.CreatePaymentIntent(ctx, "guardian-1", CreatePaymentIntentRequest{InvoiceID: "inv-1", AmountMinor: 50000}, "idem-c")
	if err != nil {
		t.Fatalf("intent: %v", err)
	}

	res, err := svc.OnChargeSuccess(ctx, intent.Reference, "gw-ref-1")
	if err != nil {
		t.Fatalf("confirm: %v", err)
	}

	// Exactly one balanced ledger move: guardian wallet → school settlement.
	if len(led.moves) != 1 {
		t.Fatalf("expected exactly 1 ledger move, got %d", len(led.moves))
	}
	if led.moves[0].guardian != "guardian-1" || led.moves[0].school != "school-1" || led.moves[0].amount != 50000 {
		t.Fatalf("ledger move must be guardian→school for the invoice amount, got %+v", led.moves[0])
	}
	// Exactly one invoice payment recorded (SF-2: RECORDED, not a balance write).
	if inv.recordCalls != 1 {
		t.Fatalf("expected exactly 1 invoice RecordPayment, got %d", inv.recordCalls)
	}
	if got := inv.recorded["idem-c"]; got != 50000 {
		t.Fatalf("invoice payment must record 50000, got %d", got)
	}
	if res.LedgerReference == "" {
		t.Fatal("confirm result must carry the ledger reference")
	}
	if res.Replayed {
		t.Fatal("first confirmation must not be a replay")
	}
}

// SF-2: the invoice collaborator exposes ONLY RecordPayment — there is structurally no balance
// setter for the confirmation path to call. This test asserts the amount flows through
// RecordPayment (the derived-balance discipline) and the returned derived status is surfaced.
func TestConfirm_SF2_RecordsPaymentNeverBalance(t *testing.T) {
	svc, _, _, inv, _ := newTestService(t, 50000)
	ctx := context.Background()

	intent, _ := svc.CreatePaymentIntent(ctx, "g", CreatePaymentIntentRequest{InvoiceID: "inv-1", AmountMinor: 50000}, "idem-sf2")
	res, err := svc.OnChargeSuccess(ctx, intent.Reference, "gw-ref")
	if err != nil {
		t.Fatalf("confirm: %v", err)
	}
	// The ONLY money-side effect on the invoice is a recorded payment (map has one entry).
	if len(inv.recorded) != 1 {
		t.Fatalf("SF-2: confirmation must record exactly one payment, got %d", len(inv.recorded))
	}
	// The invoice status is DERIVED and surfaced (paid for a full payment).
	if res.InvoiceStatus != "paid" {
		t.Fatalf("SF-2: full payment must derive status 'paid', got %q", res.InvoiceStatus)
	}
}

// End-to-end idempotency: replay the same confirmation (redelivered webhook) → one ledger move +
// one invoice payment, same result.
func TestConfirm_IdempotentEndToEnd(t *testing.T) {
	svc, _, led, inv, _ := newTestService(t, 50000)
	ctx := context.Background()

	intent, _ := svc.CreatePaymentIntent(ctx, "g", CreatePaymentIntentRequest{InvoiceID: "inv-1", AmountMinor: 50000}, "idem-e2e")

	first, err := svc.OnChargeSuccess(ctx, intent.Reference, "gw-ref")
	if err != nil {
		t.Fatalf("first confirm: %v", err)
	}
	second, err := svc.OnChargeSuccess(ctx, intent.Reference, "gw-ref") // redelivered webhook
	if err != nil {
		t.Fatalf("replayed confirm must succeed, got %v", err)
	}

	if len(led.moves) != 1 {
		t.Fatalf("idempotency: expected 1 ledger move after replay, got %d", len(led.moves))
	}
	if inv.recordCalls != 2 {
		// RecordPayment is CALLED twice (once per webhook) but is itself idempotent on the key;
		// the important invariant is a single stored payment.
		t.Logf("RecordPayment invoked %d times (idempotent on key)", inv.recordCalls)
	}
	if len(inv.recorded) != 1 {
		t.Fatalf("idempotency: expected exactly 1 stored invoice payment, got %d", len(inv.recorded))
	}
	if !second.Replayed {
		t.Fatal("second confirmation must report Replayed=true")
	}
	if first.LedgerReference != second.LedgerReference {
		t.Fatalf("replayed confirmation must reuse the same ledger reference, got %q then %q", first.LedgerReference, second.LedgerReference)
	}
}

// Fail-closed: an unverified / non-success charge posts NO money and records NO payment.
func TestConfirm_FailsClosedOnUnsuccessfulCharge(t *testing.T) {
	svc, gw, led, inv, _ := newTestService(t, 50000)
	gw.verifyStatus = "failed"
	ctx := context.Background()

	intent, _ := svc.CreatePaymentIntent(ctx, "g", CreatePaymentIntentRequest{InvoiceID: "inv-1", AmountMinor: 50000}, "idem-fail")
	if _, err := svc.OnChargeSuccess(ctx, intent.Reference, "gw-ref"); !errors.Is(err, ErrChargeNotSuccessful) {
		t.Fatalf("non-success charge must fail closed, got %v", err)
	}
	if len(led.moves) != 0 || len(inv.recorded) != 0 {
		t.Fatal("no money must move and no payment must be recorded for an unverified charge")
	}
}

// Amount mismatch between gateway and intent aborts before any money moves.
func TestConfirm_AmountMismatchAborts(t *testing.T) {
	svc, _, led, inv, _ := newTestService(t, 40000) // gateway reports 40000...
	ctx := context.Background()
	intent, _ := svc.CreatePaymentIntent(ctx, "g", CreatePaymentIntentRequest{InvoiceID: "inv-1", AmountMinor: 50000}, "idem-mm") // ...intent is 50000
	if _, err := svc.OnChargeSuccess(ctx, intent.Reference, "gw-ref"); !errors.Is(err, ErrAmountMismatch) {
		t.Fatalf("amount mismatch must abort, got %v", err)
	}
	if len(led.moves) != 0 || len(inv.recorded) != 0 {
		t.Fatal("amount mismatch must move no money and record no payment")
	}
}

// Unknown reference is a benign no-op signal (not our intent).
func TestConfirm_UnknownReferenceIsNoOp(t *testing.T) {
	svc, _, led, inv, _ := newTestService(t, 50000)
	if _, err := svc.OnChargeSuccess(context.Background(), "feespay:nope", "gw-ref"); !errors.Is(err, ErrUnknownReference) {
		t.Fatalf("unknown reference must return ErrUnknownReference, got %v", err)
	}
	if len(led.moves) != 0 || len(inv.recorded) != 0 {
		t.Fatal("unknown reference must move no money")
	}
}

// ═══════════════════════════════════════════════════════════════════════════════════
// Installments (SF-6).
// ═══════════════════════════════════════════════════════════════════════════════════

// First installment on a policy-bearing invoice without acknowledgement → DisclosureRequired,
// and NO gateway session started (no money).
func TestInstallment_FirstRequiresDisclosure(t *testing.T) {
	svc, gw, _, inv, _ := newTestService(t, 50000)
	inv.hasPolicy = true
	ctx := context.Background()

	out, err := svc.PayInstallment(ctx, "g", PayInstallmentRequest{InvoiceID: "inv-1", AmountMinor: 20000}, "idem-inst-1")
	if err != nil {
		t.Fatalf("first installment (disclosure) must not error, got %v", err)
	}
	if !out.DisclosureRequired {
		t.Fatal("SF-6: first installment on a policy invoice must surface DisclosureRequired")
	}
	if gw.initCalls != 0 {
		t.Fatal("SF-6: no gateway session may start until the disclosure is acknowledged")
	}
}

// Acknowledged first installment proceeds and starts the gateway session for the partial amount.
func TestInstallment_AcknowledgedProceeds(t *testing.T) {
	svc, gw, _, inv, _ := newTestService(t, 20000)
	inv.hasPolicy = true
	ctx := context.Background()

	out, err := svc.PayInstallment(ctx, "g", PayInstallmentRequest{InvoiceID: "inv-1", AmountMinor: 20000, Acknowledged: true}, "idem-inst-ack")
	if err != nil {
		t.Fatalf("acknowledged installment: %v", err)
	}
	if out.DisclosureRequired {
		t.Fatal("acknowledged installment must not still require disclosure")
	}
	if out.AuthorizationURL == "" || gw.initCalls != 1 {
		t.Fatal("acknowledged installment must start exactly one gateway session")
	}
	if !out.IsInstallment || out.AmountMinor != 20000 {
		t.Fatalf("installment intent must carry the partial amount, got %+v", out)
	}
}

// A partial payment against an invoice with NO installment policy is allowed with no disclosure.
func TestInstallment_NoPolicyNoDisclosure(t *testing.T) {
	svc, gw, _, inv, _ := newTestService(t, 10000)
	inv.hasPolicy = false
	ctx := context.Background()
	out, err := svc.PayInstallment(ctx, "g", PayInstallmentRequest{InvoiceID: "inv-1", AmountMinor: 10000}, "idem-nopolicy")
	if err != nil {
		t.Fatalf("partial payment without policy: %v", err)
	}
	if out.DisclosureRequired {
		t.Fatal("no policy ⇒ no disclosure gate")
	}
	if gw.initCalls != 1 {
		t.Fatalf("expected gateway session, got %d inits", gw.initCalls)
	}
}
