package loyalty

// Pure idempotency-contract tests for the loyalty redeem handlers + services —
// no live DB. The key guard runs before any repository access, so nil deps
// prove the boundary is fail-closed (a missing key must never reach the store,
// and must never self-mint one like the retired redeem:<uuid> fallback did).

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/points"
)

// Service.Redeem rejects a missing client key before any DB access (nil pool
// would panic if the guard ran late).
func TestRedeem_RequiresIdempotencyKey(t *testing.T) {
	s := NewService(nil, nil, nil)
	if _, err := s.Redeem(context.Background(), "user-1", "SKU", ""); !errors.Is(err, points.ErrIdempotencyRequired) {
		t.Fatalf("keyless redeem: err = %v, want points.ErrIdempotencyRequired", err)
	}
}

// BlackService.RedeemPerk rejects a missing client key before any DB access
// (nil base would panic if the replay check ran first).
func TestRedeemPerk_RequiresIdempotencyKey(t *testing.T) {
	s := NewBlackService(nil, nil)
	if _, err := s.RedeemPerk(context.Background(), "user-1", "PERK", "evt-1", ""); !errors.Is(err, points.ErrIdempotencyRequired) {
		t.Fatalf("keyless perk redeem: err = %v, want points.ErrIdempotencyRequired", err)
	}
}

func newRedeemContext(w *httptest.ResponseRecorder, path, body string) *gin.Context {
	c, _ := gin.CreateTestContext(w)
	c.Set("user_id", "user-1")
	c.Request = httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	return c
}

// The member redeem handler writes 400 when the Idempotency-Key header is
// absent — the svc is nil and must never be reached.
func TestRedeemHandler_RequiresIdempotencyKeyHeader(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	NewHandler(nil).Redeem(newRedeemContext(w, "/api/finance/loyalty/redeem", `{"sku":"AIRTIME_500"}`))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("headerless redeem: status = %d, want 400 (body %s)", w.Code, w.Body.String())
	}
}

// Same contract on the Black perk redeem handler.
func TestBlackRedeemHandler_RequiresIdempotencyKeyHeader(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	NewBlackHandler(nil).Redeem(newRedeemContext(w, "/api/finance/loyalty/black/redeem", `{"perk_code":"LOUNGE","context_ref":"evt-1"}`))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("headerless perk redeem: status = %d, want 400 (body %s)", w.Code, w.Body.String())
	}
}
