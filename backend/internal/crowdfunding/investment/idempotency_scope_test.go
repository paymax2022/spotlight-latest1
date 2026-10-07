package investment

// Tests for the caller-scoped idempotency replay fix (issue #500 class).
// Subscribe's replay lookup used to match on idempotency_key ALONE: a caller
// reusing a key another member already used got that member's investment
// certificate — offer, amount, units — replayed back. The lookup is now
// scoped to user_id, and the unique-constraint collision on insert maps to
// ErrIdempotencyKeyConflict → 409 "idempotency_key_conflict", mirroring
// finance/transfers (the wave-6 M16 pattern).

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestWriteSubscribeErr_IdempotencyKeyConflictIs409WithCode(t *testing.T) {
	gin.SetMode(gin.TestMode)
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/finance/crowdfunding/investment/subscribe", nil)

	writeSubscribeErr(c, fmt.Errorf("service layer: %w", ErrIdempotencyKeyConflict))

	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409; body %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"code":"idempotency_key_conflict"`) {
		t.Fatalf("body must carry the stable code idempotency_key_conflict, got %s", rec.Body.String())
	}
}

// The errMap fallthrough for other sentinels must be preserved — the explicit
// conflict branch handles only ErrIdempotencyKeyConflict.
func TestWriteSubscribeErr_BusinessSentinelsKeep422(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, sentinel := range []error{ErrNotOnboarded, ErrAnnualLimit, ErrBelowMinTicket, ErrOfferClosed, ErrAgreement} {
		rec := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(rec)
		c.Request = httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/x", nil)
		writeSubscribeErr(c, sentinel)
		if rec.Code != http.StatusUnprocessableEntity {
			t.Fatalf("%v → status %d, want 422", sentinel, rec.Code)
		}
	}
}
