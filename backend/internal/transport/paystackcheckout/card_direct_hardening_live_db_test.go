package paystackcheckout

// LIVE-DB (TEST_DATABASE_URL) proofs of the ledger-audit findings that can only
// be proven against real SQL: the fence (H1), refund claim/sweep queries (H4/H7),
// refund-before-ledger ordering (H6), the replayed-escrow guard end to end (H2),
// frozen pricing (H8) and the unique entity index (L3).

import (
	"context"
	"encoding/json"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"

	"spotlight/backend/internal/provider"
	"spotlight/backend/internal/transport"
)

func backdateClaim(t *testing.T, r *liveRig, ref string, ago string) {
	t.Helper()
	if _, err := r.pool.Exec(context.Background(),
		`UPDATE public.transport_paystack_intents SET claimed_at = now() - $2::interval WHERE reference=$1`, ref, ago); err != nil {
		t.Fatal(err)
	}
}

func rowOf(t *testing.T, r *liveRig, ref string) *Intent {
	t.Helper()
	rec, err := NewPGStore(r.pool).Get(context.Background(), ref)
	if err != nil {
		t.Fatal(err)
	}
	return rec
}

func initiateLive(t *testing.T, r *liveRig, prefix string) *Checkout {
	t.Helper()
	co, err := r.e.Initiate(context.Background(), "parcel", r.sender, json.RawMessage(liveParcelBody), prefix+uuid.New().String(), "a@b.test", "")
	if err != nil {
		t.Fatal(err)
	}
	return co
}

// ── H1 ──────────────────────────────────────────────────────────────────────

func TestLiveDB_PGStore_FenceStopsStaleOwner(t *testing.T) {
	r := newLiveRig(t)
	ctx := context.Background()
	co := initiateLive(t, r, "cdh1-")
	st := NewPGStore(r.pool)

	fenceA, ok, err := st.Claim(ctx, co.Reference, staleClaimAfter)
	if err != nil || !ok {
		t.Fatalf("claim A: %v %v", ok, err)
	}
	backdateClaim(t, r, co.Reference, "3 minutes") // owner A stalls past the stale window
	fenceB, ok, err := st.Claim(ctx, co.Reference, staleClaimAfter)
	if err != nil || !ok {
		t.Fatalf("takeover claim B: %v %v", ok, err)
	}
	if fenceB == fenceA {
		t.Fatalf("takeover must hand out a NEW fence (both %d)", fenceA)
	}

	// The old claimer wakes up and tries to write.
	stale := "ent-from-stale-owner"
	applied, err := st.Mark(ctx, co.Reference, Transition{From: StatusProcessing, To: StatusConfirmed, Fence: fenceA, EntityID: &stale})
	if err != nil || applied {
		t.Fatalf("stale owner's Mark applied=%v err=%v, want 0 rows affected", applied, err)
	}
	if rec := rowOf(t, r, co.Reference); rec.Status != StatusProcessing || rec.EntityID != nil {
		t.Fatalf("stale write leaked: %s entity=%v", rec.Status, rec.EntityID)
	}

	// The new owner finishes ...
	good := "ent-from-new-owner"
	if applied, err := st.Mark(ctx, co.Reference, Transition{From: StatusProcessing, To: StatusConfirmed, Fence: fenceB, EntityID: &good}); err != nil || !applied {
		t.Fatalf("new owner Mark applied=%v err=%v", applied, err)
	}
	// ... and no stale writer may overwrite the terminal state, whatever it tries.
	rf := "rf-stale"
	for _, tr := range []Transition{
		{From: StatusProcessing, To: StatusRefunded, Fence: fenceA, RefundReference: &rf},
		{From: StatusConfirmed, To: StatusRefunded, Fence: fenceA, RefundReference: &rf},
		{From: StatusProcessing, To: StatusRefunding, Fence: fenceB, RefundFrom: StatusOrderFailed, RefundAmountKobo: 1},
		{From: StatusProcessing, To: StatusConfirmed, Fence: fenceB, EntityID: &stale},
	} {
		if applied, err := st.Mark(ctx, co.Reference, tr); err != nil || applied {
			t.Errorf("transition %+v applied=%v err=%v: a terminal state was overwritten", tr, applied, err)
		}
	}
	rec := rowOf(t, r, co.Reference)
	if rec.Status != StatusConfirmed || rec.EntityID == nil || *rec.EntityID != good || rec.RefundReference != nil {
		t.Errorf("terminal state corrupted: %s entity=%v refund=%v", rec.Status, rec.EntityID, rec.RefundReference)
	}
}

func TestLiveDB_Engine_ConfirmedByStaleOwnerAfterTakeover_ReportsSuccessorState(t *testing.T) {
	r := newLiveRig(t)
	ctx := context.Background()
	co := initiateLive(t, r, "cdh1e-")
	r.gw.verify = &provider.PaymentStatus{Status: "success", AmountKobo: co.AmountKobo, Currency: "NGN"}
	// Owner A claims and stalls; the claim is backdated and B (the engine) takes over.
	st := NewPGStore(r.pool)
	if _, ok, _ := st.Claim(ctx, co.Reference, staleClaimAfter); !ok {
		t.Fatal("claim A")
	}
	backdateClaim(t, r, co.Reference, "3 minutes")
	res, err := r.e.OnChargeSuccess(ctx, co.Reference, co.Reference)
	if err != nil || res.Status != StatusConfirmed {
		t.Fatalf("takeover confirm: %+v %v", res, err)
	}
	if n := countParcels(t, r, co.Reference); n != 1 {
		t.Errorf("%d parcels", n)
	}
}

func countParcels(t *testing.T, r *liveRig, key string) int {
	t.Helper()
	var n int
	if err := r.pool.QueryRow(context.Background(), `SELECT count(*) FROM parcels WHERE idempotency_key=$1`, key).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// ── H4 / H7 SQL ─────────────────────────────────────────────────────────────

func TestLiveDB_PGStore_BeginRefund_FencedAndStaleTakeover(t *testing.T) {
	r := newLiveRig(t)
	ctx := context.Background()
	co := initiateLive(t, r, "cdh4-")
	r.gw.verify = &provider.PaymentStatus{Status: "success", AmountKobo: co.AmountKobo, Currency: "NGN"}
	if _, err := r.e.OnChargeSuccess(ctx, co.Reference, co.Reference); err != nil {
		t.Fatal(err)
	}
	st := NewPGStore(r.pool)

	a, ok, err := st.BeginRefund(ctx, co.Reference, []string{StatusConfirmed}, staleClaimAfter)
	if err != nil || !ok || a.Prev != StatusConfirmed || a.RefundFrom != StatusConfirmed || a.RefundAmountKobo != co.AmountKobo {
		t.Fatalf("first BeginRefund: %+v ok=%v err=%v", a, ok, err)
	}
	if _, ok, _ := st.BeginRefund(ctx, co.Reference, []string{StatusConfirmed}, staleClaimAfter); ok {
		t.Fatal("a FRESH refunding claim must not be takeable (concurrent refund)")
	}
	backdateClaim(t, r, co.Reference, "3 minutes")
	b, ok, err := st.BeginRefund(ctx, co.Reference, []string{StatusConfirmed}, staleClaimAfter)
	if err != nil || !ok || b.Prev != StatusRefunding || b.Fence == a.Fence || b.RefundFrom != StatusConfirmed {
		t.Fatalf("stale takeover: %+v ok=%v err=%v", b, ok, err)
	}
	rf := "rf-old-owner"
	if applied, _ := st.Mark(ctx, co.Reference, Transition{From: StatusRefunding, To: StatusRefunded, Fence: a.Fence, RefundReference: &rf}); applied {
		t.Fatal("the old refunding owner's write must be fenced out")
	}
	if rows, _ := st.ListForSweep(ctx, []string{StatusRefunding}, time.Minute, 0, 50); len(rows) != 0 {
		t.Errorf("a refunding row younger than the min age must not be listed (%d)", len(rows))
	}
	backdateClaim(t, r, co.Reference, "10 minutes")
	rows, err := st.ListForSweep(ctx, []string{StatusRefunding}, 5*time.Minute, 0, 50)
	if err != nil || len(rows) == 0 {
		t.Fatalf("sweep query: %d rows err=%v (an idle 'refunding' row must be listed)", len(rows), err)
	}
	found := false
	for _, row := range rows {
		found = found || row.Reference == co.Reference
	}
	if !found {
		t.Errorf("sweep did not list %s", co.Reference)
	}
	if applied, err := st.Mark(ctx, co.Reference, Transition{From: StatusRefunding, To: StatusRefunded, Fence: b.Fence, RefundReference: &rf}); err != nil || !applied {
		t.Fatalf("current owner Mark: %v %v", applied, err)
	}
}

func TestLiveDB_Reconcile_StrandedAmountMismatch_RefundsCollectedAmountViaSQL(t *testing.T) {
	r := newLiveRig(t)
	ctx := context.Background()
	co := initiateLive(t, r, "cdh7-")
	collected := co.AmountKobo - 100
	r.gw.verify = &provider.PaymentStatus{Status: "success", AmountKobo: collected, Currency: "NGN"}
	r.gw.refundErr = errors.New("paystack 500")
	_, _ = r.e.OnChargeSuccess(ctx, co.Reference, co.Reference)
	rec := rowOf(t, r, co.Reference)
	if rec.Status != StatusAmountMismatch || rec.RefundReference != nil || rec.RefundAmountKobo != collected {
		t.Fatalf("setup: %s refundRef=%v refundAmt=%d (want mismatch / none / %d)", rec.Status, rec.RefundReference, rec.RefundAmountKobo, collected)
	}
	r.gw.refundErr = nil
	backdateClaim(t, r, co.Reference, "10 minutes")
	if _, err := r.e.Reconcile(ctx, 5*time.Minute, 7*24*time.Hour); err != nil {
		t.Fatal(err)
	}
	rec = rowOf(t, r, co.Reference)
	if rec.Status != StatusRefunded || rec.RefundReference == nil {
		t.Fatalf("reconcile result %s ref=%v", rec.Status, rec.RefundReference)
	}
	if last := r.gw.refundCalls[len(r.gw.refundCalls)-1]; last != collected {
		t.Errorf("retry refunded %d, want the collected %d", last, collected)
	}
	if n := countParcels(t, r, co.Reference); n != 0 {
		t.Errorf("a mismatched charge booked %d parcels", n)
	}
}

// ── H2 end to end ───────────────────────────────────────────────────────────

func TestLiveDB_Engine_ReplayOverRefundedExternalSettlement_BooksNothing_RefundsGateway(t *testing.T) {
	r := newLiveRig(t)
	ctx := context.Background()
	co := initiateLive(t, r, "cdh2-")

	// A previous attempt escrowed, was unwound ledger-side (settlement refunded)
	// and left no parcel; the charge is still sitting verified at the gateway.
	var req transport.ParcelBookRequest
	if err := json.Unmarshal([]byte(liveParcelBody), &req); err != nil {
		t.Fatal(err)
	}
	pid, err := r.svc.BookParcelPaystackFunded(ctx, r.sender, req, co.Reference, co.AmountKobo)
	if err != nil {
		t.Fatal(err)
	}
	var sid string
	if err := r.pool.QueryRow(ctx, `SELECT settlement_id FROM parcels WHERE id=$1`, pid).Scan(&sid); err != nil {
		t.Fatal(err)
	}
	if _, err := r.pool.Exec(ctx, `DELETE FROM parcels WHERE id=$1`, pid); err != nil {
		t.Fatal(err)
	}
	if err := r.settle.RefundExternal(ctx, sid, "test_unwind"); err != nil {
		t.Fatal(err)
	}

	r.gw.verify = &provider.PaymentStatus{Status: "success", AmountKobo: co.AmountKobo, Currency: "NGN"}
	if _, err := r.e.OnChargeSuccess(ctx, co.Reference, co.Reference); err == nil {
		t.Fatal("must NOT confirm a booking onto a refunded escrow")
	}
	if n := countParcels(t, r, co.Reference); n != 0 {
		t.Fatalf("%d parcels booked on a refunded escrow", n)
	}
	rec := rowOf(t, r, co.Reference)
	if rec.Status != StatusRefunded || len(r.gw.refundCalls) != 1 || r.gw.refundCalls[0] != co.AmountKobo {
		t.Errorf("status=%s refunds=%v: the customer's money must go back exactly once", rec.Status, r.gw.refundCalls)
	}
	var st string
	_ = r.pool.QueryRow(ctx, `SELECT status FROM settlements WHERE id=$1`, sid).Scan(&st)
	if st != "refunded" {
		t.Errorf("settlement %q", st)
	}
}

// ── H6 end to end ───────────────────────────────────────────────────────────

// escrowThenFailDomain escrows through the real settlement service and then
// fails WITHOUT compensating — the worst case the engine must cope with.
type escrowThenFailDomain struct {
	r      *liveRig
	amount int64
}

func (escrowThenFailDomain) Name() string            { return "escrowfail" }
func (escrowThenFailDomain) ReferencePrefix() string { return "escrowfail:" }
func (escrowThenFailDomain) RoutePrefix() string     { return "/escrowfail/paystack" }
func (escrowThenFailDomain) EntityIDKey() string     { return "x" }
func (d escrowThenFailDomain) Quote(context.Context, string, json.RawMessage) (Quoted, error) {
	return Quoted{AmountKobo: d.amount}, nil
}
func (escrowThenFailDomain) Find(context.Context, string, string) (string, bool, error) {
	return "", false, nil
}
func (d escrowThenFailDomain) Book(ctx context.Context, payer string, _ json.RawMessage, _ json.RawMessage, idem string, amt int64) (string, error) {
	if _, err := d.r.settle.EscrowExternal(ctx, payer, "escrowfail:"+uuid.New().String(), idem, "transport", amt); err != nil {
		return "", err
	}
	return "", errors.New("insert failed after escrow, compensation also failed")
}

func TestLiveDB_Engine_OrderFailed_ExternalSettlementReversedBeforeGatewayRefund(t *testing.T) {
	r := newLiveRig(t)
	ctx := context.Background()
	e := NewEngine(r.gw, NewPGStore(r.pool), r.settle)
	e.Register(escrowThenFailDomain{r: r, amount: 123_000})
	key := "cdh6-" + uuid.New().String()
	co, err := e.Initiate(ctx, "escrowfail", r.sender, json.RawMessage(`{"a":1}`), key, "a@b.test", "")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = r.pool.Exec(context.WithoutCancel(ctx), `DELETE FROM public.transport_paystack_intents WHERE payer_id=$1`, r.sender)
	})
	r.gw.verify = &provider.PaymentStatus{Status: "success", AmountKobo: 123_000, Currency: "NGN"}

	var settlementAtRefund atomic.Value
	r.gw.onRefund = func(ref string) {
		var st string
		_ = r.pool.QueryRow(ctx, `SELECT status FROM settlements WHERE idempotency_key=$1`, ref).Scan(&st)
		settlementAtRefund.Store(st)
	}
	if _, err := e.OnChargeSuccess(ctx, co.Reference, co.Reference); err == nil {
		t.Fatal("want the booking error")
	}
	if got, _ := settlementAtRefund.Load().(string); got != "refunded" {
		t.Fatalf("settlement was %q when the customer was refunded; the escrow must already be reversed", got)
	}
	var debit, credit int64
	_ = r.pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_kobo) FILTER (WHERE type='DEBIT'),0), COALESCE(SUM(amount_kobo) FILTER (WHERE type='CREDIT'),0)
		FROM ledger_entries le JOIN settlements s ON le.reference IN ('escrow:'||s.reference, 'refund:'||s.reference)
		WHERE s.idempotency_key=$1`, co.Reference).Scan(&debit, &credit)
	if debit != credit || debit != 2*123_000 {
		t.Errorf("ledger debit=%d credit=%d, want balanced at %d (escrow in, escrow reversed)", debit, credit, 2*123_000)
	}
	if rec := rowOf(t, r, co.Reference); rec.Status != StatusRefunded || len(r.gw.refundCalls) != 1 {
		t.Errorf("status=%s refunds=%v", rec.Status, r.gw.refundCalls)
	}
}

// ── H8 end to end ───────────────────────────────────────────────────────────

// trafficMaps is a routing adapter whose duration changes on EVERY call (live
// traffic): the haversine distance stays put.
type trafficMaps struct {
	*transport.MockMaps
	calls int32
}

func (m *trafficMaps) Route(ctx context.Context, from, to transport.LatLng) (transport.RouteResult, error) {
	n := atomic.AddInt32(&m.calls, 1)
	rr, err := m.MockMaps.Route(ctx, from, to)
	rr.DurationS = 600 * int(n) // 10 min, 20 min, 30 min, …
	return rr, err
}

func TestLiveDB_TrafficAwareRouteChange_DoesNotCauseAmountMismatch(t *testing.T) {
	maps := &trafficMaps{MockMaps: transport.NewMockMaps()}
	r := newLiveRigMaps(t, maps)
	ctx := context.Background()
	co := initiateLive(t, r, "cdh8-")
	if string(rowOf(t, r, co.Reference).PricingJSON) == "" {
		t.Fatal("the priced route inputs must be frozen in the intent at initiate")
	}
	quoteCalls := atomic.LoadInt32(&maps.calls)

	r.gw.verify = &provider.PaymentStatus{Status: "success", AmountKobo: co.AmountKobo, Currency: "NGN"}
	res, err := r.e.OnChargeSuccess(ctx, co.Reference, co.Reference)
	if err != nil || res.Status != StatusConfirmed {
		t.Fatalf("a correctly charged order was not confirmed (traffic changed between charge and booking): %+v %v", res, err)
	}
	if len(r.gw.refundCalls) != 0 {
		t.Errorf("a correct charge was refunded: %v", r.gw.refundCalls)
	}
	if got := atomic.LoadInt32(&maps.calls); got != quoteCalls {
		t.Errorf("Book re-queried routing (%d → %d calls); it must price from the frozen inputs", quoteCalls, got)
	}
	var fare int64
	_ = r.pool.QueryRow(ctx, `SELECT fare_kobo FROM parcels WHERE id=$1`, *res.EntityID).Scan(&fare)
	if fare != co.AmountKobo {
		t.Errorf("parcel fare %d != charged %d", fare, co.AmountKobo)
	}
}

// ── L3 ──────────────────────────────────────────────────────────────────────

func TestLiveDB_UniqueIntentPerEntity(t *testing.T) {
	r := newLiveRig(t)
	ctx := context.Background()
	st := NewPGStore(r.pool)
	a, b := initiateLive(t, r, "cdl3a-"), initiateLive(t, r, "cdl3b-")
	entity := "ent-" + uuid.New().String()
	fa, _, _ := st.Claim(ctx, a.Reference, staleClaimAfter)
	fb, _, _ := st.Claim(ctx, b.Reference, staleClaimAfter)
	if applied, err := st.Mark(ctx, a.Reference, Transition{From: StatusProcessing, To: StatusConfirmed, Fence: fa, EntityID: &entity}); err != nil || !applied {
		t.Fatalf("first intent for the entity: %v %v", applied, err)
	}
	if _, err := st.Mark(ctx, b.Reference, Transition{From: StatusProcessing, To: StatusConfirmed, Fence: fb, EntityID: &entity}); err == nil {
		t.Fatal("two intents for one entity: the cancel/refund path resolves the intent BY entity and could refund the wrong charge")
	}
}
