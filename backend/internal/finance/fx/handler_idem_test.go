package fx_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/finance/fx"
)

// AUD-BE-011: ConvertRequest required `idempotency_key` in the body and never
// read the Idempotency-Key header at all — the documented header contract
// 400'd before the service ran. Pin: header-only accepted, no key 400s.
// Nil service on purpose: reaching the service is the signal; a bind
// rejection answers 400 first.

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
