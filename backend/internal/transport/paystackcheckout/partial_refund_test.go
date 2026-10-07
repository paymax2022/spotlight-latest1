package paystackcheckout

// PARTIAL refunds (ADR-PR522-mobility-card-direct, "Partial refunds (car hire)").
// One card charge funds several settlements (car hire: <ref>:fare + <ref>:deposit);
// each is refunded to the card on its own, for exactly its own total. Properties
// proven here with fakes (SQL-level ones are in partial_refund_live_db_test.go):
//   - the piece refund is RECORDED before the gateway is called;
//   - the gateway is only ever asked when its accepted-refund total equals the
//     books (lookup arithmetic) — "never refund on a guess";
//   - each piece is idempotent, resumable and fenced; the sum never exceeds the
//     charge; the ledger is reversed per settlement AFTER the gateway.

import (
	"context"
	"errors"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"spotlight/backend/internal/finance/settlement"
	"spotlight/backend/internal/provider"
)

const (
	pFare    = int64(700_000)
	pDeposit = int64(300_000)
	pTotal   = pFare + pDeposit
)

type prig struct {
	*rig
	ref string
}

func (p *prig) fareID() string { return "sett-fare" }
func (p *prig) depID() string  { return "sett-dep" }

func newPartialRig(t *testing.T) *prig {
	t.Helper()
	r := newRig()
	r.d.quote = pTotal
	r.gw.verify = &provider.PaymentStatus{Status: "success", AmountKobo: pTotal, Currency: "NGN"}
	r.e.EnablePartialRefunds(r.gw, r.st)
	ref := confirmed(t, r)
	r.lg.setts = map[string]*settlement.Settlement{
		"sett-fare": {ID: "sett-fare", Status: settlement.StatusEscrowed, FundingSource: "external", TotalKobo: pFare, PayerID: "u1", IdempotencyKey: ref + ":fare"},
		"sett-dep":  {ID: "sett-dep", Status: settlement.StatusEscrowed, FundingSource: "external", TotalKobo: pDeposit, PayerID: "u1", IdempotencyKey: ref + ":deposit"},
	}
	return &prig{rig: r, ref: ref}
}

func (p *prig) refund(id string) error {
	return p.e.RefunderFor("fake").RefundExternalSettlement(context.Background(), "ent-1", id, "released")
}

func (p *prig) row(t *testing.T, id string) *PartialRefund {
	t.Helper()
	row, err := p.st.GetPartial(context.Background(), p.ref, id)
	if err != nil {
		t.Fatal(err)
	}
	return row
}

func (p *prig) intent(t *testing.T) *Intent { return status(t, p.rig, p.ref) }

func (p *prig) noGatewayTraffic(t *testing.T) {
	t.Helper()
	if len(p.gw.pCalls) != 0 || len(p.gw.refundCalls) != 0 {
		t.Errorf("gateway refund issued: partial=%v full=%v", p.gw.pCalls, p.gw.refundCalls)
	}
}

// ── the happy path ──────────────────────────────────────────────────────────

func TestPartial_RefundIsRecordedBeforeGatewayCalled_ThenLedgerAfter(t *testing.T) {
	p := newPartialRig(t)
	var rowAtCall *PartialRefund
	var reservedAtCall int64
	p.gw.pOnRefund = func(string, int64) {
		rowAtCall = p.row(t, p.depID())
		reservedAtCall = p.intent(t).RefundReservedKobo
	}
	if err := p.refund(p.depID()); err != nil {
		t.Fatal(err)
	}
	if rowAtCall == nil || rowAtCall.Status != PartialRefunding || reservedAtCall != pDeposit {
		t.Fatalf("at gateway-call time row=%+v reserved=%d; the piece must already be 'refunding' with its amount reserved", rowAtCall, reservedAtCall)
	}
	if len(p.gw.pCalls) != 1 || p.gw.pCalls[0].Amt != pDeposit || p.gw.pCalls[0].Ref != p.ref {
		t.Fatalf("gateway calls %+v, want exactly one refund of the DEPOSIT total", p.gw.pCalls)
	}
	if want := p.ref + "#sett-dep"; p.gw.pCalls[0].Note != want {
		t.Errorf("note %q, want %q", p.gw.pCalls[0].Note, want)
	}
	if len(p.gw.refundCalls) != 0 {
		t.Error("the whole-charge RefundPayment must not be used for a piece")
	}
	if got := p.row(t, p.depID()); got.Status != PartialRefunded || got.GatewayRefundID == nil {
		t.Errorf("row %+v", got)
	}
	in := p.intent(t)
	if in.Status != StatusConfirmed || in.RefundedKobo != pDeposit || in.RefundReservedKobo != pDeposit {
		t.Errorf("intent %s refunded=%d reserved=%d: a piece refund must leave the booking confirmed", in.Status, in.RefundedKobo, in.RefundReservedKobo)
	}
	if len(p.lg.calls) != 1 || p.lg.calls[0] != "sett-dep|released" {
		t.Errorf("ledger %v", p.lg.calls)
	}
	ev := p.ev.list()
	if idx(ev, "gateway.refund.partial") > idx(ev, "ledger.refund") || idx(ev, "ledger.refund") < 0 {
		t.Errorf("order %v: gateway first, ledger second", ev)
	}
	// full unwind never touched
	if len(p.lg.byKey) != 0 {
		t.Errorf("by-key unwind ran: %v", p.lg.byKey)
	}
}

func idx(list []string, s string) int {
	for i, v := range list {
		if v == s {
			return i
		}
	}
	return -1
}

func TestPartial_FareThenDeposit_SumEqualsCollected_IntentBecomesRefunded(t *testing.T) {
	p := newPartialRig(t)
	if err := p.refund(p.fareID()); err != nil {
		t.Fatal(err)
	}
	if in := p.intent(t); in.Status != StatusConfirmed {
		t.Fatalf("after the fare only, status %s", in.Status)
	}
	if err := p.refund(p.depID()); err != nil {
		t.Fatal(err)
	}
	var sum int64
	for _, c := range p.gw.pCalls {
		sum += c.Amt
	}
	in := p.intent(t)
	if sum != pTotal || in.Status != StatusRefunded || in.RefundedKobo != pTotal {
		t.Fatalf("gateway sum=%d intent %s refunded=%d; want %d and 'refunded'", sum, in.Status, in.RefundedKobo, pTotal)
	}
	// A replay of either piece is a pure no-op.
	before := len(p.gw.pCalls)
	if err := p.refund(p.fareID()); err != nil {
		t.Fatalf("replay: %v", err)
	}
	if len(p.gw.pCalls) != before {
		t.Error("replay of a refunded piece called the gateway")
	}
}

func TestPartial_SumNeverExceedsCollected(t *testing.T) {
	p := newPartialRig(t)
	if err := p.refund(p.fareID()); err != nil {
		t.Fatal(err)
	}
	// A rogue settlement bound to the same reference whose total would push the
	// refunded sum past the charge.
	p.lg.setts["sett-rogue"] = &settlement.Settlement{ID: "sett-rogue", Status: settlement.StatusEscrowed, FundingSource: "external", TotalKobo: pDeposit + 1, PayerID: "u1", IdempotencyKey: p.ref + ":rogue"}
	calls := len(p.gw.pCalls)
	err := p.refund("sett-rogue")
	if !errors.Is(err, ErrPartialCapExceeded) {
		t.Fatalf("err = %v, want ErrPartialCapExceeded", err)
	}
	if len(p.gw.pCalls) != calls {
		t.Error("gateway called for a refund that exceeds the collected amount")
	}
	if in := p.intent(t); in.RefundReservedKobo != pFare || in.RefundedKobo != pFare {
		t.Errorf("reserved=%d refunded=%d leaked", in.RefundReservedKobo, in.RefundedKobo)
	}
}

// ── idempotency / lookup arithmetic ─────────────────────────────────────────

func TestPartial_AcceptedReplyLost_RecordedNotRetried(t *testing.T) {
	p := newPartialRig(t)
	p.gw.pErr = errors.New("http request: context deadline exceeded")
	p.gw.pAcceptOnErr = true
	if err := p.refund(p.depID()); err != nil {
		t.Fatalf("a refund the gateway accepted must complete: %v", err)
	}
	if len(p.gw.pCalls) != 1 {
		t.Errorf("%d POSTs; the lost reply must be resolved by lookup, not a second refund", len(p.gw.pCalls))
	}
	if got := p.row(t, p.depID()); got.Status != PartialRefunded {
		t.Errorf("row %s", got.Status)
	}
	if len(p.lg.calls) != 1 {
		t.Errorf("ledger %v", p.lg.calls)
	}
}

func TestPartial_AlreadyDoneAtGateway_NoSecondPost(t *testing.T) {
	// Crash after the gateway accepted, before we recorded: the next attempt must
	// find the refund by arithmetic and record it — never issue another.
	p := newPartialRig(t)
	p.gw.pRefunds = []provider.RefundResult{{Reference: p.ref, Status: "processed", AmountKobo: pDeposit, ID: "gw-prev"}}
	if err := p.refund(p.depID()); err != nil {
		t.Fatal(err)
	}
	p.noGatewayTraffic(t)
	got := p.row(t, p.depID())
	if got.Status != PartialRefunded || got.GatewayRefundID == nil || *got.GatewayRefundID != "gw-prev" {
		t.Errorf("row %+v", got)
	}
}

func TestPartial_PendingAtGatewayCountsAsAccepted(t *testing.T) {
	p := newPartialRig(t)
	p.gw.pRefunds = []provider.RefundResult{{Reference: p.ref, Status: "pending", AmountKobo: pDeposit, ID: "gw-p"}}
	if err := p.refund(p.depID()); err != nil {
		t.Fatal(err)
	}
	p.noGatewayTraffic(t)
}

func TestPartial_GatewayHoldsUnexplainedRefund_StaysRefundingNoPost(t *testing.T) {
	p := newPartialRig(t)
	// Someone refunded 123 kobo from the Paystack dashboard: books say 0 refunded.
	p.gw.pRefunds = []provider.RefundResult{{Reference: p.ref, Status: "processed", AmountKobo: 123, ID: "dash"}}
	err := p.refund(p.depID())
	if err == nil {
		t.Fatal("must not proceed on an unexplained gateway state")
	}
	p.noGatewayTraffic(t)
	if got := p.row(t, p.depID()); got.Status != PartialRefunding {
		t.Errorf("row %s: an unknowable outcome must stay 'refunding' for the reconciler", got.Status)
	}
	if len(p.lg.calls) != 0 {
		t.Errorf("ledger reversed on a guess: %v", p.lg.calls)
	}
}

func TestPartial_FailedRefundsAtGatewayAreIgnoredInTheSum(t *testing.T) {
	p := newPartialRig(t)
	p.gw.pRefunds = []provider.RefundResult{{Reference: p.ref, Status: "failed", AmountKobo: pDeposit, ID: "gw-f"}}
	if err := p.refund(p.depID()); err != nil {
		t.Fatal(err)
	}
	if len(p.gw.pCalls) != 1 {
		t.Errorf("a failed earlier attempt is not a refund; %d POSTs", len(p.gw.pCalls))
	}
}

func TestPartial_InflightButOnlyForeignNotes_IsUnknown(t *testing.T) {
	p := newPartialRig(t)
	// An accepted refund of the right size that carries ANOTHER piece's note is not ours.
	p.gw.pRefunds = []provider.RefundResult{{Reference: p.ref, Status: "processed", AmountKobo: pDeposit, ID: "gw-x", Note: p.ref + "#sett-fare"}}
	if err := p.refund(p.depID()); err == nil {
		t.Fatal("a same-sized refund that is demonstrably another piece's must not be adopted")
	}
	p.noGatewayTraffic(t)
	if got := p.row(t, p.depID()); got.Status != PartialRefunding {
		t.Errorf("row %s", got.Status)
	}
}

func TestPartial_FailedStatus_ReleasesReservationAndIsRetryable(t *testing.T) {
	p := newPartialRig(t)
	p.gw.pFailed = true
	if err := p.refund(p.depID()); err == nil {
		t.Fatal("a failed gateway refund must be an error")
	}
	got := p.row(t, p.depID())
	if got.Status != PartialFailed {
		t.Fatalf("row %s", got.Status)
	}
	if in := p.intent(t); in.RefundReservedKobo != 0 || in.RefundedKobo != 0 {
		t.Errorf("reserved=%d refunded=%d: a definite failure must release the reservation", in.RefundReservedKobo, in.RefundedKobo)
	}
	if len(p.lg.calls) != 0 {
		t.Errorf("ledger reversed for a refund that failed: %v", p.lg.calls)
	}
	p.gw.pFailed = false
	if err := p.refund(p.depID()); err != nil {
		t.Fatalf("retry: %v", err)
	}
	if got := p.row(t, p.depID()); got.Status != PartialRefunded || got.Attempts != 2 {
		t.Errorf("row %+v", got)
	}
	if in := p.intent(t); in.RefundedKobo != pDeposit {
		t.Errorf("refunded %d", in.RefundedKobo)
	}
}

// H2 (third ledger audit): an ambiguous POST reply followed by an EMPTY lookup is
// NOT proof the refund did not happen — Paystack's list can lag the POST. The
// piece must stay 'refunding' with its reservation, and another POST is only
// allowed once the lookup is clean AND the last POST attempt is older than the lag
// bound (a stale takeover obeys the same rule).
func TestPartial_AmbiguousError_EmptyLookup_StaysRefunding_NoImmediateSecondPost(t *testing.T) {
	p := newPartialRig(t)
	p.gw.pErr = errors.New("paystack: server error 502") // reply unreadable; the refund MAY have been created
	if err := p.refund(p.depID()); err == nil {
		t.Fatal("expected error")
	}
	got := p.row(t, p.depID())
	if got.Status != PartialRefunding || got.PostAttemptedAt == nil {
		t.Fatalf("row %+v: an ambiguous POST + empty lookup must stay refunding with the attempt recorded", got)
	}
	if in := p.intent(t); in.RefundReservedKobo != pDeposit {
		t.Errorf("reserved %d: the reservation must be kept", in.RefundReservedKobo)
	}
	if len(p.lg.calls) != 0 {
		t.Errorf("ledger reversed: %v", p.lg.calls)
	}
	// Immediate retry: the claim is fresh -> in flight, no second POST.
	if err := p.refund(p.depID()); !errors.Is(err, ErrPartialInFlight) {
		t.Errorf("immediate retry err = %v", err)
	}
	// Stale takeover INSIDE the lag window (3 min < 10 min): clean lookup, still no POST.
	p.gw.pErr = nil
	aged(p.rig, 3*time.Minute)
	if err := p.refund(p.depID()); err == nil {
		t.Fatal("a takeover inside the lag window must not complete the refund")
	}
	if len(p.gw.pCalls) != 1 {
		t.Fatalf("%d POSTs inside the lag window, want 1: a lagging gateway list would have produced a DOUBLE deposit refund", len(p.gw.pCalls))
	}
	// Past the lag bound with a clean lookup: ONE more POST is allowed and finishes.
	aged(p.rig, 11*time.Minute)
	if err := p.refund(p.depID()); err != nil {
		t.Fatalf("after the lag window: %v", err)
	}
	if len(p.gw.pCalls) != 2 {
		t.Errorf("%d POSTs, want exactly 2 (the ambiguous one + one after the lag bound)", len(p.gw.pCalls))
	}
	if got := p.row(t, p.depID()); got.Status != PartialRefunded {
		t.Errorf("row %s", got.Status)
	}
}

func TestPartial_InsideLagWindow_ALateListedRefund_IsAdoptedNotRepeated(t *testing.T) {
	p := newPartialRig(t)
	p.gw.pErr = errors.New("paystack: server error 502")
	_ = p.refund(p.depID())
	// The gateway's list catches up: the refund of the ambiguous POST now appears.
	p.gw.pErr = nil
	p.gw.pRefunds = []provider.RefundResult{{Reference: p.ref, Status: "processed", AmountKobo: pDeposit, ID: "gw-late"}}
	aged(p.rig, 3*time.Minute)
	if err := p.refund(p.depID()); err != nil {
		t.Fatalf("adopt the late-listed refund: %v", err)
	}
	if len(p.gw.pCalls) != 1 {
		t.Errorf("%d POSTs: a late-listed refund must be adopted, never repeated", len(p.gw.pCalls))
	}
	if got := p.row(t, p.depID()); got.Status != PartialRefunded || got.GatewayRefundID == nil || *got.GatewayRefundID != "gw-late" {
		t.Errorf("row %+v", got)
	}
}

func TestPartial_PostAttemptIsRecordedBeforeThePost(t *testing.T) {
	p := newPartialRig(t)
	var at *time.Time
	p.gw.pOnRefund = func(string, int64) { at = p.row(t, p.depID()).PostAttemptedAt }
	if err := p.refund(p.depID()); err != nil {
		t.Fatal(err)
	}
	if at == nil {
		t.Fatal("post_attempted_at was not persisted before the gateway POST: a crash mid-POST would look like 'never attempted' and allow an immediate second POST")
	}
}

func TestPartial_DefiniteFailure_ClearsThePostAttempt_SoAnImmediateRetryMayPost(t *testing.T) {
	p := newPartialRig(t)
	p.gw.pFailed = true
	_ = p.refund(p.depID())
	if got := p.row(t, p.depID()); got.Status != PartialFailed || got.PostAttemptedAt != nil {
		t.Fatalf("row %+v: a definite failure releases the reservation AND the post-attempt hold", got)
	}
	p.gw.pFailed = false
	p.gw.pRefunds = nil
	if err := p.refund(p.depID()); err != nil {
		t.Fatalf("immediate retry after a definite failure: %v", err)
	}
}

func TestPartial_AmbiguousThenLookupShowsFailedWithOurNote_IsDefiniteFailure(t *testing.T) {
	p := newPartialRig(t)
	p.gw.pErr = errors.New("paystack: server error 502")
	p.gw.pFailedOnErr = true
	p.gw.pEcho = true
	if err := p.refund(p.depID()); err == nil {
		t.Fatal("expected error")
	}
	got := p.row(t, p.depID())
	if got.Status != PartialFailed {
		t.Errorf("row %s: the gateway itself lists OUR attempt as failed — that is a definite non-refund", got.Status)
	}
	if in := p.intent(t); in.RefundReservedKobo != 0 {
		t.Errorf("reserved %d", in.RefundReservedKobo)
	}
}

// M1: only an explicit `failed` is ignorable; any other non-accepted status is unknowable.
func TestPartial_NonAcceptedNonFailedGatewayStatus_IsUnknown_NoPost(t *testing.T) {
	for _, st := range []string{"needs-attention", "reversed", "weird", ""} {
		p := newPartialRig(t)
		p.gw.pRefunds = []provider.RefundResult{{Reference: p.ref, Status: st, AmountKobo: pDeposit, ID: "gw-x"}}
		if err := p.refund(p.depID()); err == nil {
			t.Fatalf("status %q: refund proceeded over an unclassifiable gateway refund", st)
		}
		p.noGatewayTraffic(t)
		if got := p.row(t, p.depID()); got.Status != PartialRefunding {
			t.Errorf("status %q: row %s", st, got.Status)
		}
	}
}

func TestPartial_AlreadyReversedButNothingVisible_StaysRefunding(t *testing.T) {
	p := newPartialRig(t)
	p.gw.pErr = provider.ErrAlreadyReversed
	if err := p.refund(p.depID()); err == nil {
		t.Fatal("expected error")
	}
	if got := p.row(t, p.depID()); got.Status != PartialRefunding {
		t.Errorf("row %s: 'already reversed' with no visible refund is unknowable — never claim either way", got.Status)
	}
}

func TestPartial_LookupFails_StaysRefunding_NoPost(t *testing.T) {
	p := newPartialRig(t)
	p.gw.pListErr = errors.New("gateway down")
	if err := p.refund(p.depID()); err == nil {
		t.Fatal("expected error")
	}
	p.noGatewayTraffic(t)
	if got := p.row(t, p.depID()); got.Status != PartialRefunding {
		t.Errorf("row %s", got.Status)
	}
}

func TestPartial_GatewayReportsADifferentAmount_IsUnknownNotRefunded(t *testing.T) {
	p := newPartialRig(t)
	p.gw.pAmountOverride = pDeposit - 1
	if err := p.refund(p.depID()); err == nil {
		t.Fatal("a short refund is not the customer's money back")
	}
	if got := p.row(t, p.depID()); got.Status != PartialRefunding {
		t.Errorf("row %s", got.Status)
	}
	if len(p.lg.calls) != 0 {
		t.Errorf("ledger reversed: %v", p.lg.calls)
	}
}

func TestPartial_GatewayOKButMarkFails_LeavesRefunding_NotAFalseFailure(t *testing.T) {
	p := newPartialRig(t)
	p.st.partialMarkErr = errors.New("db blip")
	if err := p.refund(p.depID()); err == nil {
		t.Fatal("expected error")
	}
	if got := p.row(t, p.depID()); got.Status != PartialRefunding {
		t.Fatalf("row %s", got.Status)
	}
	// The retry (after the stale window) finds the refund by arithmetic: no second POST.
	p.st.partialMarkErr = nil
	aged(p.rig, 3*time.Minute)
	if err := p.refund(p.depID()); err != nil {
		t.Fatalf("retry: %v", err)
	}
	if len(p.gw.pCalls) != 1 {
		t.Errorf("%d POSTs, want exactly 1", len(p.gw.pCalls))
	}
	if got := p.row(t, p.depID()); got.Status != PartialRefunded {
		t.Errorf("row %s", got.Status)
	}
}

func TestPartial_LedgerFailsAfterGatewayRefund_RetrySkipsGateway(t *testing.T) {
	p := newPartialRig(t)
	p.lg.err = errors.New("ledger down")
	if err := p.refund(p.depID()); err == nil {
		t.Fatal("expected error")
	}
	if got := p.row(t, p.depID()); got.Status != PartialRefunded {
		t.Fatalf("row %s: the customer WAS refunded", got.Status)
	}
	p.lg.err = nil
	if err := p.refund(p.depID()); err != nil {
		t.Fatalf("retry: %v", err)
	}
	if len(p.gw.pCalls) != 1 {
		t.Errorf("%d POSTs: the retry must only finish the ledger", len(p.gw.pCalls))
	}
	if p.lg.setts["sett-dep"].Status != settlement.StatusRefunded {
		t.Error("settlement not reversed ledger-side")
	}
}

// ── validation before ANY gateway call ──────────────────────────────────────

func TestPartial_SettlementValidatedBeforeTheGateway(t *testing.T) {
	cases := map[string]func(*prig){
		"wallet funded": func(p *prig) { p.lg.setts["sett-dep"].FundingSource = "wallet" },
		"other payer":   func(p *prig) { p.lg.setts["sett-dep"].PayerID = "u2" },
		"foreign key":   func(p *prig) { p.lg.setts["sett-dep"].IdempotencyKey = "fakeorder:other-key-1:deposit" },
		"nested suffix": func(p *prig) { p.lg.setts["sett-dep"].IdempotencyKey = p.ref + ":a:b" },
		"empty suffix":  func(p *prig) { p.lg.setts["sett-dep"].IdempotencyKey = p.ref + ":" },
		"settled":       func(p *prig) { p.lg.setts["sett-dep"].Status = settlement.StatusSettled },
		"zero total":    func(p *prig) { p.lg.setts["sett-dep"].TotalKobo = 0 },
		"over the charge": func(p *prig) {
			p.lg.setts["sett-dep"].TotalKobo = pTotal + 1
		},
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			p := newPartialRig(t)
			mutate(p)
			if err := p.refund(p.depID()); err == nil {
				t.Fatal("expected a refusal")
			}
			p.noGatewayTraffic(t)
			if atomic.LoadInt32(&p.gw.pListCalls) != 0 {
				t.Error("gateway consulted before validation")
			}
			if in := p.intent(t); in.RefundReservedKobo != 0 {
				t.Errorf("reserved %d leaked", in.RefundReservedKobo)
			}
			if len(p.lg.calls) != 0 {
				t.Errorf("ledger %v", p.lg.calls)
			}
		})
	}
}

func TestPartial_SettlementLookupFails_NoGatewayCall(t *testing.T) {
	p := newPartialRig(t)
	p.lg.getErr = errors.New("db down")
	if err := p.refund(p.depID()); err == nil {
		t.Fatal("expected error")
	}
	p.noGatewayTraffic(t)
}

func TestPartial_RefundedSettlementWithUnrefundedRow_NeedsManualNoGatewayCall(t *testing.T) {
	p := newPartialRig(t)
	p.lg.setts["sett-dep"].Status = settlement.StatusRefunded
	if err := p.refund(p.depID()); err == nil {
		t.Fatal("ledger says refunded but no refund of this piece is recorded: manual reconciliation, not a silent no-op")
	}
	p.noGatewayTraffic(t)
}

func TestPartial_IntentNotConfirmed_Refused(t *testing.T) {
	for _, st := range []string{StatusPending, StatusProcessing, StatusOrderFailed, StatusRefunding} {
		p := newPartialRig(t)
		p.st.byRef[p.ref].Status = st
		if err := p.refund(p.depID()); !errors.Is(err, ErrIntentNotRefundable) {
			t.Errorf("%s: err = %v, want ErrIntentNotRefundable", st, err)
		}
		p.noGatewayTraffic(t)
	}
}

func TestPartial_NoPartialGatewayWired_FailsClosed(t *testing.T) {
	r := newRig()
	r.d.quote = pTotal
	r.gw.verify = &provider.PaymentStatus{Status: "success", AmountKobo: pTotal, Currency: "NGN"}
	ref := confirmed(t, r) // EnablePartialRefunds deliberately NOT called
	r.lg.setts = map[string]*settlement.Settlement{
		"sett-dep": {ID: "sett-dep", Status: settlement.StatusEscrowed, FundingSource: "external", TotalKobo: pDeposit, PayerID: "u1", IdempotencyKey: ref + ":deposit"},
	}
	err := r.e.RefunderFor("fake").RefundExternalSettlement(context.Background(), "ent-1", "sett-dep", "released")
	if !errors.Is(err, ErrPartialRefundsUnsupported) {
		t.Fatalf("err = %v, want ErrPartialRefundsUnsupported", err)
	}
	if len(r.gw.pCalls) != 0 || len(r.gw.refundCalls) != 0 || len(r.lg.calls) != 0 {
		t.Error("money moved with partial refunds disabled")
	}
}

// ── concurrency / fencing ───────────────────────────────────────────────────

func TestPartial_ConcurrentDifferentPieces_SingleInFlight(t *testing.T) {
	p := newPartialRig(t)
	entered, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	p.gw.pOnRefund = func(string, int64) {
		once.Do(func() { close(entered) })
		<-release
	}
	done := make(chan error, 1)
	go func() { done <- p.refund(p.fareID()) }()
	<-entered
	// While the fare refund is in flight, the deposit refund must be refused and
	// must NOT reach the gateway.
	err := p.refund(p.depID())
	if !errors.Is(err, ErrPartialInFlight) {
		t.Fatalf("concurrent piece err = %v, want ErrPartialInFlight", err)
	}
	if len(p.gw.pCalls) != 1 {
		t.Fatalf("%d gateway calls while one piece is in flight", len(p.gw.pCalls))
	}
	close(release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	p.gw.pOnRefund = nil
	if err := p.refund(p.depID()); err != nil {
		t.Fatalf("deposit after the fare finished: %v", err)
	}
	if len(p.gw.pCalls) != 2 {
		t.Errorf("%d gateway calls, want 2", len(p.gw.pCalls))
	}
}

func TestPartial_SameCallRacing_OnlyOneGatewayRefund(t *testing.T) {
	p := newPartialRig(t)
	var wg sync.WaitGroup
	var mu sync.Mutex
	var ok int
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if p.refund(p.depID()) == nil {
				mu.Lock()
				ok++
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	if len(p.gw.pCalls) != 1 {
		t.Fatalf("%d gateway refunds for one piece raced 8×", len(p.gw.pCalls))
	}
	if ok < 1 {
		t.Error("nobody completed the refund")
	}
}

func TestPartial_StaleOwnerCannotRecordOverSuccessor(t *testing.T) {
	p := newPartialRig(t)
	ctx := context.Background()
	a, err := p.st.BeginPartialRefund(ctx, p.ref, "sett-dep", "sett-dep", pDeposit, staleClaimAfter)
	if err != nil {
		t.Fatal(err)
	}
	aged(p.rig, 3*time.Minute)
	b, err := p.st.BeginPartialRefund(ctx, p.ref, "sett-dep", "sett-dep", pDeposit, staleClaimAfter)
	if err != nil || b.Fence == a.Fence || b.Prev != PartialRefunding {
		t.Fatalf("takeover %+v %v (first fence %d)", b, err, a.Fence)
	}
	if ok, _ := p.st.MarkPartialRefunded(ctx, p.ref, "sett-dep", a.Fence, "x"); ok {
		t.Error("stale owner recorded a refund over its successor")
	}
	if ok, _ := p.st.MarkPartialFailed(ctx, p.ref, "sett-dep", a.Fence); ok {
		t.Error("stale owner released the successor's reservation")
	}
	if ok, err := p.st.MarkPartialRefunded(ctx, p.ref, "sett-dep", b.Fence, "y"); err != nil || !ok {
		t.Errorf("successor mark: %v %v", ok, err)
	}
}

func TestPartial_FreshRefundingRowIsNotTakenOver(t *testing.T) {
	p := newPartialRig(t)
	ctx := context.Background()
	if _, err := p.st.BeginPartialRefund(ctx, p.ref, "sett-dep", "sett-dep", pDeposit, staleClaimAfter); err != nil {
		t.Fatal(err)
	}
	if _, err := p.st.BeginPartialRefund(ctx, p.ref, "sett-dep", "sett-dep", pDeposit, staleClaimAfter); !errors.Is(err, ErrPartialInFlight) {
		t.Errorf("err = %v, want ErrPartialInFlight", err)
	}
}

func TestFullRefund_BlockedWhileReservedPartialsExist(t *testing.T) {
	p := newPartialRig(t)
	if err := p.refund(p.depID()); err != nil {
		t.Fatal(err)
	}
	// A whole-charge refund (single-settlement shape: key == reference, total ==
	// charge) must not start on top of piece refunds — it would over-refund.
	p.lg.setts["sett-whole"] = &settlement.Settlement{ID: "sett-whole", Status: settlement.StatusEscrowed, FundingSource: "external", TotalKobo: pTotal, PayerID: "u1", IdempotencyKey: p.ref}
	calls := len(p.gw.refundCalls)
	if err := p.refund("sett-whole"); err == nil {
		t.Fatal("whole-charge refund started over piece refunds")
	}
	if len(p.gw.refundCalls) != calls {
		t.Error("whole-charge gateway refund issued after a piece was refunded")
	}
}

// ── reconciler ──────────────────────────────────────────────────────────────

func stalePartial(t *testing.T, p *prig, id string, amt int64) {
	t.Helper()
	if _, err := p.st.BeginPartialRefund(context.Background(), p.ref, id, id, amt, staleClaimAfter); err != nil {
		t.Fatal(err)
	}
	aged(p.rig, 10*time.Minute)
}

func TestReconcile_PartialRefunding_ResolvesByLookup_NoSecondRefund(t *testing.T) {
	p := newPartialRig(t)
	stalePartial(t, p, p.depID(), pDeposit)
	p.gw.pRefunds = []provider.RefundResult{{Reference: p.ref, Status: "processed", AmountKobo: pDeposit, ID: "gw-1"}}
	st, err := p.e.Reconcile(context.Background(), 5*time.Minute, 7*24*time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	p.noGatewayTraffic(t)
	if got := p.row(t, p.depID()); got.Status != PartialRefunded {
		t.Errorf("row %s", got.Status)
	}
	if len(p.lg.calls) != 1 || st.RefundsCompleted < 1 {
		t.Errorf("ledger %v stats %+v", p.lg.calls, st)
	}
}

func TestReconcile_PartialRefunding_GatewayHoldsNothing_IssuesTheRefundOnce(t *testing.T) {
	p := newPartialRig(t)
	stalePartial(t, p, p.depID(), pDeposit)
	if _, err := p.e.Reconcile(context.Background(), 5*time.Minute, 7*24*time.Hour); err != nil {
		t.Fatal(err)
	}
	if len(p.gw.pCalls) != 1 || p.gw.pCalls[0].Amt != pDeposit {
		t.Fatalf("calls %+v", p.gw.pCalls)
	}
	if got := p.row(t, p.depID()); got.Status != PartialRefunded {
		t.Errorf("row %s", got.Status)
	}
	// A second sweep is a no-op.
	if _, err := p.e.Reconcile(context.Background(), 5*time.Minute, 7*24*time.Hour); err != nil {
		t.Fatal(err)
	}
	if len(p.gw.pCalls) != 1 {
		t.Errorf("second sweep issued another refund (%d)", len(p.gw.pCalls))
	}
}

func TestReconcile_PartialRefunding_UnexplainedGatewayState_LeftAlone(t *testing.T) {
	p := newPartialRig(t)
	stalePartial(t, p, p.depID(), pDeposit)
	p.gw.pRefunds = []provider.RefundResult{{Reference: p.ref, Status: "processed", AmountKobo: 5, ID: "dash"}}
	if _, err := p.e.Reconcile(context.Background(), 5*time.Minute, 7*24*time.Hour); err != nil {
		t.Fatal(err)
	}
	p.noGatewayTraffic(t)
	if got := p.row(t, p.depID()); got.Status != PartialRefunding {
		t.Errorf("row %s", got.Status)
	}
}

func TestReconcile_PartialRefunding_LeavesFreshRowsAlone(t *testing.T) {
	p := newPartialRig(t)
	if _, err := p.st.BeginPartialRefund(context.Background(), p.ref, p.depID(), p.depID(), pDeposit, staleClaimAfter); err != nil {
		t.Fatal(err)
	}
	if _, err := p.e.Reconcile(context.Background(), 5*time.Minute, 7*24*time.Hour); err != nil {
		t.Fatal(err)
	}
	p.noGatewayTraffic(t)
}

func TestReconcile_RefundedRowWithEscrowedSettlement_FinishesLedger(t *testing.T) {
	p := newPartialRig(t)
	p.lg.err = errors.New("ledger down")
	_ = p.refund(p.depID()) // gateway done, ledger failed
	p.lg.err = nil
	p.lg.calls = nil
	p.gw.pCalls = nil
	st, err := p.e.Reconcile(context.Background(), 0, 7*24*time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if len(p.lg.calls) != 1 || p.lg.setts["sett-dep"].Status != settlement.StatusRefunded {
		t.Errorf("ledger %v settlement %s", p.lg.calls, p.lg.setts["sett-dep"].Status)
	}
	p.noGatewayTraffic(t)
	_ = st
	// Nothing left: a second sweep makes no ledger call.
	p.lg.calls = nil
	if _, err := p.e.Reconcile(context.Background(), 0, 7*24*time.Hour); err != nil {
		t.Fatal(err)
	}
	if len(p.lg.calls) != 0 {
		t.Errorf("a finished refund was reversed again: %v", p.lg.calls)
	}
}

func TestReconcile_PartialDisabled_SweepIgnoresPartialRows(t *testing.T) {
	r := newRig()
	if _, err := r.e.Reconcile(context.Background(), 0, time.Hour); err != nil {
		t.Fatalf("a sweep with partial refunds disabled must still work: %v", err)
	}
}

var _ = strings.HasPrefix

func TestReconcile_PartialRefunding_InsideLagWindowNoPost_AfterLagBoundPosts(t *testing.T) {
	p := newPartialRig(t)
	p.gw.pErr = errors.New("paystack: server error 502")
	_ = p.refund(p.depID()) // ambiguous POST #1
	p.gw.pErr = nil
	aged(p.rig, 6*time.Minute) // past minAge and the stale window, inside the 10 min lag bound
	if _, err := p.e.Reconcile(context.Background(), 5*time.Minute, 7*24*time.Hour); err != nil {
		t.Fatal(err)
	}
	if len(p.gw.pCalls) != 1 {
		t.Fatalf("sweeper POSTed inside the lag window: %d", len(p.gw.pCalls))
	}
	aged(p.rig, 20*time.Minute)
	if _, err := p.e.Reconcile(context.Background(), 5*time.Minute, 7*24*time.Hour); err != nil {
		t.Fatal(err)
	}
	if len(p.gw.pCalls) != 2 || p.row(t, p.depID()).Status != PartialRefunded {
		t.Errorf("after the lag bound: POSTs=%d row=%s", len(p.gw.pCalls), p.row(t, p.depID()).Status)
	}
}

func TestPartial_LagBoundIsConfigurable(t *testing.T) {
	p := newPartialRig(t)
	p.e.SetPartialLagBound(30 * time.Minute)
	p.gw.pErr = errors.New("paystack: server error 502")
	_ = p.refund(p.depID())
	p.gw.pErr = nil
	aged(p.rig, 11*time.Minute) // beyond the default, inside the configured bound
	if err := p.refund(p.depID()); err == nil || len(p.gw.pCalls) != 1 {
		t.Fatalf("err=%v POSTs=%d: the configured 30 min bound must hold", err, len(p.gw.pCalls))
	}
	aged(p.rig, 31*time.Minute)
	if err := p.refund(p.depID()); err != nil {
		t.Fatal(err)
	}
}
