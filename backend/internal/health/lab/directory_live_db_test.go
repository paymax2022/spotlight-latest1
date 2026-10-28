package healthlab

// Live-DB coverage for the persisted lab directory, catalog detail and reviews
// that replaced the mobile app's client-side mocks. Skips without TEST_DATABASE_URL.

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func seedDirLab(t *testing.T, ctx context.Context, pool *pgxpool.Pool, owner string, discoverable bool, home bool, status string) string {
	t.Helper()
	id := uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO health_providers (id, owner_user_id, domain, provider_type, display_name, status, discoverable, geo)
		 VALUES ($1,$2,'LAB','lab','Directory Test Lab',$3,$4, ST_SetSRID(ST_MakePoint(3.4219,6.4281),4326)::geography)`,
		id, owner, status, discoverable); err != nil {
		t.Fatalf("seed lab: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO lab_profiles (lab_provider_id, headline, address, supports_home_collection, home_collection_fee_kobo, result_eta_label)
		 VALUES ($1,'ISO lab','1 Test St',$2,250000,'Results in 24 hrs')`, id, home); err != nil {
		t.Fatalf("seed profile: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(t.Context()), `DELETE FROM health_providers WHERE id=$1`, id)
	})
	return id
}

func seedDirOrder(t *testing.T, ctx context.Context, pool *pgxpool.Pool, patient, lab, state string) string {
	t.Helper()
	id := uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO lab_orders (id, patient_id, lab_provider_id, state, collection_method, total_kobo, idempotency_key)
		 VALUES ($1,$2,$3,$4,'WALK_IN',500000,$5)`, id, patient, lab, state, "dir-"+id); err != nil {
		t.Fatalf("seed order: %v", err)
	}
	return id
}

func TestLiveDB_ListLabs_OnlyApprovedDiscoverable_AndHomeFilter(t *testing.T) {
	pool := listEndpointsLivePool(t)
	ctx := t.Context()
	svc := NewService(pool, nil, nil, nil, nil, nil, nil, nil)
	owner := uuid.New().String()
	seedLabTestUser(t, ctx, pool, owner)

	home := seedDirLab(t, ctx, pool, owner+"", true, true, "APPROVED")
	// A second capability row for the same owner needs a different type; use separate owners.
	owner2 := uuid.New().String()
	seedLabTestUser(t, ctx, pool, owner2)
	hidden := seedDirLab(t, ctx, pool, owner2, false, true, "APPROVED")
	owner3 := uuid.New().String()
	seedLabTestUser(t, ctx, pool, owner3)
	pending := seedDirLab(t, ctx, pool, owner3, true, true, "PENDING")

	labs, err := svc.ListLabs(ctx, true, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, l := range labs {
		seen[l.ID] = true
	}
	if !seen[home] {
		t.Fatal("approved+discoverable home lab must be listed")
	}
	if seen[hidden] || seen[pending] {
		t.Fatal("non-discoverable or non-approved labs must not be listed (HL-2)")
	}

	lng, lat := 3.42, 6.43
	near, err := svc.ListLabs(ctx, false, &lng, &lat)
	if err != nil {
		t.Fatal(err)
	}
	for _, l := range near {
		if l.ID == home && (l.DistanceM == nil || *l.DistanceM > 2000) {
			t.Fatalf("distance must be computed from the supplied point, got %v", l.DistanceM)
		}
	}

	one, err := svc.GetLab(ctx, hidden)
	if err != nil || one.ID != hidden {
		t.Fatalf("GetLab must return an approved lab even when not discoverable: %v", err)
	}
	if _, err := svc.GetLab(ctx, pending); !errors.Is(err, ErrLabNotFound) {
		t.Fatalf("a pending lab must be not found, got %v", err)
	}
}

func TestLiveDB_Reviews_VerifiedPurchaseOnceAndAggregate(t *testing.T) {
	pool := listEndpointsLivePool(t)
	ctx := t.Context()
	svc := NewService(pool, nil, nil, nil, nil, nil, nil, nil)
	owner, patient, stranger := uuid.New().String(), uuid.New().String(), uuid.New().String()
	for _, u := range []string{owner, patient, stranger} {
		seedLabTestUser(t, ctx, pool, u)
	}
	lab := seedDirLab(t, ctx, pool, owner, true, false, "APPROVED")
	pendingOrder := seedDirOrder(t, ctx, pool, patient, lab, "CREATED")
	released := seedDirOrder(t, ctx, pool, patient, lab, "RELEASED")

	if _, err := svc.SubmitReview(ctx, patient, pendingOrder, 5, "great"); !errors.Is(err, ErrReviewNotEligible) {
		t.Fatalf("an unreleased order cannot be reviewed, got %v", err)
	}
	if _, err := svc.SubmitReview(ctx, stranger, released, 5, "x"); !errors.Is(err, ErrOrderNotFound) {
		t.Fatalf("someone else's order must be indistinguishable from missing, got %v", err)
	}
	if _, err := svc.SubmitReview(ctx, patient, released, 6, ""); !errors.Is(err, ErrInvalidRating) {
		t.Fatalf("rating 6 must be rejected, got %v", err)
	}
	rv, err := svc.SubmitReview(ctx, patient, released, 4, "Quick and clean")
	if err != nil || rv.Rating != 4 {
		t.Fatalf("eligible review must succeed: %v", err)
	}
	if _, err := svc.SubmitReview(ctx, patient, released, 5, "again"); !errors.Is(err, ErrAlreadyReviewed) {
		t.Fatalf("second review of one order must be refused, got %v", err)
	}

	list, err := svc.ListReviews(ctx, lab)
	if err != nil || len(list) != 1 || list[0].Body != "Quick and clean" {
		t.Fatalf("review must be listed: %v %+v", err, list)
	}
	l, err := svc.GetLab(ctx, lab)
	if err != nil || l.ReviewCount != 1 || l.Rating != 4.0 {
		t.Fatalf("rating aggregate must come from reviews: %v %+v", err, l)
	}
}

func TestLiveDB_GetTestAndPackage_ActiveOnly(t *testing.T) {
	pool := listEndpointsLivePool(t)
	ctx := t.Context()
	svc := NewService(pool, nil, nil, nil, nil, nil, nil, nil)
	owner := uuid.New().String()
	seedLabTestUser(t, ctx, pool, owner)
	lab := seedDirLab(t, ctx, pool, owner, true, false, "APPROVED")

	active, inactive := uuid.New().String(), uuid.New().String()
	for id, on := range map[string]bool{active: true, inactive: false} {
		if _, err := pool.Exec(ctx,
			`INSERT INTO lab_tests (id, lab_provider_id, code, name, price_kobo, active, category, fasting_required)
			 VALUES ($1,$2,'T','Lipid',950000,$3,'cardiac',true)`, id, lab, on); err != nil {
			t.Fatal(err)
		}
	}
	got, err := svc.GetTest(ctx, active)
	if err != nil || got.Category != "cardiac" || !got.FastingRequired {
		t.Fatalf("catalog display fields must round-trip: %v %+v", err, got)
	}
	if _, err := svc.GetTest(ctx, inactive); !errors.Is(err, ErrTestNotFound) {
		t.Fatalf("inactive test must be not found, got %v", err)
	}
	if _, err := svc.GetPackage(ctx, uuid.New().String()); !errors.Is(err, ErrPackageNotFound) {
		t.Fatalf("unknown package must be not found, got %v", err)
	}
}
