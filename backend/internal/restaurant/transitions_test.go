package restaurant

import (
	"context"
	"testing"
)

func TestCanTransition(t *testing.T) {
	legal := []struct{ from, to OrderStatus }{
		{OrderPending, OrderConfirmed},
		{OrderPending, OrderCancelled},
		{OrderConfirmed, OrderPreparing},
		{OrderConfirmed, OrderCancelled},
		{OrderPreparing, OrderReady},
		{OrderPreparing, OrderCancelled},
		{OrderReady, OrderPickedUp},
		{OrderReady, OrderCancelled},
		{OrderPickedUp, OrderDelivered},
	}
	for _, c := range legal {
		if !canTransition(c.from, c.to) {
			t.Errorf("expected %s -> %s to be legal", c.from, c.to)
		}
	}

	illegal := []struct{ from, to OrderStatus }{
		{OrderPending, OrderDelivered},   // skips steps
		{OrderPending, OrderPreparing},   // skips confirmed
		{OrderConfirmed, OrderReady},     // skips preparing
		{OrderPickedUp, OrderCancelled},  // cannot cancel after pickup
		{OrderDelivered, OrderConfirmed}, // terminal
		{OrderCancelled, OrderConfirmed}, // terminal
		{OrderReady, OrderReady},         // no self-transition
	}
	for _, c := range illegal {
		if canTransition(c.from, c.to) {
			t.Errorf("expected %s -> %s to be illegal", c.from, c.to)
		}
	}
}

func TestLogNotifier(t *testing.T) {
	if err := (LogNotifier{}).Notify(context.Background(), Notification{UserID: "u1", Event: EventOrderPlaced, Title: "t"}); err != nil {
		t.Errorf("LogNotifier should not error: %v", err)
	}
}

func TestNotifierFunc(t *testing.T) {
	var got Notification
	f := NotifierFunc(func(ctx context.Context, n Notification) error { got = n; return nil })
	if err := f.Notify(context.Background(), Notification{UserID: "u9", Event: EventNewMessage}); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.UserID != "u9" || got.Event != EventNewMessage {
		t.Errorf("notifier func did not receive notification, got %+v", got)
	}
}
