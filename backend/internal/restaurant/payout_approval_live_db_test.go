package restaurant

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"spotlight/backend/internal/finance/settlement"
)

// FOOD-UAT-G-011: maker-checker gate on payout processing.
func TestLiveDB_PayoutApproval_TwoPersonGate(t *testing.T) {
	pool := tierPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	svc := NewService(pool, settlement.NewService(pool, nil))

	runID := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO restaurant_payout_runs (id, period_key, provider_type, provider_id, idempotency_key)
	  VALUES ($1,$2,'restaurant',$3,$4)`, runID, "t-"+runID[:8], uuid.New().String(), "payout-"+runID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM restaurant_payout_approvals WHERE payout_run_id=$1`, runID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM restaurant_payout_runs WHERE id=$1`, runID)
	})
	maker, endorser, checker := uuid.New().String(), uuid.New().String(), uuid.New().String()

	// approve/endorse before request -> refused
	if err := svc.RecordPayoutApproval(ctx, runID, checker, PayoutStepApproved, ""); !errors.Is(err, ErrPayoutNotRequested) {
		t.Fatalf("approve before request: %v", err)
	}
	if err := svc.RecordPayoutApproval(ctx, runID, maker, PayoutStepRequested, "june"); err != nil {
		t.Fatal(err)
	}
	if err := svc.RecordPayoutApproval(ctx, runID, maker, PayoutStepRequested, ""); !errors.Is(err, ErrPayoutStepRecorded) {
		t.Fatalf("duplicate request: %v", err)
	}
	// maker cannot endorse or approve their own request
	if err := svc.RecordPayoutApproval(ctx, runID, maker, PayoutStepEndorsed, ""); !errors.Is(err, ErrPayoutSameActor) {
		t.Fatalf("self-endorse: %v", err)
	}
	if err := svc.RecordPayoutApproval(ctx, runID, maker, PayoutStepApproved, ""); !errors.Is(err, ErrPayoutSameActor) {
		t.Fatalf("self-approve: %v", err)
	}
	if ok, _ := svc.PayoutApproved(ctx, runID); ok {
		t.Fatal("must not be approved yet")
	}
	// endorser cannot then approve
	if err := svc.RecordPayoutApproval(ctx, runID, endorser, PayoutStepEndorsed, ""); err != nil {
		t.Fatal(err)
	}
	if err := svc.RecordPayoutApproval(ctx, runID, endorser, PayoutStepApproved, ""); !errors.Is(err, ErrPayoutSameActor) {
		t.Fatalf("endorser-approve: %v", err)
	}

	// middleware blocks /process until approved by a distinct user
	h := NewHandler(svc)
	gin.SetMode(gin.TestMode)
	reached := false
	r := gin.New()
	r.POST("/payouts/:id/process", h.RequirePayoutApproved(), func(c *gin.Context) { reached = true; c.Status(http.StatusOK) })
	do := func() int {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/payouts/"+runID+"/process", nil))
		return w.Code
	}
	if code := do(); code != http.StatusForbidden || reached {
		t.Fatalf("pre-approval process: code=%d reached=%v", code, reached)
	}
	if err := svc.RecordPayoutApproval(ctx, runID, checker, PayoutStepApproved, "ok"); err != nil {
		t.Fatal(err)
	}
	if code := do(); code != http.StatusOK || !reached {
		t.Fatalf("post-approval process: code=%d reached=%v", code, reached)
	}
	// forged approval by the maker (direct SQL) still does not unlock a fresh run
	run2 := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO restaurant_payout_runs (id, period_key, provider_type, provider_id, idempotency_key)
	  VALUES ($1,$2,'rider',$3,$4)`, run2, "t-"+run2[:8], uuid.New().String(), "payout-"+run2); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM restaurant_payout_approvals WHERE payout_run_id=$1`, run2)
		_, _ = pool.Exec(context.Background(), `DELETE FROM restaurant_payout_runs WHERE id=$1`, run2)
	})
	_, _ = pool.Exec(ctx, `INSERT INTO restaurant_payout_approvals (payout_run_id, step, actor_user_id) VALUES ($1,'requested',$2),($1,'approved',$2)`, run2, maker)
	if ok, _ := svc.PayoutApproved(ctx, run2); ok {
		t.Fatal("same-actor forged approval must not count")
	}
}
