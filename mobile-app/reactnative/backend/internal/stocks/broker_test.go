package stocks

import (
	"testing"

	"paymax/crypto-backend/internal/engine"
)

// acceptOnlyBroker models a real venue (e.g. Alpaca) that accepts an order and
// fills it asynchronously — it never returns "Filled" synchronously.
type acceptOnlyBroker struct{ called bool }

func (b *acceptOnlyBroker) Place(req BrokerRequest) BrokerResult {
	b.called = true
	return BrokerResult{
		Status:   "AcceptedByProvider",
		Provider: "venue-x",
		History:  []StatusEvent{{Status: "AcceptedByProvider", At: engine.Now()}},
	}
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
