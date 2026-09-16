package restaurant

// ---------------------------------------------------------------------------
// LIVE-DB integration tests for modifier pricing on the food-delivery money
// path: OrderItemInput.ModifierIDs must be VALIDATED against the item's own
// modifier groups, PRICED into the line subtotal (per-unit × quantity), carried
// into the escrow, and SNAPSHOTTED onto order_item_modifiers so the price is
// reproducible — with conservation intact at settlement.
//
// Regression guard: PlaceOrder never called resolveLineModifiers and never wrote
// the snapshot, so every chosen modifier was free. A customer could add any
// number of paid extras at zero cost (the restaurant eats it), required groups
// went unenforced, and a bogus modifier id was accepted silently.
//
// Skipped unless TEST_DATABASE_URL/DATABASE_URL is set.
// ---------------------------------------------------------------------------

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
)

// addGroup creates a modifier group with two priced options and returns the group
// plus its option ids.
func addGroup(t *testing.T, ctx context.Context, f promoOrderFixture, itemID, name string,
	required bool, minSel, maxSel int, deltas ...int64) (groupID string, optionIDs []string) {
	t.Helper()
	g, err := f.svc.CreateModifierGroup(ctx, f.restID, f.owner, itemID, CreateModifierGroupRequest{
		Name: name, Required: required, MinSelect: minSel, MaxSelect: maxSel,
	})
	if err != nil {
		t.Fatalf("create group %s: %v", name, err)
	}
	for i, d := range deltas {
		m, err := f.svc.AddModifier(ctx, f.restID, f.owner, g.ID, AddModifierRequest{
			Name:           name + "-opt" + string(rune('A'+i)),
			PriceDeltaKobo: d,
		})
		if err != nil {
			t.Fatalf("add modifier to %s: %v", name, err)
		}
		optionIDs = append(optionIDs, m.ID)
	}
	return g.ID, optionIDs
}

// TestLiveDB_OrderModifiersPricedAndSnapshotted: chosen options raise the line price
// per unit, ride into the escrow, are snapshotted, and settle with conservation.
func TestLiveDB_OrderModifiersPricedAndSnapshotted(t *testing.T) {
	pool := promoOrderPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	f := newPromoOrderFixture(t, ctx, pool, "Modifier Kitchen", 400_000)

	// "Size": pick exactly one (required, min=max=1). "Extras": pick up to 2.
	_, sizeOpts := addGroup(t, ctx, f, f.itemID, "Size", true, 1, 1, 0, 60_000)
	_, extraOpts := addGroup(t, ctx, f, f.itemID, "Extras", false, 0, 2, 25_000, 15_000)

	// Large size (60_000) + both extras (25_000 + 15_000) = 100_000 per unit.
	const perUnitDelta int64 = 60_000 + 25_000 + 15_000
	const qty = 2
	subtotal := (int64(400_000) + perUnitDelta) * qty
	gross := subtotal + DeliveryFeeKobo

	balBefore, err := f.led.GetBalance(ctx, f.customer)
	if err != nil {
		t.Fatalf("balance before: %v", err)
	}

	order, err := f.svc.PlaceOrder(ctx, f.restID, f.customer, PlaceOrderRequest{
		Items: []OrderItemInput{{
			MenuItemID:  f.itemID,
			Quantity:    qty,
			ModifierIDs: []string{sizeOpts[1], extraOpts[0], extraOpts[1]},
		}},
		DeliveryAddress: "Victoria Island",
		IdempotencyKey:  "mods-" + uuid.New().String(),
	})
	if err != nil {
		t.Fatalf("place order with modifiers: %v", err)
	}

	if order.SubtotalKobo != subtotal {
		t.Errorf("subtotal = %d, want %d — the %d/unit of modifiers was not priced",
			order.SubtotalKobo, subtotal, perUnitDelta)
	}
	if order.TotalKobo != gross {
		t.Errorf("total = %d, want %d", order.TotalKobo, gross)
	}
	if len(order.Items) != 1 {
		t.Fatalf("got %d lines, want 1", len(order.Items))
	}
	line := order.Items[0]
	if line.ModifiersKobo != perUnitDelta {
		t.Errorf("line modifiers_kobo = %d, want the PER-UNIT %d", line.ModifiersKobo, perUnitDelta)
	}
	if want := (int64(400_000) + perUnitDelta) * qty; line.SubtotalKobo != want {
		t.Errorf("line subtotal = %d, want %d — the surcharge must multiply with quantity", line.SubtotalKobo, want)
	}
	if len(line.Modifiers) != 3 {
		t.Errorf("line carries %d modifiers, want 3", len(line.Modifiers))
	}

	// --- The snapshot is in the DB, with the name + delta as of order time. ---
	rows, err := pool.Query(ctx,
		`SELECT modifier_id::text, name, price_delta_kobo FROM order_item_modifiers WHERE order_item_id=$1 ORDER BY price_delta_kobo`,
		line.ID)
	if err != nil {
		t.Fatalf("read snapshot: %v", err)
	}
	var snapTotal int64
	var snapCount int
	for rows.Next() {
		var id, name string
		var delta int64
		if err := rows.Scan(&id, &name, &delta); err != nil {
			t.Fatalf("scan snapshot: %v", err)
		}
		snapTotal += delta
		snapCount++
	}
	rows.Close()
	if snapCount != 3 {
		t.Errorf("order_item_modifiers has %d rows, want 3 — the snapshot was never written", snapCount)
	}
	if snapTotal != perUnitDelta {
		t.Errorf("snapshot deltas sum to %d, want %d", snapTotal, perUnitDelta)
	}

	// --- The customer paid for them. ---
	var debited int64
	if err := pool.QueryRow(ctx,
		`SELECT COALESCE(SUM(amount_kobo),0) FROM ledger_entries WHERE reference=$1 AND type='DEBIT'`,
		"escrow:order:"+order.ID).Scan(&debited); err != nil {
		t.Fatalf("read escrow debit: %v", err)
	}
	if debited != gross {
		t.Errorf("customer debited %d, want %d — modifiers must be escrowed", debited, gross)
	}
	balAfter, err := f.led.GetBalance(ctx, f.customer)
	if err != nil {
		t.Fatalf("balance after: %v", err)
	}
	if balBefore-balAfter != gross {
		t.Errorf("customer paid %d, want %d", balBefore-balAfter, gross)
	}

	// --- The snapshot survives a later menu edit: the price is NOT rewritten. ---
	if _, err := pool.Exec(ctx, `UPDATE menu_modifiers SET price_delta_kobo=999_000, name='Renamed' WHERE id=$1`, extraOpts[0]); err != nil {
		t.Fatalf("re-price modifier: %v", err)
	}
	reread, err := f.svc.GetOrder(ctx, order.ID, f.customer)
	if err != nil {
		t.Fatalf("re-read order: %v", err)
	}
	if reread.Items[0].ModifiersKobo != perUnitDelta {
		t.Errorf("after a menu re-price the order reads %d, want the snapshotted %d",
			reread.Items[0].ModifiersKobo, perUnitDelta)
	}
	if reread.SubtotalKobo != subtotal {
		t.Errorf("after a menu re-price the order subtotal reads %d, want %d", reread.SubtotalKobo, subtotal)
	}

	// --- Settlement: modifier money is food revenue, split 80/10/10, conservation holds.
	deliverWithRider(t, ctx, f, order.ID)
	wantPlatform := int64(float64(gross) * splitPlatformPct)
	wantRider := int64(float64(gross) * splitRiderPct)
	wantProvider := gross - wantPlatform - wantRider
	gotProvider, gotPlatform, gotRider := legs(t, ctx, pool, order.ID)
	if gotProvider != wantProvider || gotPlatform != wantPlatform || gotRider != wantRider {
		t.Errorf("legs (provider=%d platform=%d rider=%d), want (%d %d %d)",
			gotProvider, gotPlatform, gotRider, wantProvider, wantPlatform, wantRider)
	}
	if sum := gotProvider + gotPlatform + gotRider; sum != gross {
		t.Errorf("legs sum to %d, want the escrowed %d", sum, gross)
	}
}

// TestLiveDB_OrderModifierSelectionIsValidated: every fail-closed rule rejects the order
// BEFORE any money moves. Without validation a bogus id was accepted and priced at zero.
func TestLiveDB_OrderModifierSelectionIsValidated(t *testing.T) {
	pool := promoOrderPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	f := newPromoOrderFixture(t, ctx, pool, "Validation Kitchen", 400_000)

	_, sizeOpts := addGroup(t, ctx, f, f.itemID, "Size", true, 1, 1, 0, 60_000)
	_, extraOpts := addGroup(t, ctx, f, f.itemID, "Extras", false, 0, 1, 25_000)

	// A second item with NO groups — its option ids must not be usable on the first.
	other, err := f.svc.CreateItem(ctx, f.restID, f.owner, CreateItemRequest{
		CategoryID: mustCategory(t, ctx, f), Name: "Suya", PriceKobo: 200_000,
	})
	if err != nil {
		t.Fatalf("create second item: %v", err)
	}
	_, otherOpts := addGroup(t, ctx, f, other.ID, "OtherSize", false, 0, 1, 10_000)

	before, err := f.led.GetBalance(ctx, f.customer)
	if err != nil {
		t.Fatalf("balance before: %v", err)
	}

	cases := []struct {
		name        string
		modifierIDs []string
	}{
		{"unknown option id", []string{sizeOpts[0], uuid.New().String()}},
		{"option belonging to another item", []string{sizeOpts[0], otherOpts[0]}},
		{"same option twice", []string{sizeOpts[0], sizeOpts[0]}},
		{"required group left unchosen", []string{extraOpts[0]}},
		{"two picks from a max=1 group", []string{sizeOpts[0], sizeOpts[1]}},
		{"nothing chosen at all", nil},
	}
	for _, c := range cases {
		_, err := f.svc.PlaceOrder(ctx, f.restID, f.customer, PlaceOrderRequest{
			Items:           []OrderItemInput{{MenuItemID: f.itemID, Quantity: 1, ModifierIDs: c.modifierIDs}},
			DeliveryAddress: "Victoria Island",
			IdempotencyKey:  "modbad-" + uuid.New().String(),
		})
		if err == nil {
			t.Errorf("%s: must be rejected", c.name)
			continue
		}
		if !errors.Is(err, ErrInvalidModifierSelection) {
			t.Errorf("%s: err = %v, want ErrInvalidModifierSelection (so the handler answers 400, not 500)", c.name, err)
		}
	}

	// An UNAVAILABLE option is rejected too — it is not a valid choice any more.
	if _, err := pool.Exec(ctx, `UPDATE menu_modifiers SET is_available=FALSE WHERE id=$1`, extraOpts[0]); err != nil {
		t.Fatalf("86 the option: %v", err)
	}
	if _, err := f.svc.PlaceOrder(ctx, f.restID, f.customer, PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: f.itemID, Quantity: 1, ModifierIDs: []string{sizeOpts[0], extraOpts[0]}}},
		DeliveryAddress: "Victoria Island",
		IdempotencyKey:  "modoff-" + uuid.New().String(),
	}); !errors.Is(err, ErrInvalidModifierSelection) {
		t.Errorf("an 86'd option: err = %v, want ErrInvalidModifierSelection", err)
	}

	after, err := f.led.GetBalance(ctx, f.customer)
	if err != nil {
		t.Fatalf("balance after: %v", err)
	}
	if after != before {
		t.Errorf("customer balance moved by %d across rejected orders — nothing may be escrowed", before-after)
	}
}

// TestLiveDB_OrderWithoutModifiersUnchanged: an item with no modifier groups still
// prices exactly as before. This is the back-compat guard for every existing client.
func TestLiveDB_OrderWithoutModifiersUnchanged(t *testing.T) {
	pool := promoOrderPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	f := newPromoOrderFixture(t, ctx, pool, "Plain Kitchen", 350_000)

	order, err := f.svc.PlaceOrder(ctx, f.restID, f.customer, PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: f.itemID, Quantity: 3}},
		DeliveryAddress: "Victoria Island",
		IdempotencyKey:  "plain-" + uuid.New().String(),
	})
	if err != nil {
		t.Fatalf("place plain order: %v", err)
	}
	if want := int64(3) * 350_000; order.SubtotalKobo != want {
		t.Errorf("subtotal = %d, want %d", order.SubtotalKobo, want)
	}
	if order.Items[0].ModifiersKobo != 0 {
		t.Errorf("modifiers_kobo = %d, want 0 for a plain item", order.Items[0].ModifiersKobo)
	}
	var snapRows int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM order_item_modifiers WHERE order_item_id=$1`, order.Items[0].ID).Scan(&snapRows); err != nil {
		t.Fatalf("count snapshot: %v", err)
	}
	if snapRows != 0 {
		t.Errorf("plain line has %d modifier rows, want 0", snapRows)
	}
}

// mustCategory returns a category id for the fixture's restaurant.
func mustCategory(t *testing.T, ctx context.Context, f promoOrderFixture) string {
	t.Helper()
	var id string
	if err := f.pool.QueryRow(ctx, `SELECT id::text FROM menu_categories WHERE restaurant_id=$1 LIMIT 1`, f.restID).Scan(&id); err != nil {
		t.Fatalf("find category: %v", err)
	}
	return id
}
