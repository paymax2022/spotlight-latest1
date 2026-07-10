package alpaca

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"paymax/crypto-backend/internal/config"
	"paymax/crypto-backend/internal/stocks"
)

func enabledCreds(baseURL string) config.ProviderCreds {
	return config.ProviderCreds{
		BaseURL:   baseURL,
		APIKey:    "test-key-id",
		APISecret: "test-secret",
	}
}

// A successful place submits the mapped order to /v2/orders with the Alpaca auth
// headers and returns AcceptedByProvider (no synchronous fill).
func TestPlace_Success(t *testing.T) {
	var gotPath, gotKey, gotSecret string
	var gotBody orderRequest

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotKey = r.Header.Get("APCA-API-KEY-ID")
		gotSecret = r.Header.Get("APCA-API-SECRET-KEY")
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(orderResponse{ID: "alp_1", Symbol: gotBody.Symbol, Status: "accepted"})
	}))
	defer srv.Close()

	b := New(enabledCreds(srv.URL))
	res, err := b.Place(stocks.BrokerRequest{
		Symbol:          "AAPL",
		Side:            "buy",
		OrderType:       "market",
		Quantity:        7,
		SettlementCycle: "T+2",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if gotPath != "/v2/orders" {
		t.Errorf("path = %q, want /v2/orders", gotPath)
	}
	if gotKey != "test-key-id" {
		t.Errorf("APCA-API-KEY-ID = %q, want test-key-id", gotKey)
	}
	if gotSecret != "test-secret" {
		t.Errorf("APCA-API-SECRET-KEY = %q, want test-secret", gotSecret)
	}
	if gotBody.Symbol != "AAPL" || gotBody.Qty != 7 || gotBody.Side != "buy" {
		t.Errorf("body = %+v, want symbol=AAPL qty=7 side=buy", gotBody)
	}
	if gotBody.Type != "market" {
		t.Errorf("type = %q, want market", gotBody.Type)
	}
	if gotBody.TimeInForce != "day" {
		t.Errorf("time_in_force = %q, want day", gotBody.TimeInForce)
	}

	if res.Status != "AcceptedByProvider" {
		t.Errorf("status = %q, want AcceptedByProvider", res.Status)
	}
	if res.FilledQuantity != 0 {
		t.Errorf("filledQuantity = %d, want 0 (fills arrive via webhook)", res.FilledQuantity)
	}
	if res.Provider != "alpaca" {
		t.Errorf("provider = %q, want alpaca", res.Provider)
	}
	if len(res.History) != 1 || res.History[0].Status != "AcceptedByProvider" {
		t.Errorf("history = %+v, want single AcceptedByProvider event", res.History)
	}
	if b.CircuitState() != "closed" {
		t.Errorf("circuit = %q, want closed after a success", b.CircuitState())
	}
}

// A limit order maps to Alpaca type "limit".
func TestPlace_LimitTypeMapped(t *testing.T) {
	var gotType string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body orderRequest
		_ = json.NewDecoder(r.Body).Decode(&body)
		gotType = body.Type
		_ = json.NewEncoder(w).Encode(orderResponse{ID: "alp_2", Status: "accepted"})
	}))
	defer srv.Close()

	b := New(enabledCreds(srv.URL))
	if _, err := b.Place(stocks.BrokerRequest{Symbol: "MSFT", Side: "sell", OrderType: "limit", Quantity: 3}); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if gotType != "limit" {
		t.Errorf("type = %q, want limit", gotType)
	}
}

// Repeated 5xx responses count against the breaker; once it trips, calls fail fast
// (the breaker returns before the server is even hit).
func TestPlace_BreakerTripsOn5xx(t *testing.T) {
	var hits int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	b := New(enabledCreds(srv.URL))
	// Default breaker threshold is 5 consecutive failures.
	for i := 0; i < 5; i++ {
		if _, err := b.Place(stocks.BrokerRequest{Symbol: "AAPL", Side: "buy", OrderType: "market", Quantity: 1}); err == nil {
			t.Fatalf("call %d: expected error on 500", i)
		}
	}
	if b.CircuitState() != "open" {
		t.Fatalf("circuit = %q, want open after repeated 5xx", b.CircuitState())
	}

	hitsBefore := hits
	if _, err := b.Place(stocks.BrokerRequest{Symbol: "AAPL", Side: "buy", OrderType: "market", Quantity: 1}); err == nil {
		t.Fatal("expected fail-fast error while breaker is open")
	}
	if hits != hitsBefore {
		t.Errorf("server was hit while breaker open (hits %d -> %d); expected fail-fast", hitsBefore, hits)
	}
}

// Unconfigured creds must never reach the network.
func TestPlace_UnconfiguredCreds(t *testing.T) {
	var hit bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hit = true
		_ = json.NewEncoder(w).Encode(orderResponse{})
	}))
	defer srv.Close()

	// BaseURL set but no APIKey → Enabled() is false.
	b := New(config.ProviderCreds{BaseURL: srv.URL})
	_, err := b.Place(stocks.BrokerRequest{Symbol: "AAPL", Side: "buy", OrderType: "market", Quantity: 1})
	if err == nil {
		t.Fatal("expected an error for unconfigured creds")
	}
	if hit {
		t.Error("HTTP request was made despite unconfigured creds")
	}
}
