package stocks

import (
	"errors"
	"testing"

	"paymax/crypto-backend/internal/engine"
)

// failingBroker models a venue that could not accept the order at all (transport
// failure, outage, non-2xx). Place returns an error and no usable result.
type failingBroker struct{ called bool }

func (b *failingBroker) Place(req BrokerRequest) (BrokerResult, error) {
	b.called = true
	return BrokerResult{}, errors.New("venue unavailable")
}

// acceptOnlyBroker models a real venue (e.g. Alpaca) that accepts an order and
// fills it asynchronously — it never returns "Filled" synchronously.
type acceptOnlyBroker struct{ called bool }

func (b *acceptOnlyBroker) Place(req BrokerRequest) (BrokerResult, error) {
	b.called = true
	return BrokerResult{
		Status:   "AcceptedByProvider",
		Provider: "venue-x",
		History:  []StatusEvent{{Status: "AcceptedByProvider", At: engine.Now()}},
	}, nil
}

// The injected broker must decide the order's resulting state, while Service still
// runs all pre-trade checks and persistence (idempotency, order history).
func TestPlaceOrder_UsesInjectedBroker(t *testing.T) {
	b := &acceptOnlyBroker{}
	svc := NewService().WithBroker(b)

	o, err := svc.PlaceOrder(OrderDraft{
		AssetID: "stk_dangcem", Symbol: "DANGCEM", Side: "buy", OrderType: "market", Quantity: 10,
	}, "idem-broker-1")
	if err != nil {
		t.Fatalf("unexpected error: %+v", err)
	}
	if !b.called {
		t.Fatal("injected broker was not consulted")
	}
	if o.Status != "AcceptedByProvider" {
		t.Errorf("status = %q, want AcceptedByProvider (from injected broker)", o.Status)
	}
	if o.Provider != "venue-x" {
		t.Errorf("provider = %q, want venue-x (from injected broker)", o.Provider)
	}
	// Persistence still works: the order is idempotently cached.
	again, _ := svc.PlaceOrder(OrderDraft{
		AssetID: "stk_dangcem", Symbol: "DANGCEM", Side: "buy", OrderType: "market", Quantity: 10,
	}, "idem-broker-1")
	if again.ID != o.ID {
		t.Errorf("idempotent replay returned a different order: %s vs %s", again.ID, o.ID)
	}
}

// When the venue cannot accept the order, PlaceOrder returns a provider_error and
// persists nothing — the idempotency key must stay free for a retry.
func TestPlaceOrder_ProviderError(t *testing.T) {
	b := &failingBroker{}
	svc := NewService().WithBroker(b)

	_, err := svc.PlaceOrder(OrderDraft{
		AssetID: "stk_dangcem", Symbol: "DANGCEM", Side: "buy", OrderType: "market", Quantity: 10,
	}, "idem-provider-err")
	if err == nil || err.Type != "provider_error" {
		t.Fatalf("err = %+v, want type provider_error", err)
	}
	if !b.called {
		t.Fatal("broker was not consulted")
	}
	// Nothing persisted.
	for _, o := range svc.Orders("") {
		if o.IdempotencyKey == "idem-provider-err" {
			t.Fatalf("order was persisted on a provider error: %s", o.ID)
		}
	}
	// The idempotency key is still free: a subsequent successful attempt with the
	// same key must be able to place a fresh order.
	svc.WithBroker(&acceptOnlyBroker{})
	o, err2 := svc.PlaceOrder(OrderDraft{
		AssetID: "stk_dangcem", Symbol: "DANGCEM", Side: "buy", OrderType: "market", Quantity: 10,
	}, "idem-provider-err")
	if err2 != nil {
		t.Fatalf("retry after provider error failed: %+v", err2)
	}
	if o.Status != "AcceptedByProvider" {
		t.Errorf("status = %q, want AcceptedByProvider on retry", o.Status)
	}
}

// WithBroker must ignore a nil broker so the default is never removed.
func TestWithBroker_NilIsIgnored(t *testing.T) {
	svc := NewService().WithBroker(nil)
	o, err := svc.PlaceOrder(OrderDraft{
		AssetID: "stk_dangcem", Symbol: "DANGCEM", Side: "buy", OrderType: "market", Quantity: 10,
	}, "idem-nil-1")
	if err != nil {
		t.Fatalf("unexpected error: %+v", err)
	}
	if o.Status != "Filled" { // default MockBroker still fills market orders
		t.Errorf("status = %q, want Filled (default broker retained)", o.Status)
	}
}
