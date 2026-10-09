package fractionalre

// LIVE-DB regression tests for the fractionalre money-path hardening wave
// (w10): idempotency-key scoping, offering capacity, close-claim replay
// convergence, and secondary-settle lifecycle. Skipped unless
// TEST_DATABASE_URL is set — same convention as live_journey_test.go.

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"

	"spotlight/backend/internal/finance/kyc"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/settlement"
	"spotlight/backend/internal/finance/tiers"
)

func newLiveSvc(t *testing.T, pool *pgxpool.Pool) (*Service, *ledger.Service, *settlement.Service) {
	t.Helper()
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	settle := settlement.NewService(pool, led)
	svc := NewService(NewRepository(pool), led, settle, kyc.NewService(pool), tiers.NewService(pool), nil)
	return svc, led, settle
}

// onboardInvestor runs the full investor gate chain Subscribe requires:
// activate → HNI classify (exempts retail cap) → verified KYC tier ≥1 → funded
// wallet → per-offer risk ack.
func onboardInvestor(t *testing.T, ctx context.Context, pool *pgxpool.Pool, svc *Service, led *ledger.Service,
	maker, offeringID string, fundKobo int64) string {
	t.Helper()
	u := seedUser(t, ctx, pool)
	setKycVerified(t, ctx, pool, u, 3)
	fundWallet(t, ctx, led, u, fundKobo)
	if _, err := svc.Activate(ctx, u); err != nil {
		t.Fatalf("activate: %v", err)
	}
	if err := svc.ClassifyInvestor(ctx, maker, u, ClassHNI, 0); err != nil {
		t.Fatalf("classify: %v", err)
	}
	if _, err := svc.AckRisk(ctx, u, &offeringID, "disclosure-v1", true); err != nil {
		t.Fatalf("risk ack: %v", err)
	}
	return u
}

func walletBalance(t *testing.T, ctx context.Context, pool *pgxpool.Pool, led *ledger.Service, userID string) int64 {
	t.Helper()
	acc, err := led.GetOrCreateUserWallet(ctx, userID)
	if err != nil {
		t.Fatalf("wallet: %v", err)
	}
	bal, err := NewRepository(pool).ProjectAccountBalance(ctx, acc.ID)
	if err != nil {
		t.Fatalf("balance: %v", err)
	}
	return bal
}

func settlementStatusByKey(t *testing.T, ctx context.Context, pool *pgxpool.Pool, key string) string {
	t.Helper()
	var st string
	err := pool.QueryRow(ctx, `SELECT status FROM settlements WHERE idempotency_key=$1`, key).Scan(&st)
	if err != nil {
		t.Fatalf("settlement by key %q: %v", key, err)
	}
	return st
}

// A second user replaying ANOTHER user's Idempotency-Key must never receive
// that user's subscription, and must be debited from their OWN wallet. The key
// is scoped per (module, caller) before it reaches any shared UNIQUE index or
// the global settlements table.
func TestLiveDB_Subscribe_CrossUserKeyCollision(t *testing.T) {
	ctx := context.Background()
	pool := livePool(t)
	svc, led, _ := newLiveSvc(t, pool)

	maker := seedUser(t, ctx, pool)
	verifier := seedUser(t, ctx, pool)
	off := setupLiveOffering(t, ctx, svc, maker, verifier, "KeyScope", "Abeokuta", 50_000_000, 100, 1)

	a := onboardInvestor(t, ctx, pool, svc, led, maker, off.ID, 20_000_000)
	b := onboardInvestor(t, ctx, pool, svc, led, maker, off.ID, 20_000_000)

	shared := "w10-prop-shared:" + off.ID
	subA, err := svc.Subscribe(ctx, a, shared, off.ID, SubscribeRequest{Units: 5})
	if err != nil {
		t.Fatalf("A subscribe: %v", err)
	}
	subB, err := svc.Subscribe(ctx, b, shared, off.ID, SubscribeRequest{Units: 5})
	if err != nil {
		t.Fatalf("B subscribe with a reused key must still succeed on its own scope: %v", err)
	}
	if subB.UserID != b {
		t.Fatalf("cross-user key reuse returned another user's subscription (user_id=%s)", subB.UserID)
	}
	if subB.ID == subA.ID {
		t.Fatal("cross-user key reuse must not alias the first subscription")
	}
	// Each escrow posts one balanced pair under ITS OWN scoped key.
	if n, _ := countLegs(t, ctx, pool, scopedIdemKey(a, shared)+":%"); n != 2 {
		t.Fatalf("A's escrow legs under scoped key: want 2, got %d", n)
	}
	if n, _ := countLegs(t, ctx, pool, scopedIdemKey(b, shared)+":%"); n != 2 {
		t.Fatalf("B's escrow legs under scoped key: want 2, got %d", n)
	}
	// B was actually debited (funded 20m, escrowed 500_000).
	if bal := walletBalance(t, ctx, pool, led, b); bal != 20_000_000-500_000 {
		t.Fatalf("B wallet must show its own debit, got %d", bal)
	}
}

// Replaying a key with a DIFFERENT payload (offering or units) must conflict —
// never silently return the subscription the key originally produced.
func TestLiveDB_Subscribe_KeyReplayDifferentPayload_Conflicts(t *testing.T) {
	ctx := context.Background()
	pool := livePool(t)
	svc, led, _ := newLiveSvc(t, pool)

	maker := seedUser(t, ctx, pool)
	verifier := seedUser(t, ctx, pool)
	off1 := setupLiveOffering(t, ctx, svc, maker, verifier, "ScopeOne", "Ikeja", 50_000_000, 100, 1)
	off2 := setupLiveOffering(t, ctx, svc, maker, verifier, "ScopeTwo", "Ikeja", 50_000_000, 100, 1)

	u := onboardInvestor(t, ctx, pool, svc, led, maker, off1.ID, 50_000_000)
	if _, err := svc.AckRisk(ctx, u, &off2.ID, "disclosure-v1", true); err != nil {
		t.Fatalf("ack off2: %v", err)
	}
	key := "w10-prop-mismatch:" + off1.ID
	if _, err := svc.Subscribe(ctx, u, key, off1.ID, SubscribeRequest{Units: 5}); err != nil {
		t.Fatalf("first subscribe: %v", err)
	}
	if _, err := svc.Subscribe(ctx, u, key, off2.ID, SubscribeRequest{Units: 5}); !errors.Is(err, ErrIdempotencyConflict) {
		t.Fatalf("same key on a different offering must conflict, got %v", err)
	}
	if _, err := svc.Subscribe(ctx, u, key, off1.ID, SubscribeRequest{Units: 7}); !errors.Is(err, ErrIdempotencyConflict) {
		t.Fatalf("same key with different units must conflict, got %v", err)
	}
	// The conflicting attempts moved no money.
	if n, _ := countLegs(t, ctx, pool, scopedIdemKey(u, key)+":%"); n != 2 {
		t.Fatalf("conflicted replays must not post extra legs, got %d", n)
	}
}

// Oversubscription: a round may never sell more units than share_count, and a
// refused subscribe must return the escrowed funds to the investor's wallet.
func TestLiveDB_Subscribe_SoldOut_RefundsEscrow(t *testing.T) {
	ctx := context.Background()
	pool := livePool(t)
	svc, led, _ := newLiveSvc(t, pool)

	maker := seedUser(t, ctx, pool)
	verifier := seedUser(t, ctx, pool)
	off := setupLiveOffering(t, ctx, svc, maker, verifier, "CapCheck", "Enugu", 50_000_000, 10, 1)

	a := onboardInvestor(t, ctx, pool, svc, led, maker, off.ID, 20_000_000)
	b := onboardInvestor(t, ctx, pool, svc, led, maker, off.ID, 20_000_000)

	if _, err := svc.Subscribe(ctx, a, "w10-prop-cap-a:"+off.ID, off.ID, SubscribeRequest{Units: 8}); err != nil {
		t.Fatalf("A subscribe: %v", err)
	}
	bKey := "w10-prop-cap-b:" + off.ID
	if _, err := svc.Subscribe(ctx, b, bKey, off.ID, SubscribeRequest{Units: 5}); !errors.Is(err, ErrOfferingSoldOut) {
		t.Fatalf("subscribe beyond share_count must be refused, got %v", err)
	}
	// The refused attempt must have unwound its escrow — B keeps the full 20m.
	if bal := walletBalance(t, ctx, pool, led, b); bal != 20_000_000 {
		t.Fatalf("refused subscribe must refund the escrow, B balance=%d want 20000000", bal)
	}
	if st := settlementStatusByKey(t, ctx, pool, scopedIdemKey(b, bKey)); st != "refunded" {
		t.Fatalf("orphan escrow must be refunded, settlement status=%s", st)
	}
	// A's subscription is untouched.
	if bal := walletBalance(t, ctx, pool, led, a); bal != 20_000_000-800_000 {
		t.Fatalf("A balance=%d want %d", bal, 20_000_000-800_000)
	}
}

// Close replay convergence: a second checker (or a retried close) must not
// double-allocate cap-table units, and a refunded round must stay refunded.
func TestLiveDB_CloseAndSettle_ReplayNoDoubleAllocate(t *testing.T) {
	ctx := context.Background()
	pool := livePool(t)
	svc, led, _ := newLiveSvc(t, pool)

	maker := seedUser(t, ctx, pool)
	checker1 := seedUser(t, ctx, pool)
	checker2 := seedUser(t, ctx, pool)
	verifier := seedUser(t, ctx, pool)
	off := setupLiveOffering(t, ctx, svc, maker, verifier, "DoubleClose", "Osogbo", 50_000_000, 100, 4_000_000)

	u := onboardInvestor(t, ctx, pool, svc, led, maker, off.ID, 20_000_000)
	if _, err := svc.Subscribe(ctx, u, "w10-prop-dc:"+off.ID, off.ID, SubscribeRequest{Units: 50}); err != nil {
		t.Fatalf("subscribe: %v", err)
	}
	if err := svc.ProposeClose(ctx, maker, off.ID); err != nil {
		t.Fatalf("propose: %v", err)
	}
	closed, err := svc.CloseAndSettle(ctx, checker1, off.ID)
	if err != nil || closed.Status != OfferingFunded {
		t.Fatalf("first close: %v status=%s", err, closed.Status)
	}
	// Second close by a DIFFERENT checker must be a converged no-op, not a
	// second allocation pass.
	again, err := svc.CloseAndSettle(ctx, checker2, off.ID)
	if err != nil {
		t.Fatalf("replayed close must return the converged state, got %v", err)
	}
	if again.Status != OfferingFunded {
		t.Fatalf("replayed close changed status to %s", again.Status)
	}
	holds, err := svc.ListHoldings(ctx, u)
	if err != nil || len(holds) != 1 || holds[0].Units != 50 {
		t.Fatalf("double close must not double-allocate: holdings=%+v err=%v", holds, err)
	}
}

// A checker who claimed a close and crashed mid-allocation resumes under their
// own claim: escrowed subs allocate, already-allocated subs are NOT re-issued,
// and the round still reaches funded.
func TestLiveDB_CloseAndSettle_CrashResumeAllocate(t *testing.T) {
	ctx := context.Background()
	pool := livePool(t)
	svc, led, _ := newLiveSvc(t, pool)

	maker := seedUser(t, ctx, pool)
	checker := seedUser(t, ctx, pool)
	verifier := seedUser(t, ctx, pool)
	off := setupLiveOffering(t, ctx, svc, maker, verifier, "CrashAlloc", "Ibadan", 50_000_000, 100, 4_000_000)

	u1 := onboardInvestor(t, ctx, pool, svc, led, maker, off.ID, 20_000_000)
	u2 := onboardInvestor(t, ctx, pool, svc, led, maker, off.ID, 20_000_000)
	sub1, err := svc.Subscribe(ctx, u1, "w10-prop-ca1:"+off.ID, off.ID, SubscribeRequest{Units: 30})
	if err != nil {
		t.Fatalf("sub1: %v", err)
	}
	sub2, err := svc.Subscribe(ctx, u2, "w10-prop-ca2:"+off.ID, off.ID, SubscribeRequest{Units: 20})
	if err != nil {
		t.Fatalf("sub2: %v", err)
	}
	if err := svc.ProposeClose(ctx, maker, off.ID); err != nil {
		t.Fatalf("propose: %v", err)
	}
	// Craft the crashed-mid-allocate state by hand: u1's subscription is fully
	// allocated (status + cap row) and the checker already owns the claim;
	// u2's subscription is still escrowed — the crash hit between the two.
	if _, err := pool.Exec(ctx,
		`UPDATE fre_subscriptions SET status='allocated', updated_at=now() WHERE id=$1`, sub1.ID); err != nil {
		t.Fatalf("craft sub1 allocated: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO fre_cap_table (asset_id, offering_id, user_id, units, cost_kobo, source)
		VALUES ($1,$2,$3,$4,$5,'primary')`,
		off.AssetID, off.ID, u1, sub1.Units, sub1.AmountKobo); err != nil {
		t.Fatalf("craft u1 cap row: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`UPDATE fre_offerings SET close_approved_by=$2, updated_at=now() WHERE id=$1`, off.ID, checker); err != nil {
		t.Fatalf("craft claim: %v", err)
	}
	_ = sub2 // still escrowed — the resume must allocate exactly this one

	closed, err := svc.CloseAndSettle(ctx, checker, off.ID)
	if err != nil {
		t.Fatalf("resumed close must succeed under the same checker, got %v", err)
	}
	if closed.Status != OfferingFunded {
		t.Fatalf("resumed close must fund the round, got %s", closed.Status)
	}
	// u1 must not be issued twice: the cap-table row holds the original 30.
	var u1Units int64
	if err := pool.QueryRow(ctx,
		`SELECT units FROM fre_cap_table WHERE asset_id=$1 AND user_id=$2`, off.AssetID, u1).Scan(&u1Units); err != nil {
		t.Fatalf("u1 cap row: %v", err)
	}
	if u1Units != 30 {
		t.Fatalf("crash-resume re-issued u1's units: got %d want 30", u1Units)
	}
	h2, err := svc.GetHolding(ctx, off.AssetID, u2)
	if err != nil || h2.Units != 20 {
		t.Fatalf("u2 must be allocated 20 units on resume, got %+v err=%v", h2, err)
	}
	var sub2Status string
	if err := pool.QueryRow(ctx, `SELECT status FROM fre_subscriptions WHERE id=$1`, sub2.ID).Scan(&sub2Status); err != nil {
		t.Fatalf("sub2 status: %v", err)
	}
	if sub2Status != "allocated" {
		t.Fatalf("resumed sub must be allocated, got %s", sub2Status)
	}
	// A THIRD checker still cannot hijack the finished close.
	if _, err := svc.CloseAndSettle(ctx, seedUser(t, ctx, pool), off.ID); err != nil {
		t.Fatalf("close on a funded round must converge, got %v", err)
	}
}

// A funded round must refuse the refund escape hatch — previously RefundRound
// flipped a funded offering to 'refunded' while units stayed allocated.
func TestLiveDB_RefundRound_FundedOffering_Refused(t *testing.T) {
	ctx := context.Background()
	pool := livePool(t)
	svc, led, _ := newLiveSvc(t, pool)

	maker := seedUser(t, ctx, pool)
	checker := seedUser(t, ctx, pool)
	refunder := seedUser(t, ctx, pool)
	verifier := seedUser(t, ctx, pool)
	off := setupLiveOffering(t, ctx, svc, maker, verifier, "FundedRefund", "Kano", 50_000_000, 100, 4_000_000)

	u := onboardInvestor(t, ctx, pool, svc, led, maker, off.ID, 20_000_000)
	if _, err := svc.Subscribe(ctx, u, "w10-prop-fr:"+off.ID, off.ID, SubscribeRequest{Units: 50}); err != nil {
		t.Fatalf("subscribe: %v", err)
	}
	if err := svc.ProposeClose(ctx, maker, off.ID); err != nil {
		t.Fatalf("propose: %v", err)
	}
	if _, err := svc.CloseAndSettle(ctx, checker, off.ID); err != nil {
		t.Fatalf("close: %v", err)
	}
	if _, err := svc.RefundRound(ctx, refunder, off.ID); !errors.Is(err, ErrInvalidTransition) {
		t.Fatalf("refund on a funded round must fail, got %v", err)
	}
	got, err := svc.GetOffering(ctx, off.ID)
	if err != nil || got.Status != OfferingFunded {
		t.Fatalf("funded round must stay funded, status=%v err=%v", got.Status, err)
	}
}

// Secondary settle must close the settlement lifecycle: the row reaches
// 'settled' (not stuck 'escrowed'), the seller/revenue legs stay balanced, and
// the settled escrow can never be refunded a second time.
func TestLiveDB_BuyFraction_SettlementRowSettles(t *testing.T) {
	ctx := context.Background()
	pool := livePool(t)
	svc, led, settle := newLiveSvc(t, pool)

	maker := seedUser(t, ctx, pool)
	checker := seedUser(t, ctx, pool)
	verifier := seedUser(t, ctx, pool)
	off := setupLiveOffering(t, ctx, svc, maker, verifier, "Secondary", "Jos", 50_000_000, 100, 4_000_000)

	seller := onboardInvestor(t, ctx, pool, svc, led, maker, off.ID, 20_000_000)
	buyer := onboardInvestor(t, ctx, pool, svc, led, maker, off.ID, 20_000_000)
	if _, err := svc.Subscribe(ctx, seller, "w10-prop-sec:"+off.ID, off.ID, SubscribeRequest{Units: 50}); err != nil {
		t.Fatalf("subscribe: %v", err)
	}
	if err := svc.ProposeClose(ctx, maker, off.ID); err != nil {
		t.Fatalf("propose: %v", err)
	}
	if _, err := svc.CloseAndSettle(ctx, checker, off.ID); err != nil {
		t.Fatalf("close: %v", err)
	}

	// Pin the shared market-controls row — other suites/tests can leave it
	// halted or with a different fee. fee 100bps → 750_000*100/10000 = 7_500.
	if err := svc.UpdateMarketControls(ctx, maker, true, 100); err != nil {
		t.Fatalf("market controls: %v", err)
	}
	list, err := svc.ListFraction(ctx, seller, "w10-prop-list:"+off.AssetID, ListFractionRequest{
		AssetID: off.AssetID, Units: 10, UnitPriceKobo: 150_000,
	})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	buyKey := "w10-prop-buy:" + list.ID
	order, err := svc.BuyFraction(ctx, buyer, buyKey, list.ID, BuyFractionRequest{Units: 5})
	if err != nil {
		t.Fatalf("buy: %v", err)
	}
	if order.Status != "settled" {
		t.Fatalf("order must settle, got %s", order.Status)
	}
	// amount 750_000, default fee 100bps → 7_500; seller nets 742_500.
	if bal := walletBalance(t, ctx, pool, led, seller); bal != 15_000_000+742_500 {
		t.Fatalf("seller net credit wrong: %d", bal)
	}
	if bal := walletBalance(t, ctx, pool, led, buyer); bal != 20_000_000-750_000 {
		t.Fatalf("buyer balance wrong: %d", bal)
	}
	// The settlement row must be 'settled' — a row left 'escrowed' is refundable
	// and pays the buyer a second time.
	var st string
	if order.SettlementID == nil {
		t.Fatal("order missing settlement id")
	}
	if err := pool.QueryRow(ctx, `SELECT status FROM settlements WHERE id=$1`, *order.SettlementID).Scan(&st); err != nil {
		t.Fatalf("settlement row: %v", err)
	}
	if st != "settled" {
		t.Fatalf("settlement row must be settled after secondary buy, got %s", st)
	}
	if err := settle.Refund(ctx, *order.SettlementID, "double-pay probe"); err == nil {
		t.Fatal("refunding an already-settled secondary escrow must fail")
	}
	// Replay: same key returns the settled order with no extra legs.
	order2, err := svc.BuyFraction(ctx, buyer, buyKey, list.ID, BuyFractionRequest{Units: 5})
	if err != nil || order2.ID != order.ID {
		t.Fatalf("replay must return the same order, got %+v err=%v", order2, err)
	}
	holdB, err := svc.GetHolding(ctx, off.AssetID, buyer)
	if err != nil || holdB.Units != 5 {
		t.Fatalf("buyer units must be 5 after replay, got %+v err=%v", holdB, err)
	}
}

// A crash between order insert and settlement must be recoverable by replaying
// the same key: units move exactly once and the escrow settles.
func TestLiveDB_BuyFraction_CrashResume(t *testing.T) {
	ctx := context.Background()
	pool := livePool(t)
	svc, led, settle := newLiveSvc(t, pool)

	maker := seedUser(t, ctx, pool)
	checker := seedUser(t, ctx, pool)
	verifier := seedUser(t, ctx, pool)
	off := setupLiveOffering(t, ctx, svc, maker, verifier, "CrashResume", "Sokoto", 50_000_000, 100, 4_000_000)

	seller := onboardInvestor(t, ctx, pool, svc, led, maker, off.ID, 20_000_000)
	buyer := onboardInvestor(t, ctx, pool, svc, led, maker, off.ID, 20_000_000)
	if _, err := svc.Subscribe(ctx, seller, "w10-prop-cr:"+off.ID, off.ID, SubscribeRequest{Units: 50}); err != nil {
		t.Fatalf("subscribe: %v", err)
	}
	if err := svc.ProposeClose(ctx, maker, off.ID); err != nil {
		t.Fatalf("propose: %v", err)
	}
	if _, err := svc.CloseAndSettle(ctx, checker, off.ID); err != nil {
		t.Fatalf("close: %v", err)
	}
	if err := svc.UpdateMarketControls(ctx, maker, true, 100); err != nil {
		t.Fatalf("market controls: %v", err)
	}
	list, err := svc.ListFraction(ctx, seller, "w10-prop-crlist:"+off.AssetID, ListFractionRequest{
		AssetID: off.AssetID, Units: 10, UnitPriceKobo: 150_000,
	})
	if err != nil {
		t.Fatalf("list: %v", err)
	}

	// Simulate the crash-between-insert-and-transfer state by hand: escrow
	// posted + order row present ('escrowed'), units not yet moved.
	buyKey := "w10-prop-crbuy:" + list.ID
	sKey := scopedIdemKey(buyer, buyKey)
	amountKobo := int64(5) * 150_000
	feeKobo := amountKobo * 100 / 10000
	ref := "fre-secondary:" + list.ID + ":" + buyer
	sett, err := settle.Escrow(ctx, buyer, ref, sKey, moduleType, amountKobo)
	if err != nil {
		t.Fatalf("craft escrow: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO fre_secondary_orders (listing_id, asset_id, buyer_id, seller_id, units, amount_kobo, fee_kobo, status, settlement_id, idempotency_key)
		VALUES ($1,$2,$3,$4,$5,$6,$7,'escrowed',$8,$9)`,
		list.ID, off.AssetID, buyer, seller, 5, amountKobo, feeKobo, sett.ID, sKey); err != nil {
		t.Fatalf("craft order row: %v", err)
	}

	order, err := svc.BuyFraction(ctx, buyer, buyKey, list.ID, BuyFractionRequest{Units: 5})
	if err != nil {
		t.Fatalf("resume must complete, got %v", err)
	}
	if order.Status != "settled" {
		t.Fatalf("resumed order must settle, got %s", order.Status)
	}
	hb, err := svc.GetHolding(ctx, off.AssetID, buyer)
	if err != nil || hb.Units != 5 {
		t.Fatalf("resume must move units exactly once, buyer=%+v err=%v", hb, err)
	}
	l2, err := svc.repo.GetListing(ctx, list.ID)
	if err != nil || l2.UnitsRemaining != 5 {
		t.Fatalf("listing must decrement once, remaining=%d err=%v", l2.UnitsRemaining, err)
	}
	if st := settlementStatusByKey(t, ctx, pool, sKey); st != "settled" {
		t.Fatalf("resumed settlement must reach settled, got %s", st)
	}
}

// fee_bps above 100% would price a fee larger than the trade — refuse it at
// the control surface instead of poisoning every buy.
func TestLiveDB_MarketControls_FeeBpsBound(t *testing.T) {
	ctx := context.Background()
	pool := livePool(t)
	svc, _, _ := newLiveSvc(t, pool)
	admin := seedUser(t, ctx, pool)

	if err := svc.UpdateMarketControls(ctx, admin, true, 10_001); !errors.Is(err, ErrValidation) {
		t.Fatalf("fee_bps > 10000 must be refused, got %v", err)
	}
	if err := svc.UpdateMarketControls(ctx, admin, true, 100); err != nil {
		t.Fatalf("sane fee must save, got %v", err)
	}
}
