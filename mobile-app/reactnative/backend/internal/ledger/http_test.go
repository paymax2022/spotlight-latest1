package ledger

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync/atomic"
	"testing"
)

// PostJournal against a 200 {posted:true} must return nil and send the correct
// method, path, headers (Bearer + Idempotency-Key) and camelCase JSON body.
func TestPostJournal_Success(t *testing.T) {
	var (
		gotMethod string
		gotPath   string
		gotAuth   string
		gotIdem   string
		gotCT     string
		gotBody   map[string]any
	)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotPath = r.URL.Path
		gotAuth = r.Header.Get("Authorization")
		gotIdem = r.Header.Get("Idempotency-Key")
		gotCT = r.Header.Get("Content-Type")
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"posted":true}`))
	}))
	defer srv.Close()

	l := NewHTTP(srv.URL, "svc-token")
	j := Journal{
		UserID:         "u1",
		DebitAccount:   "user_wallet",
		CreditAccount:  "settlement",
		AmountKobo:     15000,
		Reference:      "stock_buy:PMX-ST-1",
		IdempotencyKey: "idem-123",
		BalanceChecked: true,
	}
	if err := l.PostJournal(context.Background(), j); err != nil {
		t.Fatalf("PostJournal: unexpected error: %v", err)
	}

	if gotMethod != http.MethodPost {
		t.Errorf("method = %q, want POST", gotMethod)
	}
	if gotPath != "/internal/finance/ledger/journal" {
		t.Errorf("path = %q, want /internal/finance/ledger/journal", gotPath)
	}
	if gotAuth != "Bearer svc-token" {
		t.Errorf("Authorization = %q, want Bearer svc-token", gotAuth)
	}
	if gotIdem != "idem-123" {
		t.Errorf("Idempotency-Key = %q, want idem-123", gotIdem)
	}
	if gotCT != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", gotCT)
	}

	// camelCase body fields, kobo as an integer.
	wantBody := map[string]any{
		"userId":         "u1",
		"debitAccount":   "user_wallet",
		"creditAccount":  "settlement",
		"amountKobo":     float64(15000), // JSON numbers decode to float64
		"reference":      "stock_buy:PMX-ST-1",
		"idempotencyKey": "idem-123",
		"balanceChecked": true,
	}
	for k, want := range wantBody {
		if got, ok := gotBody[k]; !ok || got != want {
			t.Errorf("body[%q] = %v (present=%v), want %v", k, got, ok, want)
		}
	}
}

// A 409 insufficient_funds must map to ErrInsufficientFunds.
func TestPostJournal_InsufficientFunds(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusConflict)
		_, _ = w.Write([]byte(`{"error":"insufficient_funds"}`))
	}))
	defer srv.Close()

	l := NewHTTP(srv.URL, "svc-token")
	err := l.PostJournal(context.Background(), Journal{
		UserID:         "u1",
		DebitAccount:   "user_wallet",
		CreditAccount:  "settlement",
		AmountKobo:     999999,
		IdempotencyKey: "idem-over",
		BalanceChecked: true,
	})
	if !errors.Is(err, ErrInsufficientFunds) {
		t.Fatalf("err = %v, want ErrInsufficientFunds", err)
	}
}

// Repeated 500s must trip the breaker after the threshold (default 5), after which
// calls fail fast WITHOUT hitting the server again.
func TestPostJournal_5xxTripsBreaker_ThenFailsFast(t *testing.T) {
	var hits int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	l := NewHTTP(srv.URL, "svc-token")
	j := Journal{
		UserID:         "u1",
		DebitAccount:   "user_wallet",
		CreditAccount:  "settlement",
		AmountKobo:     100,
		IdempotencyKey: "idem-5xx",
	}

	for i := 0; i < 5; i++ {
		if err := l.PostJournal(context.Background(), j); err == nil {
			t.Fatalf("call %d: expected error on 5xx, got nil", i+1)
		}
	}
	if state := l.CircuitState(); state != "open" {
		t.Fatalf("after 5 failures breaker state = %q, want open", state)
	}

	before := atomic.LoadInt32(&hits)
	for i := 0; i < 3; i++ {
		if err := l.PostJournal(context.Background(), j); err == nil {
			t.Fatalf("breaker open: expected fail-fast error, got nil")
		}
	}
	if after := atomic.LoadInt32(&hits); after != before {
		t.Fatalf("breaker open but server hit %d more time(s); want fail-fast", after-before)
	}
	if before != 5 {
		t.Fatalf("expected exactly 5 network hits before tripping, got %d", before)
	}
}

// Many 409s must NOT trip the breaker — a 409 is a healthy provider decision.
func TestPostJournal_409DoesNotTripBreaker(t *testing.T) {
	var hits int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		w.WriteHeader(http.StatusConflict)
		_, _ = w.Write([]byte(`{"error":"insufficient_funds"}`))
	}))
	defer srv.Close()

	l := NewHTTP(srv.URL, "svc-token")
	j := Journal{
		UserID:         "u1",
		DebitAccount:   "user_wallet",
		CreditAccount:  "settlement",
		AmountKobo:     100,
		IdempotencyKey: "idem-409",
		BalanceChecked: true,
	}

	for i := 0; i < 10; i++ {
		if err := l.PostJournal(context.Background(), j); !errors.Is(err, ErrInsufficientFunds) {
			t.Fatalf("call %d: err = %v, want ErrInsufficientFunds", i+1, err)
		}
	}
	if state := l.CircuitState(); state != "closed" {
		t.Fatalf("409 must not trip breaker; state = %q, want closed", state)
	}
	if got := atomic.LoadInt32(&hits); got != 10 {
		t.Fatalf("all 10 calls should reach the healthy provider, got %d hits", got)
	}
}

// Balance must decode balanceKobo and send userId/account query params + Bearer.
func TestBalance_DecodesBalanceKobo(t *testing.T) {
	var gotQuery string
	var gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotQuery = r.URL.RawQuery
		gotAuth = r.Header.Get("Authorization")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"balanceKobo":42750}`))
	}))
	defer srv.Close()

	l := NewHTTP(srv.URL, "svc-token")
	bal, err := l.Balance(context.Background(), "u1", "user_wallet")
	if err != nil {
		t.Fatalf("Balance: unexpected error: %v", err)
	}
	if bal != 42750 {
		t.Fatalf("balance = %d, want 42750", bal)
	}
	if gotAuth != "Bearer svc-token" {
		t.Errorf("Authorization = %q, want Bearer svc-token", gotAuth)
	}
	// Both query params present.
	q, err := url.ParseQuery(gotQuery)
	if err != nil {
		t.Fatalf("parse query %q: %v", gotQuery, err)
	}
	if q.Get("userId") != "u1" {
		t.Errorf("userId query = %q, want u1", q.Get("userId"))
	}
	if q.Get("account") != "user_wallet" {
		t.Errorf("account query = %q, want user_wallet", q.Get("account"))
	}
}

// An empty idempotency key must be rejected BEFORE any HTTP call is made.
func TestPostJournal_MissingIdem_NoHTTPCall(t *testing.T) {
	var hits int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	l := NewHTTP(srv.URL, "svc-token")
	err := l.PostJournal(context.Background(), Journal{
		UserID:        "u1",
		DebitAccount:  "user_wallet",
		CreditAccount: "settlement",
		AmountKobo:    100,
		// IdempotencyKey deliberately empty
	})
	if !errors.Is(err, ErrMissingIdem) {
		t.Fatalf("err = %v, want ErrMissingIdem", err)
	}
	if got := atomic.LoadInt32(&hits); got != 0 {
		t.Fatalf("validation must happen before any HTTP call; server was hit %d time(s)", got)
	}
}
