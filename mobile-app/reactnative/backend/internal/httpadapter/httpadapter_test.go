package httpadapter

import (
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

// A provider that always 500s must trip the breaker after the failure threshold
// (default 5), after which further calls fail fast WITHOUT hitting the network.
func TestCircuitBreaker_TripsOn5xx_ThenFailsFast(t *testing.T) {
	var hits int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	c := New(srv.URL, "")

	// Drive 5 consecutive failures to trip the breaker (default FailureThreshold=5).
	for i := 0; i < 5; i++ {
		if got := c.Assets(); got != nil {
			t.Fatalf("call %d: expected nil on 5xx, got %v", i+1, got)
		}
	}
	if state := c.CircuitState(); state != "open" {
		t.Fatalf("after 5 failures breaker state = %q, want open", state)
	}

	// Next calls must fail fast — the server must NOT be hit again.
	before := atomic.LoadInt32(&hits)
	for i := 0; i < 3; i++ {
		_ = c.Assets()
	}
	if after := atomic.LoadInt32(&hits); after != before {
		t.Fatalf("breaker open but server was hit %d more time(s); want fail-fast", after-before)
	}
	if before != 5 {
		t.Fatalf("expected exactly 5 network hits before tripping, got %d", before)
	}
}

// A 4xx (e.g. 404 not-found) means the provider is healthy — it must NOT trip the
// breaker, or ordinary not-found lookups would open the circuit.
func TestCircuitBreaker_DoesNotTripOn4xx(t *testing.T) {
	var hits int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	c := New(srv.URL, "")

	for i := 0; i < 10; i++ {
		if _, ok := c.Asset("does-not-exist"); ok {
			t.Fatalf("call %d: 404 should yield ok=false", i+1)
		}
	}
	if state := c.CircuitState(); state != "closed" {
		t.Fatalf("4xx must not trip breaker; state = %q, want closed", state)
	}
	if got := atomic.LoadInt32(&hits); got != 10 {
		t.Fatalf("all 10 calls should reach the healthy provider, got %d hits", got)
	}
}

// ScreenAddress must fail safe (flagged) when the provider errors, even with the
// breaker in the path.
func TestScreenAddress_FailsSafe_UnderBreaker(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	c := New(srv.URL, "")
	got := c.ScreenAddress("bc1qexample")
	if got.Risk != "flagged" {
		t.Fatalf("unreachable screening must fail safe as flagged, got risk=%q", got.Risk)
	}
}
