package p2pmarket

// LIVE-DB regression coverage for the checkout wedge residual from the escrow
// ledger re-audit (mirrors health pharmacy's binding_race suite): the
// post-hold compensation path used to run a bare escrow.Refund whenever the
// p2p_orders insert failed. escrow.Hold dedups on the bare idempotency key, so
// `hold` can be a replayed row this attempt did not mint — and a concurrent
// same-key checkout (the "winner") could bind a live order to that hold while
// a failing attempt (the "loser") still believed it unbound. The loser's
// refund could then commit AFTER the winner's binding, reversing a live
// order's payment out from under it (order-over-refunded-hold wedge).
//
// The fix is two halves that serialize on the escrow_holds row lock:
//   - binding half  — Checkout's order tx does SELECT ... FOR UPDATE on the
//     hold and requires HELD + this buyer + this module + NOT already bound
//     (lockEscrowForBinding) before inserting;
//   - resolution half — the insert-failure compensation calls
//     escrow.RefundIf, whose guard re-checks payer + module +
//     NOT EXISTS(bound order) inside the refund tx under the same lock.
//
// These tests drive the residual deterministically: a raw winner transaction
// locks the hold and inserts the bound order row UNCOMMITTED, the loser
// blocks inside its own binding tx on the winner's lock (confirmed via
// pg_locks — no sleeps), the winner commits, and the loser must converge
// without ever refunding the winner's hold.
// Skips unless TEST_DATABASE_URL is set.

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/escrow"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/testsupport"
)

func checkoutPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping p2pmarket checkout-race live-DB test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// checkoutFixture seeds a seller + a funded buyer and wires the real p2pmarket
// service on the real escrow + ledger stack.
type checkoutFixture struct {
	pool   *pgxpool.Pool
	svc    *Service
	esc    *escrow.Service
	led    *ledger.Service
	seller string
	buyer  string
}

func newCheckoutFixture(t *testing.T) *checkoutFixture {
	t.Helper()
	pool := checkoutPool(t)
	ctx := context.Background()

	led := ledger.NewService(ledger.NewRepository(pool), nil)
	esc := escrow.NewService(pool, led, nil)

	f := &checkoutFixture{pool: pool, led: led, esc: esc,
		svc:    NewService(pool, esc, nil),
		seller: uuid.New().String(), buyer: uuid.New().String()}
	for _, u := range []string{f.seller, f.buyer} {
		if _, err := pool.Exec(ctx,
			`INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
			u, u+"@checkout.test"); err != nil {
			t.Fatalf("seed user %s: %v", u, err)
		}
	}
	testsupport.CleanupUsers(t, pool, f.seller, f.buyer)
	// The hold's wallet debit is tier-gated fail-closed — promote the buyer.
	testsupport.SetKycTier(t, ctx, pool, f.buyer, testsupport.KycTierUnlimited)
	return f
}

func (f *checkoutFixture) fund(t *testing.T, userID string, kobo int64) {
	t.Helper()
	revAcc, err := f.led.GetOrCreateStandingAccount(context.Background(), ledger.AccountPaymaxRevenue)
	if err != nil {
		t.Fatalf("resolve revenue account: %v", err)
	}
	if err := f.led.Credit(context.Background(), userID, "seed:checkout-fixtures",
		"seed-fund-"+userID, revAcc.ID, kobo); err != nil {
		t.Fatalf("fund user %s: %v", userID, err)
	}
}

func (f *checkoutFixture) balance(t *testing.T, userID string) int64 {
	t.Helper()
	bal, err := f.led.GetBalance(context.Background(), userID)
	if err != nil {
		t.Fatalf("balance for %s: %v", userID, err)
	}
	return bal
}

func (f *checkoutFixture) holdState(t *testing.T, escrowID string) string {
	t.Helper()
	var st string
	if err := f.pool.QueryRow(context.Background(),
		`SELECT state FROM escrow_holds WHERE id=$1`, escrowID).Scan(&st); err != nil {
		t.Fatalf("read hold state %s: %v", escrowID, err)
	}
	return st
}

func (f *checkoutFixture) boundOrders(t *testing.T, escrowID string) int {
	t.Helper()
	var n int
	if err := f.pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM p2p_orders WHERE escrow_id=$1`, escrowID).Scan(&n); err != nil {
		t.Fatalf("count orders bound to %s: %v", escrowID, err)
	}
	return n
}

// waitForLockWaiter blocks until another transaction is queued on holder's
// transactionid — i.e., until the loser is provably parked at its FOR UPDATE
// on the escrow_holds row the holder locks. Deterministic alternative to a
// sleep: a FOR UPDATE waiter appears in pg_locks as an ungranted ShareLock on
// the holder's xid.
func waitForLockWaiter(t *testing.T, ctx context.Context, pool *pgxpool.Pool, holder pgx.Tx) {
	t.Helper()
	var xid uint64
	if err := holder.QueryRow(ctx, `SELECT txid_current()`).Scan(&xid); err != nil {
		t.Fatalf("read holder txid: %v", err)
	}
	deadline := time.Now().Add(10 * time.Second)
	for {
		var n int
		if err := pool.QueryRow(ctx,
			`SELECT COUNT(*) FROM pg_locks
			 WHERE locktype='transactionid' AND transactionid=$1 AND NOT granted`,
			xid).Scan(&n); err != nil {
			t.Fatalf("probe lock waiters: %v", err)
		}
		if n > 0 {
			return
		}
		if time.Now().After(deadline) {
			t.Fatal("loser never queued on the holder's escrow_holds lock")
		}
		time.Sleep(20 * time.Millisecond)
	}
}

// TestLiveDB_Checkout_LoserCannotRefundBoundHold drives the flagged
// interleave: the winner binds an order to the shared hold UNCOMMITTED, the
// loser (same buyer + same idempotency key) dedups onto that hold and parks on
// the winner's FOR UPDATE, the winner commits — and the loser must converge to
// ErrIdemConflict while leaving the winner's hold HELD.
func TestLiveDB_Checkout_LoserCannotRefundBoundHold(t *testing.T) {
	f := newCheckoutFixture(t)
	ctx := context.Background()
	f.fund(t, f.buyer, 1_000_000)

	l1, err := f.svc.CreateListing(ctx, f.seller, "bike", "used bike", 50_000)
	if err != nil {
		t.Fatalf("create listing 1: %v", err)
	}
	key := "p2p-bind-" + uuid.New().String()

	// The shared hold — escrow.Hold dedups on the bare idempotency key, so the
	// loser below adopts THIS hold rather than minting its own.
	hold, err := f.esc.Hold(ctx, f.buyer, "p2p:"+l1.ID, moduleType, key, l1.PriceKobo)
	if err != nil {
		t.Fatalf("place shared hold: %v", err)
	}

	// Winner's binding transaction — mirror what the winner's own Checkout
	// does: lock the hold FOR UPDATE, insert the bound p2p_orders row; then
	// HOLD THE TX OPEN so the loser's serialized window exists.
	wtx, err := f.pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin winner tx: %v", err)
	}
	defer func() { _ = wtx.Rollback(context.Background()) }()
	var holdState string
	if err := wtx.QueryRow(ctx, `SELECT state FROM escrow_holds WHERE id=$1 FOR UPDATE`, hold.ID).Scan(&holdState); err != nil {
		t.Fatalf("winner lock hold: %v", err)
	}
	if holdState != "HELD" {
		t.Fatalf("precondition: hold state = %s, want HELD", holdState)
	}
	winnerOrderID := uuid.New().String()
	if _, err := wtx.Exec(ctx, `
		INSERT INTO p2p_orders
			(id, listing_id, buyer_id, seller_id, amount_kobo, escrow_id, state, idempotency_key)
		VALUES ($1,$2,$3,$4,$5,$6,'CHECKOUT',$7)`,
		winnerOrderID, l1.ID, f.buyer, f.seller, l1.PriceKobo, hold.ID, key+":winner"); err != nil {
		t.Fatalf("winner bind order: %v", err)
	}

	// Loser: same buyer + same idempotency key on the SAME listing — a
	// same-key/different-params retry is now refused at adoption (the hold's
	// recorded reference would mismatch), which is correct but would error
	// BEFORE reaching the binding lock. Identical params let Hold dedup onto
	// the shared hold so the binding tx blocks on the winner's FOR UPDATE
	// inside lockEscrowForBinding — the interleave this test exists to drive.
	errCh := make(chan error, 1)
	go func() {
		_, err := f.svc.Checkout(ctx, l1.ID, f.buyer, key)
		errCh <- err
	}()

	// Wait until the loser is provably parked on the winner's lock — the only
	// place it can block — then commit the winner: the exact interleave the
	// audit flagged. The loser's binding check now sees the committed bound
	// row and refuses, and its guarded refund vetoes on the same row.
	waitForLockWaiter(t, ctx, f.pool, wtx)
	if err := wtx.Commit(ctx); err != nil {
		t.Fatalf("winner commit: %v", err)
	}

	select {
	case err := <-errCh:
		if !errors.Is(err, ErrIdemConflict) {
			t.Fatalf("loser must converge to ErrIdemConflict, got %v", err)
		}
	case <-time.After(15 * time.Second):
		t.Fatal("loser Checkout did not return — possible deadlock between binding lock and RefundIf")
	}

	// THE assertion: the winner's hold is still HELD — the guarded refund saw
	// the committed bound row and vetoed. A REFUNDED state here is the old
	// bug: a committed order pointing at money already returned.
	if st := f.holdState(t, hold.ID); st != "HELD" {
		t.Fatalf("winner's hold state = %s, want HELD — loser refunded a bound hold", st)
	}
	if n := f.boundOrders(t, hold.ID); n != 1 {
		t.Fatalf("orders bound to hold = %d, want exactly the winner's 1", n)
	}
	// The winner's money is still parked in escrow — not refunded, not double
	// held: buyer balance = funded - hold amount.
	if got := f.balance(t, f.buyer); got != 1_000_000-50_000 {
		t.Fatalf("buyer balance = %d, want %d (held, not refunded)", got, 1_000_000-50_000)
	}
}

// TestLiveDB_Checkout_UnboundHoldStillRefunded is the other half of the
// invariant: a post-hold insert failure with NO committed winner must still
// refund — the guard must never strand the buyer's money in escrow. The
// non-unique insert failure is injected by deleting the loser's listing while
// it is parked on a blocker transaction's FOR UPDATE (a real FK-violation
// class, deterministic rather than a timing guess).
func TestLiveDB_Checkout_UnboundHoldStillRefunded(t *testing.T) {
	f := newCheckoutFixture(t)
	ctx := context.Background()
	f.fund(t, f.buyer, 1_000_000)

	l3, err := f.svc.CreateListing(ctx, f.seller, "chair", "oak chair", 40_000)
	if err != nil {
		t.Fatalf("create listing: %v", err)
	}
	key := "p2p-unbound-" + uuid.New().String()

	// Pre-mint the hold under the loser's key (the same shape the loser's own
	// escrow.Hold produces before its insert attempt).
	hold, err := f.esc.Hold(ctx, f.buyer, "p2p:"+l3.ID, moduleType, key, l3.PriceKobo)
	if err != nil {
		t.Fatalf("place hold: %v", err)
	}

	// A blocker transaction parks on the hold's FOR UPDATE lock so the loser
	// is forced to wait — the deterministic window in which the listing
	// delete is injected between the loser's GetListing and its insert.
	btx, err := f.pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin blocker tx: %v", err)
	}
	defer func() { _ = btx.Rollback(context.Background()) }()
	var st string
	if err := btx.QueryRow(ctx, `SELECT state FROM escrow_holds WHERE id=$1 FOR UPDATE`, hold.ID).Scan(&st); err != nil {
		t.Fatalf("blocker lock hold: %v", err)
	}

	errCh := make(chan error, 1)
	go func() {
		_, err := f.svc.Checkout(ctx, l3.ID, f.buyer, key)
		errCh <- err
	}()

	// Once the loser is parked at lockEscrowForBinding, delete its listing —
	// the bound insert then fails on the p2p_orders.listing_id FK, a
	// NON-unique failure that drives the guarded-refund compensation.
	waitForLockWaiter(t, ctx, f.pool, btx)
	if _, err := f.pool.Exec(ctx, `DELETE FROM p2p_listings WHERE id=$1`, l3.ID); err != nil {
		t.Fatalf("inject listing delete: %v", err)
	}
	if err := btx.Commit(ctx); err != nil {
		t.Fatalf("blocker commit: %v", err)
	}

	select {
	case err := <-errCh:
		if err == nil {
			t.Fatal("injected insert failure must surface an error")
		}
		if errors.Is(err, ErrIdemConflict) {
			t.Fatalf("no winner exists — ErrIdemConflict is wrong here: %v", err)
		}
	case <-time.After(15 * time.Second):
		t.Fatal("loser Checkout did not return — possible deadlock between binding lock and RefundIf")
	}

	if st := f.holdState(t, hold.ID); st != "REFUNDED" {
		t.Fatalf("unbound hold state = %s, want REFUNDED — compensation stranded the buyer's money", st)
	}
	if got := f.balance(t, f.buyer); got != 1_000_000 {
		t.Fatalf("buyer balance = %d, want %d — the failed checkout must be fully refunded", got, 1_000_000)
	}
	if n := f.boundOrders(t, hold.ID); n != 0 {
		t.Fatalf("orders bound to refunded hold = %d, want 0", n)
	}
}

// TestLiveDB_Checkout_AlreadyResolvedHoldRefused pins the binding-half
// refusal in the other direction: when the resolution wins the lock first
// (hold already REFUNDED), a checkout replaying the same key must NOT bind an
// order to the resolved hold, must not double-refund, and must surface an
// error rather than minting a live order over released money.
func TestLiveDB_Checkout_AlreadyResolvedHoldRefused(t *testing.T) {
	f := newCheckoutFixture(t)
	ctx := context.Background()
	f.fund(t, f.buyer, 1_000_000)

	l4, err := f.svc.CreateListing(ctx, f.seller, "shelf", "wall shelf", 30_000)
	if err != nil {
		t.Fatalf("create listing: %v", err)
	}
	key := "p2p-resolved-" + uuid.New().String()

	hold, err := f.esc.Hold(ctx, f.buyer, "p2p:"+l4.ID, moduleType, key, l4.PriceKobo)
	if err != nil {
		t.Fatalf("place hold: %v", err)
	}
	if err := f.esc.Refund(ctx, hold.ID); err != nil {
		t.Fatalf("refund hold: %v", err)
	}

	// Same-key replay: escrow.Hold returns the resolved row (idempotent
	// replay), the binding lock sees state != HELD and refuses, and the
	// guarded refund converges as an idempotent no-op — never a second credit.
	if _, err := f.svc.Checkout(ctx, l4.ID, f.buyer, key); err == nil {
		t.Fatal("checkout over an already-refunded hold must fail")
	}
	if st := f.holdState(t, hold.ID); st != "REFUNDED" {
		t.Fatalf("hold state = %s, want REFUNDED", st)
	}
	if n := f.boundOrders(t, hold.ID); n != 0 {
		t.Fatalf("orders bound to resolved hold = %d, want 0", n)
	}
	if got := f.balance(t, f.buyer); got != 1_000_000 {
		t.Fatalf("buyer balance = %d, want %d — refund must stay exactly-once", got, 1_000_000)
	}
}
