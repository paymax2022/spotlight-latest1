package restaurant

// LIVE-DB tests for legacy owner linking (foodhub §5.4).
//
// Every restaurant on the platform predates the merchant-onboarding engine:
// 1651 restaurants, 1539 distinct owners, and ZERO merchant profiles. The
// consequence is not cosmetic — capabilities are read from onb_merchant_profile,
// so today every one of those owners:
//
//   • has no capability card in the merchant hub, and
//   • resolves to "you don't manage a restaurant yet" at /merchant/restaurant,
//
// while their tooling works perfectly if they happen to know the direct URL.
// Linking creates the profile that makes them visible to the hub, WITHOUT
// requiring 1539 people to re-apply for a business they already run.
//
// A legacy profile is distinguishable by application_id IS NULL — it was never
// applied for. That is deliberate: an operator asking "who was reviewed?" must
// not get an answer polluted by people who were grandfathered in.
//
// Skips unless TEST_DATABASE_URL is set.

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"spotlight/backend/internal/testsupport"
)

func TestLiveDB_LinkingGrandfathersAnUnlinkedOwner(t *testing.T) {
	pool := staffPool(t)
	t.Cleanup(func() { pool.Close() })
	ctx := context.Background()
	svc := NewService(pool, nil)

	// Deterministic by construction. An earlier version of this test asserted the
	// GLOBAL invariant "no restaurant owner lacks a profile", which passed alone
	// and failed in a full run: every other test's fixtures create restaurants
	// with fresh owners, so the suite broke its own assertion. A test whose result
	// depends on what other tests leave behind measures the suite, not the code.
	owner := uuid.New().String()
	shop := uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, owner, owner+"@seed.test"); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	testsupport.CleanupUser(t, pool, owner)
	if _, err := pool.Exec(ctx,
		`INSERT INTO restaurants (id, owner_id, name, address, is_open) VALUES ($1,$2,'Legacy Kitchen','1 St',TRUE)`,
		shop, owner); err != nil {
		t.Fatalf("seed restaurant: %v", err)
	}
	t.Cleanup(func() {
		bg := context.Background()
		pool.Exec(bg, `DELETE FROM restaurant_staff WHERE restaurant_id=$1`, shop)
		pool.Exec(bg, `DELETE FROM restaurants WHERE id=$1`, shop)
		pool.Exec(bg, `DELETE FROM onb_merchant_profile WHERE user_id=$1`, owner)
	})

	if _, err := svc.LinkLegacyOwners(ctx); err != nil {
		t.Fatalf("LinkLegacyOwners: %v", err)
	}

	var profileID, route string
	var appID *string
	if err := pool.QueryRow(ctx,
		`SELECT id, COALESCE(workspace_route,''), application_id FROM onb_merchant_profile
		  WHERE user_id=$1 AND merchant_type_id='mt-restaurant' AND status='ACTIVE'`, owner).
		Scan(&profileID, &route, &appID); err != nil {
		t.Fatalf("the owner was not linked: %v", err)
	}
	// The capability card links here; a wrong route is a card that goes nowhere.
	if route != "/merchant/restaurant" {
		t.Errorf("workspace_route = %q, want /merchant/restaurant", route)
	}
	// Grandfathered must stay distinguishable from reviewed.
	if appID != nil {
		t.Error("a legacy profile carries an application_id — that fabricates a review")
	}

	var linked *string
	if err := pool.QueryRow(ctx, `SELECT owner_profile_id::text FROM restaurants WHERE id=$1`, shop).Scan(&linked); err != nil {
		t.Fatalf("read restaurant: %v", err)
	}
	if linked == nil || *linked != profileID {
		t.Error("the restaurant does not point at its owner's profile")
	}

	var hasRole bool
	if err := pool.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM user_roles ur JOIN roles ro ON ro.id=ur.role_id
		               WHERE ur.user_id=$1 AND ro.slug='restaurant_merchant' AND ur.is_active)`, owner).Scan(&hasRole); err != nil {
		t.Fatalf("check role: %v", err)
	}
	if !hasRole {
		t.Error("the owner has a profile but not the role — the hub would show the business while routes refuse it")
	}
}

func TestLiveDB_LinkingIsIdempotent(t *testing.T) {
	pool := staffPool(t)
	t.Cleanup(func() { pool.Close() })
	ctx := context.Background()
	svc := NewService(pool, nil)

	owner := uuid.New().String()
	shop := uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, owner, owner+"@seed.test"); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	testsupport.CleanupUser(t, pool, owner)
	if _, err := pool.Exec(ctx,
		`INSERT INTO restaurants (id, owner_id, name, address, is_open) VALUES ($1,$2,'Idem Legacy','1 St',TRUE)`,
		shop, owner); err != nil {
		t.Fatalf("seed restaurant: %v", err)
	}
	t.Cleanup(func() {
		bg := context.Background()
		pool.Exec(bg, `DELETE FROM restaurant_staff WHERE restaurant_id=$1`, shop)
		pool.Exec(bg, `DELETE FROM restaurants WHERE id=$1`, shop)
		pool.Exec(bg, `DELETE FROM onb_merchant_profile WHERE user_id=$1`, owner)
	})

	if _, err := svc.LinkLegacyOwners(ctx); err != nil {
		t.Fatalf("first run: %v", err)
	}
	if _, err := svc.LinkLegacyOwners(ctx); err != nil {
		t.Fatalf("second run: %v", err)
	}
	// Re-running a backfill is normal — after an import, or a retried deploy. It
	// must not duplicate a merchant's identity.
	var profiles int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM onb_merchant_profile WHERE user_id=$1 AND merchant_type_id='mt-restaurant'`, owner).
		Scan(&profiles); err != nil {
		t.Fatalf("count profiles: %v", err)
	}
	if profiles != 1 {
		t.Errorf("%d profiles after two runs, want exactly 1", profiles)
	}
}

func TestLiveDB_LegacyProfilesCarryAWorkingWorkspaceRoute(t *testing.T) {
	pool := staffPool(t)
	t.Cleanup(func() { pool.Close() })
	ctx := context.Background()

	// The capability card links to workspace_route. A profile with the wrong one
	// (or none) is a card that goes nowhere — the exact defect fixed in 686a045b.
	var wrong int
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM onb_merchant_profile
		WHERE merchant_type_id = 'mt-restaurant'
		  AND COALESCE(workspace_route,'') <> '/merchant/restaurant'`).Scan(&wrong); err != nil {
		t.Fatalf("check routes: %v", err)
	}
	if wrong != 0 {
		t.Errorf("%d restaurant profiles have a workspace_route the app cannot resolve", wrong)
	}
}

func TestLiveDB_LegacyOwnersHoldTheMerchantRole(t *testing.T) {
	pool := staffPool(t)
	t.Cleanup(func() { pool.Close() })
	ctx := context.Background()

	// A profile without the RBAC role is a half grant: the hub shows the business
	// while permissioned routes refuse it.
	var missingRole int
	if err := pool.QueryRow(ctx, `
		SELECT count(*)
		FROM onb_merchant_profile p
		WHERE p.merchant_type_id = 'mt-restaurant' AND p.status='ACTIVE'
		  AND NOT EXISTS (
		    SELECT 1 FROM user_roles ur
		    JOIN roles ro ON ro.id = ur.role_id
		    WHERE ur.user_id = p.user_id AND ro.slug = 'restaurant_merchant' AND ur.is_active
		  )`).Scan(&missingRole); err != nil {
		t.Fatalf("check roles: %v", err)
	}
	if missingRole != 0 {
		t.Errorf("%d linked owners lack the restaurant_merchant role", missingRole)
	}
}

func TestLiveDB_LegacyProfilesAreDistinguishableFromReviewedOnes(t *testing.T) {
	pool := staffPool(t)
	t.Cleanup(func() { pool.Close() })
	ctx := context.Background()

	// Grandfathered owners were never reviewed. If they were indistinguishable
	// from approved applicants, "who did we actually vet?" becomes unanswerable.
	var legacy int
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM onb_merchant_profile
		WHERE merchant_type_id='mt-restaurant' AND application_id IS NULL`).Scan(&legacy); err != nil {
		t.Fatalf("count legacy: %v", err)
	}
	if legacy == 0 {
		t.Error("no legacy profiles found — linking did not run, or it invented applications")
	}
}

func TestLiveDB_RestaurantsPointAtTheirOwnersProfile(t *testing.T) {
	pool := staffPool(t)
	t.Cleanup(func() { pool.Close() })
	ctx := context.Background()

	// owner_profile_id is the durable link the PRD asks for (§5.1). Where it is
	// set, it must agree with owner_id — a restaurant pointing at someone else's
	// profile would attribute the shop to the wrong merchant.
	var mismatched int
	if err := pool.QueryRow(ctx, `
		SELECT count(*)
		FROM restaurants r
		JOIN onb_merchant_profile p ON p.id = r.owner_profile_id
		WHERE p.user_id <> r.owner_id`).Scan(&mismatched); err != nil {
		t.Fatalf("check linkage: %v", err)
	}
	if mismatched != 0 {
		t.Errorf("%d restaurants point at a profile belonging to a different user", mismatched)
	}
}

func TestLiveDB_UnclaimedRestaurantsAreDetectable(t *testing.T) {
	pool := staffPool(t)
	t.Cleanup(func() { pool.Close() })
	ctx := context.Background()

	// §5.4 case 2 has TWO shapes, and only one is reachable in this schema:
	// restaurants.owner_id is NOT NULL, so "no owner at all" cannot occur — the
	// database forbids it. The reachable shape is an owner with no active merchant
	// profile, which is what every restaurant looked like before the linking
	// migration and what a newly imported shop would look like again.
	//
	// Asserting the current zero would pass even if the query were nonsense, so
	// this creates the state and checks it surfaces.
	orphanOwner := uuid.New().String()
	orphanShop := uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
		orphanOwner, orphanOwner+"@seed.test"); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	testsupport.CleanupUser(t, pool, orphanOwner)
	if _, err := pool.Exec(ctx,
		`INSERT INTO restaurants (id, owner_id, name, address, is_open) VALUES ($1,$2,'Unclaimed Kitchen','1 St',FALSE)`,
		orphanShop, orphanOwner); err != nil {
		t.Fatalf("seed restaurant: %v", err)
	}
	t.Cleanup(func() {
		bg := context.Background()
		pool.Exec(bg, `DELETE FROM restaurant_staff WHERE restaurant_id=$1`, orphanShop)
		pool.Exec(bg, `DELETE FROM restaurants WHERE id=$1`, orphanShop)
	})

	svc := NewService(pool, nil)
	list, err := svc.UnclaimedRestaurants(ctx)
	if err != nil {
		t.Fatalf("UnclaimedRestaurants: %v", err)
	}
	var found *UnclaimedRestaurant
	for i := range list {
		if list[i].ID == orphanShop {
			found = &list[i]
		}
	}
	if found == nil {
		t.Fatal("a restaurant whose owner has no merchant profile did not surface in the unclaimed queue")
	}
	// The reason drives the admin's next action, so it must name the real problem.
	if found.Reason != "owner has no merchant profile" {
		t.Errorf("reason = %q, want it to name the missing profile", found.Reason)
	}

	// And once the owner is linked, the shop must leave the queue — otherwise the
	// queue never drains and admins learn to ignore it.
	if _, err := pool.Exec(ctx, `
		INSERT INTO onb_merchant_profile (user_id, module_id, merchant_type_id, role_granted, status, workspace_route, activated_at)
		VALUES ($1,'mod-food','mt-restaurant','restaurant_merchant','ACTIVE','/merchant/restaurant',now())
		ON CONFLICT (user_id, merchant_type_id) DO NOTHING`, orphanOwner); err != nil {
		t.Fatalf("link owner: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM onb_merchant_profile WHERE user_id=$1`, orphanOwner)
	})

	after, err := svc.UnclaimedRestaurants(ctx)
	if err != nil {
		t.Fatalf("UnclaimedRestaurants (after linking): %v", err)
	}
	for _, r := range after {
		if r.ID == orphanShop {
			t.Error("the shop stayed in the unclaimed queue after its owner was linked")
		}
	}
}
