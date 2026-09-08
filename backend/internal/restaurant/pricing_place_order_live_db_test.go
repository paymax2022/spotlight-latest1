package restaurant

// ---------------------------------------------------------------------------
// LIVE-DB integration tests for the platform pricing config on the food-delivery
// money path: restaurants.surge_bp must inflate the item subtotal INSIDE the
// settlement gross (split 80/10/10 like any food revenue), and
// restaurants.service_fee_bp must be escrowed on top and paid 100% to the
// platform (settlement.Split.ServiceFeeKobo, the mirror of a rider tip) — with
// conservation intact (escrow released == provider + platform + rider legs).
//
// Regression guard: SetPricingConfig wrote both knobs but PlaceOrder never read
// them, so orders.service_fee_kobo and orders.surge_kobo were always 0 — the
// platform never collected a service fee and surge pricing did nothing.
//
// Skipped unless TEST_DATABASE_URL/DATABASE_URL is set.
// ---------------------------------------------------------------------------

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"
)

// TestLiveDB_OrderSurgeAndServiceFee: both knobs price the order, are persisted, are
// escrowed, and settle to the right party — surge shared 80/10/10, service fee 100%
// platform.
func TestLiveDB_OrderSurgeAndServiceFee(t *testing.T) {
	pool := promoOrderPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	f := newPromoOrderFixture(t, ctx, pool, "Surge Kitchen", 450_000)

	// 20% surge on the items, 5% platform service fee on the surged item price.
	if err := f.svc.SetPricingConfig(ctx, f.restID, PricingConfig{SurgeBp: 2000, ServiceFeeBp: 500}); err != nil {
		t.Fatalf("set pricing config: %v", err)
	}

	subtotal := int64(2) * 450_000       // 900_000
	wantSurge := subtotal * 2000 / 10000 // 180_000
	items := subtotal + wantSurge        // 1_080_000
	wantFee := items * 500 / 10000       // 54_000
	gross := items + DeliveryFeeKobo     // what the percentages price
	wantTotal := gross + wantFee         // escrowed: gross + the platform fee leg

	balBefore, err := f.led.GetBalance(ctx, f.customer)
	if err != nil {
		t.Fatalf("balance before: %v", err)
	}

	order, err := f.svc.PlaceOrder(ctx, f.restID, f.customer, PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: f.itemID, Quantity: 2}},
		DeliveryAddress: "Victoria Island",
		IdempotencyKey:  "surge-" + uuid.New().String(),
	})
	if err != nil {
		t.Fatalf("place surged order: %v", err)
	}

	if order.SurgeKobo != wantSurge {
		t.Errorf("returned surge_kobo = %d, want %d (surge_bp was never read at order time)", order.SurgeKobo, wantSurge)
	}
	if order.ServiceFeeKobo != wantFee {
		t.Errorf("returned service_fee_kobo = %d, want %d (service_fee_bp was never read at order time)", order.ServiceFeeKobo, wantFee)
	}
	if order.TotalKobo != wantTotal {
		t.Errorf("returned total = %d, want %d (items %d + delivery %d + fee %d)",
			order.TotalKobo, wantTotal, items, DeliveryFeeKobo, wantFee)
	}

	var dbSurge, dbFee, dbTotal int64
	if err := pool.QueryRow(ctx,
		`SELECT surge_kobo, service_fee_kobo, total_kobo FROM orders WHERE id=$1`, order.ID).
		Scan(&dbSurge, &dbFee, &dbTotal); err != nil {
		t.Fatalf("read order row: %v", err)
	}
	if dbSurge != wantSurge || dbFee != wantFee || dbTotal != wantTotal {
		t.Errorf("persisted (surge=%d, fee=%d, total=%d), want (%d, %d, %d)",
			dbSurge, dbFee, dbTotal, wantSurge, wantFee, wantTotal)
	}

	// The customer was actually charged the surged, fee-bearing total.
	var debited int64
	if err := pool.QueryRow(ctx,
		`SELECT COALESCE(SUM(amount_kobo),0) FROM ledger_entries WHERE reference=$1 AND type='DEBIT'`,
		"escrow:order:"+order.ID).Scan(&debited); err != nil {
		t.Fatalf("read escrow debit: %v", err)
	}
	if debited != wantTotal {
		t.Errorf("customer debited %d, want %d — surge and the service fee must be escrowed", debited, wantTotal)
	}
	balAfter, err := f.led.GetBalance(ctx, f.customer)
	if err != nil {
		t.Fatalf("balance after: %v", err)
	}
	if balBefore-balAfter != wantTotal {
		t.Errorf("customer paid %d, want %d", balBefore-balAfter, wantTotal)
	}

	// --- Settlement. ---
	deliverWithRider(t, ctx, f, order.ID)

	wantRider := int64(float64(gross) * splitRiderPct)
	wantPlatform := int64(float64(gross)*splitPlatformPct) + wantFee
	wantProvider := wantTotal - wantPlatform - wantRider

	gotProvider, gotPlatform, gotRider := legs(t, ctx, pool, order.ID)
	if gotPlatform != wantPlatform {
		t.Errorf("platform leg = %d, want %d (10%% of the gross %d PLUS the whole %d service fee)",
			gotPlatform, wantPlatform, gross, wantFee)
	}
	if gotRider != wantRider {
		t.Errorf("rider leg = %d, want %d — the rider takes no cut of the service fee", gotRider, wantRider)
	}
	if gotProvider != wantProvider {
		t.Errorf("provider leg = %d, want %d", gotProvider, wantProvider)
	}
	// The service fee must be pure platform money: the restaurant's share is exactly what
	// it would have been WITHOUT the fee (the fee never enters the gross).
	if noFeeProvider := gross - int64(float64(gross)*splitPlatformPct) - wantRider; gotProvider != noFeeProvider {
		t.Errorf("provider leg = %d, want %d — the service fee must not come out of the restaurant's share",
			gotProvider, noFeeProvider)
	}
	// But the restaurant DOES share in the surge: 80% of the surge lands in its leg.
	if gotProvider <= 0 {
		t.Fatalf("provider leg = %d", gotProvider)
	}
	// Conservation.
	if sum := gotProvider + gotPlatform + gotRider; sum != wantTotal {
		t.Errorf("settlement legs sum to %d, want the escrowed total %d", sum, wantTotal)
	}
	var settledProvider, settledFee int64
	var settledStatus string
	if err := pool.QueryRow(ctx,
		`SELECT status, provider_kobo, fee_kobo FROM settlements WHERE id=$1`, order.SettlementID).
		Scan(&settledStatus, &settledProvider, &settledFee); err != nil {
		t.Fatalf("read settled row: %v", err)
	}
	if settledStatus != "settled" || settledProvider != wantProvider || settledFee != wantPlatform {
		t.Errorf("settlement row = (%s, provider=%d, fee=%d), want (settled, %d, %d)",
			settledStatus, settledProvider, settledFee, wantProvider, wantPlatform)
	}

	// The merchant's earnings statement reports gross NET of the platform service fee —
	// that money was never theirs.
	stmt, err := f.svc.EarningsStatement(ctx, f.restID, f.owner, order.CreatedAt.AddDate(0, 0, -1), order.CreatedAt.AddDate(0, 0, 1))
	if err != nil {
		t.Fatalf("earnings statement: %v", err)
	}
	var line *EarningsLine
	for i := range stmt.Lines {
		if stmt.Lines[i].OrderID == order.ID {
			line = &stmt.Lines[i]
		}
	}
	if line == nil {
		t.Fatalf("order %s missing from the earnings statement", order.ID)
	}
	if want := wantTotal - wantFee; line.GrossKobo != want {
		t.Errorf("earnings gross = %d, want %d — the platform service fee must not inflate the merchant's gross",
			line.GrossKobo, want)
	}
}

// TestLiveDB_OrderReadsExposeEveryPricingComponent: the order a client reads back must
// ADD UP. GetOrder/ListOrders omitted surge_kobo, service_fee_kobo and the promo
// provenance, so total_kobo exceeded the sum of the visible parts by an unexplained gap —
// and because the idempotent replay path returns GetOrder, a retry of the same POST
// returned a materially different payload than the original.
func TestLiveDB_OrderReadsExposeEveryPricingComponent(t *testing.T) {
	pool := promoOrderPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	f := newPromoOrderFixture(t, ctx, pool, "Readback Kitchen", 450_000)

	if err := f.svc.SetPricingConfig(ctx, f.restID, PricingConfig{SurgeBp: 2000, ServiceFeeBp: 500}); err != nil {
		t.Fatalf("set pricing config: %v", err)
	}
	code := "READBACK-" + uuid.New().String()[:8]
	promoID := seedPromo(t, ctx, pool, f.restID, code, FunderRestaurant, PromoFixed, 0, 40_000, nil, nil)

	req := PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: f.itemID, Quantity: 2}},
		DeliveryAddress: "Victoria Island",
		PromoCode:       code,
		TipKobo:         30_000,
		IdempotencyKey:  "readback-" + uuid.New().String(),
	}
	placed, err := f.svc.PlaceOrder(ctx, f.restID, f.customer, req)
	if err != nil {
		t.Fatalf("place: %v", err)
	}

	// The identity every client relies on to render a receipt.
	check := func(label string, o *Order) {
		t.Helper()
		want := o.SubtotalKobo + o.SurgeKobo + o.DeliveryKobo - o.DiscountKobo + o.ServiceFeeKobo + o.TipKobo
		if o.TotalKobo != want {
			t.Errorf("%s: total_kobo %d != subtotal %d + surge %d + delivery %d − discount %d + fee %d + tip %d = %d",
				label, o.TotalKobo, o.SubtotalKobo, o.SurgeKobo, o.DeliveryKobo, o.DiscountKobo, o.ServiceFeeKobo, o.TipKobo, want)
		}
		if o.SurgeKobo == 0 || o.ServiceFeeKobo == 0 {
			t.Errorf("%s: surge=%d fee=%d, want both non-zero (the read omitted them)", label, o.SurgeKobo, o.ServiceFeeKobo)
		}
		if o.PromoID == nil || *o.PromoID != promoID {
			t.Errorf("%s: promo_id = %v, want %s", label, o.PromoID, promoID)
		}
		if o.PromoFunder == nil || *o.PromoFunder != string(FunderRestaurant) {
			t.Errorf("%s: promo_funder = %v, want restaurant", label, o.PromoFunder)
		}
	}
	check("PlaceOrder", placed)

	got, err := f.svc.GetOrder(ctx, placed.ID, f.customer)
	if err != nil {
		t.Fatalf("GetOrder: %v", err)
	}
	check("GetOrder", got)

	// The idempotent replay returns GetOrder — it must match the original payload.
	replay, err := f.svc.PlaceOrder(ctx, f.restID, f.customer, req)
	if err != nil {
		t.Fatalf("replay: %v", err)
	}
	check("replay", replay)
	if replay.SurgeKobo != placed.SurgeKobo || replay.ServiceFeeKobo != placed.ServiceFeeKobo || replay.TotalKobo != placed.TotalKobo {
		t.Errorf("replay payload differs from the original: surge %d/%d fee %d/%d total %d/%d",
			replay.SurgeKobo, placed.SurgeKobo, replay.ServiceFeeKobo, placed.ServiceFeeKobo, replay.TotalKobo, placed.TotalKobo)
	}

	// The list reads must add up too.
	for _, role := range []struct{ name, role, user string }{
		{"customer list", "customer", f.customer},
		{"restaurant list", "restaurant", f.owner},
	} {
		list, err := f.svc.ListOrders(ctx, role.user, role.role)
		if err != nil {
			t.Fatalf("%s: %v", role.name, err)
		}
		var found bool
		for i := range list {
			if list[i].ID == placed.ID {
				check(role.name, &list[i])
				found = true
			}
		}
		if !found {
			t.Errorf("%s: order %s missing", role.name, placed.ID)
		}
	}
}

// TestLiveDB_OrderCartIsSanityBounded: quantity was bounded only below, and the
// basis-point pricing multiplies before it divides — so a hostile quantity could
// overflow int64 inside applyBp and wrap the subtotal negative on the money path.
// Both bounds must reject BEFORE the escrow.
func TestLiveDB_OrderCartIsSanityBounded(t *testing.T) {
	pool := promoOrderPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	f := newPromoOrderFixture(t, ctx, pool, "Bounds Kitchen", 100_000_000) // max item price

	if err := f.svc.SetPricingConfig(ctx, f.restID, PricingConfig{SurgeBp: 50000}); err != nil { // 5x, the ceiling
		t.Fatalf("set pricing config: %v", err)
	}
	before, err := f.led.GetBalance(ctx, f.customer)
	if err != nil {
		t.Fatalf("balance before: %v", err)
	}

	// The quantity that used to overflow applyBp(subtotal, 50000). The assertion is on
	// WHICH guard fired: without the bound this call still fails (the wrapped total
	// cannot be escrowed), so a bare "did it error" check passes vacuously.
	_, err = f.svc.PlaceOrder(ctx, f.restID, f.customer, PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: f.itemID, Quantity: 2_000_000}},
		DeliveryAddress: "Victoria Island",
		IdempotencyKey:  "bigqty-" + uuid.New().String(),
	})
	if err == nil {
		t.Error("an absurd line quantity must be rejected before the escrow")
	} else if !strings.Contains(err.Error(), "per-line maximum") {
		t.Errorf("quantity rejected by the wrong guard: %v — want the explicit per-line bound, hit before any pricing arithmetic", err)
	}
	// Many in-bound lines that still add up past the aggregate ceiling.
	var manyLines []OrderItemInput
	for i := 0; i < 20; i++ {
		manyLines = append(manyLines, OrderItemInput{MenuItemID: f.itemID, Quantity: maxLineQuantity})
	}
	_, err = f.svc.PlaceOrder(ctx, f.restID, f.customer, PlaceOrderRequest{
		Items:           manyLines,
		DeliveryAddress: "Victoria Island",
		IdempotencyKey:  "bigcart-" + uuid.New().String(),
	})
	if err == nil {
		t.Error("a cart subtotal past the aggregate ceiling must be rejected before the escrow")
	} else if !strings.Contains(err.Error(), "maximum order value") {
		t.Errorf("cart rejected by the wrong guard: %v — want the explicit aggregate bound", err)
	}
	after, err := f.led.GetBalance(ctx, f.customer)
	if err != nil {
		t.Fatalf("balance after: %v", err)
	}
	if after != before {
		t.Errorf("customer balance moved by %d on rejected carts — nothing may be escrowed", before-after)
	}

	// A cart at the maximum allowed line quantity still prices correctly (no wrap):
	// every derived amount stays positive and the total is the exact identity.
	ok, err := f.svc.PlaceOrder(ctx, f.restID, f.customer, PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: f.itemID, Quantity: maxLineQuantity}},
		DeliveryAddress: "Victoria Island",
		IdempotencyKey:  "atlimit-" + uuid.New().String(),
	})
	if err != nil {
		// Expected: the customer cannot afford it. What must NOT happen is a wrap.
		if !strings.Contains(err.Error(), "escrow") && !strings.Contains(err.Error(), "balance") && !strings.Contains(err.Error(), "insufficient") {
			t.Fatalf("a max-quantity cart failed for an unexpected reason: %v", err)
		}
		return
	}
	if ok.SubtotalKobo <= 0 || ok.SurgeKobo < 0 || ok.TotalKobo <= 0 {
		t.Errorf("max-quantity cart wrapped: subtotal=%d surge=%d total=%d", ok.SubtotalKobo, ok.SurgeKobo, ok.TotalKobo)
	}
}

// TestLiveDB_OrderSurgeServiceFeeWithTipAndPromo: all four adjustments at once. This is
// the composition that can break conservation — the two fixed legs (tip → rider, service
// fee → platform) ride on top of the percentages while the discount is reconstructed
// back INTO the gross, and the escrow must still release exactly.
func TestLiveDB_OrderSurgeServiceFeeWithTipAndPromo(t *testing.T) {
	pool := promoOrderPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	f := newPromoOrderFixture(t, ctx, pool, "Everything Kitchen", 500_000)

	if err := f.svc.SetPricingConfig(ctx, f.restID, PricingConfig{SurgeBp: 1500, ServiceFeeBp: 750}); err != nil {
		t.Fatalf("set pricing config: %v", err)
	}
	code := "COMBO-" + uuid.New().String()[:8]
	seedPromo(t, ctx, pool, f.restID, code, FunderRestaurant, PromoPercent, 1000, 0, nil, nil)

	const tip int64 = 40_000
	subtotal := int64(2) * 500_000   // 1_000_000
	surge := subtotal * 1500 / 10000 // 150_000
	items := subtotal + surge        // 1_150_000
	fee := items * 750 / 10000       // 86_250
	gross := items + DeliveryFeeKobo // percentages price this
	discount := items * 1000 / 10000 // 10% of the SURGED item price
	wantTotal := gross - discount + fee + tip

	order, err := f.svc.PlaceOrder(ctx, f.restID, f.customer, PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: f.itemID, Quantity: 2}},
		DeliveryAddress: "Victoria Island",
		PromoCode:       code,
		TipKobo:         tip,
		IdempotencyKey:  "combo-" + uuid.New().String(),
	})
	if err != nil {
		t.Fatalf("place combined order: %v", err)
	}
	if order.SurgeKobo != surge || order.ServiceFeeKobo != fee || order.DiscountKobo != discount || order.TipKobo != tip {
		t.Fatalf("order (surge=%d fee=%d discount=%d tip=%d), want (%d %d %d %d)",
			order.SurgeKobo, order.ServiceFeeKobo, order.DiscountKobo, order.TipKobo, surge, fee, discount, tip)
	}
	if order.TotalKobo != wantTotal {
		t.Fatalf("total = %d, want %d (gross %d − discount %d + fee %d + tip %d)",
			order.TotalKobo, wantTotal, gross, discount, fee, tip)
	}
	var escrowed int64
	if err := pool.QueryRow(ctx, `SELECT total_kobo FROM settlements WHERE id=$1`, order.SettlementID).Scan(&escrowed); err != nil {
		t.Fatalf("read settlement: %v", err)
	}
	if escrowed != wantTotal {
		t.Fatalf("escrowed %d, want %d", escrowed, wantTotal)
	}

	deliverWithRider(t, ctx, f, order.ID)

	wantPlatform := int64(float64(gross)*splitPlatformPct) + fee // restaurant-funded promo: platform untouched by it
	wantRider := int64(float64(gross)*splitRiderPct) + tip
	wantProvider := wantTotal - wantPlatform - wantRider

	gotProvider, gotPlatform, gotRider := legs(t, ctx, pool, order.ID)
	if gotPlatform != wantPlatform {
		t.Errorf("platform leg = %d, want %d", gotPlatform, wantPlatform)
	}
	if gotRider != wantRider {
		t.Errorf("rider leg = %d, want %d (10%% of gross + the whole tip)", gotRider, wantRider)
	}
	if gotProvider != wantProvider {
		t.Errorf("provider leg = %d, want %d", gotProvider, wantProvider)
	}
	// The restaurant alone absorbed the discount, and neither the tip nor the fee touched it.
	if undiscounted := gross - int64(float64(gross)*splitPlatformPct) - int64(float64(gross)*splitRiderPct); undiscounted-gotProvider != discount {
		t.Errorf("restaurant bore %d of the discount, want exactly %d", undiscounted-gotProvider, discount)
	}
	if sum := gotProvider + gotPlatform + gotRider; sum != escrowed {
		t.Errorf("legs sum to %d, want the escrowed %d — conservation broken", sum, escrowed)
	}
	if gotProvider < 0 || gotPlatform < 0 || gotRider < 0 {
		t.Errorf("negative leg: provider=%d platform=%d rider=%d", gotProvider, gotPlatform, gotRider)
	}
}

// TestLiveDB_OrderServiceFeeRefundedOnCancel: a cancelled order returns the WHOLE
// escrow, service fee and surge included — the platform's fee is only earned on
// delivery.
func TestLiveDB_OrderServiceFeeRefundedOnCancel(t *testing.T) {
	pool := promoOrderPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	f := newPromoOrderFixture(t, ctx, pool, "Fee Refund Kitchen", 400_000)

	if err := f.svc.SetPricingConfig(ctx, f.restID, PricingConfig{SurgeBp: 1000, ServiceFeeBp: 800}); err != nil {
		t.Fatalf("set pricing config: %v", err)
	}
	before, err := f.led.GetBalance(ctx, f.customer)
	if err != nil {
		t.Fatalf("balance before: %v", err)
	}
	order, err := f.svc.PlaceOrder(ctx, f.restID, f.customer, PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: f.itemID, Quantity: 1}},
		DeliveryAddress: "Victoria Island",
		IdempotencyKey:  "feerefund-" + uuid.New().String(),
	})
	if err != nil {
		t.Fatalf("place order: %v", err)
	}
	if order.ServiceFeeKobo == 0 || order.SurgeKobo == 0 {
		t.Fatalf("expected a non-zero surge/fee, got surge=%d fee=%d", order.SurgeKobo, order.ServiceFeeKobo)
	}
	if err := f.svc.UpdateStatus(ctx, order.ID, f.customer, OrderCancelled); err != nil {
		t.Fatalf("cancel: %v", err)
	}
	after, err := f.led.GetBalance(ctx, f.customer)
	if err != nil {
		t.Fatalf("balance after: %v", err)
	}
	if after != before {
		t.Errorf("balance after cancel = %d, want %d (short by %d) — the service fee and surge must be refunded too",
			after, before, before-after)
	}
}

// TestLiveDB_OrderPricingConfigIsSnapshotAtPlacement: an ops change to the pricing knobs
// after an order is placed must NOT reprice it. The escrow is already sized; repricing
// at settlement would break conservation.
func TestLiveDB_OrderPricingConfigIsSnapshotAtPlacement(t *testing.T) {
	pool := promoOrderPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	f := newPromoOrderFixture(t, ctx, pool, "Repricing Kitchen", 400_000)

	if err := f.svc.SetPricingConfig(ctx, f.restID, PricingConfig{SurgeBp: 1000, ServiceFeeBp: 500}); err != nil {
		t.Fatalf("set pricing config: %v", err)
	}
	order, err := f.svc.PlaceOrder(ctx, f.restID, f.customer, PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: f.itemID, Quantity: 1}},
		DeliveryAddress: "Victoria Island",
		IdempotencyKey:  "reprice-" + uuid.New().String(),
	})
	if err != nil {
		t.Fatalf("place order: %v", err)
	}
	placedFee, placedTotal := order.ServiceFeeKobo, order.TotalKobo

	// Ops triples the fee AFTER placement.
	if err := f.svc.SetPricingConfig(ctx, f.restID, PricingConfig{SurgeBp: 1000, ServiceFeeBp: 1500}); err != nil {
		t.Fatalf("re-set pricing config: %v", err)
	}
	deliverWithRider(t, ctx, f, order.ID)

	gotProvider, gotPlatform, gotRider := legs(t, ctx, pool, order.ID)
	if sum := gotProvider + gotPlatform + gotRider; sum != placedTotal {
		t.Errorf("legs sum to %d, want the escrowed %d — settlement must use the fee snapshotted at placement", sum, placedTotal)
	}
	var dbFee int64
	if err := pool.QueryRow(ctx, `SELECT service_fee_kobo FROM orders WHERE id=$1`, order.ID).Scan(&dbFee); err != nil {
		t.Fatalf("read order: %v", err)
	}
	if dbFee != placedFee {
		t.Errorf("order service_fee_kobo = %d, want the placement-time %d", dbFee, placedFee)
	}
}
