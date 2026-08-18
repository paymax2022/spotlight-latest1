package restaurant

// LIVE-DB tests for the capability ↔ KYB bridge (foodhub A17).
//
// Spotlight answers two different questions with two unconnected systems:
//   • onb_application  — "may this PERSON be a restaurant merchant?" (capability)
//   • restaurant_kyb   — "may this OUTLET be paid?"  (payout gate, PY-007)
//
// Nothing joined them, and the consequence is measurable: 1059 of 1075 outlets
// have no KYB row at all, and 709 are actively trading while not KYB-approved.
// payout.go builds runs with `AND res.kyb_status = 'approved'`, so those outlets
// take orders, settle into provider_kobo, and are then skipped by every payout
// run — silently. No banner, no admin queue entry, nothing.
//
// The bridge does not merge the systems (KYB is per OUTLET, capability is per
// PERSON — an owner's second outlet can have different banking). It reports the
// join: per outlet, can it be paid, why not, and how much is already stuck.
//
// The readiness rule MUST mirror the payout query exactly. If it drifts, the app
// tells owners something the payout engine does not honour.
//
// Skips unless TEST_DATABASE_URL is set.

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func readinessPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping payout-readiness live-DB tests")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	return pool
}

type readinessFixture struct {
	svc            *Service
	pool           *pgxpool.Pool
	owner, other   string
	approved       string // KYB approved  → payable
	pending        string // KYB submitted → not payable
	noKyb          string // no KYB row    → not payable (the 1059 case)
	rival          string // someone else's
}

func newReadinessFixture(t *testing.T, ctx context.Context, pool *pgxpool.Pool) readinessFixture {
	t.Helper()
	f := readinessFixture{
		svc: NewService(pool, nil), pool: pool,
		owner: uuid.New().String(), other: uuid.New().String(),
		approved: uuid.New().String(), pending: uuid.New().String(),
		noKyb: uuid.New().String(), rival: uuid.New().String(),
	}
	for _, u := range []string{f.owner, f.other} {
		if _, err := pool.Exec(ctx,
			`INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test"); err != nil {
			t.Fatalf("seed user: %v", err)
		}
	}
	rows := []struct {
		id, owner, name, kyb string
	}{
		{f.approved, f.owner, "RDY Approved", "approved"},
		{f.pending, f.owner, "RDY Pending", "submitted"},
		{f.noKyb, f.owner, "RDY NoKyb", ""},
		{f.rival, f.other, "RDY Rival", "approved"},
	}
	for _, r := range rows {
		if r.kyb == "" {
			if _, err := pool.Exec(ctx,
				`INSERT INTO restaurants (id, owner_id, name, address, is_open) VALUES ($1,$2,$3,'1 St',TRUE)`,
				r.id, r.owner, r.name); err != nil {
				t.Fatalf("seed restaurant: %v", err)
			}
			continue
		}
		if _, err := pool.Exec(ctx,
			`INSERT INTO restaurants (id, owner_id, name, address, is_open, kyb_status) VALUES ($1,$2,$3,'1 St',TRUE,$4)`,
			r.id, r.owner, r.name, r.kyb); err != nil {
			t.Fatalf("seed restaurant: %v", err)
		}
	}
	t.Cleanup(func() {
		bg := context.Background()
		pool.Exec(bg, `DELETE FROM restaurants WHERE id IN ($1,$2,$3,$4)`, f.approved, f.pending, f.noKyb, f.rival)
	})
	return f
}

func TestLiveDB_ReadinessMirrorsThePayoutGate(t *testing.T) {
	pool := readinessPool(t)
	t.Cleanup(func() { pool.Close() })
	ctx := context.Background()
	f := newReadinessFixture(t, ctx, pool)

	got, err := f.svc.PayoutReadinessForOwner(ctx, f.owner)
	if err != nil {
		t.Fatalf("PayoutReadinessForOwner: %v", err)
	}
	by := map[string]OutletPayoutReadiness{}
	for _, r := range got {
		by[r.RestaurantID] = r
	}

	// The payout query pays only `kyb_status = 'approved'`. Anything else — including
	// a missing KYB row entirely — must report NOT payable, or the app promises money
	// the payout engine will not release.
	if !by[f.approved].Payable {
		t.Error("an approved outlet must be payable")
	}
	if by[f.pending].Payable {
		t.Error("a submitted-but-undecided KYB must NOT be payable — payout.go requires 'approved'")
	}
	if by[f.noKyb].Payable {
		t.Error("an outlet with NO KYB row must NOT be payable (this is 1059 of 1075 outlets)")
	}
}

func TestLiveDB_ReadinessExplainsWhyAnOutletCannotBePaid(t *testing.T) {
	pool := readinessPool(t)
	t.Cleanup(func() { pool.Close() })
	ctx := context.Background()
	f := newReadinessFixture(t, ctx, pool)

	got, err := f.svc.PayoutReadinessForOwner(ctx, f.owner)
	if err != nil {
		t.Fatalf("PayoutReadinessForOwner: %v", err)
	}
	for _, r := range got {
		if r.Payable {
			continue
		}
		// The whole point of the bridge: an owner who cannot be paid must be told
		// what to do about it. A blocked outlet with no reason is the status quo.
		if r.Reason == "" {
			t.Errorf("outlet %s is not payable but gives no reason", r.Name)
		}
	}
	// And the never-started case is distinguishable from the in-review case, since
	// they need different actions from the owner.
	by := map[string]OutletPayoutReadiness{}
	for _, r := range got {
		by[r.RestaurantID] = r
	}
	if by[f.noKyb].KYBStatus != KYBStatusNone {
		t.Errorf("no-KYB outlet reports %q, want %q", by[f.noKyb].KYBStatus, KYBStatusNone)
	}
	if by[f.noKyb].Reason == by[f.pending].Reason {
		t.Error("‘never submitted’ and ‘awaiting review’ must not read the same — the owner's next action differs")
	}
}

func TestLiveDB_ReadinessIsScopedToTheOwner(t *testing.T) {
	pool := readinessPool(t)
	t.Cleanup(func() { pool.Close() })
	ctx := context.Background()
	f := newReadinessFixture(t, ctx, pool)

	got, err := f.svc.PayoutReadinessForOwner(ctx, f.owner)
	if err != nil {
		t.Fatalf("PayoutReadinessForOwner: %v", err)
	}
	for _, r := range got {
		if r.RestaurantID == f.rival {
			t.Fatal("another owner's outlet appeared — banking/KYB state is commercially sensitive")
		}
	}
	if len(got) != 3 {
		t.Errorf("got %d outlets, want the owner's 3", len(got))
	}

	none, err := f.svc.PayoutReadinessForOwner(ctx, uuid.New().String())
	if err != nil {
		t.Fatalf("PayoutReadinessForOwner(stranger): %v", err)
	}
	if len(none) != 0 {
		t.Errorf("a non-owner saw %d outlets, want 0", len(none))
	}
}

func TestLiveDB_ReadinessReportsMoneyAlreadyStuck(t *testing.T) {
	pool := readinessPool(t)
	t.Cleanup(func() { pool.Close() })
	ctx := context.Background()
	f := newReadinessFixture(t, ctx, pool)

	got, err := f.svc.PayoutReadinessForOwner(ctx, f.owner)
	if err != nil {
		t.Fatalf("PayoutReadinessForOwner: %v", err)
	}
	for _, r := range got {
		// Never negative, and always integer kobo — this is money, and it is the
		// number that makes the banner worth acting on.
		if r.UnpaidKobo < 0 {
			t.Errorf("outlet %s reports negative stuck earnings %d", r.Name, r.UnpaidKobo)
		}
	}
}
