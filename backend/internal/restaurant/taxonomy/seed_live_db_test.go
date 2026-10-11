package taxonomy_test

// LIVE-DB test for the admin-managed taxonomy: the seeder's idempotency, that admin
// edits survive a re-seed, and the delete and depth rules. Skipped unless
// TEST_DATABASE_URL is set.

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/restaurant/taxonomy"
)

func pool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping live-DB taxonomy test")
	}
	p, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(p.Close)
	return p
}

func TestLiveDB_Seed_IsIdempotentAndKeepsAdminEdits_Integration(t *testing.T) {
	db := pool(t)
	ctx := context.Background()
	svc := taxonomy.NewService(db)

	first, err := taxonomy.SeedDefaults(ctx, db)
	if err != nil {
		t.Fatal(err)
	}
	wantTotal := 30 + 243 + 40
	if first.Inserted+first.Skipped != wantTotal {
		t.Fatalf("first run accounted for %d rows, want %d (%+v)", first.Inserted+first.Skipped, wantTotal, first)
	}
	if len(first.Duplicates) != 0 {
		t.Fatalf("seed reported duplicates: %v", first.Duplicates)
	}

	second, err := taxonomy.SeedDefaults(ctx, db)
	if err != nil {
		t.Fatal(err)
	}
	if second.Inserted != 0 {
		t.Fatalf("re-seed inserted %d rows; must be a no-op", second.Inserted)
	}

	// Rename a default; a re-seed must not put the seed's name back.
	tree, err := svc.ListTree(ctx, true)
	if err != nil {
		t.Fatal(err)
	}
	var dessertsID string
	for _, n := range tree {
		if n.Slug == "desserts" {
			dessertsID = n.ID
		}
	}
	if dessertsID == "" {
		t.Fatal("desserts not seeded")
	}
	renamed := "Sweets"
	if _, err := svc.Update(ctx, actor(t, db), dessertsID, taxonomy.Patch{Name: &renamed}); err != nil {
		t.Fatal(err)
	}
	if _, err := taxonomy.SeedDefaults(ctx, db); err != nil {
		t.Fatal(err)
	}
	var name string
	if err := db.QueryRow(ctx, `SELECT name FROM restaurant_taxonomy_categories WHERE id=$1`, dessertsID).Scan(&name); err != nil {
		t.Fatal(err)
	}
	if name != "Sweets" {
		t.Fatalf("re-seed overwrote an admin rename: name = %q", name)
	}
	_, _ = svc.Update(ctx, actor(t, db), dessertsID, taxonomy.Patch{Name: strPtr("Desserts")})
}

func TestLiveDB_Taxonomy_InactiveHiddenAndSeededProtected_Integration(t *testing.T) {
	db := pool(t)
	ctx := context.Background()
	svc := taxonomy.NewService(db)
	if _, err := taxonomy.SeedDefaults(ctx, db); err != nil {
		t.Fatal(err)
	}

	public, _ := svc.ListTree(ctx, false)
	all, _ := svc.ListTree(ctx, true)
	if len(public) != 27 || len(all) != 30 {
		t.Fatalf("top-level public=%d all=%d; want 27 / 30 (three alcohol categories ship inactive)", len(public), len(all))
	}

	var dessertsID string
	for _, n := range all {
		if n.Slug == "desserts" {
			dessertsID = n.ID
		}
	}
	if err := svc.Delete(ctx, actor(t, db), dessertsID); !errors.Is(err, taxonomy.ErrSeeded) {
		t.Fatalf("deleting a default: err = %v, want ErrSeeded", err)
	}
}

func TestLiveDB_Taxonomy_CreateDepthAndDeleteRules_Integration(t *testing.T) {
	db := pool(t)
	ctx := context.Background()
	svc := taxonomy.NewService(db)

	name := "Local Specials " + uuid.NewString()[:8]
	top, err := svc.Create(ctx, actor(t, db), taxonomy.Input{Name: name, Kind: "FOOD"})
	if err != nil {
		t.Fatalf("create top-level: %v", err)
	}
	t.Cleanup(func() { _ = svc.Delete(context.Background(), actor(t, db), top.ID) })

	if _, err := svc.Create(ctx, actor(t, db), taxonomy.Input{Name: name, Kind: "FOOD"}); !errors.Is(err, taxonomy.ErrConflict) {
		t.Fatalf("duplicate name: err = %v, want ErrConflict", err)
	}

	sub, err := svc.Create(ctx, actor(t, db), taxonomy.Input{Name: "Chef Pick", Kind: "FOOD", ParentID: &top.ID})
	if err != nil {
		t.Fatalf("create sub-category: %v", err)
	}
	_, err = svc.Create(ctx, actor(t, db), taxonomy.Input{Name: "Too Deep", Kind: "FOOD", ParentID: &sub.ID})
	if !errors.Is(err, taxonomy.ErrInvalid) {
		t.Fatalf("third level: err = %v, want ErrInvalid", err)
	}

	if err := svc.Delete(ctx, actor(t, db), top.ID); !errors.As(err, new(taxonomy.ErrInUse)) {
		t.Fatalf("delete with a child: err = %v, want ErrInUse", err)
	}

	// A category a menu item uses cannot be deleted either.
	rid := uuid.NewString()
	if _, err := db.Exec(ctx, `INSERT INTO restaurants (id, owner_id, name, address) VALUES ($1,$2,'Taxonomy Test Kitchen','1 Test Road')`, rid, actor(t, db)); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ctx, `INSERT INTO menu_items (restaurant_id, name, price_kobo, taxonomy_category_id) VALUES ($1,'Jollof',0,$2)`, rid, sub.ID); err != nil {
		t.Fatalf("seed item: %v", err)
	}
	if err := svc.Delete(ctx, actor(t, db), sub.ID); !errors.As(err, new(taxonomy.ErrInUse)) {
		t.Fatalf("delete used sub-category: err = %v, want ErrInUse", err)
	}
	if _, err := db.Exec(ctx, `DELETE FROM menu_items WHERE restaurant_id=$1`, rid); err != nil {
		t.Fatal(err)
	}
	if err := svc.Delete(ctx, actor(t, db), sub.ID); err != nil {
		t.Fatalf("delete unused leaf: %v", err)
	}
}

func TestLiveDB_Cuisines_DeactivateNotDelete_Integration(t *testing.T) {
	db := pool(t)
	ctx := context.Background()
	svc := taxonomy.NewService(db)
	if _, err := taxonomy.SeedDefaults(ctx, db); err != nil {
		t.Fatal(err)
	}
	cu, err := svc.CreateCuisine(ctx, actor(t, db), "Ghanaian "+uuid.NewString()[:8], 999)
	if err != nil {
		t.Fatal(err)
	}
	off := false
	if _, err := svc.UpdateCuisine(ctx, actor(t, db), cu.ID, nil, nil, &off); err != nil {
		t.Fatal(err)
	}
	public, _ := svc.ListCuisines(ctx, false)
	for _, c := range public {
		if c.ID == cu.ID {
			t.Fatal("deactivated cuisine still listed to owners")
		}
	}
	adminView, _ := svc.ListCuisines(ctx, true)
	found := false
	for _, c := range adminView {
		if c.ID == cu.ID {
			found = true
		}
	}
	if !found {
		t.Fatal("admin view lost a deactivated cuisine")
	}
}

func strPtr(s string) *string { return &s }

// actor returns a real auth.users id, since created_by is a foreign key.
func actor(t *testing.T, db *pgxpool.Pool) string {
	t.Helper()
	id := uuid.NewString()
	if _, err := db.Exec(context.Background(), `INSERT INTO auth.users (id) VALUES ($1)`, id); err != nil {
		t.Fatalf("seed actor: %v", err)
	}
	return id
}
