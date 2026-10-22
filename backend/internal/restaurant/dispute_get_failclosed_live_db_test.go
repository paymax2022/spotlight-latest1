package restaurant

// LIVE-DB regression for FOOD-UAT-F-010: GetFoodDispute swallowed any order-lookup
// error and skipped the party check, returning the dispute to any caller.
// Skipped unless TEST_DATABASE_URL is set.

import (
	"context"
	"errors"
	"net/http"
	"testing"

	"github.com/google/uuid"

	"spotlight/backend/internal/testsupport"
)

func TestLiveDB_GetFoodDispute_FailsClosedOnOrderLookupError(t *testing.T) {
	pool := withdrawalPool(t)
	defer pool.Close()
	ctx := t.Context()
	svc := NewService(pool, nil)

	reporter := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, reporter, reporter+"@seed.test"); err != nil {
		t.Fatalf("seed reporter: %v", err)
	}
	testsupport.CleanupUser(t, pool, reporter)

	seed := func(reference string) string {
		id := uuid.New().String()
		if _, err := pool.Exec(ctx,
			`INSERT INTO disputes (id, user_id, reference, module_type, type, description) VALUES ($1,$2,$3,'food','other','probe')`,
			id, reporter, reference); err != nil {
			t.Fatalf("seed dispute: %v", err)
		}
		t.Cleanup(func() { _, _ = pool.Exec(context.WithoutCancel(t.Context()), `DELETE FROM disputes WHERE id=$1`, id) })
		return id
	}
	stranger := uuid.New().String()

	// Order lookup errors (reference is not a uuid -> the orders.id cast fails):
	// must be an internal error, never the dispute.
	d, err := svc.GetFoodDispute(ctx, seed("not-a-uuid"), stranger)
	if d != nil || !errors.Is(err, ErrDisputeLookup) {
		t.Fatalf("broken lookup: want nil + ErrDisputeLookup, got %+v / %v", d, err)
	}
	if got := disputeErrCode(err); got != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", got)
	}

	// Orphan dispute (valid uuid, no such order): clean not-found, no leak.
	d, err = svc.GetFoodDispute(ctx, seed(uuid.New().String()), stranger)
	if d != nil || !errors.Is(err, ErrDisputeInvalid) {
		t.Fatalf("orphan dispute: want nil + ErrDisputeInvalid, got %+v / %v", d, err)
	}
}
