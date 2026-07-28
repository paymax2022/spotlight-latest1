package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"paymax/crypto-backend/internal/domain"
	"paymax/crypto-backend/internal/engine"
	"paymax/crypto-backend/internal/store"
)

// requestQuote posts a buy quote and returns the persisted quote id the server
// assigned. The execute path consumes strictly this id.
func requestQuote(t *testing.T, h http.Handler, side, assetID string, amount int64) domain.Quote {
	t.Helper()
	body, _ := json.Marshal(map[string]any{
		"side": side, "assetId": assetID, "basis": "fiat",
		"amount": amount, "currency": "NGN", "lock": true,
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/crypto/quote", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("quote status = %d (%s)", rec.Code, rec.Body.String())
	}
	var q domain.Quote
	if err := json.Unmarshal(rec.Body.Bytes(), &q); err != nil {
		t.Fatalf("decode quote: %v", err)
	}
	if q.ID == "" {
		t.Fatal("quote has no id")
	}
	return q
}

// execBuy posts a buy execution for a quote id and returns the recorder.
func execBuy(h http.Handler, quoteID, idemKey string) *httptest.ResponseRecorder {
	body, _ := json.Marshal(map[string]string{"quoteId": quoteID})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/crypto/buy", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if idemKey != "" {
		req.Header.Set("Idempotency-Key", idemKey)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

// ── Eligibility gate ──────────────────────────────────────────────────────────

func TestGetEligibility_ClearedDemoUser(t *testing.T) {
	h := NewServer(store.New()).Handler()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/invest/eligibility", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	var e domain.Eligibility
	if err := json.Unmarshal(rec.Body.Bytes(), &e); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if e.State != "eligible" {
		t.Errorf("state = %q, want eligible", e.State)
	}
}

func TestBuyBlockedWhenIneligible(t *testing.T) {
	s := store.New()
	// Strip suitability → the gate must block fail-closed before any execution.
	s.SetEligibility(domain.EligibilityFacts{
		UserActive: true, KycTier: 2, CryptoEnabled: true,
		SuitabilityComplete: false, AgreementsAccepted: true,
	})
	h := NewServer(s).Handler()

	q := requestQuote(t, h, "buy", "ast_usdc", 1_000_00)
	investBefore := s.Portfolio().InvestableBalance.Amount

	rec := execBuy(h, q.ID, "idem-blocked")
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 (%s)", rec.Code, rec.Body.String())
	}
	var body map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	if body["reason"] != "suitability_required" {
		t.Errorf("reason = %v, want suitability_required", body["reason"])
	}
	if got := s.Portfolio().InvestableBalance.Amount; got != investBefore {
		t.Errorf("ineligible buy moved cash: %d -> %d", investBefore, got)
	}
	// The quote must remain unconsumed (a blocked attempt cannot burn the quote).
	if _, ok := s.GetQuote(q.ID); !ok {
		t.Error("quote was consumed by a blocked attempt")
	}
}

func TestBuyAllowedWhenEligible(t *testing.T) {
	s := store.New() // demo user is seeded eligible
	h := NewServer(s).Handler()

	q := requestQuote(t, h, "buy", "ast_usdc", 1_000_00)
	rec := execBuy(h, q.ID, "idem-ok")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	var o domain.Order
	if err := json.Unmarshal(rec.Body.Bytes(), &o); err != nil {
		t.Fatalf("decode order: %v", err)
	}
	if o.Status != "Filled" {
		t.Errorf("order status = %q, want Filled", o.Status)
	}
}

// ── Quote integrity ───────────────────────────────────────────────────────────

func TestBuyHappyPathConsumesQuote(t *testing.T) {
	s := store.New()
	h := NewServer(s).Handler()

	q := requestQuote(t, h, "buy", "ast_usdc", 1_000_00)
	if _, ok := s.GetQuote(q.ID); !ok {
		t.Fatal("fresh quote should be retrievable")
	}
	if rec := execBuy(h, q.ID, "idem-consume"); rec.Code != http.StatusOK {
		t.Fatalf("buy status = %d (%s)", rec.Code, rec.Body.String())
	}
	// After execution the quote is consumed and no longer retrievable.
	if _, ok := s.GetQuote(q.ID); ok {
		t.Error("quote should be consumed after a successful execution")
	}
}

func TestBuyRejectsConsumedQuote(t *testing.T) {
	s := store.New()
	h := NewServer(s).Handler()

	q := requestQuote(t, h, "buy", "ast_usdc", 1_000_00)
	// First execution consumes the quote (distinct idempotency key).
	if rec := execBuy(h, q.ID, "idem-first"); rec.Code != http.StatusOK {
		t.Fatalf("first buy status = %d (%s)", rec.Code, rec.Body.String())
	}
	// Re-submitting the SAME quote id under a NEW idempotency key must be rejected
	// (the quote is single-use; this is not an idempotent replay).
	rec := execBuy(h, q.ID, "idem-second")
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422 (%s)", rec.Code, rec.Body.String())
	}
	if typ := errType(rec); typ != "quote_expired" {
		t.Errorf("type = %q, want quote_expired", typ)
	}
}

func TestBuyRejectsExpiredQuote(t *testing.T) {
	s := store.New()
	h := NewServer(s).Handler()

	// Persist a quote that is already expired.
	usdc, _ := s.Asset("ast_usdc")
	q := engine.BuildQuote(usdc, "buy", "fiat", 1_000_00, "NGN", true)
	q.ExpiresAt = "2000-01-01T00:00:00Z"
	s.PutQuote(q)

	rec := execBuy(h, q.ID, "idem-expired")
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422 (%s)", rec.Code, rec.Body.String())
	}
	if typ := errType(rec); typ != "quote_expired" {
		t.Errorf("type = %q, want quote_expired", typ)
	}
}

func TestBuyRejectsUnknownQuote(t *testing.T) {
	s := store.New()
	h := NewServer(s).Handler()

	rec := execBuy(h, "cq_does_not_exist", "idem-unknown")
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422 (%s)", rec.Code, rec.Body.String())
	}
	if typ := errType(rec); typ != "quote_expired" {
		t.Errorf("type = %q, want quote_expired", typ)
	}
}

func TestBuyRejectsMissingQuoteID(t *testing.T) {
	s := store.New()
	h := NewServer(s).Handler()

	body, _ := json.Marshal(map[string]string{})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/crypto/buy", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", "idem-missing")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (%s)", rec.Code, rec.Body.String())
	}
}

// errType extracts the `type` field from an error envelope recorder body.
func errType(rec *httptest.ResponseRecorder) string {
	var body map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	if v, ok := body["type"].(string); ok {
		return v
	}
	return ""
}
