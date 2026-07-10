package quidax

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"paymax/crypto-backend/internal/config"
)

// marketsJSON and tickersJSON are Quidax-shaped responses for /markets and
// /markets/tickers. BTC/NGN is fiat-quoted (surfaced); ETH/USDT is crypto-quoted
// (filtered out of the fiat catalogue).
const marketsJSON = `{
  "status": "success",
  "message": "Successful",
  "data": [
    {"id": "btcngn", "base_unit": "btc", "quote_unit": "ngn"},
    {"id": "ethusdt", "base_unit": "eth", "quote_unit": "usdt"}
  ]
}`

const tickersJSON = `{
  "status": "success",
  "message": "Successful",
  "data": {
    "btcngn": {"at": 1770989541000, "market": "btcngn", "ticker": {
      "high": "95584613", "vol": "1.92860435", "last": "93694580.0000000000000000",
      "low": "91197776", "buy": "93809724", "sell": "94565493", "open": "90000000"
    }},
    "ethusdt": {"at": 1770989541000, "market": "ethusdt", "ticker": {
      "high": "3600", "vol": "10", "last": "3500", "low": "3400",
      "buy": "3499", "sell": "3501", "open": "3450"
    }}
  }
}`

// newTestClient points a Client at srv with a fixed API key.
func newTestClient(srv *httptest.Server) *Client {
	return New(config.ProviderCreds{BaseURL: srv.URL, APIKey: "testkey"})
}

func TestAssetsMapsQuidaxMarketsToDomain(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/markets":
			w.Write([]byte(marketsJSON))
		case "/markets/tickers":
			w.Write([]byte(tickersJSON))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	assets := newTestClient(srv).Assets()

	// Only the fiat-quoted market (BTC/NGN) is surfaced; ETH/USDT is filtered.
	if len(assets) != 1 {
		t.Fatalf("expected 1 fiat-quoted asset, got %d: %+v", len(assets), assets)
	}
	a := assets[0]
	if a.Symbol != "BTC" || a.ID != "BTC" {
		t.Errorf("symbol/id = %q/%q, want BTC/BTC", a.Symbol, a.ID)
	}
	if a.Price.Currency != "NGN" {
		t.Errorf("price currency = %q, want NGN", a.Price.Currency)
	}
	// 93694580 (truncated at 2 dp) * 10^2 = 9369458000 kobo.
	if a.Price.Amount != 9369458000 {
		t.Errorf("price minor units = %d, want 9369458000", a.Price.Amount)
	}
	if a.Decimals != defaultCryptoDecimals {
		t.Errorf("decimals = %d, want %d", a.Decimals, defaultCryptoDecimals)
	}
}

func TestBreakerTripsOn5xx(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "boom", http.StatusInternalServerError)
	}))
	defer srv.Close()

	c := newTestClient(srv)
	// Default breaker trips after 5 consecutive transport/5xx failures. Each
	// Assets() call issues a /markets GET that 500s → one breaker failure.
	for i := 0; i < 5; i++ {
		if got := c.Assets(); got != nil {
			t.Fatalf("call %d: expected nil assets on 5xx, got %+v", i, got)
		}
	}
	if state := c.CircuitState(); state != "open" {
		t.Fatalf("breaker state = %q, want open after 5 consecutive 5xx", state)
	}
	// A further call must fail fast (still nil) without a healthy provider.
	if got := c.Assets(); got != nil {
		t.Fatalf("expected nil after breaker open, got %+v", got)
	}
}

func TestScreenAddressFailsSafeOn500(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "boom", http.StatusInternalServerError)
	}))
	defer srv.Close()

	res := newTestClient(srv).ScreenAddress("bc1qexampleaddressxxxxxxxxxxxx")
	if res.Risk != "flagged" {
		t.Fatalf("screening risk = %q, want flagged (fail-safe) on 500", res.Risk)
	}
}

func TestAuthHeaderBearerIsSent(t *testing.T) {
	var gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		switch r.URL.Path {
		case "/markets":
			w.Write([]byte(marketsJSON))
		case "/markets/tickers":
			w.Write([]byte(tickersJSON))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	_ = newTestClient(srv).Assets()
	if gotAuth != "Bearer testkey" {
		t.Fatalf("Authorization header = %q, want %q", gotAuth, "Bearer testkey")
	}
}
