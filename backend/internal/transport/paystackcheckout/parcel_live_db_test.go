package paystackcheckout

// LIVE-DB end-to-end test for the card-direct parcel path: real Engine + real
// PGStore (public.transport_paystack_intents) + real transport.Service /
// settlement / ledger, with only the Paystack gateway faked. Gated on
// TEST_DATABASE_URL like paystackfunded_live_db_test.go. Proves, against real
// SQL: a Tier-0 sender pays by card and gets a parcel; replays/webhook+poll
// races book once; a tampered amount books nothing and refunds; cancel
// refunds through the gateway AND reverses the ledger, never the wallet; and
// the ledger nets to zero for the parcel afterwards.

import (
	"context"
	"encoding/json"
	"os"
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

func livePool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping live-DB card-direct parcel test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return pool
}

type liveRig struct {
	e      *Engine
	gw     *fakeGW
	svc    *transport.Service
	pool   *pgxpool.Pool
	sender string
	settle *settlement.Service
}

func newLiveRig(t *testing.T) *liveRig { return newLiveRigMaps(t, nil) }

// newLiveRigMaps is newLiveRig with a custom routing adapter (nil = the
// service's deterministic MockMaps).
func newLiveRigMaps(t *testing.T, maps transport.MapsAdapter) *liveRig {
	t.Helper()
	ctx := context.Background()
	pool := livePool(t)
	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), nil)
	settleSvc := settlement.NewService(pool, ledgerSvc)
	svc := transport.NewService(pool, settleSvc).WithLedger(ledgerSvc)
	if maps != nil {
		svc = svc.WithMaps(maps)
	}

	sender := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, sender, sender+"@cdparcel.test"); err != nil {
		t.Fatal(err)
	}
	testsupport.CleanupUser(t, pool, sender)

	gw := &fakeGW{}
	e := NewEngine(gw, NewPGStore(pool), settleSvc)
	e.Register(NewParcelDomain(svc))
	svc.SetDomainExternalRefunder("parcel", e.RefunderFor("parcel"))
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM public.transport_paystack_intents WHERE payer_id=$1`, sender)
	})
	return &liveRig{e: e, gw: gw, svc: svc, pool: pool, sender: sender, settle: settleSvc}
}

const liveParcelBody = `{"pickup":{"lat":6.5,"lng":3.4,"address":"A, Lagos"},"dropoff":{"lat":6.6,"lng":3.35,"address":"B, Lagos"},
 "receiver_name":"Ada","receiver_phone":"+2348000000000","size":"small","speed":"standard","prohibited_ack":true}`

func (r *liveRig) walletBalance(t *testing.T) int64 {
	t.Helper()
	var b int64
	if err := r.pool.QueryRow(context.Background(), `
		SELECT COALESCE(SUM(CASE WHEN le.type='CREDIT' THEN le.amount_kobo ELSE -le.amount_kobo END),0)
		FROM ledger_entries le JOIN ledger_accounts la ON la.id=le.account_id WHERE la.user_id=$1`, r.sender).Scan(&b); err != nil {
		t.Fatal(err)
	}
	return b
}

func TestLiveDB_ParcelCardDirect_EndToEnd(t *testing.T) {
	r := newLiveRig(t)
	ctx := context.Background()
	key := "cdparcel-" + uuid.New().String()

	co, err := r.e.Initiate(ctx, "parcel", r.sender, json.RawMessage(liveParcelBody), key, "a@b.test", "")
	if err != nil {
		t.Fatalf("initiate (Tier-0 sender): %v", err)
	}
	if co.AmountKobo <= 0 || co.Reference != "parcelorder:"+key {
		t.Fatalf("checkout %+v", co)
	}
	r.gw.verify = &provider.PaymentStatus{Status: "success", AmountKobo: co.AmountKobo, Currency: "NGN"}

	// webhook + 8 polls race → exactly one parcel
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
	parcelID := *res.EntityID
	var n int
	_ = r.pool.QueryRow(ctx, `SELECT count(*) FROM parcels WHERE idempotency_key=$1`, co.Reference).Scan(&n)
	if n != 1 {
		t.Fatalf("%d parcels for one charge", n)
	}
	if len(r.gw.refundCalls) != 0 {
		t.Fatal("a booked parcel must not be refunded")
	}
	if bal := r.walletBalance(t); bal != 0 {
		t.Errorf("sender wallet = %d, want 0 (never touched)", bal)
	}

	// replaying initiate after payment re-serves status, never reopens the gateway
	again, err := r.e.Initiate(ctx, "parcel", r.sender, json.RawMessage(liveParcelBody), key, "a@b.test", "")
	if err != nil || again.Status != StatusConfirmed || len(r.gw.initCalls) != 1 {
		t.Errorf("replay: %+v %v inits=%d", again, err, len(r.gw.initCalls))
	}

	// cancel → gateway refund (exact amount) + ledger reversal, wallet untouched
	if err := r.svc.CancelParcel(ctx, parcelID, r.sender, "changed_mind"); err != nil {
		t.Fatalf("cancel: %v", err)
	}
	if len(r.gw.refundCalls) != 1 || r.gw.refundCalls[0] != co.AmountKobo || r.gw.refundedRefs[0] != co.Reference {
		t.Errorf("gateway refund %v %v", r.gw.refundCalls, r.gw.refundedRefs)
	}
	var sStatus string
	_ = r.pool.QueryRow(ctx, `SELECT s.status FROM parcels p JOIN settlements s ON s.id=p.settlement_id WHERE p.id=$1`, parcelID).Scan(&sStatus)
	if sStatus != "refunded" {
		t.Errorf("settlement %s, want refunded", sStatus)
	}
	rec, _ := NewPGStore(r.pool).Get(ctx, co.Reference)
	if rec.Status != StatusRefunded || rec.RefundReference == nil {
		t.Errorf("intent %s ref=%v", rec.Status, rec.RefundReference)
	}
	if bal := r.walletBalance(t); bal != 0 {
		t.Errorf("sender wallet = %d after a card refund, want 0 (card money returns to the card)", bal)
	}
	// Ledger nets to zero for this parcel: escrow in, escrow reversed.
	var debit, credit int64
	_ = r.pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_kobo) FILTER (WHERE type='DEBIT'),0), COALESCE(SUM(amount_kobo) FILTER (WHERE type='CREDIT'),0)
		FROM ledger_entries WHERE reference IN ($1,$2)`, "escrow:parcel:"+parcelID, "refund:parcel:"+parcelID).Scan(&debit, &credit)
	if debit != credit || debit != 2*co.AmountKobo {
		t.Errorf("ledger debit=%d credit=%d, want balanced at %d", debit, credit, 2*co.AmountKobo)
	}
	// A repeat cancel is a no-op: no second gateway refund.
	_ = r.svc.CancelParcel(ctx, parcelID, r.sender, "again")
	if len(r.gw.refundCalls) != 1 {
		t.Errorf("customer refunded %d times", len(r.gw.refundCalls))
	}
}

func TestLiveDB_ParcelCardDirect_TamperedAmount_BooksNothing_Refunds(t *testing.T) {
	r := newLiveRig(t)
	ctx := context.Background()
	key := "cdparcel-mm-" + uuid.New().String()
	co, err := r.e.Initiate(ctx, "parcel", r.sender, json.RawMessage(liveParcelBody), key, "a@b.test", "")
	if err != nil {
		t.Fatal(err)
	}
	r.gw.verify = &provider.PaymentStatus{Status: "success", AmountKobo: co.AmountKobo - 100, Currency: "NGN"}
	if _, err := r.e.OnChargeSuccess(ctx, co.Reference, co.Reference); err == nil {
		t.Fatal("want amount mismatch")
	}
	var n int
	_ = r.pool.QueryRow(ctx, `SELECT count(*) FROM parcels WHERE idempotency_key=$1`, co.Reference).Scan(&n)
	var sn int
	_ = r.pool.QueryRow(ctx, `SELECT count(*) FROM settlements WHERE idempotency_key=$1`, co.Reference).Scan(&sn)
	if n != 0 || sn != 0 {
		t.Errorf("parcels=%d settlements=%d, want none", n, sn)
	}
	if len(r.gw.refundCalls) != 1 || r.gw.refundCalls[0] != co.AmountKobo-100 {
		t.Errorf("refund calls %v", r.gw.refundCalls)
	}
}

func TestLiveDB_PGStore_ClaimIsExclusiveAndStaleReclaimable(t *testing.T) {
	r := newLiveRig(t)
	ctx := context.Background()
	key := "cdparcel-claim-" + uuid.New().String()
	co, err := r.e.Initiate(ctx, "parcel", r.sender, json.RawMessage(liveParcelBody), key, "a@b.test", "")
	if err != nil {
		t.Fatal(err)
	}
	st := NewPGStore(r.pool)
	var wins int32
	var wg sync.WaitGroup
	var mu sync.Mutex
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, ok, _ := st.Claim(ctx, co.Reference, staleClaimAfter); ok {
				mu.Lock()
				wins++
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	if wins != 1 {
		t.Fatalf("%d concurrent claims won, want exactly 1", wins)
	}
	if _, ok, _ := st.Claim(ctx, co.Reference, staleClaimAfter); ok {
		t.Error("a fresh processing claim must not be re-claimable")
	}
	if _, err := r.pool.Exec(ctx, `UPDATE public.transport_paystack_intents SET claimed_at = now() - interval '10 minutes' WHERE reference=$1`, co.Reference); err != nil {
		t.Fatal(err)
	}
	if _, ok, _ := st.Claim(ctx, co.Reference, staleClaimAfter); !ok {
		t.Error("a stale processing claim must be re-claimable")
	}
}
