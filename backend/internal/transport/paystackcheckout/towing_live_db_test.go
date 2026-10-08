package paystackcheckout

// LIVE-DB end-to-end test for the card-direct TOWING path: real Engine + real
// PGStore + real transport.Service / settlement / ledger, only the Paystack
// gateway faked (the towing counterpart of parcel_live_db_test.go). Gated on
// TEST_DATABASE_URL via livePool. Engine behaviours are proven once in
// engine_test.go / card_direct_hardening_live_db_test.go; this file proves the
// towing ADAPTER end to end: no wallet leg, one job per charge under a
// webhook+poll race, tampered amount books nothing, refunded-escrow replay,
// frozen routing, and cancel ⇒ exact gateway refund + balanced ledger.

import (
	"context"
	"encoding/json"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/google/uuid"

	"spotlight/backend/internal/provider"
	"spotlight/backend/internal/transport"
)

const liveTowingBody = `{"service_type":"flatbed","vehicle_type":"sedan","issue_type":"breakdown",
 "pickup":{"lat":6.5,"lng":3.4,"address":"3rd Mainland Bridge"},"dest":{"lat":6.6,"lng":3.35,"address":"AutoWorks Garage, Ikeja"}}`

func newTowingLiveRig(t *testing.T, maps transport.MapsAdapter) *liveRig {
	t.Helper()
	r := newLiveRigMaps(t, maps)
	r.e.Register(NewTowingDomain(r.svc))
	r.svc.SetDomainExternalRefunder(TowingDomainName, r.e.RefunderFor(TowingDomainName))
	return r
}

func countTowing(t *testing.T, r *liveRig, key string) int {
	t.Helper()
	var n int
	if err := r.pool.QueryRow(context.Background(), `SELECT count(*) FROM towing_jobs WHERE idempotency_key=$1`, key).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestLiveDB_TowingCardDirect_EndToEnd(t *testing.T) {
	r := newTowingLiveRig(t, nil)
	ctx := context.Background()
	key := "cdtow-" + uuid.New().String()

	co, err := r.e.Initiate(ctx, "towing", r.sender, json.RawMessage(liveTowingBody), key, "a@b.test", "")
	if err != nil {
		t.Fatalf("initiate (Tier-0 user): %v", err)
	}
	if co.AmountKobo <= 0 || co.Reference != "towingorder:"+key {
		t.Fatalf("checkout %+v", co)
	}
	r.gw.verify = &provider.PaymentStatus{Status: "success", AmountKobo: co.AmountKobo, Currency: "NGN"}

	var wg sync.WaitGroup
	for i := 0; i < 9; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			if i == 0 {
				_, _ = r.e.OnChargeSuccess(ctx, co.Reference, co.Reference)
			} else {
				_, _ = r.e.CheckStatus(ctx, co.Reference)
			}
		}(i)
	}
	wg.Wait()
	res, err := r.e.CheckStatus(ctx, co.Reference)
	if err != nil || res.Status != StatusConfirmed || res.EntityID == nil {
		t.Fatalf("not confirmed: %+v %v", res, err)
	}
	jobID := *res.EntityID
	if n := countTowing(t, r, co.Reference); n != 1 {
		t.Fatalf("%d jobs for one charge", n)
	}
	if len(r.gw.refundCalls) != 0 {
		t.Fatal("a booked job must not be refunded")
	}
	if bal := r.walletBalance(t); bal != 0 {
		t.Errorf("user wallet = %d, want 0 (never touched)", bal)
	}
	var fare int64
	_ = r.pool.QueryRow(ctx, `SELECT fare_kobo FROM towing_jobs WHERE id=$1`, jobID).Scan(&fare)
	if fare != co.AmountKobo {
		t.Errorf("job fare %d != charged %d", fare, co.AmountKobo)
	}

	again, err := r.e.Initiate(ctx, "towing", r.sender, json.RawMessage(liveTowingBody), key, "a@b.test", "")
	if err != nil || again.Status != StatusConfirmed || len(r.gw.initCalls) != 1 {
		t.Errorf("replay: %+v %v inits=%d", again, err, len(r.gw.initCalls))
	}

	if err := r.svc.CancelTowing(ctx, jobID, r.sender, "changed_mind"); err != nil {
		t.Fatalf("cancel: %v", err)
	}
	if len(r.gw.refundCalls) != 1 || r.gw.refundCalls[0] != co.AmountKobo || r.gw.refundedRefs[0] != co.Reference {
		t.Errorf("gateway refund %v %v", r.gw.refundCalls, r.gw.refundedRefs)
	}
	var sStatus string
	_ = r.pool.QueryRow(ctx, `SELECT s.status FROM towing_jobs j JOIN settlements s ON s.id=j.settlement_id WHERE j.id=$1`, jobID).Scan(&sStatus)
	if sStatus != "refunded" {
		t.Errorf("settlement %s, want refunded", sStatus)
	}
	rec, _ := NewPGStore(r.pool).Get(ctx, co.Reference)
	if rec.Status != StatusRefunded || rec.RefundReference == nil {
		t.Errorf("intent %s ref=%v", rec.Status, rec.RefundReference)
	}
	if bal := r.walletBalance(t); bal != 0 {
		t.Errorf("user wallet = %d after a card refund, want 0 (card money returns to the card)", bal)
	}
	var debit, credit int64
	_ = r.pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_kobo) FILTER (WHERE type='DEBIT'),0), COALESCE(SUM(amount_kobo) FILTER (WHERE type='CREDIT'),0)
		FROM ledger_entries WHERE reference IN ($1,$2)`, "escrow:towing:"+jobID, "refund:towing:"+jobID).Scan(&debit, &credit)
	if debit != credit || debit != 2*co.AmountKobo {
		t.Errorf("ledger debit=%d credit=%d, want balanced at %d", debit, credit, 2*co.AmountKobo)
	}
	_ = r.svc.CancelTowing(ctx, jobID, r.sender, "again")
	if len(r.gw.refundCalls) != 1 {
		t.Errorf("customer refunded %d times", len(r.gw.refundCalls))
	}
}

func TestLiveDB_TowingCardDirect_TamperedAmount_BooksNothing_Refunds(t *testing.T) {
	r := newTowingLiveRig(t, nil)
	ctx := context.Background()
	co, err := r.e.Initiate(ctx, "towing", r.sender, json.RawMessage(liveTowingBody), "cdtow-mm-"+uuid.New().String(), "a@b.test", "")
	if err != nil {
		t.Fatal(err)
	}
	r.gw.verify = &provider.PaymentStatus{Status: "success", AmountKobo: co.AmountKobo - 100, Currency: "NGN"}
	if _, err := r.e.OnChargeSuccess(ctx, co.Reference, co.Reference); err == nil {
		t.Fatal("want amount mismatch")
	}
	var sn int
	_ = r.pool.QueryRow(ctx, `SELECT count(*) FROM settlements WHERE idempotency_key=$1`, co.Reference).Scan(&sn)
	if n := countTowing(t, r, co.Reference); n != 0 || sn != 0 {
		t.Errorf("jobs=%d settlements=%d, want none", n, sn)
	}
	if len(r.gw.refundCalls) != 1 || r.gw.refundCalls[0] != co.AmountKobo-100 {
		t.Errorf("refund calls %v", r.gw.refundCalls)
	}
}

func TestLiveDB_TowingCardDirect_InvalidRequest_NeverReachesTheGateway(t *testing.T) {
	r := newTowingLiveRig(t, nil)
	ctx := context.Background()
	for name, body := range map[string]string{
		"unbookable service type": `{"service_type":"heavy_duty","pickup":{"lat":6.5,"lng":3.4,"address":"A"},"dest":{"lat":6.6,"lng":3.3,"address":"B"}}`,
		"tow without destination": `{"service_type":"tow","pickup":{"lat":6.5,"lng":3.4,"address":"A"}}`,
	} {
		if _, err := r.e.Initiate(ctx, "towing", r.sender, json.RawMessage(body), "cdtow-bad-"+uuid.New().String(), "a@b.test", ""); err == nil {
			t.Errorf("%s: initiate must refuse before any Paystack call", name)
		}
	}
	if len(r.gw.initCalls) != 0 {
		t.Errorf("%d gateway initializations for requests that can never book", len(r.gw.initCalls))
	}
}

func TestLiveDB_TowingCardDirect_ReplayOverRefundedExternalSettlement_BooksNothing_RefundsGateway(t *testing.T) {
	r := newTowingLiveRig(t, nil)
	ctx := context.Background()
	co, err := r.e.Initiate(ctx, "towing", r.sender, json.RawMessage(liveTowingBody), "cdtow-h2-"+uuid.New().String(), "a@b.test", "")
	if err != nil {
		t.Fatal(err)
	}
	var req transport.TowingBookRequest
	if err := json.Unmarshal([]byte(liveTowingBody), &req); err != nil {
		t.Fatal(err)
	}
	jid, err := r.svc.BookTowingPaystackFunded(ctx, r.sender, req, co.Reference, co.AmountKobo)
	if err != nil {
		t.Fatal(err)
	}
	var sid string
	if err := r.pool.QueryRow(ctx, `SELECT settlement_id FROM towing_jobs WHERE id=$1`, jid).Scan(&sid); err != nil {
		t.Fatal(err)
	}
	if _, err := r.pool.Exec(ctx, `DELETE FROM towing_jobs WHERE id=$1`, jid); err != nil {
		t.Fatal(err)
	}
	if err := r.settle.RefundExternal(ctx, sid, "test_unwind"); err != nil {
		t.Fatal(err)
	}

	r.gw.verify = &provider.PaymentStatus{Status: "success", AmountKobo: co.AmountKobo, Currency: "NGN"}
	if _, err := r.e.OnChargeSuccess(ctx, co.Reference, co.Reference); err == nil {
		t.Fatal("must NOT confirm a booking onto a refunded escrow")
	}
	if n := countTowing(t, r, co.Reference); n != 0 {
		t.Fatalf("%d jobs booked on a refunded escrow", n)
	}
	rec := rowOf(t, r, co.Reference)
	if rec.Status != StatusRefunded || len(r.gw.refundCalls) != 1 || r.gw.refundCalls[0] != co.AmountKobo {
		t.Errorf("status=%s refunds=%v: the customer's money must go back exactly once", rec.Status, r.gw.refundCalls)
	}
}

// distanceShiftMaps moves the distance on every routing call.
type distanceShiftMaps struct {
	*transport.MockMaps
	calls int32
}

func (m *distanceShiftMaps) Route(ctx context.Context, from, to transport.LatLng) (transport.RouteResult, error) {
	n := atomic.AddInt32(&m.calls, 1)
	rr, err := m.MockMaps.Route(ctx, from, to)
	rr.DistanceM += int(n) * 5_000
	return rr, err
}

func TestLiveDB_TowingCardDirect_RouteChangeBetweenChargeAndBooking_DoesNotCauseMismatch(t *testing.T) {
	maps := &distanceShiftMaps{MockMaps: transport.NewMockMaps()}
	r := newTowingLiveRig(t, maps)
	ctx := context.Background()
	co, err := r.e.Initiate(ctx, "towing", r.sender, json.RawMessage(liveTowingBody), "cdtow-h8-"+uuid.New().String(), "a@b.test", "")
	if err != nil {
		t.Fatal(err)
	}
	if string(rowOf(t, r, co.Reference).PricingJSON) == "" {
		t.Fatal("the priced route inputs must be frozen in the intent at initiate")
	}
	quoteCalls := atomic.LoadInt32(&maps.calls)
	r.gw.verify = &provider.PaymentStatus{Status: "success", AmountKobo: co.AmountKobo, Currency: "NGN"}
	res, err := r.e.OnChargeSuccess(ctx, co.Reference, co.Reference)
	if err != nil || res.Status != StatusConfirmed {
		t.Fatalf("a correctly charged order was not confirmed (route moved between charge and booking): %+v %v", res, err)
	}
	if len(r.gw.refundCalls) != 0 {
		t.Errorf("a correct charge was refunded: %v", r.gw.refundCalls)
	}
	if got := atomic.LoadInt32(&maps.calls); got != quoteCalls {
		t.Errorf("Book re-queried routing (%d → %d calls); it must price from the frozen inputs", quoteCalls, got)
	}
}
