package restaurant

import "testing"

func TestCanTransition_ExpandedStates(t *testing.T) {
	legal := []struct{ from, to OrderStatus }{
		{OrderPending, OrderRejected},
		{OrderConfirmed, OrderRejected},
		{OrderReady, OrderDispatchFailed},
		{OrderPickedUp, OrderDeliveryFailed},
	}
	for _, c := range legal {
		if !canTransition(c.from, c.to) {
			t.Errorf("expected %s→%s allowed", c.from, c.to)
		}
	}
	illegal := []struct{ from, to OrderStatus }{
		{OrderPreparing, OrderRejected},       // too late to reject once cooking
		{OrderPending, OrderDispatchFailed},   // dispatch only fails once ready
		{OrderReady, OrderDeliveryFailed},     // delivery fails only after pickup
		{OrderRejected, OrderConfirmed},       // terminal
		{OrderDispatchFailed, OrderReady},     // terminal
		{OrderDeliveryFailed, OrderDelivered}, // terminal
	}
	for _, c := range illegal {
		if canTransition(c.from, c.to) {
			t.Errorf("expected %s→%s rejected", c.from, c.to)
		}
	}
	// The original happy path is unchanged.
	if !canTransition(OrderReady, OrderPickedUp) || !canTransition(OrderPickedUp, OrderDelivered) {
		t.Error("original lifecycle transitions must still hold")
	}
}

func TestIsRefundedClose(t *testing.T) {
	for _, s := range []OrderStatus{OrderCancelled, OrderRejected, OrderDispatchFailed} {
		if !isRefundedClose(s) {
			t.Errorf("%s should be a refunded close state", s)
		}
	}
	for _, s := range []OrderStatus{OrderDelivered, OrderDeliveryFailed, OrderPickedUp, OrderPending} {
		if isRefundedClose(s) {
			t.Errorf("%s should NOT be a refunded close state", s)
		}
	}
}
