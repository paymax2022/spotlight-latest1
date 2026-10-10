package p2pmarket

// LIVE-DB coverage for the wave-12 crash-wedge fixes in the p2p layer (F6a-d)
// and the F2 payee-pinning contract they depend on:
//
//   - Checkout pins the seller as the hold's payee so a later DISPUTED order
//     can be arbitrated to RELEASE (F2 — previously refund-only, dead code).
//   - Checkout refuses to attach an order to a non-HELD replayed hold, and its
//     best-effort refund is gated on holdReferenced so it can never drain a
//     hold a committed order references (F6a).
//   - RaiseDispute / Arbitrate converge on retry after the escrow side commits
//     but the p2p_orders update fails (F6b/F6c).
//   - A direct escrow Release on a DISPUTED order's hold is blocked
//     (ErrDisputeRequired) — only arbitration moves contested funds (F6d).
//
// Skips unless TEST_DATABASE_URL is set (mirrors escrow's recovery suite).

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/escrow"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/testsupport"
)

type p2pFixture struct {
	pool    *pgxpool.Pool
	svc     *Service
	esc     *escrow.Service
	led     *ledger.Service
	buyer   string
	seller  string
	arbiter string
}

func newP2PFixture(t *testing.T) *p2pFixture {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping p2pmarket live-DB test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping: %v", err)
	}
	t.Cleanup(pool.Close)
	ctx := context.Background()

	led := ledger.NewService(ledger.NewRepository(pool), nil)
	esc := escrow.NewService(pool, led, nil)
	svc := NewService(pool, esc, nil)

	f := &p2pFixture{pool: pool, svc: svc, esc: esc, led: led,
		buyer: uuid.New().String(), seller: uuid.New().String(), arbiter: uuid.New().String()}
	for _, u := range []string{f.buyer, f.seller, f.arbiter} {
		if _, err := pool.Exec(ctx,
			`INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
			u, u+"@p2p.test"); err != nil {
			t.Fatalf("seed user %s: %v", u, err)
		}
	}
	testsupport.CleanupUsers(t, pool, f.buyer, f.seller, f.arbiter)
	// Checkout debits the buyer's wallet — tier-gated fail-closed.
	testsupport.SetKycTier(t, ctx, pool, f.buyer, testsupport.KycTierUnlimited)
	return f
}

func (f *p2pFixture) fund(t *testing.T, userID string, kobo int64) {
	t.Helper()
	revAcc, err := f.led.GetOrCreateStandingAccount(context.Background(), ledger.AccountPaymaxRevenue)
	if err != nil {
		t.Fatalf("resolve revenue account: %v", err)
	}
	if err := f.led.Credit(context.Background(), userID, "seed:p2p-fixtures",
		"seed-fund-"+userID, revAcc.ID, kobo); err != nil {
		t.Fatalf("fund user %s: %v", userID, err)
	}
}

func (f *p2pFixture) balance(t *testing.T, userID string) int64 {
	t.Helper()
	bal, err := f.led.GetBalance(context.Background(), userID)
	if err != nil {
		t.Fatalf("balance for %s: %v", userID, err)
	}
	return bal
}

// orderState reads the persisted p2p_orders.state (the row, not the struct).
func (f *p2pFixture) orderState(t *testing.T, orderID string) string {
	t.Helper()
	var st string
	if err := f.pool.QueryRow(context.Background(),
		`SELECT state FROM p2p_orders WHERE id=$1`, orderID).Scan(&st); err != nil {
		t.Fatalf("order state: %v", err)
	}
	return st
}

// holdState reads the persisted escrow_holds.state.
func (f *p2pFixture) holdState(t *testing.T, escrowID string) string {
	t.Helper()
	var st string
	if err := f.pool.QueryRow(context.Background(),
		`SELECT state FROM escrow_holds WHERE id=$1`, escrowID).Scan(&st); err != nil {
		t.Fatalf("hold state: %v", err)
	}
	return st
}

// checkout seeds a listing + order end-to-end through the real service.
func (f *p2pFixture) checkout(t *testing.T, priceKobo int64, idem string) *Order {
	t.Helper()
	l, err := f.svc.CreateListing(context.Background(), f.seller, "item-"+idem, "desc", priceKobo)
	if err != nil {
		t.Fatalf("create listing: %v", err)
	}
	o, err := f.svc.Checkout(context.Background(), l.ID, f.buyer, idem)
	if err != nil {
		t.Fatalf("checkout: %v", err)
	}
	return o
}

// TestLiveDB_Checkout_PinsSellerPayee verifies the F2 contract at the module
// boundary: the hold created for an order carries the SELLER as payee_id, so
// arbitration can later release contested funds to them.
func TestLiveDB_Checkout_PinsSellerPayee(t *testing.T) {
	f := newP2PFixture(t)
	ctx := context.Background()
	f.fund(t, f.buyer, 1_000_000)

	o := f.checkout(t, 300_000, "p2p-pin-"+uuid.New().String())

	var payee *string
	if err := f.pool.QueryRow(ctx,
		`SELECT payee_id FROM escrow_holds WHERE id=$1`, o.EscrowID).Scan(&payee); err != nil {
		t.Fatalf("load hold payee: %v", err)
	}
	if payee == nil || *payee != f.seller {
		t.Fatalf("hold payee_id = %v, want seller %s", payee, f.seller)
	}
	if got := f.holdState(t, o.EscrowID); got != "HELD" {
		t.Fatalf("hold state = %s, want HELD", got)
	}
	if !f.mustHoldReferenced(t, o.EscrowID) {
		t.Fatal("holdReferenced must report the committed order")
	}
}

func (f *p2pFixture) mustHoldReferenced(t *testing.T, escrowID string) bool {
	t.Helper()
	var owned bool
	if err := f.pool.QueryRow(context.Background(),
		`SELECT EXISTS(SELECT 1 FROM p2p_orders WHERE escrow_id=$1)`, escrowID).Scan(&owned); err != nil {
		t.Fatalf("hold referenced probe: %v", err)
	}
	return owned
}

// TestLiveDB_P2P_ArbitrateRelease_PaysSeller is the F2 end-to-end through the
// module: checkout → buyer disputes → arbiter rules RELEASE → the SELLER is
// credited. Before payee pinning every arbitration could only refund.
func TestLiveDB_P2P_ArbitrateRelease_PaysSeller(t *testing.T) {
	f := newP2PFixture(t)
	const price int64 = 420_000
	f.fund(t, f.buyer, 1_000_000)

	o := f.checkout(t, price, "p2p-arb-rel-"+uuid.New().String())
	if err := f.svc.RaiseDispute(context.Background(), o.ID, f.buyer, "never shipped"); err != nil {
		t.Fatalf("raise dispute: %v", err)
	}
	if err := f.svc.Arbitrate(context.Background(), o.ID, escrow.DecisionRelease, f.arbiter); err != nil {
		t.Fatalf("arbitrate release: %v", err)
	}
	if got := f.balance(t, f.seller); got != price {
		t.Fatalf("seller balance = %d, want %d — arbitration must pay the seller", got, price)
	}
	if got := f.orderState(t, o.ID); got != "CONFIRMED" {
		t.Fatalf("order state = %s, want CONFIRMED", got)
	}
	if got := f.holdState(t, o.EscrowID); got != "RELEASED" {
		t.Fatalf("hold state = %s, want RELEASED", got)
	}
}

// TestLiveDB_RaiseDispute_WedgeHealsOnRetry plants the F6b wedge: the escrow
// side committed (hold DISPUTED + dispute row) but the p2p_orders update never
// ran — order CHECKOUT over a DISPUTED hold. The retry must converge: escrow
// returns the persisted dispute and the order is marked DISPUTED.
func TestLiveDB_RaiseDispute_WedgeHealsOnRetry(t *testing.T) {
	f := newP2PFixture(t)
	f.fund(t, f.buyer, 1_000_000)

	o := f.checkout(t, 200_000, "p2p-disp-wedge-"+uuid.New().String())
	// Simulate the crash: escrow dispute commits, the order update never runs.
	if _, err := f.esc.RaiseDispute(context.Background(), o.EscrowID, f.buyer, "not as described"); err != nil {
		t.Fatalf("plant wedged escrow dispute: %v", err)
	}
	if got := f.orderState(t, o.ID); got != "CHECKOUT" {
		t.Fatalf("precondition: order still %s, want CHECKOUT", got)
	}
	if got := f.holdState(t, o.EscrowID); got != "DISPUTED" {
		t.Fatalf("precondition: hold %s, want DISPUTED", got)
	}

	if err := f.svc.RaiseDispute(context.Background(), o.ID, f.buyer, "not as described"); err != nil {
		t.Fatalf("retry must converge the wedged dispute, got %v", err)
	}
	if got := f.orderState(t, o.ID); got != "DISPUTED" {
		t.Fatalf("order state after heal = %s, want DISPUTED", got)
	}
	var n int
	if err := f.pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM escrow_disputes WHERE escrow_id=$1`, o.EscrowID).Scan(&n); err != nil {
		t.Fatalf("count disputes: %v", err)
	}
	if n != 1 {
		t.Fatalf("dispute rows = %d, want exactly 1 (no duplicate on heal)", n)
	}

	// A further replay of the now-consistent state is a no-op success.
	if err := f.svc.RaiseDispute(context.Background(), o.ID, f.buyer, "again"); err != nil {
		t.Fatalf("completed-dispute replay must be a no-op success, got %v", err)
	}
}

// TestLiveDB_Arbitrate_WedgeHealsOnRetry plants the F6c wedge: escrow.Arbitrate
// resolved the hold + dispute (RELEASE) but the order finalize never ran —
// order DISPUTED over resolved money. The retry converges to CONFIRMED.
func TestLiveDB_Arbitrate_WedgeHealsOnRetry(t *testing.T) {
	f := newP2PFixture(t)
	const price int64 = 150_000
	f.fund(t, f.buyer, 1_000_000)

	o := f.checkout(t, price, "p2p-arb-wedge-"+uuid.New().String())
	if err := f.svc.RaiseDispute(context.Background(), o.ID, f.buyer, "broken"); err != nil {
		t.Fatalf("raise dispute: %v", err)
	}
	// Simulate the crash: the escrow arbitration commits, the order update dies.
	if err := f.esc.Arbitrate(context.Background(), o.EscrowID, escrow.DecisionRelease, f.arbiter); err != nil {
		t.Fatalf("plant wedged arbitration: %v", err)
	}
	if got := f.orderState(t, o.ID); got != "DISPUTED" {
		t.Fatalf("precondition: order still %s, want DISPUTED", got)
	}
	if got := f.holdState(t, o.EscrowID); got != "RELEASED" {
		t.Fatalf("precondition: hold %s, want RELEASED", got)
	}

	if err := f.svc.Arbitrate(context.Background(), o.ID, escrow.DecisionRelease, f.arbiter); err != nil {
		t.Fatalf("retry must converge the wedged arbitration, got %v", err)
	}
	if got := f.orderState(t, o.ID); got != "CONFIRMED" {
		t.Fatalf("order state after heal = %s, want CONFIRMED", got)
	}
	if got := f.balance(t, f.seller); got != price {
		t.Fatalf("seller balance = %d, want %d (exactly-once release)", got, price)
	}

	// Fully-converged replay: same decision no-ops, contradicting fails closed.
	if err := f.svc.Arbitrate(context.Background(), o.ID, escrow.DecisionRelease, f.arbiter); err != nil {
		t.Fatalf("decision-consistent replay must no-op, got %v", err)
	}
	if err := f.svc.Arbitrate(context.Background(), o.ID, escrow.DecisionRefund, f.arbiter); err == nil {
		t.Fatal("contradicting decision on a finalized order must fail closed")
	}
}

// TestLiveDB_Checkout_RefundedHoldRetryFailsClosed covers the second half of
// F6a: after a failed checkout refunded the hold, a same-key retry used to
// attach a CHECKOUT order to terminal (refunded) money — an order "in escrow"
// with no funds held. The retry must refuse instead.
func TestLiveDB_Checkout_RefundedHoldRetryFailsClosed(t *testing.T) {
	f := newP2PFixture(t)
	ctx := context.Background()
	f.fund(t, f.buyer, 1_000_000)

	idem := "p2p-refunded-" + uuid.New().String()
	l, err := f.svc.CreateListing(ctx, f.seller, "item-refunded", "desc", 90_000)
	if err != nil {
		t.Fatalf("create listing: %v", err)
	}
	// Plant the wedge directly: hold committed under the checkout key, order
	// insert never landed, best-effort refund already drained it.
	h, err := f.esc.HoldWithPayee(ctx, f.buyer, f.seller, "p2p:"+l.ID, moduleType, idem, 90_000)
	if err != nil {
		t.Fatalf("plant hold: %v", err)
	}
	if err := f.esc.Refund(ctx, h.ID); err != nil {
		t.Fatalf("plant refund: %v", err)
	}

	if _, err := f.svc.Checkout(ctx, l.ID, f.buyer, idem); err == nil {
		t.Fatal("checkout retry over a REFUNDED hold must fail closed")
	}
	var n int
	if err := f.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM p2p_orders WHERE idempotency_key=$1`, idem).Scan(&n); err != nil {
		t.Fatalf("count orders: %v", err)
	}
	if n != 0 {
		t.Fatalf("orders rows = %d, want 0 — no order may reference refunded money", n)
	}
	// Money untouched by the refused retry: buyer still refunded in full.
	if got := f.balance(t, f.buyer); got != 1_000_000 {
		t.Fatalf("buyer balance = %d, want %d", got, 1_000_000)
	}
}

// TestLiveDB_DisputedOrder_DirectEscrowReleaseBlocked pins F6d through the
// module: a disputed order's hold cannot be drained by a direct escrow.Release
// (which would move money while dispute bookkeeping stays OPEN) — only
// arbitration resolves it, closing the dispute with the ruling.
func TestLiveDB_DisputedOrder_DirectEscrowReleaseBlocked(t *testing.T) {
	f := newP2PFixture(t)
	const price int64 = 110_000
	f.fund(t, f.buyer, 1_000_000)

	o := f.checkout(t, price, "p2p-blocked-"+uuid.New().String())
	if err := f.svc.RaiseDispute(context.Background(), o.ID, f.buyer, "fraud"); err != nil {
		t.Fatalf("raise dispute: %v", err)
	}
	if err := f.esc.Release(context.Background(), o.EscrowID, f.seller); !errors.Is(err, escrow.ErrDisputeRequired) {
		t.Fatalf("direct escrow release on a disputed hold must fail with ErrDisputeRequired, got %v", err)
	}
	if got := f.balance(t, f.seller); got != 0 {
		t.Fatalf("seller balance = %d, want 0 — contested funds must not move", got)
	}
	// Arbitration is the only way out.
	if err := f.svc.Arbitrate(context.Background(), o.ID, escrow.DecisionRelease, f.arbiter); err != nil {
		t.Fatalf("arbitrate release: %v", err)
	}
	if got := f.balance(t, f.seller); got != price {
		t.Fatalf("seller balance = %d, want %d", got, price)
	}
}

// TestLiveDB_ConfirmReceipt_StillWorks guards the happy path: the pinned
// payee equals o.SellerID, so the buyer's confirm releases to the seller with
// no payee mismatch.
func TestLiveDB_ConfirmReceipt_StillWorks(t *testing.T) {
	f := newP2PFixture(t)
	const price int64 = 75_000
	f.fund(t, f.buyer, 1_000_000)

	o := f.checkout(t, price, "p2p-confirm-"+uuid.New().String())
	if err := f.svc.ConfirmReceipt(context.Background(), o.ID, f.buyer); err != nil {
		t.Fatalf("confirm receipt: %v", err)
	}
	if got := f.balance(t, f.seller); got != price {
		t.Fatalf("seller balance = %d, want %d", got, price)
	}
	if got := f.orderState(t, o.ID); got != "CONFIRMED" {
		t.Fatalf("order state = %s, want CONFIRMED", got)
	}
}
