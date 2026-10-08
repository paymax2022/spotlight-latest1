package transport

// LIVE-DB integration tests for CARD-DIRECT (Paystack-funded) mover bid
// acceptance: QuoteMoverAcceptance / AcceptMoverBidPaystackFunded /
// FindMoverAcceptanceByIdempotencyKey / CancelMover's refund rail. Gated on
// TEST_DATABASE_URL like every live-DB suite here. What these pin:
//  1. A Tier-0 customer is refused by the wallet path but accepts a bid by card;
//     the amount is the bid read SERVER-side; the wallet is UNCHANGED; the escrow
//     is a balanced external journal on a settlement with funding_source='external'.
//  2. Any other verified amount (±1, 0, negative) is refused BEFORE any write.
//  3. The job + bid must belong to / still be open for the paying customer AT
//     BOOK TIME (withdrawn/rejected bid, changed bid amount or provider,
//     cancelled or already-funded job ⇒ refused, nothing escrowed).
//  4. A replay books once; Find is payer-scoped; a replay over a refunded /
//     foreign / wallet-funded settlement books nothing.
//  5. A failure AFTER the escrow posted reverses it ledger-side when (and only
//     when) provably no job owns it.
//  6. Two concurrent charges for one job: exactly one books, the loser's escrow
//     is reversed.
//  7. Cancelling a card-funded move NEVER credits the wallet; no refunder ⇒
//     fails closed and the retry completes; wallet-funded cancel still refunds
//     the wallet; escrow_status only reads 'refunded' once the refund happened.

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/testsupport"
)

// seedMoverDriver creates an approved driver and returns its drivers.id.
func seedMoverDriver(t *testing.T, ctx context.Context, pool *pgxpool.Pool) (userID, driverID string) {
	t.Helper()
	userID = seedCashTestDriver(t, ctx, pool)
	if err := pool.QueryRow(ctx, `SELECT id FROM drivers WHERE user_id=$1`, userID).Scan(&driverID); err != nil {
		t.Fatalf("read driver id: %v", err)
	}
	return
}

// seedMoverJob creates a job for customer with one bid per amount; returns the
// job id and the bid ids (same order) and their driver ids.
func seedMoverJob(t *testing.T, ctx context.Context, svc *Service, pool *pgxpool.Pool, customer string, amounts ...int64) (jobID string, bidIDs, driverIDs []string) {
	t.Helper()
	j, err := svc.RequestMoverQuote(ctx, customer, MoverQuoteRequest{
		Pickup: Place{Address: "A, Lagos"}, Dropoff: Place{Address: "B, Lagos"}, TruckSize: "medium",
	})
	if err != nil {
		t.Fatalf("RequestMoverQuote: %v", err)
	}
	jobID, _ = j["id"].(string)
	for _, amt := range amounts {
		du, did := seedMoverDriver(t, ctx, pool)
		b, err := svc.SubmitMoverBid(ctx, jobID, du, amt, "")
		if err != nil {
			t.Fatalf("SubmitMoverBid: %v", err)
		}
		bidIDs = append(bidIDs, b["id"].(string))
		driverIDs = append(driverIDs, did)
	}
	return
}

func moverReq(jobID, bidID string) MoverAcceptRequest {
	return MoverAcceptRequest{JobID: jobID, BidID: bidID}
}

type moverState struct {
	status, escrow string
	settlementID   *string
	acceptedBid    *string
	amount         *int64
}

func readMover(t *testing.T, ctx context.Context, pool *pgxpool.Pool, jobID string) moverState {
	t.Helper()
	var m moverState
	if err := pool.QueryRow(ctx, `SELECT status, escrow_status, settlement_id::text, accepted_bid_id::text, quote_amount_kobo FROM mover_jobs WHERE id=$1`, jobID).
		Scan(&m.status, &m.escrow, &m.settlementID, &m.acceptedBid, &m.amount); err != nil {
		t.Fatalf("read mover: %v", err)
	}
	return m
}

func settlementsForKey(t *testing.T, ctx context.Context, pool *pgxpool.Pool, key string) int {
	t.Helper()
	var n int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM settlements WHERE idempotency_key=$1`, key).Scan(&n)
	return n
}

func moverSettlement(t *testing.T, ctx context.Context, pool *pgxpool.Pool, jobID string) (id, funding, status string, total int64) {
	t.Helper()
	if err := pool.QueryRow(ctx, `
		SELECT s.id, s.funding_source, s.status, s.total_kobo
		FROM mover_jobs m JOIN settlements s ON s.id = m.settlement_id WHERE m.id=$1`, jobID).
		Scan(&id, &funding, &status, &total); err != nil {
		t.Fatalf("read mover settlement: %v", err)
	}
	return
}

func wantCoded(t *testing.T, err error, status int, code string) {
	t.Helper()
	ce, ok := errors.AsType[*CodedError](err)
	if !ok || ce.Status != status || (code != "" && ce.Code != code) {
		t.Fatalf("want %d %s, got %v", status, code, err)
	}
}

func TestLiveDB_MoverAcceptCardDirect_SkipsTierGate_BalancedExternalEscrow_AmountIsServerBid(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, customer := paystackRideFixture(t, ctx, pool, 10_000_000) // Tier 0
	jobID, bids, drivers := seedMoverJob(t, ctx, svc, pool, customer, 4_500_000, 6_000_000)

	if _, err := svc.AcceptMoverBid(ctx, jobID, customer, bids[0], "mvwallet-"+uuid.New().String()); err == nil {
		t.Fatal("wallet AcceptMoverBid must stay refused for a Tier-0 customer (this feature must not relax it)")
	}

	amt, pricing, err := svc.QuoteMoverAcceptance(ctx, customer, moverReq(jobID, bids[0]))
	if err != nil || amt != 4_500_000 || len(pricing) == 0 {
		t.Fatalf("QuoteMoverAcceptance = %d %s %v; the amount must be the accepted bid", amt, pricing, err)
	}
	before := riderWalletBalance(t, ctx, pool, customer)
	key := "moversorder:mvcd-" + uuid.New().String()
	id, err := svc.AcceptMoverBidPaystackFunded(ctx, customer, moverReq(jobID, bids[0]), key, amt, pricing)
	if err != nil || id != jobID {
		t.Fatalf("card-direct must succeed for a Tier-0 customer: %q %v", id, err)
	}
	if after := riderWalletBalance(t, ctx, pool, customer); after != before {
		t.Errorf("wallet moved on a card-funded move: %d -> %d", before, after)
	}

	m := readMover(t, ctx, pool, jobID)
	if m.status != "bid_accepted" || m.escrow != "funded" || m.acceptedBid == nil || *m.acceptedBid != bids[0] || m.amount == nil || *m.amount != 4_500_000 {
		t.Errorf("job state %+v", m)
	}
	var provider string
	_ = pool.QueryRow(ctx, `SELECT provider_id::text FROM mover_jobs WHERE id=$1`, jobID).Scan(&provider)
	if provider != drivers[0] {
		t.Errorf("provider %s, want the accepted bid's driver %s", provider, drivers[0])
	}
	var s0, s1 string
	_ = pool.QueryRow(ctx, `SELECT status FROM mover_bids WHERE id=$1`, bids[0]).Scan(&s0)
	_ = pool.QueryRow(ctx, `SELECT status FROM mover_bids WHERE id=$1`, bids[1]).Scan(&s1)
	if s0 != "accepted" || s1 != "rejected" {
		t.Errorf("bid statuses %s/%s", s0, s1)
	}

	sid, funding, status, total := moverSettlement(t, ctx, pool, jobID)
	if funding != "external" || status != "escrowed" || total != 4_500_000 {
		t.Errorf("settlement funding=%s status=%s total=%d", funding, status, total)
	}
	var idemKey string
	_ = pool.QueryRow(ctx, `SELECT idempotency_key FROM settlements WHERE id=$1`, sid).Scan(&idemKey)
	if idemKey != key {
		t.Errorf("settlement key %q, want the NAMESPACED key %q", idemKey, key)
	}
	var debit, credit int64
	if err := pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_kobo) FILTER (WHERE type='DEBIT'),0), COALESCE(SUM(amount_kobo) FILTER (WHERE type='CREDIT'),0)
		FROM ledger_entries WHERE reference = $1`, "escrow:mover:"+jobID).Scan(&debit, &credit); err != nil {
		t.Fatal(err)
	}
	if debit != 4_500_000 || credit != 4_500_000 {
		t.Errorf("escrow journal debit=%d credit=%d", debit, credit)
	}
}

func TestLiveDB_MoverAcceptCardDirect_AmountMismatch_NothingWritten(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, customer := paystackRideFixture(t, ctx, pool, 0)
	jobID, bids, _ := seedMoverJob(t, ctx, svc, pool, customer, 4_500_000)
	amt, pricing, _ := svc.QuoteMoverAcceptance(ctx, customer, moverReq(jobID, bids[0]))
	for _, wrong := range []int64{amt - 1, amt + 1, 0, -amt} {
		key := "moversorder:mvcd-mm-" + uuid.New().String()
		_, err := svc.AcceptMoverBidPaystackFunded(ctx, customer, moverReq(jobID, bids[0]), key, wrong, pricing)
		wantCoded(t, err, http.StatusConflict, CodeAmountMismatch)
		if n := settlementsForKey(t, ctx, pool, key); n != 0 {
			t.Errorf("verified=%d: an escrow was written before the cross-check", wrong)
		}
		if m := readMover(t, ctx, pool, jobID); m.status != "quote_requested" && m.status != "bids_received" || m.escrow != "none" {
			t.Errorf("verified=%d: job moved: %+v", wrong, m)
		}
	}
}

func TestLiveDB_MoverAcceptCardDirect_StateChangedBeforeBook_RefusedNothingEscrowed(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, customer := paystackRideFixture(t, ctx, pool, 50_000_000)
	other := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2)`, other, other+"@mv.test"); err != nil {
		t.Fatal(err)
	}
	testsupport.CleanupUser(t, pool, other)

	cases := []struct {
		name   string
		mutate func(jobID, bidID, driverID string)
		caller func(customer string) string
	}{
		{"bid withdrawn/rejected", func(j, b, d string) {
			pool.Exec(ctx, `UPDATE mover_bids SET status='rejected' WHERE id=$1`, b)
		}, nil},
		{"bid amount changed", func(j, b, d string) {
			pool.Exec(ctx, `UPDATE mover_bids SET amount_kobo=amount_kobo+100 WHERE id=$1`, b)
		}, nil},
		{"bid provider changed", func(j, b, d string) {
			_, did := seedMoverDriver(t, ctx, pool)
			pool.Exec(ctx, `UPDATE mover_bids SET provider_id=$2 WHERE id=$1`, b, did)
		}, nil},
		{"job cancelled", func(j, b, d string) {
			pool.Exec(ctx, `UPDATE mover_jobs SET status='cancelled' WHERE id=$1`, j)
		}, nil},
		{"job already funded", func(j, b, d string) {
			pool.Exec(ctx, `UPDATE mover_jobs SET status='bid_accepted', escrow_status='funded' WHERE id=$1`, j)
		}, nil},
		{"paid by a different user", func(j, b, d string) {}, func(string) string { return other }},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			jobID, bids, drivers := seedMoverJob(t, ctx, svc, pool, customer, 4_500_000)
			amt, pricing, err := svc.QuoteMoverAcceptance(ctx, customer, moverReq(jobID, bids[0]))
			if err != nil {
				t.Fatal(err)
			}
			c.mutate(jobID, bids[0], drivers[0])
			payer := customer
			if c.caller != nil {
				payer = c.caller(customer)
			}
			key := "moversorder:mvcd-st-" + uuid.New().String()
			if _, err := svc.AcceptMoverBidPaystackFunded(ctx, payer, moverReq(jobID, bids[0]), key, amt, pricing); err == nil {
				t.Fatal("Book must refuse: the job/bid is no longer what was charged for")
			}
			if n := settlementsForKey(t, ctx, pool, key); n != 0 {
				t.Errorf("an escrow was posted for a booking that cannot be made")
			}
			if _, found, _ := svc.FindMoverAcceptanceByIdempotencyKey(ctx, payer, key); found {
				t.Error("Find must report absence so the engine refunds the gateway")
			}
		})
	}
}

func TestLiveDB_MoverQuoteAcceptance_RefusesWrongOwnerNotOpenAndForeignBid(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, customer := paystackRideFixture(t, ctx, pool, 0)
	jobID, bids, _ := seedMoverJob(t, ctx, svc, pool, customer, 4_500_000)
	jobB, bidsB, _ := seedMoverJob(t, ctx, svc, pool, customer, 1_000_000)

	if _, _, err := svc.QuoteMoverAcceptance(ctx, uuid.New().String(), moverReq(jobID, bids[0])); err == nil {
		t.Error("another user must not be able to quote someone else's job")
	} else {
		wantCoded(t, err, http.StatusForbidden, "")
	}
	if _, _, err := svc.QuoteMoverAcceptance(ctx, customer, moverReq(jobID, bidsB[0])); err == nil {
		t.Error("a bid of ANOTHER job must not price this job")
	}
	if _, _, err := svc.QuoteMoverAcceptance(ctx, customer, moverReq(uuid.New().String(), bids[0])); err == nil {
		t.Error("unknown job")
	}
	pool.Exec(ctx, `UPDATE mover_jobs SET status='cancelled' WHERE id=$1`, jobB)
	if _, _, err := svc.QuoteMoverAcceptance(ctx, customer, moverReq(jobB, bidsB[0])); err == nil {
		t.Error("a cancelled job must not be quotable (never charge for an unacceptable bid)")
	} else {
		wantCoded(t, err, http.StatusConflict, CodeInvalidState)
	}
	pool.Exec(ctx, `UPDATE mover_bids SET status='rejected' WHERE id=$1`, bids[0])
	if _, _, err := svc.QuoteMoverAcceptance(ctx, customer, moverReq(jobID, bids[0])); err == nil {
		t.Error("a non-submitted bid must not be quotable")
	}
}

func TestLiveDB_MoverAcceptCardDirect_ReplayBooksOnce_FindIsPayerScoped(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, customer := paystackRideFixture(t, ctx, pool, 0)
	jobID, bids, _ := seedMoverJob(t, ctx, svc, pool, customer, 4_500_000)
	amt, pricing, _ := svc.QuoteMoverAcceptance(ctx, customer, moverReq(jobID, bids[0]))
	key := "moversorder:mvcd-replay-" + uuid.New().String()
	a, err := svc.AcceptMoverBidPaystackFunded(ctx, customer, moverReq(jobID, bids[0]), key, amt, pricing)
	if err != nil {
		t.Fatal(err)
	}
	b, err := svc.AcceptMoverBidPaystackFunded(ctx, customer, moverReq(jobID, bids[0]), key, amt, pricing)
	if err != nil || a != b {
		t.Fatalf("replay must return the same job: %s vs %s (%v)", a, b, err)
	}
	if n := settlementsForKey(t, ctx, pool, key); n != 1 {
		t.Errorf("%d escrows for one charge", n)
	}
	got, found, err := svc.FindMoverAcceptanceByIdempotencyKey(ctx, customer, key)
	if err != nil || !found || got != jobID {
		t.Errorf("Find = %s %v %v", got, found, err)
	}
	if _, found, _ := svc.FindMoverAcceptanceByIdempotencyKey(ctx, uuid.New().String(), key); found {
		t.Error("Find must be scoped to the payer")
	}
	if _, found, _ := svc.FindMoverAcceptanceByIdempotencyKey(ctx, customer, "moversorder:nope-"+uuid.New().String()); found {
		t.Error("an unknown key must not be found")
	}
}

func TestLiveDB_MoverAcceptCardDirect_ReplayOverRefundedOrForeignSettlement_BooksNothing(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, customer := paystackRideFixture(t, ctx, pool, 50_000_000)
	jobID, bids, _ := seedMoverJob(t, ctx, svc, pool, customer, 4_500_000)
	amt, pricing, _ := svc.QuoteMoverAcceptance(ctx, customer, moverReq(jobID, bids[0]))

	// refunded: an escrow for this key already exists and was reversed.
	keyR := "moversorder:mvcd-ref-" + uuid.New().String()
	sett, err := svc.settlement.EscrowExternal(ctx, customer, "mover:"+jobID, keyR, "transport", amt)
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.settlement.RefundExternal(ctx, sett.ID, "test"); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.AcceptMoverBidPaystackFunded(ctx, customer, moverReq(jobID, bids[0]), keyR, amt, pricing); err == nil {
		t.Fatal("a replay over a REFUNDED settlement must not fund a job (the money already went back)")
	}
	if m := readMover(t, ctx, pool, jobID); m.escrow != "none" {
		t.Errorf("job funded off a refunded settlement: %+v", m)
	}

	// foreign payer's settlement under the same key.
	keyF := "moversorder:mvcd-for-" + uuid.New().String()
	stranger := uuid.New().String()
	pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2)`, stranger, stranger+"@mv.test")
	testsupport.CleanupUser(t, pool, stranger)
	if _, err := svc.settlement.EscrowExternal(ctx, stranger, "mover:"+jobID, keyF, "transport", amt); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.AcceptMoverBidPaystackFunded(ctx, customer, moverReq(jobID, bids[0]), keyF, amt, pricing); err == nil {
		t.Fatal("a replay over ANOTHER payer's settlement must not fund this job")
	}

	// wallet-funded settlement under the same key.
	keyW := "moversorder:mvcd-wal-" + uuid.New().String()
	testsupport.SetKycTier(t, ctx, pool, customer, testsupport.KycTierUnlimited)
	if _, err := svc.settlement.Escrow(ctx, customer, "mover:"+jobID, keyW, "transport", amt); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.AcceptMoverBidPaystackFunded(ctx, customer, moverReq(jobID, bids[0]), keyW, amt, pricing); err == nil {
		t.Fatal("a replay over a WALLET-funded settlement must not be treated as card money")
	}
	if m := readMover(t, ctx, pool, jobID); m.escrow != "none" {
		t.Errorf("job funded: %+v", m)
	}
}

// A failure AFTER the escrow posted (here: the job UPDATE is rejected by a
// trigger) must reverse the escrow ledger-side, because Find proves no job owns it.
func TestLiveDB_MoverAcceptCardDirect_FailureAfterEscrow_ReversesEscrowWhenNoJobOwnsIt(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, customer := paystackRideFixture(t, ctx, pool, 0)
	jobID, bids, _ := seedMoverJob(t, ctx, svc, pool, customer, 4_500_000)
	amt, pricing, _ := svc.QuoteMoverAcceptance(ctx, customer, moverReq(jobID, bids[0]))

	fn := "mvfail_" + uuid.NewString()[:8]
	fn = "fn_" + fn[len(fn)-8:]
	if _, err := pool.Exec(ctx, `CREATE FUNCTION `+fn+`() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected mover update failure'; END $$`); err != nil {
		t.Fatal(err)
	}
	trg := "trg_" + fn
	if _, err := pool.Exec(ctx, `CREATE TRIGGER `+trg+` BEFORE UPDATE ON mover_jobs FOR EACH ROW WHEN (NEW.id = '`+jobID+`' AND NEW.status = 'bid_accepted') EXECUTE FUNCTION `+fn+`()`); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DROP TRIGGER IF EXISTS `+trg+` ON mover_jobs`)
		_, _ = pool.Exec(context.Background(), `DROP FUNCTION IF EXISTS `+fn+`()`)
	})

	key := "moversorder:mvcd-fail-" + uuid.New().String()
	if _, err := svc.AcceptMoverBidPaystackFunded(ctx, customer, moverReq(jobID, bids[0]), key, amt, pricing); err == nil {
		t.Fatal("the injected failure must surface")
	}
	var status string
	if err := pool.QueryRow(ctx, `SELECT status FROM settlements WHERE idempotency_key=$1`, key).Scan(&status); err != nil || status != "refunded" {
		t.Fatalf("orphaned external escrow must be reversed ledger-side (status=%q err=%v)", status, err)
	}
	var debit, credit int64
	_ = pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_kobo) FILTER (WHERE type='DEBIT'),0), COALESCE(SUM(amount_kobo) FILTER (WHERE type='CREDIT'),0)
		FROM ledger_entries WHERE reference IN ($1,$2)`, "escrow:mover:"+jobID, "refund:mover:"+jobID).Scan(&debit, &credit)
	if debit != credit || debit != 2*amt {
		t.Errorf("escrow+reversal must net out: debit=%d credit=%d", debit, credit)
	}
	if m := readMover(t, ctx, pool, jobID); m.escrow != "none" {
		t.Errorf("job state %+v", m)
	}
}

// Two different charges (different keys) for the SAME job: exactly one books,
// the loser's escrow is reversed (ledger nets to zero) so the engine's gateway
// refund of the loser leaves the books balanced.
func TestLiveDB_MoverAcceptCardDirect_TwoChargesOneJob_ExactlyOneBooks(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, customer := paystackRideFixture(t, ctx, pool, 0)
	jobID, bids, _ := seedMoverJob(t, ctx, svc, pool, customer, 4_500_000)
	amt, pricing, _ := svc.QuoteMoverAcceptance(ctx, customer, moverReq(jobID, bids[0]))

	keys := []string{"moversorder:mvcd-race-a-" + uuid.NewString(), "moversorder:mvcd-race-b-" + uuid.NewString()}
	errs := make([]error, 2)
	var wg sync.WaitGroup
	for i := range keys {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, errs[i] = svc.AcceptMoverBidPaystackFunded(ctx, customer, moverReq(jobID, bids[0]), keys[i], amt, pricing)
		}(i)
	}
	wg.Wait()
	ok := 0
	for _, e := range errs {
		if e == nil {
			ok++
		}
	}
	if ok != 1 {
		t.Fatalf("exactly one charge may fund the job, got %d successes (%v)", ok, errs)
	}
	var live, reversedOrAbsent int
	for _, k := range keys {
		var st string
		err := pool.QueryRow(ctx, `SELECT status FROM settlements WHERE idempotency_key=$1`, k).Scan(&st)
		switch {
		case err != nil:
			reversedOrAbsent++
		case st == "escrowed":
			live++
		case st == "refunded":
			reversedOrAbsent++
		}
	}
	if live != 1 || reversedOrAbsent != 1 {
		t.Errorf("live=%d reversed/absent=%d; the loser's escrow must not stay live", live, reversedOrAbsent)
	}
}

// ── cancel / refund rail ───────────────────────────────────────────────────

// fakeMoverRefunder stands in for the engine refunder. reverse (optional) does
// what the real one does after the gateway accepts: reverse the escrow ledger-side.
type fakeMoverRefunder struct {
	calls   []struct{ entityID, settlementID, reason string }
	err     error
	reverse func(ctx context.Context, settlementID string) error
}

func (f *fakeMoverRefunder) RefundExternalSettlement(ctx context.Context, entityID, settlementID, reason string) error {
	f.calls = append(f.calls, struct{ entityID, settlementID, reason string }{entityID, settlementID, reason})
	if f.err != nil {
		return f.err
	}
	if f.reverse != nil {
		return f.reverse(ctx, settlementID)
	}
	return nil
}

func cardFundedMove(t *testing.T, ctx context.Context, svc *Service, pool *pgxpool.Pool, customer string) string {
	t.Helper()
	jobID, bids, _ := seedMoverJob(t, ctx, svc, pool, customer, 4_500_000)
	amt, pricing, err := svc.QuoteMoverAcceptance(ctx, customer, moverReq(jobID, bids[0]))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.AcceptMoverBidPaystackFunded(ctx, customer, moverReq(jobID, bids[0]), "moversorder:mvcd-c-"+uuid.NewString(), amt, pricing); err != nil {
		t.Fatal(err)
	}
	return jobID
}

func TestLiveDB_CancelMover_CardFunded_UsesExternalRefunder_NeverWalletCredit(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, customer := paystackRideFixture(t, ctx, pool, 10_000_000)
	fake := &fakeMoverRefunder{}
	svc.SetDomainExternalRefunder("movers", fake)
	jobID := cardFundedMove(t, ctx, svc, pool, customer)

	before := riderWalletBalance(t, ctx, pool, customer)
	if err := svc.CancelMover(ctx, jobID, customer, "changed_mind"); err != nil {
		t.Fatalf("CancelMover: %v", err)
	}
	if after := riderWalletBalance(t, ctx, pool, customer); after != before {
		t.Errorf("wallet moved cancelling a card-funded move: %d -> %d (settlement.Refund must never run)", before, after)
	}
	sid, _, _, _ := moverSettlement(t, ctx, pool, jobID)
	if len(fake.calls) != 1 || fake.calls[0].entityID != jobID || fake.calls[0].settlementID != sid {
		t.Fatalf("refunder calls %+v", fake.calls)
	}
	if m := readMover(t, ctx, pool, jobID); m.status != "cancelled" || m.escrow != "refunded" {
		t.Errorf("state %+v", m)
	}
}

func TestLiveDB_CancelMover_CardFunded_RefundFailureIsNotRecordedAsRefunded_RetryCompletes(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, customer := paystackRideFixture(t, ctx, pool, 10_000_000)
	jobID := cardFundedMove(t, ctx, svc, pool, customer) // NO refunder wired

	before := riderWalletBalance(t, ctx, pool, customer)
	// M2: refused up front — the move is not flipped to cancelled while its
	// refund cannot run (it used to answer success with the money still escrowed).
	err := svc.CancelMover(ctx, jobID, customer, "x")
	wantCoded(t, err, 503, "refund_unavailable")
	if after := riderWalletBalance(t, ctx, pool, customer); after != before {
		t.Fatalf("wallet credited with no refunder wired: %d -> %d", before, after)
	}
	_, _, status, _ := moverSettlement(t, ctx, pool, jobID)
	if status != "escrowed" {
		t.Fatalf("settlement %s; must stay escrowed", status)
	}
	if m := readMover(t, ctx, pool, jobID); m.status != "bid_accepted" || m.escrow == "refunded" {
		t.Fatalf("a refused cancel must leave the move untouched: %+v", m)
	}

	fake := &fakeMoverRefunder{reverse: func(ctx context.Context, id string) error {
		return svc.settlement.RefundExternal(ctx, id, "test")
	}}
	svc.SetDomainExternalRefunder("movers", fake)
	if err := svc.CancelMover(ctx, jobID, customer, "retry"); err != nil {
		t.Fatalf("retry cancel must finish the refund: %v", err)
	}
	if len(fake.calls) != 1 || fake.calls[0].entityID != jobID {
		t.Errorf("retry refund calls %+v", fake.calls)
	}
	if m := readMover(t, ctx, pool, jobID); m.escrow != "refunded" {
		t.Errorf("after the retry escrow_status should be refunded: %+v", m)
	}
	// and a third POST is a harmless no-op (no second gateway refund)
	if err := svc.CancelMover(ctx, jobID, customer, "again"); err != nil {
		t.Errorf("repeat cancel after completion: %v", err)
	}
	if len(fake.calls) != 1 {
		t.Errorf("a completed refund was attempted again: %+v", fake.calls)
	}
}

func TestLiveDB_CancelMover_WalletFunded_StillRefundsWallet(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, customer := paystackRideFixture(t, ctx, pool, 50_000_000)
	testsupport.SetKycTier(t, ctx, pool, customer, testsupport.KycTierUnlimited)
	fake := &fakeMoverRefunder{}
	svc.SetDomainExternalRefunder("movers", fake)
	jobID, bids, _ := seedMoverJob(t, ctx, svc, pool, customer, 4_500_000)

	if _, err := svc.AcceptMoverBid(ctx, jobID, customer, bids[0], "mvwal-"+uuid.NewString()); err != nil {
		t.Fatalf("wallet AcceptMoverBid (Tier 3): %v", err)
	}
	afterAccept := riderWalletBalance(t, ctx, pool, customer)
	if err := svc.CancelMover(ctx, jobID, customer, "x"); err != nil {
		t.Fatal(err)
	}
	if got := riderWalletBalance(t, ctx, pool, customer); got != afterAccept+4_500_000 {
		t.Errorf("wallet-funded cancel refund: balance %d, want %d", got, afterAccept+4_500_000)
	}
	if len(fake.calls) != 0 {
		t.Errorf("external refunder must not be consulted for a wallet-funded move: %+v", fake.calls)
	}
	if m := readMover(t, ctx, pool, jobID); m.escrow != "refunded" {
		t.Errorf("state %+v", m)
	}
}

// ensure the frozen pricing blob stays JSON the engine can store.
func TestLiveDB_MoverQuoteAcceptance_PricingIsValidJSONWithBidIdentity(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, customer := paystackRideFixture(t, ctx, pool, 0)
	jobID, bids, drivers := seedMoverJob(t, ctx, svc, pool, customer, 4_500_000)
	_, pricing, err := svc.QuoteMoverAcceptance(ctx, customer, moverReq(jobID, bids[0]))
	if err != nil {
		t.Fatal(err)
	}
	var f moverFrozenAcceptance
	if err := json.Unmarshal(pricing, &f); err != nil || f.BidID != bids[0] || f.ProviderID != drivers[0] || f.AmountKobo != 4_500_000 {
		t.Errorf("frozen pricing %s (%v)", pricing, err)
	}
}
