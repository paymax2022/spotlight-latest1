package restaurant

// LIVE-DB integration tests for the MERCHANT-SIDE KYC receipt ceiling: an outlet may
// not accept an order worth more than its OWNER's verification level allows.
// The consumer gate (tierlimit_live_db_test.go) caps what a CUSTOMER may pay out of
// their wallet. Until this gate existed nothing capped what a MERCHANT may take in,
// so an unverified account could stand up a restaurant and receive unlimited card-
// funded orders into it — the money lands in the owner's wallet and is one withdrawal
// away from leaving the platform, while the account behind it has never proven who it
// belongs to. The customer gate cannot cover this: it prices the CUSTOMER, and a
// card-funded order never debits a wallet at all.
// What these tests pin:
//	 1. a Tier-0 owner is refused an order above the unverified ceiling, and NOTHING
//	    is written — no escrow leg, no settlement row, no order row, wallet untouched;
//	 2. the ceiling is a ceiling, not a ban: a small order at the same tier still
//	    reaches the kitchen;
//	 3. the boundary is exact, and it is PER ORDER — the same-sized order may be taken
//	    again immediately (no daily aggregate is implied by "cannot receive an order
//	    that is more than its KYC level");
//	 4. the quote path refuses too, which is the card rail: paystackcheckout
//	    InitiateCheckout quotes BEFORE creating a Paystack transaction, so an over-
//	    ceiling order never reaches a charge the platform would have to reverse;
//	 5. the gate prices the FULL order total (the amount that will settle to the
//	    owner), on the OWNER's id — not the customer's and not the food subtotal;
//	 6. with no tier gate wired the quote path refuses rather than pricing an ungated
//	    order (ADR-033: an unwired money gate is a misconfiguration, never a bypass).
// Skipped unless TEST_DATABASE_URL/DATABASE_URL is set.

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/tiers"
)

// seedRestOwner gives the outlet's OWNER a KYC tier and returns that owner's id.
// tierGateFixture creates the owner with no user_profiles row, so without this every
// order would fail closed on an undeterminable tier rather than on a ceiling.
func seedRestOwner(t *testing.T, ctx context.Context, pool *pgxpool.Pool, restID string, ownerTier int) string {
	t.Helper()
	var owner string
	if err := pool.QueryRow(ctx, `SELECT owner_id::text FROM restaurants WHERE id=$1`, restID).Scan(&owner); err != nil {
		t.Fatalf("read outlet owner: %v", err)
	}
	seedKYCTier(t, ctx, pool, owner, ownerTier)
	return owner
}

// orderTotalKobo is what the fixture's cart settles to: one unit at itemPrice plus the
// flat fallback delivery fee (the fixture seeds no pin, so no distance pricing).
// The service fee is 0 — restaurants.service_fee_bp is NULL and COALESCE'd to 0.
func orderTotalKobo(itemPriceKobo, qty int64, tipKobo int64) int64 {
	return itemPriceKobo*qty + DeliveryFeeKobo + tipKobo
}

// TestLiveDB_MerchantReceiptGate_Tier0OwnerRefusedAboveCeiling: an unverified owner is
// refused a large order. The CUSTOMER is Tier 3 and funded, so nothing else on the
// path can produce this refusal.
func TestLiveDB_MerchantReceiptGate_Tier0OwnerRefusedAboveCeiling(t *testing.T) {
	pool := tierPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()

	// A ₦30,000 item — over the ₦20,000 an unverified account may take in.
	svc, led, restID, item, customer := tierGateFixture(t, ctx, pool, "Tier0 Owner Kitchen", 3_000_000, 50_000_000)
	seedKYCTier(t, ctx, pool, customer, 3) // unlimited payer — isolates the merchant gate
	seedRestOwner(t, ctx, pool, restID, 0)

	before, err := led.GetBalance(ctx, customer)
	if err != nil {
		t.Fatalf("read balance: %v", err)
	}
	idem := "mrc-tier0-" + uuid.New().String()
	_, err = svc.PlaceOrder(ctx, restID, customer, PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: item.ID, Quantity: 1}},
		DeliveryAddress: "Victoria Island",
		IdempotencyKey:  idem,
	})
	if !errors.Is(err, tiers.ErrMerchantOrderLimitExceeded) {
		t.Fatalf("order above an unverified owner's ceiling err = %v, want tiers.ErrMerchantOrderLimitExceeded", err)
	}
	assertNothingWritten(t, ctx, pool, led, customer, idem, before)
}

// TestLiveDB_MerchantReceiptGate_Tier0OwnerStillTakesSmallOrders: the ceiling must not
// silently become a ban on trading while unverified — the same ₦20,000 line ADR-001
// already draws for an unverified SPENDER. Below it, the order places normally.
func TestLiveDB_MerchantReceiptGate_Tier0OwnerStillTakesSmallOrders(t *testing.T) {
	pool := tierPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()

	svc, _, restID, item, customer := tierGateFixture(t, ctx, pool, "Small Orders Kitchen", 200_000, 10_000_000)
	seedKYCTier(t, ctx, pool, customer, 3)
	seedRestOwner(t, ctx, pool, restID, 0)

	order, err := svc.PlaceOrder(ctx, restID, customer, PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: item.ID, Quantity: 1}},
		DeliveryAddress: "Victoria Island",
		IdempotencyKey:  "mrc-small-" + uuid.New().String(),
	})
	if err != nil {
		t.Fatalf("a ₦2,500 order at a Tier-0 outlet must place, got: %v", err)
	}
	if want := orderTotalKobo(200_000, 1, 0); order.TotalKobo != want {
		t.Errorf("order total = %d, want %d", order.TotalKobo, want)
	}
}

// TestLiveDB_MerchantReceiptGate_BoundaryIsExactAndPerOrder: at Tier 1 (₦50,000) an
// order of exactly the ceiling is accepted, one kobo more is refused, and the ceiling
// does not accumulate across orders. The last case is the one that would quietly turn
// a per-order rule into a daily cap: a second identical order must still be accepted.
func TestLiveDB_MerchantReceiptGate_BoundaryIsExactAndPerOrder(t *testing.T) {
	pool := tierPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()

	const ceiling = 5_000_000 // ₦50,000 — Tier 1
	// One item priced so that item + delivery lands EXACTLY on the ceiling.
	svc, led, restID, item, customer := tierGateFixture(t, ctx, pool, "Boundary Kitchen", ceiling-DeliveryFeeKobo, 200_000_000)
	seedKYCTier(t, ctx, pool, customer, 3)
	seedRestOwner(t, ctx, pool, restID, 1)

	// At the ceiling — accepted, twice.
	for i := 0; i < 2; i++ {
		if _, err := svc.PlaceOrder(ctx, restID, customer, PlaceOrderRequest{
			Items:           []OrderItemInput{{MenuItemID: item.ID, Quantity: 1}},
			DeliveryAddress: "Victoria Island",
			IdempotencyKey:  "mrc-at-" + uuid.New().String(),
		}); err != nil {
			t.Fatalf("order %d at exactly the ₦50,000 ceiling must be accepted, got: %v", i+1, err)
		}
	}

	// A kobo over — refused, with nothing written. The tip is the cheapest way to move
	// the total by exactly one kobo, and it doubles as proof the tip is INSIDE the
	// gated amount.
	before, err := led.GetBalance(ctx, customer)
	if err != nil {
		t.Fatalf("read balance: %v", err)
	}
	idem := "mrc-over-" + uuid.New().String()
	_, err = svc.PlaceOrder(ctx, restID, customer, PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: item.ID, Quantity: 1}},
		DeliveryAddress: "Victoria Island",
		TipKobo:         1,
		IdempotencyKey:  idem,
	})
	if !errors.Is(err, tiers.ErrMerchantOrderLimitExceeded) {
		t.Fatalf("an order a kobo over the ceiling must be refused, got: %v", err)
	}
	assertNothingWritten(t, ctx, pool, led, customer, idem, before)
}

// TestLiveDB_MerchantReceiptGate_QuotePathRefuses: the card rail. paystackcheckout
// InitiateCheckout calls QuoteOrder BEFORE it asks Paystack for a charge, so a refusal
// here means no customer is ever prompted to pay for an order the outlet cannot take.
// This is also the case the customer-side gate structurally cannot cover: a card-
// funded order debits no wallet, so EnforceCheckoutDebitLimit never runs on it.
func TestLiveDB_MerchantReceiptGate_QuotePathRefuses(t *testing.T) {
	pool := tierPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()

	svc, _, restID, item, customer := tierGateFixture(t, ctx, pool, "Card Rail Kitchen", 3_000_000, 10_000_000)
	seedKYCTier(t, ctx, pool, customer, 0) // a Tier-0 PAYER on a card rail is the real case
	seedRestOwner(t, ctx, pool, restID, 0)

	total, err := svc.QuoteOrder(ctx, restID, customer, PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: item.ID, Quantity: 1}},
		DeliveryAddress: "Victoria Island",
	})
	if !errors.Is(err, tiers.ErrMerchantOrderLimitExceeded) {
		t.Fatalf("quote above the owner's ceiling err = %v, want tiers.ErrMerchantOrderLimitExceeded", err)
	}
	if total != 0 {
		t.Errorf("a refused quote returned total %d, want 0 — no amount may be handed to a payment provider", total)
	}
}

// TestLiveDB_MerchantReceiptGate_UnwiredGateRefusesQuote: a Service with no TierLimiter
// must refuse to price at all rather than quote an ungated order. QuoteOrder used to
// have no gate of any kind, so this is the new half of ADR-033's coverage.
func TestLiveDB_MerchantReceiptGate_UnwiredGateRefusesQuote(t *testing.T) {
	pool := tierPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()

	svc, _, restID, item, customer := tierGateFixture(t, ctx, pool, "Unwired Quote Kitchen", 200_000, 10_000_000)
	seedKYCTier(t, ctx, pool, customer, 3)
	seedRestOwner(t, ctx, pool, restID, 3)
	svc.WithTiers(nil)

	if _, err := svc.QuoteOrder(ctx, restID, customer, PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: item.ID, Quantity: 1}},
		DeliveryAddress: "Victoria Island",
	}); !errors.Is(err, ErrTierGateUnwired) {
		t.Fatalf("quote with no tier gate wired err = %v, want ErrTierGateUnwired", err)
	}
}

// TestLiveDB_MerchantReceiptGate_GatesTheFullTotalOnTheOwner: WHAT is gated and WHO
// it is gated on. The amount must be the whole order total — the number that will
// settle into the owner's wallet, delivery, service fee and tip included — and the
// account whose tier decides is the OWNER, because the owner is the payee. Gating the
// customer's tier instead (or the food subtotal) would leave the tip and the delivery
// fee as levers around the ceiling.
func TestLiveDB_MerchantReceiptGate_GatesTheFullTotalOnTheOwner(t *testing.T) {
	pool := tierPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()

	svc, _, restID, item, customer := tierGateFixture(t, ctx, pool, "Who Is Gated Kitchen", 200_000, 10_000_000)
	seedKYCTier(t, ctx, pool, customer, 3)
	owner := seedRestOwner(t, ctx, pool, restID, 3)

	rec := &recordingLimiter{}
	svc.WithTiers(rec)

	const tip int64 = 70_000
	order, err := svc.PlaceOrder(ctx, restID, customer, PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: item.ID, Quantity: 3}},
		DeliveryAddress: "Victoria Island",
		TipKobo:         tip,
		IdempotencyKey:  "mrc-fulltotal-" + uuid.New().String(),
	})
	if err != nil {
		t.Fatalf("place order: %v", err)
	}
	if rec.merchantCalls != 1 {
		t.Fatalf("merchant receipt gate called %d times, want exactly 1 per order", rec.merchantCalls)
	}
	if rec.gotMerchantKobo != order.TotalKobo {
		t.Errorf("merchant gate authorized %d kobo but the order totals %d — it must price the settled amount",
			rec.gotMerchantKobo, order.TotalKobo)
	}
	if want := orderTotalKobo(200_000, 3, tip); rec.gotMerchantKobo != want {
		t.Errorf("merchant gate authorized %d kobo, want %d (3 items + delivery + tip)", rec.gotMerchantKobo, want)
	}
	if rec.gotMerchantUser != owner {
		t.Errorf("merchant gate checked tier of %s, want the outlet owner %s — the customer's own tier is a different gate",
			rec.gotMerchantUser, owner)
	}
}
