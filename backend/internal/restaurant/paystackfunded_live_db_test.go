package restaurant

// ---------------------------------------------------------------------------
// LIVE-DB integration tests for PlaceOrderPaystackFunded / QuoteOrder
// (backend/internal/restaurant/service.go), the externally-funded checkout
// path built for the "pay with Paystack, no KYC needed" feature. Package
// restaurant (not restaurant_test) to reuse tierlimit_live_db_test.go's
// fixtures (tierPool, tierGateFixture, seedKYCTier, escrowLegs, escrowLegsPosted,
// assertNothingWritten).
//
// What these tests pin:
//
//  1. A Tier-0 (wallet-disabled) customer — refused outright by the WALLET path
//     (ErrWalletDisabled) — can place an order through the Paystack-funded path.
//     The tier gate is not merely lenient here, it never runs at all: a customer
//     with NO kyc_tier profile row succeeds too (TestLiveDB_PlaceOrderPaystackFunded_NoProfileNeeded).
//  2. The customer's wallet balance is UNCHANGED by an externally-funded order —
//     the money that gets escrowed never came from their wallet, so nothing there
//     should move, in either direction.
//  3. QuoteOrder's number is exactly what PlaceOrderPaystackFunded will accept —
//     the two must never drift (they share priceOrder).
//  4. A caller that passes anything other than the exact recomputed total is
//     refused BEFORE any escrow or order row is written (ErrExternalAmountMismatch)
//     — proven both above and below the true total, so this cannot be papered
//     over by only testing underpayment.
//  5. The ORIGINAL wallet-funded PlaceOrder path is completely unaffected by this
//     feature's existence: the same Tier-0 customer, same cart, still refused by
//     PlaceOrder exactly as before.
// ---------------------------------------------------------------------------

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	"spotlight/backend/internal/finance/tiers"
)

// TestLiveDB_PlaceOrderPaystackFunded_SkipsTierGate: a Tier-0 (wallet-disabled)
// customer is refused by the wallet-funded path, but the Paystack-funded path
// places the same order — because no wallet debit occurs, there is nothing for
// the tier gate to price. The wallet balance must not move either way.
func TestLiveDB_PlaceOrderPaystackFunded_SkipsTierGate(t *testing.T) {
	pool := tierPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()

	svc, led, restID, item, customer := tierGateFixture(t, ctx, pool, "Paystack Tier0 Kitchen", 200_000, 10_000_000)
	seedKYCTier(t, ctx, pool, customer, 0) // wallet disabled

	before, err := led.GetBalance(ctx, customer)
	if err != nil {
		t.Fatalf("read balance: %v", err)
	}

	req := PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: item.ID, Quantity: 1}},
		DeliveryAddress: "Victoria Island",
		IdempotencyKey:  "pfk-tier0-" + uuid.New().String(),
	}

	// Sanity: the WALLET path is still refused for this customer, exactly as
	// before this feature existed.
	if _, err := svc.PlaceOrder(ctx, restID, customer, req); !errors.Is(err, tiers.ErrWalletDisabled) {
		t.Fatalf("wallet-funded PlaceOrder err = %v, want tiers.ErrWalletDisabled (this feature must not relax it)", err)
	}

	quoted, err := svc.QuoteOrder(ctx, restID, customer, req)
	if err != nil {
		t.Fatalf("QuoteOrder: %v", err)
	}

	order, err := svc.PlaceOrderPaystackFunded(ctx, restID, customer, req, quoted)
	if err != nil {
		t.Fatalf("PlaceOrderPaystackFunded must succeed for a Tier-0 customer, got: %v", err)
	}
	if order.TotalKobo != quoted {
		t.Errorf("order total = %d, want the quoted amount %d", order.TotalKobo, quoted)
	}

	// The escrow posted (2 balanced ledger legs: DR provider-clearing, CR escrow)
	// but NEITHER leg is the customer's wallet — so their balance is unchanged.
	if n := escrowLegs(t, ctx, pool, req.IdempotencyKey); n != escrowLegsPosted {
		t.Errorf("escrow ledger legs = %d, want %d (EscrowExternal must still post a balanced pair)", n, escrowLegsPosted)
	}
	after, err := led.GetBalance(ctx, customer)
	if err != nil {
		t.Fatalf("read balance: %v", err)
	}
	if after != before {
		t.Errorf("customer wallet balance moved on an externally-funded order: %d -> %d", before, after)
	}
}

// TestLiveDB_PlaceOrderPaystackFunded_NoProfileNeeded: a customer with NO
// user_profiles row at all — the strongest case the wallet path refuses
// (ErrTierGateUnwired-adjacent fail-closed behaviour tested elsewhere) —
// still succeeds via the Paystack-funded path. This proves the tier gate is
// skipped entirely, not merely satisfied by some default.
func TestLiveDB_PlaceOrderPaystackFunded_NoProfileNeeded(t *testing.T) {
	pool := tierPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()

	svc, _, restID, item, customer := tierGateFixture(t, ctx, pool, "Paystack No Profile Kitchen", 200_000, 10_000_000)
	// Deliberately no seedKYCTier call.

	req := PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: item.ID, Quantity: 1}},
		DeliveryAddress: "Victoria Island",
		IdempotencyKey:  "pfk-noprofile-" + uuid.New().String(),
	}
	quoted, err := svc.QuoteOrder(ctx, restID, customer, req)
	if err != nil {
		t.Fatalf("QuoteOrder: %v", err)
	}
	if _, err := svc.PlaceOrderPaystackFunded(ctx, restID, customer, req, quoted); err != nil {
		t.Fatalf("PlaceOrderPaystackFunded must succeed with no tier profile at all, got: %v", err)
	}
}

// TestLiveDB_PlaceOrderPaystackFunded_AmountMismatchRejects: a caller that
// supplies anything other than the exact recomputed total is refused before
// any escrow or order row is written — tested both above and below the true
// total, so an "only checks underpayment" bug would be caught.
func TestLiveDB_PlaceOrderPaystackFunded_AmountMismatchRejects(t *testing.T) {
	pool := tierPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()

	svc, led, restID, item, customer := tierGateFixture(t, ctx, pool, "Paystack Mismatch Kitchen", 200_000, 10_000_000)
	seedKYCTier(t, ctx, pool, customer, 0)

	req := PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: item.ID, Quantity: 1}},
		DeliveryAddress: "Victoria Island",
		IdempotencyKey:  "pfk-mismatch-under-" + uuid.New().String(),
	}
	quoted, err := svc.QuoteOrder(ctx, restID, customer, req)
	if err != nil {
		t.Fatalf("QuoteOrder: %v", err)
	}

	before, err := led.GetBalance(ctx, customer)
	if err != nil {
		t.Fatalf("read balance: %v", err)
	}

	// Underpaid by 1 kobo.
	if _, err := svc.PlaceOrderPaystackFunded(ctx, restID, customer, req, quoted-1); !errors.Is(err, ErrExternalAmountMismatch) {
		t.Fatalf("underpaid amount err = %v, want ErrExternalAmountMismatch", err)
	}
	assertNothingWritten(t, ctx, pool, led, customer, req.IdempotencyKey, before)

	// Overpaid by 1 kobo — a different bug (only bounding one side) must not
	// let this slip through either.
	req2 := req
	req2.IdempotencyKey = "pfk-mismatch-over-" + uuid.New().String()
	if _, err := svc.PlaceOrderPaystackFunded(ctx, restID, customer, req2, quoted+1); !errors.Is(err, ErrExternalAmountMismatch) {
		t.Fatalf("overpaid amount err = %v, want ErrExternalAmountMismatch", err)
	}
	assertNothingWritten(t, ctx, pool, led, customer, req2.IdempotencyKey, before)
}

// TestLiveDB_QuoteOrder_MatchesPlaceOrderPaystackFundedTotal: QuoteOrder and
// PlaceOrderPaystackFunded must never drift apart — they share priceOrder, and
// this test is the one that would fail if a future change updated one without
// the other.
func TestLiveDB_QuoteOrder_MatchesPlaceOrderPaystackFundedTotal(t *testing.T) {
	pool := tierPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()

	svc, _, restID, item, customer := tierGateFixture(t, ctx, pool, "Paystack Quote Match Kitchen", 350_000, 10_000_000)
	seedKYCTier(t, ctx, pool, customer, 3)

	req := PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: item.ID, Quantity: 2}},
		DeliveryAddress: "Victoria Island",
		TipKobo:         25_000,
		IdempotencyKey:  "pfk-quotematch-" + uuid.New().String(),
	}
	quoted, err := svc.QuoteOrder(ctx, restID, customer, req)
	if err != nil {
		t.Fatalf("QuoteOrder: %v", err)
	}
	order, err := svc.PlaceOrderPaystackFunded(ctx, restID, customer, req, quoted)
	if err != nil {
		t.Fatalf("PlaceOrderPaystackFunded: %v", err)
	}
	if order.TotalKobo != quoted {
		t.Errorf("placed order total = %d, quoted = %d — QuoteOrder and PlaceOrderPaystackFunded drifted", order.TotalKobo, quoted)
	}
}

// fakeExternalRefunder records calls instead of touching Paystack/ledger —
// see transport's identical fixture for the sibling test this mirrors.
type fakeExternalRefunder struct {
	calls []struct{ orderID, settlementID, reason string }
}

func (f *fakeExternalRefunder) RefundExternalSettlement(_ context.Context, orderID, settlementID, reason string) error {
	f.calls = append(f.calls, struct{ orderID, settlementID, reason string }{orderID, settlementID, reason})
	return nil
}

// TestLiveDB_CancelOrder_PaystackFundedUsesExternalRefunder is the restaurant
// counterpart of transport's identically-named test: cancelling a
// Paystack-funded order is a NORMAL, frequent action, so a wrong refund
// mechanism here would affect every such cancellation, not a rare crash
// window. This is the exact defect settlement.ErrWrongRefundMethod exists to
// catch — found while porting this feature to ride-hailing and retrofitted
// back here.
func TestLiveDB_CancelOrder_PaystackFundedUsesExternalRefunder(t *testing.T) {
	pool := tierPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()

	svc, led, restID, item, customer := tierGateFixture(t, ctx, pool, "Paystack Cancel Kitchen", 200_000, 10_000_000)
	seedKYCTier(t, ctx, pool, customer, 0)
	fake := &fakeExternalRefunder{}
	svc.SetExternalRefunder(fake)

	req := PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: item.ID, Quantity: 1}},
		DeliveryAddress: "Victoria Island",
		IdempotencyKey:  "pfk-cancel-" + uuid.New().String(),
	}
	quoted, err := svc.QuoteOrder(ctx, restID, customer, req)
	if err != nil {
		t.Fatalf("QuoteOrder: %v", err)
	}
	order, err := svc.PlaceOrderPaystackFunded(ctx, restID, customer, req, quoted)
	if err != nil {
		t.Fatalf("PlaceOrderPaystackFunded: %v", err)
	}

	before, err := led.GetBalance(ctx, customer)
	if err != nil {
		t.Fatalf("read balance: %v", err)
	}

	if err := svc.CancelOrder(ctx, order.ID, customer); err != nil {
		t.Fatalf("CancelOrder: %v", err)
	}

	after, err := led.GetBalance(ctx, customer)
	if err != nil {
		t.Fatalf("read balance: %v", err)
	}
	if after != before {
		t.Errorf("customer wallet balance moved on cancelling a Paystack-funded order: %d -> %d (settlement.Refund must never run for this order)", before, after)
	}
	if len(fake.calls) != 1 {
		t.Fatalf("ExternalRefunder called %d times, want exactly 1", len(fake.calls))
	}
	if fake.calls[0].orderID != order.ID {
		t.Errorf("refunder called with orderID=%s, want %s", fake.calls[0].orderID, order.ID)
	}
}

// TestLiveDB_CancelOrder_PaystackFundedNoRefunderWiredFailsClosed proves the
// fail-CLOSED default: with no ExternalRefunder wired (e.g. the feature flag
// off), cancelling a Paystack-funded order must NOT fall back to
// settlement.Refund — it must move no money and leave the order un-cancelled
// (an honest error) rather than silently wallet-crediting the customer.
func TestLiveDB_CancelOrder_PaystackFundedNoRefunderWiredFailsClosed(t *testing.T) {
	pool := tierPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()

	svc, led, restID, item, customer := tierGateFixture(t, ctx, pool, "Paystack No Refunder Kitchen", 200_000, 10_000_000)
	seedKYCTier(t, ctx, pool, customer, 0)
	// Deliberately no SetExternalRefunder call.

	req := PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: item.ID, Quantity: 1}},
		DeliveryAddress: "Victoria Island",
		IdempotencyKey:  "pfk-norefunder-" + uuid.New().String(),
	}
	quoted, err := svc.QuoteOrder(ctx, restID, customer, req)
	if err != nil {
		t.Fatalf("QuoteOrder: %v", err)
	}
	order, err := svc.PlaceOrderPaystackFunded(ctx, restID, customer, req, quoted)
	if err != nil {
		t.Fatalf("PlaceOrderPaystackFunded: %v", err)
	}

	before, err := led.GetBalance(ctx, customer)
	if err != nil {
		t.Fatalf("read balance: %v", err)
	}

	if err := svc.CancelOrder(ctx, order.ID, customer); err == nil {
		t.Fatal("cancelling a Paystack-funded order with no ExternalRefunder wired must fail, not silently succeed")
	}

	after, err := led.GetBalance(ctx, customer)
	if err != nil {
		t.Fatalf("read balance: %v", err)
	}
	if after != before {
		t.Errorf("customer wallet balance moved with no ExternalRefunder wired: %d -> %d (must fail closed, never wallet-credit)", before, after)
	}

	var status string
	if err := pool.QueryRow(ctx, `SELECT status FROM orders WHERE id=$1`, order.ID).Scan(&status); err != nil {
		t.Fatalf("read order status: %v", err)
	}
	if status == string(OrderCancelled) {
		t.Error("order was marked cancelled despite the refund failing — it must stay un-cancelled until the money actually moves")
	}
}
