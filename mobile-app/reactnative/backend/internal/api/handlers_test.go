package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"paymax/crypto-backend/internal/domain"
	"paymax/crypto-backend/internal/store"
)

func TestAssetsEndpoint(t *testing.T) {
	h := NewServer(store.New()).Handler()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/crypto/assets", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var assets []domain.Asset
	if err := json.Unmarshal(rec.Body.Bytes(), &assets); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(assets) != 6 {
		t.Errorf("assets = %d, want 6", len(assets))
	}
}

func TestBuyIsIdempotent(t *testing.T) {
	s := store.New()
	h := NewServer(s).Handler()

	// Execution runs strictly against a persisted quote id; request one first.
	q := requestQuote(t, h, "buy", "ast_usdc", 1_000_00)
	body, _ := json.Marshal(map[string]string{"quoteId": q.ID})

	buy := func() domain.Order {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/crypto/buy", bytes.NewReader(body))
		req.Header.Set("Idempotency-Key", "test-idem-1")
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("buy status = %d (%s)", rec.Code, rec.Body.String())
		}
		var o domain.Order
		if err := json.Unmarshal(rec.Body.Bytes(), &o); err != nil {
			t.Fatalf("decode order: %v", err)
		}
		return o
	}

	investBefore := s.Portfolio().InvestableBalance.Amount
	first := buy()
	investAfterFirst := s.Portfolio().InvestableBalance.Amount
	second := buy() // same Idempotency-Key → must replay, not re-execute
	investAfterSecond := s.Portfolio().InvestableBalance.Amount

	if first.Reference != second.Reference {
		t.Errorf("idempotency broken: %q vs %q", first.Reference, second.Reference)
	}
	if investAfterFirst == investBefore {
		t.Error("first buy did not debit cash")
	}
	if investAfterSecond != investAfterFirst {
		t.Errorf("replay re-executed: cash moved from %d to %d", investAfterFirst, investAfterSecond)
	}
}
