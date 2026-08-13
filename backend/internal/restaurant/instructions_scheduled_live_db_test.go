package restaurant

// ---------------------------------------------------------------------------
// LIVE-DB integration tests for the two non-money fields PlaceOrder was dropping:
//
//   special_instructions — sanitized (CT-009) and persisted, so the note actually
//                          reaches the kitchen and the rider.
//   scheduled_for        — validated against the restaurant's weekly hours
//                          (SG-001/002) and persisted, so ActivateScheduledOrders
//                          (the sweeper) can fire for an order placed via the API.
//
// Regression guard: sanitizeInstructions and validateScheduledFor both existed,
// unit-tested and never called. orders.special_instructions and
// orders.scheduled_for were never written, so notes vanished and every scheduled
// order silently became an immediate one — the sweeper had nothing to sweep.
//
// Skipped unless TEST_DATABASE_URL/DATABASE_URL is set.
// ---------------------------------------------------------------------------

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

// TestLiveDB_OrderSpecialInstructionsSanitizedAndPersisted: the note is stored, with
// control characters stripped and whitespace collapsed; an empty note stays NULL.
func TestLiveDB_OrderSpecialInstructionsSanitizedAndPersisted(t *testing.T) {
	pool := promoOrderPool(t)
	defer pool.Close()
	ctx := context.Background()
	f := newPromoOrderFixture(t, ctx, pool, "Notes Kitchen", 400_000)

	raw := "  Extra\x00 spicy,\tplease\n\nring   the\x07 bell  "
	want := sanitizeInstructions(raw)
	if want == "" || strings.ContainsRune(want, '\x00') {
		t.Fatalf("sanitize produced %q", want)
	}

	order, err := f.svc.PlaceOrder(ctx, f.restID, f.customer, PlaceOrderRequest{
		Items:               []OrderItemInput{{MenuItemID: f.itemID, Quantity: 1}},
		DeliveryAddress:     "Victoria Island",
		SpecialInstructions: raw,
		IdempotencyKey:      "note-" + uuid.New().String(),
	})
	if err != nil {
		t.Fatalf("place order with a note: %v", err)
	}
	if order.SpecialInstructions != want {
		t.Errorf("returned instructions = %q, want the sanitized %q", order.SpecialInstructions, want)
	}
	var stored *string
	if err := pool.QueryRow(ctx, `SELECT special_instructions FROM orders WHERE id=$1`, order.ID).Scan(&stored); err != nil {
		t.Fatalf("read order: %v", err)
	}
	if stored == nil {
		t.Fatal("special_instructions is NULL — the note was dropped from the INSERT")
	}
	if *stored != want {
		t.Errorf("persisted %q, want %q", *stored, want)
	}
	// Raw control bytes must never reach the DB (the kitchen screen renders this).
	for _, r := range *stored {
		if r < 0x20 {
			t.Errorf("persisted note contains control byte %q", r)
		}
	}
	// And it comes back on the read path, for the kitchen and the rider.
	reread, err := f.svc.GetOrder(ctx, order.ID, f.customer)
	if err != nil {
		t.Fatalf("re-read: %v", err)
	}
	if reread.SpecialInstructions != want {
		t.Errorf("GetOrder returned %q, want %q", reread.SpecialInstructions, want)
	}

	// An over-long note is capped rather than rejected.
	long := strings.Repeat("a", maxInstructionsLen+250)
	capped, err := f.svc.PlaceOrder(ctx, f.restID, f.customer, PlaceOrderRequest{
		Items:               []OrderItemInput{{MenuItemID: f.itemID, Quantity: 1}},
		DeliveryAddress:     "Victoria Island",
		SpecialInstructions: long,
		IdempotencyKey:      "notelong-" + uuid.New().String(),
	})
	if err != nil {
		t.Fatalf("place order with a long note: %v", err)
	}
	if len(capped.SpecialInstructions) != maxInstructionsLen {
		t.Errorf("long note stored at %d chars, want it capped to %d", len(capped.SpecialInstructions), maxInstructionsLen)
	}

	// No note ⇒ NULL, not an empty string.
	plain, err := f.svc.PlaceOrder(ctx, f.restID, f.customer, PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: f.itemID, Quantity: 1}},
		DeliveryAddress: "Victoria Island",
		IdempotencyKey:  "nonote-" + uuid.New().String(),
	})
	if err != nil {
		t.Fatalf("place order without a note: %v", err)
	}
	var nullNote *string
	if err := pool.QueryRow(ctx, `SELECT special_instructions FROM orders WHERE id=$1`, plain.ID).Scan(&nullNote); err != nil {
		t.Fatalf("read plain order: %v", err)
	}
	if nullNote != nil {
		t.Errorf("no-note order stored %q, want NULL", *nullNote)
	}
}

// TestLiveDB_OrderScheduledForPersistedAndSweepable: a scheduled order persists its
// slot, stays pending, and is picked up by ActivateScheduledOrders when the slot
// arrives — the sweeper could never fire for an API-placed order before this.
func TestLiveDB_OrderScheduledForPersistedAndSweepable(t *testing.T) {
	pool := promoOrderPool(t)
	defer pool.Close()
	ctx := context.Background()
	f := newPromoOrderFixture(t, ctx, pool, "Scheduled Kitchen", 400_000)

	slot := time.Now().Add(2 * time.Hour)
	order, err := f.svc.PlaceOrder(ctx, f.restID, f.customer, PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: f.itemID, Quantity: 1}},
		DeliveryAddress: "Victoria Island",
		ScheduledFor:    &slot,
		IdempotencyKey:  "sched-" + uuid.New().String(),
	})
	if err != nil {
		t.Fatalf("place scheduled order: %v", err)
	}
	if order.ScheduledFor == nil {
		t.Fatal("returned order has no scheduled_for — the slot was dropped")
	}
	var stored *time.Time
	var status string
	if err := pool.QueryRow(ctx, `SELECT scheduled_for, status FROM orders WHERE id=$1`, order.ID).Scan(&stored, &status); err != nil {
		t.Fatalf("read order: %v", err)
	}
	if stored == nil {
		t.Fatal("orders.scheduled_for is NULL — the sweeper can never see this order")
	}
	if d := stored.Sub(slot); d > time.Second || d < -time.Second {
		t.Errorf("persisted slot %v, want %v", stored, slot)
	}
	if status != string(OrderPending) {
		t.Errorf("status = %s, want pending", status)
	}
	// The escrow happened now, as documented — scheduling defers the kitchen, not the money.
	var escrowed int64
	if err := pool.QueryRow(ctx, `SELECT total_kobo FROM settlements WHERE id=$1`, order.SettlementID).Scan(&escrowed); err != nil {
		t.Fatalf("read settlement: %v", err)
	}
	if escrowed != order.TotalKobo {
		t.Errorf("escrowed %d, want %d", escrowed, order.TotalKobo)
	}

	// --- The sweeper now finds it. Restaurant is open ⇒ released into the live queue. ---
	released, cancelled, err := f.svc.ActivateScheduledOrders(ctx, slot.Add(time.Minute))
	if err != nil {
		t.Fatalf("activate: %v", err)
	}
	if released < 1 {
		t.Errorf("sweeper released %d orders (cancelled %d), want to release at least this one", released, cancelled)
	}
	if err := pool.QueryRow(ctx, `SELECT scheduled_for, status FROM orders WHERE id=$1`, order.ID).Scan(&stored, &status); err != nil {
		t.Fatalf("re-read order: %v", err)
	}
	if stored != nil {
		t.Errorf("scheduled_for = %v after activation, want NULL (released into the live queue)", stored)
	}
	if status != string(OrderPending) {
		t.Errorf("status after release = %s, want pending", status)
	}
}

// TestLiveDB_ScheduledOrderSurvivesTheAcceptSlaReaper: a scheduled order sits 'pending'
// by design until its slot — up to 7 days. The accept-SLA reaper must skip it, or any
// sane accept_sla_minutes cancels and refunds every scheduled order minutes after it is
// booked, silently deleting the feature.
func TestLiveDB_ScheduledOrderSurvivesTheAcceptSlaReaper(t *testing.T) {
	pool := promoOrderPool(t)
	defer pool.Close()
	ctx := context.Background()
	f := newPromoOrderFixture(t, ctx, pool, "SLA Kitchen", 400_000)

	if err := f.svc.SetPricingConfig(ctx, f.restID, PricingConfig{AcceptSlaMinutes: 30}); err != nil {
		t.Fatalf("set accept SLA: %v", err)
	}
	slot := time.Now().Add(48 * time.Hour)
	scheduled, err := f.svc.PlaceOrder(ctx, f.restID, f.customer, PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: f.itemID, Quantity: 1}},
		DeliveryAddress: "Victoria Island",
		ScheduledFor:    &slot,
		IdempotencyKey:  "slasched-" + uuid.New().String(),
	})
	if err != nil {
		t.Fatalf("place scheduled: %v", err)
	}
	// An ordinary order placed at the same moment, as the control.
	immediate, err := f.svc.PlaceOrder(ctx, f.restID, f.customer, PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: f.itemID, Quantity: 1}},
		DeliveryAddress: "Victoria Island",
		IdempotencyKey:  "slaimm-" + uuid.New().String(),
	})
	if err != nil {
		t.Fatalf("place immediate: %v", err)
	}

	// Run the reaper well past the SLA but long before the scheduled slot.
	if _, err := f.svc.SweepUnacceptedOrders(ctx, time.Now().Add(2*time.Hour)); err != nil {
		t.Fatalf("sweep: %v", err)
	}
	var schedStatus, immStatus string
	if err := pool.QueryRow(ctx, `SELECT status FROM orders WHERE id=$1`, scheduled.ID).Scan(&schedStatus); err != nil {
		t.Fatalf("read scheduled: %v", err)
	}
	if err := pool.QueryRow(ctx, `SELECT status FROM orders WHERE id=$1`, immediate.ID).Scan(&immStatus); err != nil {
		t.Fatalf("read immediate: %v", err)
	}
	if schedStatus != string(OrderPending) {
		t.Errorf("scheduled order status = %s, want pending — the accept-SLA reaper must skip orders waiting for a future slot", schedStatus)
	}
	if immStatus != string(OrderCancelled) {
		t.Errorf("immediate order status = %s, want cancelled — the reaper must still sweep ordinary unaccepted orders", immStatus)
	}
}

// TestLiveDB_OrderScheduledSlotValidated: an impossible slot is rejected BEFORE the
// escrow, so no money moves for an order that could never be cooked.
func TestLiveDB_OrderScheduledSlotValidated(t *testing.T) {
	pool := promoOrderPool(t)
	defer pool.Close()
	ctx := context.Background()
	f := newPromoOrderFixture(t, ctx, pool, "Slot Validation Kitchen", 400_000)

	before, err := f.led.GetBalance(ctx, f.customer)
	if err != nil {
		t.Fatalf("balance before: %v", err)
	}
	cases := []struct {
		name string
		slot time.Time
	}{
		{"in the past", time.Now().Add(-time.Hour)},
		{"inside the minimum lead", time.Now().Add(scheduledMinLead / 2)},
		{"beyond the horizon", time.Now().Add(scheduledHorizon + 24*time.Hour)},
	}
	for _, c := range cases {
		slot := c.slot
		if _, err := f.svc.PlaceOrder(ctx, f.restID, f.customer, PlaceOrderRequest{
			Items:           []OrderItemInput{{MenuItemID: f.itemID, Quantity: 1}},
			DeliveryAddress: "Victoria Island",
			ScheduledFor:    &slot,
			IdempotencyKey:  "schedbad-" + uuid.New().String(),
		}); err == nil {
			t.Errorf("a slot %s must be rejected", c.name)
		}
	}
	after, err := f.led.GetBalance(ctx, f.customer)
	if err != nil {
		t.Fatalf("balance after: %v", err)
	}
	if after != before {
		t.Errorf("customer balance moved by %d on rejected slots — nothing may be escrowed", before-after)
	}
}

// TestLiveDB_OrderScheduledWhileClosed: scheduling is allowed while the restaurant is
// shut (that is when people schedule); the slot itself must still fall inside its weekly
// hours, and the sweeper refunds if the kitchen is still closed when the slot arrives.
func TestLiveDB_OrderScheduledWhileClosed(t *testing.T) {
	pool := promoOrderPool(t)
	defer pool.Close()
	ctx := context.Background()
	f := newPromoOrderFixture(t, ctx, pool, "Closed Now Kitchen", 400_000)

	if _, err := pool.Exec(ctx, `UPDATE restaurants SET is_open=FALSE WHERE id=$1`, f.restID); err != nil {
		t.Fatalf("close restaurant: %v", err)
	}
	// An IMMEDIATE order is still refused.
	if _, err := f.svc.PlaceOrder(ctx, f.restID, f.customer, PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: f.itemID, Quantity: 1}},
		DeliveryAddress: "Victoria Island",
		IdempotencyKey:  "closednow-" + uuid.New().String(),
	}); err == nil {
		t.Error("an immediate order on a closed restaurant must still be refused")
	}
	// A SCHEDULED one is accepted — the slot, not the switch, is what matters.
	slot := time.Now().Add(3 * time.Hour)
	order, err := f.svc.PlaceOrder(ctx, f.restID, f.customer, PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: f.itemID, Quantity: 1}},
		DeliveryAddress: "Victoria Island",
		ScheduledFor:    &slot,
		IdempotencyKey:  "closedsched-" + uuid.New().String(),
	})
	if err != nil {
		t.Fatalf("scheduling while closed must be allowed: %v", err)
	}

	// Still closed at the slot ⇒ the sweeper cancels AND refunds it (SG-002). This is
	// what makes accepting the order safe: the customer's money always comes back.
	balBefore, err := f.led.GetBalance(ctx, f.customer)
	if err != nil {
		t.Fatalf("balance before sweep: %v", err)
	}
	_, cancelled, err := f.svc.ActivateScheduledOrders(ctx, slot.Add(time.Minute))
	if err != nil {
		t.Fatalf("activate: %v", err)
	}
	if cancelled < 1 {
		t.Errorf("sweeper cancelled %d, want it to cancel the order whose restaurant is closed", cancelled)
	}
	var status string
	if err := pool.QueryRow(ctx, `SELECT status FROM orders WHERE id=$1`, order.ID).Scan(&status); err != nil {
		t.Fatalf("read order: %v", err)
	}
	if status != string(OrderCancelled) {
		t.Errorf("status = %s, want cancelled", status)
	}
	balAfter, err := f.led.GetBalance(ctx, f.customer)
	if err != nil {
		t.Fatalf("balance after sweep: %v", err)
	}
	if balAfter-balBefore != order.TotalKobo {
		t.Errorf("refunded %d, want the full escrowed %d", balAfter-balBefore, order.TotalKobo)
	}
}
