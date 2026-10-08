package paystackcheckout

// LIVE-DB end-to-end for card-direct CAR HIRE: real Engine + PGStore + the real
// transport.Service / settlement / ledger, only the Paystack gateway faked. Proves
// ONE charge (fare + deposit) books two external settlements, and that cancel /
// completion return money to the CARD in exact pieces (gateway first, ledger
// second), never the wallet, with the sum of refunds never above the charge.

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/settlement"
	"spotlight/backend/internal/provider"
	"spotlight/backend/internal/testsupport"
	"spotlight/backend/internal/transport"
)

type hireRig struct {
	e     *Engine
	gw    *fakeGW
	svc   *transport.Service
	pool  *pgxpool.Pool
	payer string
}

func newHireRig(t *testing.T) *hireRig {
	t.Helper()
	ctx := context.Background()
	pool := livePool(t)
	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), nil)
	settleSvc := settlement.NewService(pool, ledgerSvc)
	svc := transport.NewService(pool, settleSvc).WithLedger(ledgerSvc)
	payer := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, payer, payer+"@cdhire.test"); err != nil {
		t.Fatal(err)
	}
	testsupport.CleanupUser(t, pool, payer)
	gw := &fakeGW{ev: &events{}}
	st := NewPGStore(pool)
	e := NewEngine(gw, st, settleSvc)
	e.Register(NewCarHireDomain(svc))
	e.EnablePartialRefunds(gw, st)
	svc.SetDomainExternalRefunder(CarHireDomainName, e.RefunderFor(CarHireDomainName))
	t.Cleanup(func() {
		c := context.WithoutCancel(ctx)
		_, _ = pool.Exec(c, `DELETE FROM public.transport_paystack_intent_refunds WHERE reference IN (SELECT reference FROM public.transport_paystack_intents WHERE payer_id=$1)`, payer)
		_, _ = pool.Exec(c, `DELETE FROM public.transport_paystack_intents WHERE payer_id=$1`, payer)
	})
	return &hireRig{e: e, gw: gw, svc: svc, pool: pool, payer: payer}
}

func (r *hireRig) body() string {
	return `{"hire_type":"daily","vehicle_class":"executive","start_at":"` + time.Now().Add(48*time.Hour).UTC().Format(time.RFC3339) + `","duration_hours":8,"chauffeur":true,"pickup_address":"Ikeja, Lagos"}`
}

func (r *hireRig) confirmed(t *testing.T) (ref, bookingID string, fare, deposit int64) {
	t.Helper()
	ctx := context.Background()
	co, err := r.e.Initiate(ctx, CarHireDomainName, r.payer, json.RawMessage(r.body()), "hire-"+uuid.NewString(), "a@b.test", "")
	if err != nil {
		t.Fatalf("initiate (Tier-0 renter): %v", err)
	}
	r.gw.verify = &provider.PaymentStatus{Status: "success", AmountKobo: co.AmountKobo, Currency: "NGN"}
	res, err := r.e.OnChargeSuccess(ctx, co.Reference, co.Reference)
	if err != nil || res.Status != StatusConfirmed || res.EntityID == nil {
		t.Fatalf("confirm: %+v %v", res, err)
	}
	if err := r.pool.QueryRow(ctx, `SELECT fare_kobo, deposit_kobo FROM car_hire_bookings WHERE id=$1`, *res.EntityID).Scan(&fare, &deposit); err != nil {
		t.Fatal(err)
	}
	if fare+deposit != co.AmountKobo {
		t.Fatalf("fare %d + deposit %d != charge %d", fare, deposit, co.AmountKobo)
	}
	return co.Reference, *res.EntityID, fare, deposit
}

func (r *hireRig) walletBalance(t *testing.T, user string) int64 {
	t.Helper()
	var b int64
	if err := r.pool.QueryRow(context.Background(), `
		SELECT COALESCE(SUM(CASE WHEN le.type='CREDIT' THEN le.amount_kobo ELSE -le.amount_kobo END),0)
		FROM ledger_entries le JOIN ledger_accounts la ON la.id=le.account_id WHERE la.user_id=$1`, user).Scan(&b); err != nil {
		t.Fatal(err)
	}
	return b
}

func (r *hireRig) settStatus(t *testing.T, ref string) string {
	t.Helper()
	var s string
	if err := r.pool.QueryRow(context.Background(), `SELECT status FROM settlements WHERE reference=$1`, ref).Scan(&s); err != nil {
		t.Fatal(err)
	}
	return s
}

func TestLiveDB_CarHireCardDirect_EndToEnd_CancelRefundsFareAndDepositToCardInPieces(t *testing.T) {
	r := newHireRig(t)
	ctx := context.Background()
	ref, id, fare, deposit := r.confirmed(t)

	// Replays after payment never re-open the gateway or book again.
	again, err := r.e.Initiate(ctx, CarHireDomainName, r.payer, json.RawMessage(r.body()), ref[len(CarHireReferencePrefix):], "a@b.test", "")
	if err == nil && again.Status != StatusConfirmed {
		t.Errorf("replay %+v", again)
	}

	res, err := r.svc.CancelCarHireWithRefund(ctx, id, r.payer, "changed_mind")
	if err != nil || res.RefundStatus != transport.RefundStatusRefunded {
		t.Fatalf("cancel: %+v %v", res, err)
	}
	if len(r.gw.pCalls) != 2 || r.gw.pCalls[0].Amt != fare || r.gw.pCalls[1].Amt != deposit {
		t.Fatalf("gateway refunds %+v, want fare %d then deposit %d", r.gw.pCalls, fare, deposit)
	}
	if len(r.gw.refundCalls) != 0 {
		t.Errorf("a whole-charge refund was used: %v", r.gw.refundCalls)
	}
	in, _ := NewPGStore(r.pool).Get(ctx, ref)
	if in.Status != StatusRefunded || in.RefundedKobo != fare+deposit || in.RefundReservedKobo != fare+deposit {
		t.Errorf("intent %s refunded=%d reserved=%d", in.Status, in.RefundedKobo, in.RefundReservedKobo)
	}
	if r.settStatus(t, "carhire:"+id) != "refunded" || r.settStatus(t, "carhire:"+id+":deposit") != "refunded" {
		t.Error("settlements not both reversed")
	}
	var d, c int64
	_ = r.pool.QueryRow(ctx, `SELECT COALESCE(SUM(amount_kobo) FILTER (WHERE type='DEBIT'),0), COALESCE(SUM(amount_kobo) FILTER (WHERE type='CREDIT'),0)
		FROM ledger_entries WHERE reference = ANY($1)`, []string{"escrow:carhire:" + id, "escrow:carhire:" + id + ":deposit", "refund:carhire:" + id, "refund:carhire:" + id + ":deposit"}).Scan(&d, &c)
	if d != c || d != 2*(fare+deposit) {
		t.Errorf("ledger debit=%d credit=%d, want balanced at %d", d, c, 2*(fare+deposit))
	}
	if bal := r.walletBalance(t, r.payer); bal != 0 {
		t.Errorf("renter wallet %d: card money must return to the card", bal)
	}
	// A repeat cancel refunds nothing more.
	if _, err := r.svc.CancelCarHireWithRefund(ctx, id, r.payer, "again"); err != nil {
		t.Fatal(err)
	}
	if len(r.gw.pCalls) != 2 {
		t.Errorf("repeat cancel issued gateway refunds: %d", len(r.gw.pCalls))
	}
}

func TestLiveDB_CarHireCardDirect_EndToEnd_CompleteRefundsOnlyTheDeposit_FareStaysSettled(t *testing.T) {
	r := newHireRig(t)
	ctx := context.Background()
	ref, id, _, deposit := r.confirmed(t)
	du, did := seedHireDriver(t, r.pool)
	_ = du
	if _, err := r.pool.Exec(ctx, `UPDATE car_hire_bookings SET driver_id=$1 WHERE id=$2`, did, id); err != nil {
		t.Fatal(err)
	}
	if err := r.svc.ActivateCarHire(ctx, id, r.payer); err != nil {
		t.Fatal(err)
	}
	res, err := r.svc.CompleteCarHireWithRefund(ctx, id, r.payer)
	if err != nil || res.DepositRefundStatus != transport.RefundStatusRefunded {
		t.Fatalf("complete: %+v %v", res, err)
	}
	if len(r.gw.pCalls) != 1 || r.gw.pCalls[0].Amt != deposit {
		t.Fatalf("gateway refunds %+v, want exactly the deposit %d", r.gw.pCalls, deposit)
	}
	in, _ := NewPGStore(r.pool).Get(ctx, ref)
	if in.Status != StatusConfirmed || in.RefundedKobo != deposit {
		t.Errorf("intent %s refunded=%d: only the deposit left the charge", in.Status, in.RefundedKobo)
	}
	if r.settStatus(t, "carhire:"+id) != "settled" || r.settStatus(t, "carhire:"+id+":deposit") != "refunded" {
		t.Error("fare must be settled and deposit refunded")
	}
	// The lookup-first guard: a re-POST never issues a second gateway refund.
	if _, err := r.svc.CompleteCarHireWithRefund(ctx, id, r.payer); err != nil {
		t.Fatal(err)
	}
	if len(r.gw.pCalls) != 1 {
		t.Errorf("re-POST issued another refund: %d", len(r.gw.pCalls))
	}
	if bal := r.walletBalance(t, r.payer); bal != 0 {
		t.Errorf("renter wallet %d", bal)
	}
}

func TestLiveDB_CarHireCardDirect_EndToEnd_DepositRefundLostReply_ResumesWithoutSecondRefund(t *testing.T) {
	r := newHireRig(t)
	ctx := context.Background()
	_, id, _, deposit := r.confirmed(t)
	_, did := seedHireDriver(t, r.pool)
	_, _ = r.pool.Exec(ctx, `UPDATE car_hire_bookings SET driver_id=$1 WHERE id=$2`, did, id)
	_ = r.svc.ActivateCarHire(ctx, id, r.payer)
	// The gateway accepts the refund but the reply is lost.
	r.gw.pErr = context.DeadlineExceeded
	r.gw.pAcceptOnErr = true
	res, err := r.svc.CompleteCarHireWithRefund(ctx, id, r.payer)
	if err != nil || res.DepositRefundStatus != transport.RefundStatusRefunded {
		t.Fatalf("complete with a lost reply: %+v %v", res, err)
	}
	if len(r.gw.pCalls) != 1 || r.gw.pCalls[0].Amt != deposit {
		t.Errorf("gateway refunds %+v", r.gw.pCalls)
	}
	if r.settStatus(t, "carhire:"+id+":deposit") != "refunded" {
		t.Error("deposit settlement not reversed")
	}
}

func TestLiveDB_CarHireCardDirect_AmountMismatch_BooksNothing_RefundsTheWholeCharge(t *testing.T) {
	r := newHireRig(t)
	ctx := context.Background()
	co, err := r.e.Initiate(ctx, CarHireDomainName, r.payer, json.RawMessage(r.body()), "hire-mm-"+uuid.NewString(), "a@b.test", "")
	if err != nil {
		t.Fatal(err)
	}
	r.gw.verify = &provider.PaymentStatus{Status: "success", AmountKobo: co.AmountKobo - 1, Currency: "NGN"}
	if _, err := r.e.OnChargeSuccess(ctx, co.Reference, co.Reference); err == nil {
		t.Fatal("want amount mismatch")
	}
	var n, sn int
	_ = r.pool.QueryRow(ctx, `SELECT count(*) FROM car_hire_bookings WHERE idempotency_key=$1`, co.Reference).Scan(&n)
	_ = r.pool.QueryRow(ctx, `SELECT count(*) FROM settlements WHERE starts_with(idempotency_key, $1)`, co.Reference).Scan(&sn)
	if n != 0 || sn != 0 {
		t.Errorf("bookings=%d settlements=%d, want none", n, sn)
	}
	if len(r.gw.refundCalls) != 1 || r.gw.refundCalls[0] != co.AmountKobo-1 || len(r.gw.pCalls) != 0 {
		t.Errorf("whole refund %v partial %v", r.gw.refundCalls, r.gw.pCalls)
	}
}

func seedHireDriver(t *testing.T, pool *pgxpool.Pool) (userID, driverID string) {
	t.Helper()
	ctx := context.Background()
	userID = uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, userID, userID+"@cdhire.test"); err != nil {
		t.Fatal(err)
	}
	testsupport.CleanupUser(t, pool, userID)
	if _, err := pool.Exec(ctx, `INSERT INTO drivers (user_id, name, vehicle_reg, status, verification_status, current_lat, current_lng)
		VALUES ($1,'Hire Test Driver',$2,'online','approved',6.5,3.4)`, userID, "HIRE-"+userID[:8]); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT id::text FROM drivers WHERE user_id=$1`, userID).Scan(&driverID); err != nil {
		t.Fatal(err)
	}
	return
}

func TestLiveDB_Reconcile_CancelledCarHire_StrandedCardRefund_FinishedBySweep(t *testing.T) {
	r := newHireRig(t)
	ctx := context.Background()
	ref, id, fare, deposit := r.confirmed(t)
	r.gw.pFailed = true // the gateway rejects every refund at cancel time
	res, err := r.svc.CancelCarHireWithRefund(ctx, id, r.payer, "x")
	if err != nil || res.RefundStatus != transport.RefundStatusPending {
		t.Fatalf("cancel: %+v %v (the booking IS cancelled; the money is NOT back)", res, err)
	}
	if r.settStatus(t, "carhire:"+id) != "escrowed" {
		t.Fatal("fare settlement reversed although the gateway refund failed")
	}
	r.gw.pFailed = false
	r.gw.pRefunds = nil // the failed attempt is not a refund
	st, err := r.e.Reconcile(ctx, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if st.CancelRefundsCompleted < 1 {
		t.Errorf("stats %+v: the car-hire sweep did not run", st)
	}
	if r.settStatus(t, "carhire:"+id) != "refunded" || r.settStatus(t, "carhire:"+id+":deposit") != "refunded" {
		t.Error("sweep did not finish both card refunds")
	}
	var sum int64
	for _, rr := range r.gw.pRefunds {
		if rr.Status == "processed" {
			sum += rr.AmountKobo
		}
	}
	if sum != fare+deposit {
		t.Errorf("accepted gateway refunds sum %d, want exactly the charge %d", sum, fare+deposit)
	}
	in, _ := NewPGStore(r.pool).Get(ctx, ref)
	if in.Status != StatusRefunded {
		t.Errorf("intent %s", in.Status)
	}
}
