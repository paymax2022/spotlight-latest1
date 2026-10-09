package wallet

// Tests for the caller-scoped idempotency replay fix (issue #500 class).
// SubmitWithdrawal's replay lookup used to match on idempotency_key ALONE: a
// caller reusing a key another member already used got that member's
// withdrawal — reference, amount, bank label — replayed back. The lookup is
// now scoped to creator_id, and the unique-constraint collision on insert
// maps to ErrIdempotencyKeyConflict → 409 "idempotency_key_conflict",
// mirroring finance/transfers (the wave-6 M16 pattern).

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestWriteWithdrawalErr_IdempotencyKeyConflictIs409WithCode(t *testing.T) {
	gin.SetMode(gin.TestMode)
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/finance/crowdfunding/campaigns/x/withdrawal-request", nil)

	writeWithdrawalErr(c, fmt.Errorf("service layer: %w", ErrIdempotencyKeyConflict))

	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409; body %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"code":"idempotency_key_conflict"`) {
		t.Fatalf("body must carry the stable code idempotency_key_conflict, got %s", rec.Body.String())
	}
}

// Unmapped business errors keep the pre-existing 400 default — the new 409
// branch must not have widened the conflict surface.
func TestWriteWithdrawalErr_GenericErrorStill400(t *testing.T) {
	gin.SetMode(gin.TestMode)
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/x", nil)

	writeWithdrawalErr(c, fmt.Errorf("crowdfunding/wallet: amount must be at least 100 kobo"))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 for a plain validation refusal", rec.Code)
	}
}
