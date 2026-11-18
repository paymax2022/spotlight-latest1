package restaurant

// LIVE-DB tests for operator cuisine tagging. Skipped unless TEST_DATABASE_URL is
// set (see discoveryPool).

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
)

func TestLiveDB_AdminSetRestaurantCuisines(t *testing.T) {
	pool := discoveryPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()

	owner := uuid.New().String()
	_, _ = pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, owner, owner+"@seed.test")
	restID := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO restaurants (id, owner_id, name, address, is_open, rating)
		VALUES ($1,$2,'Cuisine Admin Kitchen','1 St',TRUE,4.5)`, restID, owner); err != nil {
		t.Fatalf("seed restaurant: %v", err)
	}

	sfx := uuid.New().String()[:8]
	var c1, c2 string
	if err := pool.QueryRow(ctx, `INSERT INTO cuisines (name,slug,sort_order,is_active)
		VALUES ($1,$2,1,TRUE) RETURNING id::text`, "Nigerian "+sfx, "nigerian-"+sfx).Scan(&c1); err != nil {
		t.Fatalf("seed cuisine 1: %v", err)
	}
	if err := pool.QueryRow(ctx, `INSERT INTO cuisines (name,slug,sort_order,is_active)
		VALUES ($1,$2,2,FALSE) RETURNING id::text`, "Retired "+sfx, "retired-"+sfx).Scan(&c2); err != nil {
		t.Fatalf("seed cuisine 2: %v", err)
	}
	t.Cleanup(func() {
		c := context.Background()
		_, _ = pool.Exec(c, `DELETE FROM restaurant_cuisines WHERE restaurant_id=$1`, restID)
		_, _ = pool.Exec(c, `DELETE FROM restaurants WHERE id=$1`, restID)
		_, _ = pool.Exec(c, `DELETE FROM cuisines WHERE id = ANY($1::uuid[])`, []string{c1, c2})
		_, _ = pool.Exec(c, `DELETE FROM auth.users WHERE id=$1`, owner)
	})

	svc := NewService(pool, nil)

	// Duplicate ids collapse; both an active and an inactive cuisine are assignable
	// (the latter so an operator can clear a tag deactivated after assignment).
	got, err := svc.AdminSetRestaurantCuisines(ctx, owner, restID, []string{c1, c1, c2})
	if err != nil {
		t.Fatalf("set cuisines: %v", err)
	}
	if len(got.Selected) != 2 {
		t.Fatalf("selected = %v, want 2 ids", got.Selected)
	}
	if len(got.Available) < 2 {
		t.Fatalf("available = %d, want at least the two seeded cuisines", len(got.Available))
	}

	// Replacing the set removes what is no longer listed.
	got, err = svc.AdminSetRestaurantCuisines(ctx, owner, restID, []string{c2})
	if err != nil {
		t.Fatalf("replace cuisines: %v", err)
	}
	if len(got.Selected) != 1 || got.Selected[0] != c2 {
		t.Fatalf("selected = %v, want [%s]", got.Selected, c2)
	}

	// Clearing is allowed.
	got, err = svc.AdminSetRestaurantCuisines(ctx, owner, restID, nil)
	if err != nil {
		t.Fatalf("clear cuisines: %v", err)
	}
	if len(got.Selected) != 0 {
		t.Fatalf("selected = %v, want empty", got.Selected)
	}

	// An unknown cuisine id is refused, and the previous set is left untouched.
	if _, err := svc.AdminSetRestaurantCuisines(ctx, owner, restID, []string{c1}); err != nil {
		t.Fatalf("re-set: %v", err)
	}
	_, err = svc.AdminSetRestaurantCuisines(ctx, owner, restID, []string{uuid.New().String()})
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("unknown cuisine err = %v, want ErrInvalidInput", err)
	}
	if cur, err := svc.AdminGetRestaurantCuisines(ctx, restID); err != nil || len(cur.Selected) != 1 || cur.Selected[0] != c1 {
		t.Fatalf("after refused write: selected = %v, err = %v; want [%s]", cur.Selected, err, c1)
	}

	if _, err := svc.AdminSetRestaurantCuisines(ctx, owner, uuid.New().String(), []string{c1}); !errors.Is(err, ErrRestaurantNotFound) {
		t.Fatalf("missing restaurant err = %v, want ErrRestaurantNotFound", err)
	}
}
