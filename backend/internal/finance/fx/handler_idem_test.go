package fx_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/finance/fx"
)

// AUD-BE-011: pin the header contract — a header-only Idempotency-Key is
// accepted and a missing key 400s. Nil service on purpose: reaching the
// service is the signal; a bind rejection answers 400 first.

func engine() *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(func(c *gin.Context) {
		c.Set("user_id", "u-1")
		c.Next()
	})
	r.POST("/convert", fx.NewHandler(nil).Convert)
	return r
}

func TestConvert_HeaderOnlyIdemKey_IsAccepted(t *testing.T) {
	w := httptest.NewRecorder()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/convert", strings.NewReader(`{"quote_id":"q-1"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", "idem-hdr-fx")
	engine().ServeHTTP(w, req)
	if w.Code == http.StatusBadRequest && strings.Contains(w.Body.String(), "IdempotencyKey") {
		t.Fatalf("header-only Idempotency-Key rejected at binding: %d %s", w.Code, w.Body.String())
	}
}

func TestConvert_NoIdemKey_400s(t *testing.T) {
	w := httptest.NewRecorder()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/convert", strings.NewReader(`{"quote_id":"q-1"}`))
	req.Header.Set("Content-Type", "application/json")
	engine().ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 without any idempotency key, got %d %s", w.Code, w.Body.String())
	}
}

// Sweep-2: GET /wallets/:currency must reject a non-ISO currency code with 400
// BEFORE the wallet upsert — 'ZZZ9' previously hit the CHECK constraint → 500
// and 'ngn' wrote a lowercase twin row. Nil service on purpose: reaching the
// validation (which precedes any Service field access) is the signal.
func TestGetWallet_InvalidCurrency_400s(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", "u-1")
		c.Next()
	})
	r.GET("/wallets/:currency", fx.NewHandler(nil).GetWallet)

	for _, bad := range []string{"ZZZ9", "n", "NGNA", "12$"} {
		w := httptest.NewRecorder()
		req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/wallets/"+bad, nil)
		r.ServeHTTP(w, req)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("currency %q: expected 400, got %d %s", bad, w.Code, w.Body.String())
		}
	}
}
