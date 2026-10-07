package crowdfunding

// Tests for the caller-scoped idempotency replay fix (issue #500 class).
// Contribute's replay lookup used to match on idempotency_key ALONE: a caller
// reusing a key another member already used got that member's contribution —
// campaign, amount, settlement id — replayed back. The lookup is now scoped
// to contributor_id, and the unique-constraint collision on insert (or a
// foreign ledger-leg key surfacing as ledger.ErrDuplicate from escrow) maps
// to ErrIdempotencyKeyConflict → 409 "idempotency_key_conflict", mirroring
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

func TestWriteContributeErr_IdempotencyKeyConflictIs409WithCode(t *testing.T) {
	gin.SetMode(gin.TestMode)
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/finance/crowdfunding/campaigns/x/contribute", nil)

	writeContributeErr(c, fmt.Errorf("service layer: %w", ErrIdempotencyKeyConflict))

	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409; body %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"code":"idempotency_key_conflict"`) {
		t.Fatalf("body must carry the stable code idempotency_key_conflict, got %s", rec.Body.String())
	}
}

// The campaign-state sentinels must still land on their own contract — the
// conflict sentinel must not have been folded into the generic 409 branch in
// a way that drops its stable code.
func TestWriteContributeErr_CampaignStatesStillConflictSansCode(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, sentinel := range []error{ErrCampaignPaused, ErrCampaignNotAccepting, ErrCampaignNotReviewed, ErrCampaignDeadline} {
		rec := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(rec)
		c.Request = httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/x", nil)
		writeContributeErr(c, sentinel)
		if rec.Code != http.StatusConflict {
			t.Fatalf("%v → status %d, want 409", sentinel, rec.Code)
		}
		if strings.Contains(rec.Body.String(), `"code"`) {
			t.Fatalf("%v must not carry a machine code (that's the idempotency contract): %s", sentinel, rec.Body.String())
		}
	}
}
