package restaurant

// ---------------------------------------------------------------------------
// LIVE-DB integration test for FOOD-010: KYB review was entirely optional.
//
// SetAvailability's own doc comment claimed "eligibility/KYC gating is handled
// upstream by the merchant-onboarding engine" — that gate did not exist
// anywhere. An owner could call SetAvailability(isOpen=true) regardless of
// kyb_status, and PlaceOrder only ever checked is_open, never kyb_status — so
// a restaurant could take real paying customers with zero admin review ever
// happening. Separately, AdminListApplications derived its displayed status
// purely from is_open, so a restaurant an owner self-opened looked identical
// to a genuinely admin-approved one in the review queue, and the frontend's
// in_review/rejected filters never matched anything since the backend never
// emitted those values.
//
// Skipped unless TEST_DATABASE_URL is set.
// ---------------------------------------------------------------------------

import (
	"context"
	"errors"
	"testing"

	goredis "github.com/redis/go-redis/v9"

	"github.com/google/uuid"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/settlement"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/testsupport"
)

func TestLiveDB_SetAvailability_RequiresApprovedKYBToOpen(t *testing.T) {
	pool := processRunPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	svc := NewService(pool, settlement.NewService(pool, led)).WithLedger(led).WithTiers(tiers.NewService(pool))

	owner := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, owner, owner+"@seed.test"); err != nil {
		t.Fatalf("seed owner: %v", err)
	}
	testsupport.CleanupUser(t, pool, owner)

	// (a) No KYB row at all — the common case for a brand-new restaurant.
	restID := uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO restaurants (id, owner_id, name, address, is_open) VALUES ($1,$2,'Gate Kitchen','1 St',FALSE)`,
		restID, owner); err != nil {
		t.Fatalf("seed restaurant: %v", err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM restaurants WHERE id=$1`, restID) })

	if _, err := svc.SetAvailability(ctx, restID, owner, true); !errors.Is(err, ErrKYBNotApproved) {
		t.Fatalf("open with no KYB row: want ErrKYBNotApproved, got %v", err)
	}
	var isOpen bool
	if err := pool.QueryRow(ctx, `SELECT is_open FROM restaurants WHERE id=$1`, restID).Scan(&isOpen); err != nil {
		t.Fatalf("reload restaurant: %v", err)
	}
	if isOpen {
		t.Fatal("is_open flipped to true despite the refused gate — the DB write must not have happened")
	}

	// (b) A KYB row exists but is only 'submitted' (not yet reviewed) — still refused.
	if _, err := pool.Exec(ctx,
		`INSERT INTO restaurant_kyb (restaurant_id, status, legal_name, business_type, bank_code, account_number, account_name)
		 VALUES ($1,'submitted','Gate Kitchen Ltd','sole_proprietor','058','0123456789','Gate Kitchen')`,
		restID); err != nil {
		t.Fatalf("seed kyb row: %v", err)
	}
	if _, err := svc.SetAvailability(ctx, restID, owner, true); !errors.Is(err, ErrKYBNotApproved) {
		t.Fatalf("open with submitted-but-unreviewed KYB: want ErrKYBNotApproved, got %v", err)
	}

	// (c) Admin approves via the real onboarding decision — NOW opening must succeed.
	if err := svc.AdminDecideApplication(ctx, restID, uuid.New().String(), "approve", ""); err != nil {
		t.Fatalf("admin approve: %v", err)
	}
	if _, err := svc.SetAvailability(ctx, restID, owner, true); err != nil {
		t.Fatalf("open after real approval: want success, got %v", err)
	}
	if err := pool.QueryRow(ctx, `SELECT is_open FROM restaurants WHERE id=$1`, restID).Scan(&isOpen); err != nil {
		t.Fatalf("reload restaurant: %v", err)
	}
	if !isOpen {
		t.Fatal("is_open still false after a successful open following approval")
	}

	// (d) Closing is ALWAYS allowed, regardless of KYB state — a restaurant must
	// always be able to stop taking orders.
	if _, err := svc.SetAvailability(ctx, restID, owner, false); err != nil {
		t.Fatalf("close: want success (always allowed), got %v", err)
	}
}

func TestLiveDB_AdminListApplications_StatusReflectsRealKYBState(t *testing.T) {
	pool := processRunPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	svc := NewService(pool, settlement.NewService(pool, led)).WithLedger(led).WithTiers(tiers.NewService(pool))

	owner := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, owner, owner+"@seed.test"); err != nil {
		t.Fatalf("seed owner: %v", err)
	}
	testsupport.CleanupUser(t, pool, owner)

	mk := func(status *string) string {
		id := uuid.New().String()
		if _, err := pool.Exec(ctx,
			`INSERT INTO restaurants (id, owner_id, name, address, is_open, kyb_status) VALUES ($1,$2,$3,'1 St',FALSE,$4)`,
			id, owner, "Gate-"+id, status); err != nil {
			t.Fatalf("seed restaurant: %v", err)
		}
		t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM restaurants WHERE id=$1`, id) })
		return id
	}

	noRow := mk(nil)
	underReview := mk(strPtr("under_review"))
	approved := mk(strPtr("approved"))
	rejected := mk(strPtr("rejected"))

	apps, err := svc.AdminListApplications(ctx, "")
	if err != nil {
		t.Fatalf("AdminListApplications: %v", err)
	}
	statusByID := map[string]string{}
	for _, a := range apps {
		statusByID[a.ID] = a.Status
	}
	cases := map[string]string{
		noRow:       "pending",
		underReview: "in_review",
		approved:    "approved",
		rejected:    "rejected",
	}
	for id, want := range cases {
		if got := statusByID[id]; got != want {
			t.Errorf("restaurant %s: status = %q, want %q", id, got, want)
		}
	}

	// The status filter must actually match these real values now (previously
	// "in_review"/"rejected" never matched anything since the backend never
	// emitted them).
	inReviewOnly, err := svc.AdminListApplications(ctx, "in_review")
	if err != nil {
		t.Fatalf("AdminListApplications(in_review): %v", err)
	}
	found := false
	for _, a := range inReviewOnly {
		if a.ID == underReview {
			found = true
		}
		if a.Status != "in_review" {
			t.Errorf("filter=in_review returned a %s row", a.Status)
		}
	}
	if !found {
		t.Error("filter=in_review did not return the under_review restaurant")
	}
}

func strPtr(s string) *string { return &s }
