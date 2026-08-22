package restaurant

// LIVE-DB tests for per-outlet staff resolution (foodhub A18).
//
// The property that matters most is NOT that staff work — it is that owners are
// unaffected. Every owner-side guard in this package is assertOwner today; the
// resolver replaces it, and if it disagrees for even one owner, a working
// restaurant loses control of its own shop.
//
// The second property is per-outlet isolation: a manager at one branch must have
// no authority at another. That is the whole reason authority moved off
// restaurants.owner_id.
//
// Skips unless TEST_DATABASE_URL is set.

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func staffPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping staff resolution live-DB tests")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	return pool
}

type staffFixture struct {
	svc              *Service
	pool             *pgxpool.Pool
	owner            string
	manager          string
	stranger         string
	lekki, ikeja     string // two outlets, same owner
}

func newStaffFixture(t *testing.T, ctx context.Context, pool *pgxpool.Pool) staffFixture {
	t.Helper()
	f := staffFixture{
		svc: NewService(pool, nil), pool: pool,
		owner: uuid.New().String(), manager: uuid.New().String(), stranger: uuid.New().String(),
		lekki: uuid.New().String(), ikeja: uuid.New().String(),
	}
	for _, u := range []string{f.owner, f.manager, f.stranger} {
		if _, err := pool.Exec(ctx,
			`INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test"); err != nil {
			t.Fatalf("seed user: %v", err)
		}
	}
	for _, r := range []struct{ id, name string }{{f.lekki, "STF Lekki"}, {f.ikeja, "STF Ikeja"}} {
		if _, err := pool.Exec(ctx,
			`INSERT INTO restaurants (id, owner_id, name, address, is_open) VALUES ($1,$2,$3,'1 St',TRUE)`,
			r.id, f.owner, r.name); err != nil {
			t.Fatalf("seed restaurant: %v", err)
		}
		// Mirrors what the migration backfills for every existing owner.
		if _, err := pool.Exec(ctx,
			`INSERT INTO restaurant_staff (restaurant_id,user_id,role,status,accepted_at)
			 VALUES ($1,$2,'OWNER','ACTIVE',now()) ON CONFLICT DO NOTHING`, r.id, f.owner); err != nil {
			t.Fatalf("seed owner grant: %v", err)
		}
	}
	// A manager at Lekki ONLY.
	if _, err := pool.Exec(ctx,
		`INSERT INTO restaurant_staff (restaurant_id,user_id,role,status,accepted_at)
		 VALUES ($1,$2,'MANAGER','ACTIVE',now())`, f.lekki, f.manager); err != nil {
		t.Fatalf("seed manager: %v", err)
	}
	t.Cleanup(func() {
		bg := context.Background()
		pool.Exec(bg, `DELETE FROM restaurant_staff WHERE restaurant_id IN ($1,$2)`, f.lekki, f.ikeja)
		pool.Exec(bg, `DELETE FROM restaurants WHERE id IN ($1,$2)`, f.lekki, f.ikeja)
	})
	return f
}

func TestLiveDB_OwnerKeepsFullControl(t *testing.T) {
	pool := staffPool(t)
	t.Cleanup(func() { pool.Close() })
	ctx := context.Background()
	f := newStaffFixture(t, ctx, pool)

	// The regression that would matter most: an owner losing their own shop.
	for _, p := range allPermissions() {
		if err := f.svc.AssertStaffPermission(ctx, f.lekki, f.owner, p); err != nil {
			t.Errorf("owner denied %q at their own outlet: %v", p, err)
		}
	}
}

func TestLiveDB_StaffAuthorityIsPerOutlet(t *testing.T) {
	pool := staffPool(t)
	t.Cleanup(func() { pool.Close() })
	ctx := context.Background()
	f := newStaffFixture(t, ctx, pool)

	// Granted at Lekki…
	if err := f.svc.AssertStaffPermission(ctx, f.lekki, f.manager, PermManageMenu); err != nil {
		t.Errorf("manager denied the menu at their own outlet: %v", err)
	}
	// …and nothing at Ikeja, which is the point of moving authority off owner_id.
	if err := f.svc.AssertStaffPermission(ctx, f.ikeja, f.manager, PermManageMenu); err == nil {
		t.Error("a Lekki manager could edit the Ikeja menu — authority must follow the outlet")
	}
	if err := f.svc.AssertStaffPermission(ctx, f.ikeja, f.manager, PermViewOrders); err == nil {
		t.Error("a Lekki manager could read the Ikeja order queue")
	}
}

func TestLiveDB_ManagerCannotTouchBanking(t *testing.T) {
	pool := staffPool(t)
	t.Cleanup(func() { pool.Close() })
	ctx := context.Background()
	f := newStaffFixture(t, ctx, pool)

	// A manager runs the shop; they do not get to move where the money lands.
	if err := f.svc.AssertStaffPermission(ctx, f.lekki, f.manager, PermManageBanking); err == nil {
		t.Error("a manager could change banking — only the owner may")
	}
}

func TestLiveDB_StrangersGetNothing(t *testing.T) {
	pool := staffPool(t)
	t.Cleanup(func() { pool.Close() })
	ctx := context.Background()
	f := newStaffFixture(t, ctx, pool)

	for _, p := range allPermissions() {
		if err := f.svc.AssertStaffPermission(ctx, f.lekki, f.stranger, p); err == nil {
			t.Errorf("a user with no grant was allowed %q", p)
		}
	}
}

func TestLiveDB_SuspendedStaffLoseAccessImmediately(t *testing.T) {
	pool := staffPool(t)
	t.Cleanup(func() { pool.Close() })
	ctx := context.Background()
	f := newStaffFixture(t, ctx, pool)

	if _, err := pool.Exec(ctx,
		`UPDATE restaurant_staff SET status='SUSPENDED' WHERE restaurant_id=$1 AND user_id=$2`,
		f.lekki, f.manager); err != nil {
		t.Fatalf("suspend: %v", err)
	}
	// Suspension is the lever used when someone leaves or is under investigation;
	// it has to bite on the next request, not at the next login.
	if err := f.svc.AssertStaffPermission(ctx, f.lekki, f.manager, PermViewOrders); err == nil {
		t.Error("a suspended manager still had access")
	}
}

func TestLiveDB_ResolutionAgreesWithOwnerCheck(t *testing.T) {
	pool := staffPool(t)
	t.Cleanup(func() { pool.Close() })
	ctx := context.Background()
	f := newStaffFixture(t, ctx, pool)

	// The migration path: the resolver must answer exactly what assertOwner
	// answers for owners and non-owners, or swapping the guard changes behaviour
	// for every restaurant on the platform.
	for _, c := range []struct {
		user string
		want bool
		who  string
	}{
		{f.owner, true, "owner"},
		{f.stranger, false, "stranger"},
	} {
		legacyErr := f.svc.assertOwner(ctx, f.lekki, c.user)
		newErr := f.svc.AssertStaffPermission(ctx, f.lekki, c.user, PermManageMenu)
		if (legacyErr == nil) != (newErr == nil) {
			t.Errorf("%s: assertOwner allowed=%v but resolver allowed=%v", c.who, legacyErr == nil, newErr == nil)
		}
		if (legacyErr == nil) != c.want {
			t.Errorf("%s: assertOwner allowed=%v, want %v", c.who, legacyErr == nil, c.want)
		}
	}
}

// ─── The swap itself ────────────────────────────────────────────────────────
//
// The tests above exercise AssertStaffPermission directly. These go through the
// real service methods, which is the only way to prove the guard swap actually
// took effect at the call sites: a handler still calling assertOwner would pass
// every test above and still refuse every manager.

func TestLiveDB_ManagerCanRunTheirOutletThroughTheRealMethods(t *testing.T) {
	pool := staffPool(t)
	t.Cleanup(func() { pool.Close() })
	ctx := context.Background()
	f := newStaffFixture(t, ctx, pool)

	// Menu — the daily work of a branch manager.
	cat, err := f.svc.CreateCategory(ctx, f.lekki, f.manager, "Manager Specials")
	if err != nil {
		t.Fatalf("manager could not create a category at their own outlet: %v", err)
	}
	if _, err := f.svc.CreateItem(ctx, f.lekki, f.manager, CreateItemRequest{
		CategoryID: cat.ID, Name: "Jollof", PriceKobo: 250_000,
	}); err != nil {
		t.Errorf("manager could not add a menu item: %v", err)
	}

	// Storefront.
	if _, err := f.svc.SetAvailability(ctx, f.lekki, f.manager, false); err != nil {
		t.Errorf("manager could not close their own outlet: %v", err)
	}
	if _, err := f.svc.UpdateRestaurant(ctx, f.lekki, f.manager, UpdateRestaurantRequest{
		PackagingFeeKobo: ptrInt64Staff(25_000),
	}); err != nil {
		t.Errorf("manager could not set the packaging price: %v", err)
	}
}

func TestLiveDB_ManagerIsRefusedAtOtherOutletsAndOnBanking(t *testing.T) {
	pool := staffPool(t)
	t.Cleanup(func() { pool.Close() })
	ctx := context.Background()
	f := newStaffFixture(t, ctx, pool)

	// A different branch of the same brand — the manager has no grant there.
	if _, err := f.svc.CreateCategory(ctx, f.ikeja, f.manager, "Should Not Exist"); err == nil {
		t.Error("a Lekki manager created a category at Ikeja")
	}
	// Banking stays with the owner even at the manager's own outlet.
	if _, err := f.svc.SaveKYB(ctx, f.lekki, f.manager, KYB{LegalName: "Hijack Ltd"}); err == nil {
		t.Error("a manager saved KYB — banking details are owner-only")
	}
	if _, _, err := f.svc.GetKYB(ctx, f.lekki, f.manager); err == nil {
		t.Error("a manager read KYB — it carries bank account, TIN and RC numbers")
	}
	// Earnings are not a manager-blocked action, but a stranger must still fail.
	if _, err := f.svc.EarningsStatement(ctx, f.lekki, f.stranger, time.Now().Add(-24*time.Hour), time.Now()); err == nil {
		t.Error("a stranger read the earnings statement")
	}
}

func ptrInt64Staff(v int64) *int64 { return &v }
