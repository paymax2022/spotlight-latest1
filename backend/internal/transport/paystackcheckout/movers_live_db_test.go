package paystackcheckout

// LIVE-DB end-to-end test for the card-direct MOVERS path (charged at bid
// acceptance): real Engine + real PGStore + real transport.Service /
// settlement / ledger, only the Paystack gateway faked. Gated on
// TEST_DATABASE_URL (see livePool). Proves, against real SQL: a Tier-0
// customer accepts a bid by card and the charge is the SERVER-read bid; the
// webhook+poll race funds the job once; a tampered amount books nothing and
// refunds; a bid withdrawn / a job cancelled or already funded between initiate
// and confirm is refunded at the gateway with nothing escrowed; cancel refunds
// through the gateway AND reverses the ledger, never the wallet.

import (
	"context"
	"encoding/json"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/settlement"
	"spotlight/backend/internal/provider"
	"spotlight/backend/internal/testsupport"
	"spotlight/backend/internal/transport"
)

type moversRig struct {
	e        *Engine
	gw       *fakeGW
	svc      *transport.Service
	pool     *pgxpool.Pool
	customer string
	jobID    string
	bidID    string
	driverID string
}

const moverBidKobo = 4_500_000

func newMoversRig(t *testing.T) *moversRig {
	t.Helper()
	ctx := context.Background()
	pool := livePool(t)
	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), nil)
	settleSvc := settlement.NewService(pool, ledgerSvc)
	svc := transport.NewService(pool, settleSvc).WithLedger(ledgerSvc)

	customer := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, customer, customer+"@cdmovers.test"); err != nil {
		t.Fatal(err)
	}
	testsupport.CleanupUser(t, pool, customer)

	driverUser := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, driverUser, driverUser+"@cdmovers.test"); err != nil {
		t.Fatal(err)
	}
	testsupport.CleanupUser(t, pool, driverUser)
	if _, err := pool.Exec(ctx, `
		INSERT INTO drivers (user_id, name, vehicle_reg, status, verification_status, current_lat, current_lng)
		VALUES ($1,'Mover Test Driver',$2,'online','approved',6.5,3.4)`, driverUser, "MV-"+driverUser[:8]); err != nil {
		t.Fatal(err)
	}
	r := &moversRig{svc: svc, pool: pool, customer: customer}
	if err := pool.QueryRow(ctx, `SELECT id FROM drivers WHERE user_id=$1`, driverUser).Scan(&r.driverID); err != nil {
		t.Fatal(err)
	}
	j, err := svc.RequestMoverQuote(ctx, customer, transport.MoverQuoteRequest{
		Pickup: transport.Place{Address: "A, Lagos"}, Dropoff: transport.Place{Address: "B, Lagos"},
	})
	if err != nil {
		t.Fatal(err)
	}
	r.jobID, _ = j["id"].(string)
	b, err := svc.SubmitMoverBid(ctx, r.jobID, driverUser, moverBidKobo, "")
	if err != nil {
		t.Fatal(err)
	}
	r.bidID, _ = b["id"].(string)

	r.gw = &fakeGW{}
	r.e = NewEngine(r.gw, NewPGStore(pool), settleSvc)
	r.e.Register(NewMoversDomain(svc))
	svc.SetDomainExternalRefunder(MoversDomainName, r.e.RefunderFor(MoversDomainName))
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM public.transport_paystack_intents WHERE payer_id=$1`, customer)
	})
	return r
}

func (r *moversRig) body() json.RawMessage {
	b, _ := json.Marshal(map[string]any{"job_id": r.jobID, "bid_id": r.bidID, "amount_kobo": 1, "email": "a@b.test"})
	return b
}

func (r *moversRig) walletBalance(t *testing.T) int64 {
	t.Helper()
	var b int64
	if err := r.pool.QueryRow(context.Background(), `
		SELECT COALESCE(SUM(CASE WHEN le.type='CREDIT' THEN le.amount_kobo ELSE -le.amount_kobo END),0)
		FROM ledger_entries le JOIN ledger_accounts la ON la.id=le.account_id WHERE la.user_id=$1`, r.customer).Scan(&b); err != nil {
		t.Fatal(err)
	}
	return b
}

func (r *moversRig) count(t *testing.T, q string, args ...any) int {
	t.Helper()
	var n int
	if err := r.pool.QueryRow(context.Background(), q, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestLiveDB_MoversCardDirect_EndToEnd(t *testing.T) {
	r := newMoversRig(t)
	ctx := context.Background()
	key := "cdmovers-" + uuid.New().String()

	co, err := r.e.Initiate(ctx, MoversDomainName, r.customer, r.body(), key, "a@b.test", "")
	if err != nil {
		t.Fatalf("initiate (Tier-0 customer): %v", err)
	}
	if co.AmountKobo != moverBidKobo || co.Reference != "moversorder:"+key {
		t.Fatalf("checkout %+v — the charge must be the server-read bid, not the client's amount_kobo", co)
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
	if err != nil || res.Status != StatusConfirmed || res.EntityID == nil || *res.EntityID != r.jobID {
		t.Fatalf("not confirmed: %+v %v", res, err)
	}
	if n := r.count(t, `SELECT count(*) FROM settlements WHERE idempotency_key=$1`, co.Reference); n != 1 {
		t.Fatalf("%d escrows for one charge", n)
	}
	var status, escrow string
	_ = r.pool.QueryRow(ctx, `SELECT status, escrow_status FROM mover_jobs WHERE id=$1`, r.jobID).Scan(&status, &escrow)
	if status != "bid_accepted" || escrow != "funded" {
		t.Fatalf("job %s/%s", status, escrow)
	}
	if len(r.gw.refundCalls) != 0 {
		t.Fatal("an accepted bid must not be refunded")
	}
	if bal := r.walletBalance(t); bal != 0 {
		t.Errorf("customer wallet = %d, want 0 (never touched)", bal)
	}
	again, err := r.e.Initiate(ctx, MoversDomainName, r.customer, r.body(), key, "a@b.test", "")
	if err != nil || again.Status != StatusConfirmed || len(r.gw.initCalls) != 1 {
		t.Errorf("replay: %+v %v inits=%d", again, err, len(r.gw.initCalls))
	}

	// cancel → exact gateway refund + ledger reversal; wallet untouched
	if err := r.svc.CancelMover(ctx, r.jobID, r.customer, "changed_mind"); err != nil {
		t.Fatalf("cancel: %v", err)
	}
	if len(r.gw.refundCalls) != 1 || r.gw.refundCalls[0] != co.AmountKobo || r.gw.refundedRefs[0] != co.Reference {
		t.Errorf("gateway refund %v %v", r.gw.refundCalls, r.gw.refundedRefs)
	}
	var sStatus string
	_ = r.pool.QueryRow(ctx, `SELECT s.status FROM mover_jobs m JOIN settlements s ON s.id=m.settlement_id WHERE m.id=$1`, r.jobID).Scan(&sStatus)
	_ = r.pool.QueryRow(ctx, `SELECT escrow_status FROM mover_jobs WHERE id=$1`, r.jobID).Scan(&escrow)
	if sStatus != "refunded" || escrow != "refunded" {
		t.Errorf("settlement %s, job escrow %s; want refunded/refunded", sStatus, escrow)
	}
	rec, _ := NewPGStore(r.pool).Get(ctx, co.Reference)
	if rec.Status != StatusRefunded || rec.RefundReference == nil {
		t.Errorf("intent %s ref=%v", rec.Status, rec.RefundReference)
	}
	if bal := r.walletBalance(t); bal != 0 {
		t.Errorf("customer wallet = %d after a card refund, want 0", bal)
	}
	var debit, credit int64
	_ = r.pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_kobo) FILTER (WHERE type='DEBIT'),0), COALESCE(SUM(amount_kobo) FILTER (WHERE type='CREDIT'),0)
		FROM ledger_entries WHERE reference IN ($1,$2)`, "escrow:mover:"+r.jobID, "refund:mover:"+r.jobID).Scan(&debit, &credit)
	if debit != credit || debit != 2*co.AmountKobo {
		t.Errorf("ledger debit=%d credit=%d, want balanced at %d", debit, credit, 2*co.AmountKobo)
	}
	_ = r.svc.CancelMover(ctx, r.jobID, r.customer, "again")
	if len(r.gw.refundCalls) != 1 {
		t.Errorf("customer refunded %d times", len(r.gw.refundCalls))
	}
}

func TestLiveDB_MoversCardDirect_TamperedAmount_BooksNothing_Refunds(t *testing.T) {
	r := newMoversRig(t)
	ctx := context.Background()
	co, err := r.e.Initiate(ctx, MoversDomainName, r.customer, r.body(), "cdmovers-mm-"+uuid.New().String(), "a@b.test", "")
	if err != nil {
		t.Fatal(err)
	}
	r.gw.verify = &provider.PaymentStatus{Status: "success", AmountKobo: co.AmountKobo - 100, Currency: "NGN"}
	if _, err := r.e.OnChargeSuccess(ctx, co.Reference, co.Reference); err == nil {
		t.Fatal("want amount mismatch")
	}
	if n := r.count(t, `SELECT count(*) FROM settlements WHERE idempotency_key=$1`, co.Reference); n != 0 {
		t.Errorf("settlements=%d, want none", n)
	}
	if len(r.gw.refundCalls) != 1 || r.gw.refundCalls[0] != co.AmountKobo-100 {
		t.Errorf("refund calls %v", r.gw.refundCalls)
	}
}

// The core of "charged at bid acceptance": whatever changed the job or bid
// between initiate and the charge confirming, the customer is refunded in full
// and NOTHING is escrowed or accepted.
func TestLiveDB_MoversCardDirect_JobOrBidChangedBeforeConfirm_RefundsGateway_NothingBooked(t *testing.T) {
	cases := []struct {
		name   string
		mutate func(r *moversRig)
	}{
		{"bid withdrawn", func(r *moversRig) {
			_, _ = r.pool.Exec(context.Background(), `UPDATE mover_bids SET status='rejected' WHERE id=$1`, r.bidID)
		}},
		{"bid amount changed", func(r *moversRig) {
			_, _ = r.pool.Exec(context.Background(), `UPDATE mover_bids SET amount_kobo=amount_kobo+500 WHERE id=$1`, r.bidID)
		}},
		{"job cancelled", func(r *moversRig) {
			_, _ = r.pool.Exec(context.Background(), `UPDATE mover_jobs SET status='cancelled' WHERE id=$1`, r.jobID)
		}},
		{"job funded by another path", func(r *moversRig) {
			_, _ = r.pool.Exec(context.Background(), `UPDATE mover_jobs SET status='bid_accepted', escrow_status='funded' WHERE id=$1`, r.jobID)
		}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			r := newMoversRig(t)
			ctx := context.Background()
			co, err := r.e.Initiate(ctx, MoversDomainName, r.customer, r.body(), "cdmovers-ch-"+uuid.New().String(), "a@b.test", "")
			if err != nil {
				t.Fatal(err)
			}
			c.mutate(r)
			r.gw.verify = &provider.PaymentStatus{Status: "success", AmountKobo: co.AmountKobo, Currency: "NGN"}
			if _, err := r.e.OnChargeSuccess(ctx, co.Reference, co.Reference); err == nil {
				t.Fatal("confirm must fail: the bid can no longer be accepted as charged")
			}
			if len(r.gw.refundCalls) != 1 || r.gw.refundCalls[0] != co.AmountKobo || r.gw.refundedRefs[0] != co.Reference {
				t.Fatalf("customer must be refunded exactly what was charged: %v %v", r.gw.refundCalls, r.gw.refundedRefs)
			}
			rec, _ := NewPGStore(r.pool).Get(ctx, co.Reference)
			if rec.Status != StatusRefunded {
				t.Errorf("intent %s, want refunded", rec.Status)
			}
			if n := r.count(t, `SELECT count(*) FROM settlements WHERE idempotency_key=$1 AND status='escrowed'`, co.Reference); n != 0 {
				t.Errorf("%d live escrows left for a refunded charge", n)
			}
			if n := r.count(t, `SELECT count(*) FROM mover_jobs WHERE id=$1 AND settlement_id IS NOT NULL`, r.jobID); n != 0 {
				t.Errorf("job points at a settlement")
			}
			if bal := r.walletBalance(t); bal != 0 {
				t.Errorf("customer wallet = %d, want 0", bal)
			}
		})
	}
}

func TestLiveDB_MoversCardDirect_InitiateRefusesUnacceptableBidBeforeAnyCharge(t *testing.T) {
	r := newMoversRig(t)
	ctx := context.Background()
	stranger := uuid.New().String()
	if _, err := r.e.Initiate(ctx, MoversDomainName, stranger, r.body(), "cdmovers-st-"+uuid.New().String(), "a@b.test", ""); err == nil {
		t.Error("someone else's job must not be chargeable")
	}
	_, _ = r.pool.Exec(ctx, `UPDATE mover_bids SET status='rejected' WHERE id=$1`, r.bidID)
	if _, err := r.e.Initiate(ctx, MoversDomainName, r.customer, r.body(), "cdmovers-st2-"+uuid.New().String(), "a@b.test", ""); err == nil {
		t.Error("a non-submitted bid must not be chargeable")
	}
	if len(r.gw.initCalls) != 0 {
		t.Errorf("gateway initialized %d times for unacceptable bids", len(r.gw.initCalls))
	}
	if n := r.count(t, `SELECT count(*) FROM public.transport_paystack_intents WHERE payer_id=$1`, r.customer); n != 0 {
		t.Errorf("%d intents persisted", n)
	}
}
