package restaurant

// LIVE-DB tests for FOOD-UAT-C-012 (delivery pin persisted, rider-only exposure),
// C-008 (notes surfaced on kitchen + rider views) and D-007 (order_type foundation:
// pickup_now / pickup_scheduled / dine_in). Skipped unless TEST_DATABASE_URL is set.

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
)

func ptrF(f float64) *float64 { return &f }

func TestLiveDB_DeliveryCoordsPersistedAndRiderOnly(t *testing.T) {
	pool := promoOrderPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	f := newPromoOrderFixture(t, ctx, pool, "Coords Kitchen", 400_000)

	order, err := f.svc.PlaceOrder(ctx, f.restID, f.customer, PlaceOrderRequest{
		Items:                  []OrderItemInput{{MenuItemID: f.itemID, Quantity: 1}},
		DeliveryAddress:        "12 Admiralty Way",
		DeliveryLat:            ptrF(6.4281),
		DeliveryLng:            ptrF(3.4219),
		DeliveryLandmark:       "Blue gate, opposite the pharmacy",
		DeliveryRecipientPhone: "+234 803 000 1111 (mum)",
		SpecialInstructions:    "No onions",
		IdempotencyKey:         "coords-" + uuid.New().String(),
	})
	if err != nil {
		t.Fatalf("place: %v", err)
	}
	if order.OrderType != OrderTypeDelivery {
		t.Errorf("order_type = %q, want delivery", order.OrderType)
	}
	var lat, lng *float64
	var lm, ph *string
	if err := pool.QueryRow(ctx, `SELECT delivery_latitude::float8, delivery_longitude::float8, delivery_landmark, delivery_recipient_phone FROM orders WHERE id=$1`, order.ID).
		Scan(&lat, &lng, &lm, &ph); err != nil {
		t.Fatal(err)
	}
	if lat == nil || lng == nil || *lat != 6.4281 || *lng != 3.4219 {
		t.Errorf("coords not persisted: %v %v", lat, lng)
	}
	if lm == nil || ph == nil || *ph != "+2348030001111" {
		t.Errorf("landmark/phone not persisted/cleaned: %v %v", lm, ph)
	}

	// Customer view: no PII coordinates, but the note is there.
	cv, err := f.svc.GetOrder(ctx, order.ID, f.customer)
	if err != nil {
		t.Fatal(err)
	}
	if cv.DeliveryLatitude != nil || cv.DeliveryRecipientPhone != nil || cv.DeliveryLandmark != nil {
		t.Error("customer view leaked delivery coordinates / recipient phone")
	}
	// Kitchen view: note surfaced, no coordinates.
	kv, _ := f.svc.GetOrder(ctx, order.ID, f.owner)
	if kv.SpecialInstructions != "No onions" || kv.DeliveryLatitude != nil {
		t.Errorf("kitchen view: note=%q lat=%v", kv.SpecialInstructions, kv.DeliveryLatitude)
	}
	// Assigned rider: pin + contact + note.
	if _, err := pool.Exec(ctx, `UPDATE orders SET rider_id=$2 WHERE id=$1`, order.ID, f.rider); err != nil {
		t.Fatal(err)
	}
	rv, err := f.svc.GetOrder(ctx, order.ID, f.rider)
	if err != nil {
		t.Fatal(err)
	}
	if rv.DeliveryLatitude == nil || *rv.DeliveryLatitude != 6.4281 || rv.DeliveryRecipientPhone == nil ||
		rv.DeliveryLandmark == nil || rv.SpecialInstructions != "No onions" {
		t.Errorf("rider view incomplete: %+v", rv)
	}
	// Kitchen list also carries the note.
	list, err := f.svc.ListOrders(ctx, f.owner, "restaurant")
	if err != nil || len(list) == 0 || list[0].SpecialInstructions != "No onions" {
		t.Errorf("restaurant list note: err=%v list=%+v", err, list)
	}
}

func TestLiveDB_PickupNow_NoDispatch_SettlesWithoutRider(t *testing.T) {
	pool := promoOrderPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	f := newPromoOrderFixture(t, ctx, pool, "Pickup Kitchen", 400_000)

	order, err := f.svc.PlaceOrder(ctx, f.restID, f.customer, PlaceOrderRequest{
		OrderType:      "pickup_now",
		Items:          []OrderItemInput{{MenuItemID: f.itemID, Quantity: 1}},
		TipKobo:        50_000, // must be ignored: no rider to receive it
		IdempotencyKey: "pickup-" + uuid.New().String(),
	})
	if err != nil {
		t.Fatalf("place pickup_now without address: %v", err)
	}
	if order.DeliveryKobo != 0 || order.TipKobo != 0 || order.TotalKobo != 400_000 {
		t.Errorf("pickup pricing: delivery=%d tip=%d total=%d", order.DeliveryKobo, order.TipKobo, order.TotalKobo)
	}
	for _, step := range []OrderStatus{OrderConfirmed, OrderPreparing, OrderReady} {
		if err := f.svc.UpdateStatus(ctx, order.ID, f.owner, step); err != nil {
			t.Fatalf("-> %s: %v", step, err)
		}
	}
	var code *string
	var dispatch *string
	if err := pool.QueryRow(ctx, `SELECT pickup_code, dispatch_status FROM orders WHERE id=$1`, order.ID).Scan(&code, &dispatch); err != nil {
		t.Fatal(err)
	}
	if code == nil || *code == "" {
		t.Error("pickup code not issued at ready")
	}
	if dispatch != nil && *dispatch != "none" {
		t.Errorf("dispatch_status = %q, want none (no dispatch for pickup)", *dispatch)
	}
	var offers int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM restaurant_delivery_offers WHERE order_id=$1`, order.ID).Scan(&offers)
	if offers != 0 {
		t.Errorf("%d dispatch offers created for a pickup order", offers)
	}
	// Customer cannot self-collect; delivered is never legal.
	if err := f.svc.UpdateStatus(ctx, order.ID, f.customer, OrderPickedUp); !errors.Is(err, ErrForbidden) {
		t.Errorf("customer picked_up err = %v, want ErrForbidden", err)
	}
	if err := f.svc.UpdateStatus(ctx, order.ID, f.owner, OrderPickedUp); err != nil {
		t.Fatalf("collect: %v", err)
	}
	prov, plat, rider := legs(t, ctx, pool, order.ID)
	if prov <= 0 || plat <= 0 || rider != 0 {
		t.Errorf("settlement legs provider=%d platform=%d rider=%d, want merchant+platform only", prov, plat, rider)
	}
	if prov+plat != 400_000 {
		t.Errorf("legs sum %d, want the full 400000 escrow released", prov+plat)
	}
	// Terminal: no further moves.
	if err := f.svc.UpdateStatus(ctx, order.ID, f.owner, OrderClosed); err == nil {
		t.Error("picked_up -> closed must be illegal for pickup")
	}
}

func TestLiveDB_PickupScheduled_Window(t *testing.T) {
	pool := promoOrderPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	f := newPromoOrderFixture(t, ctx, pool, "PickupSched Kitchen", 400_000)
	place := func(at *time.Time) (*Order, error) {
		return f.svc.PlaceOrder(ctx, f.restID, f.customer, PlaceOrderRequest{
			OrderType: "pickup_scheduled", ScheduledFor: at,
			Items:          []OrderItemInput{{MenuItemID: f.itemID, Quantity: 1}},
			IdempotencyKey: "ps-" + uuid.New().String(),
		})
	}
	ok := time.Now().Add(time.Hour)
	o, err := place(&ok)
	if err != nil {
		t.Fatalf("1h ahead: %v", err)
	}
	if o.OrderType != OrderTypePickupScheduled || o.ScheduledFor == nil || o.DeliveryKobo != 0 {
		t.Errorf("unexpected order: %+v", o)
	}
	past := time.Now().Add(-time.Hour)
	if _, err := place(&past); !errors.Is(err, ErrScheduledSlotInvalid) {
		t.Errorf("past slot err = %v", err)
	}
	far := time.Now().Add(26 * time.Hour)
	if _, err := place(&far); !errors.Is(err, ErrScheduledSlotInvalid) {
		t.Errorf("26h slot err = %v", err)
	}
	if _, err := place(nil); !errors.Is(err, ErrScheduledSlotInvalid) {
		t.Errorf("missing slot err = %v", err)
	}
	if code, isErr := escrowErrStatus(ErrScheduledSlotInvalid); !isErr || code != 400 {
		t.Errorf("slot error maps to %d", code)
	}
}

func TestLiveDB_DineIn_TableRequired_ServedSettles(t *testing.T) {
	pool := promoOrderPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	f := newPromoOrderFixture(t, ctx, pool, "DineIn Kitchen", 400_000)
	req := PlaceOrderRequest{
		OrderType: "dine_in",
		Items:     []OrderItemInput{{MenuItemID: f.itemID, Quantity: 1}},
	}
	req.IdempotencyKey = "di-" + uuid.New().String()
	if _, err := f.svc.PlaceOrder(ctx, f.restID, f.customer, req); !errors.Is(err, ErrOrderInvalid) {
		t.Fatalf("dine_in without table err = %v, want ErrOrderInvalid", err)
	}
	req.TableNumber = "T-14"
	req.IdempotencyKey = "di-" + uuid.New().String()
	o, err := f.svc.PlaceOrder(ctx, f.restID, f.customer, req)
	if err != nil {
		t.Fatalf("dine_in with table: %v", err)
	}
	if o.TableNumber == nil || *o.TableNumber != "T-14" {
		t.Errorf("table = %v", o.TableNumber)
	}
	// Dine-in skips `ready`.
	if err := f.svc.UpdateStatus(ctx, o.ID, f.owner, OrderConfirmed); err != nil {
		t.Fatal(err)
	}
	if err := f.svc.UpdateStatus(ctx, o.ID, f.owner, OrderPreparing); err != nil {
		t.Fatal(err)
	}
	if err := f.svc.UpdateStatus(ctx, o.ID, f.owner, OrderReady); err == nil {
		t.Error("dine_in must not enter ready")
	}
	if err := f.svc.UpdateStatus(ctx, o.ID, f.owner, OrderServed); err != nil {
		t.Fatalf("served: %v", err)
	}
	prov, plat, rider := legs(t, ctx, pool, o.ID)
	if prov <= 0 || plat <= 0 || rider != 0 {
		t.Errorf("legs provider=%d platform=%d rider=%d", prov, plat, rider)
	}
	if err := f.svc.UpdateStatus(ctx, o.ID, f.owner, OrderClosed); err != nil {
		t.Fatalf("closed: %v", err)
	}
	if err := f.svc.CancelOrder(ctx, o.ID, f.owner); err == nil {
		t.Error("closed order must not be cancellable")
	}
}

func TestOrderTypeFSMAndValidation(t *testing.T) {
	if !canTransitionFor(OrderTypeDelivery, OrderReady, OrderPickedUp) || !canTransitionFor("", OrderPickedUp, OrderDelivered) {
		t.Error("delivery FSM changed")
	}
	if canTransitionFor(OrderTypePickupNow, OrderPickedUp, OrderDelivered) || canTransitionFor(OrderTypePickupNow, OrderPreparing, OrderServed) {
		t.Error("pickup FSM too permissive")
	}
	if !canTransitionFor(OrderTypeDineIn, OrderServed, OrderClosed) || canTransitionFor(OrderTypeDineIn, OrderPreparing, OrderReady) {
		t.Error("dine-in FSM wrong")
	}
	if _, err := validateOrderType(PlaceOrderRequest{OrderType: "teleport"}, time.Now()); !errors.Is(err, ErrOrderInvalid) {
		t.Errorf("unknown type err = %v", err)
	}
	if ot, err := validateOrderType(PlaceOrderRequest{}, time.Now()); err != nil || ot != OrderTypeDelivery {
		t.Errorf("empty type = %q, %v", ot, err)
	}
}
