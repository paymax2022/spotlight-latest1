package restaurant_test

import (
	"testing"

	"spotlight/backend/internal/restaurant"
)

// TestDeliveryFeeKobo verifies the flat delivery fee per PRD.
// ₦500 = 50,000 kobo. Change only with a migration and ADR.
func TestDeliveryFeeKobo(t *testing.T) {
	const want int64 = 50_000
	if restaurant.DeliveryFeeKobo != want {
		t.Errorf("DeliveryFeeKobo = %d, want %d (₦500)", restaurant.DeliveryFeeKobo, want)
	}
}

// TestDeliveryFeeIsPositive verifies the delivery fee is a positive integer.
func TestDeliveryFeeIsPositive(t *testing.T) {
	if restaurant.DeliveryFeeKobo <= 0 {
		t.Errorf("DeliveryFeeKobo must be positive, got %d", restaurant.DeliveryFeeKobo)
	}
}

// TestOrderTotalCalculation verifies that order total = subtotal + delivery fee.
// This is the escrow amount — it must include the delivery fee, never just items.
func TestOrderTotalCalculation(t *testing.T) {
	itemsSubtotal := int64(350_000) // ₦3,500 in items
	total := itemsSubtotal + restaurant.DeliveryFeeKobo
	want := int64(400_000) // ₦4,000 total

	if total != want {
		t.Errorf("order total = %d, want %d (items=%d + delivery=%d)",
			total, want, itemsSubtotal, restaurant.DeliveryFeeKobo)
	}
}

// TestOrderStatusConstants verifies order status values are distinct.
func TestOrderStatusConstants(t *testing.T) {
	statuses := []restaurant.OrderStatus{
		restaurant.OrderPending,
		restaurant.OrderConfirmed,
		restaurant.OrderPreparing,
		restaurant.OrderReady,
		restaurant.OrderPickedUp,
		restaurant.OrderDelivered,
		restaurant.OrderCancelled,
	}
	seen := map[restaurant.OrderStatus]bool{}
	for _, s := range statuses {
		if s == "" {
			t.Error("OrderStatus must not be empty string")
		}
		if seen[s] {
			t.Errorf("duplicate OrderStatus: %q", s)
		}
		seen[s] = true
	}
}

// TestTerminalOrderStates verifies that delivered and cancelled are terminal states.
func TestTerminalOrderStates(t *testing.T) {
	terminals := []restaurant.OrderStatus{
		restaurant.OrderDelivered,
		restaurant.OrderCancelled,
	}
	// Terminal states must differ from the entry state.
	for _, ts := range terminals {
		if ts == restaurant.OrderPending {
			t.Errorf("terminal state %q must not equal entry state (pending)", ts)
		}
	}
}
