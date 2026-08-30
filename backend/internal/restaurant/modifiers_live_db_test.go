package restaurant

// ---------------------------------------------------------------------------
// LIVE-DB integration test for grouped menu-item modifiers (Phase 3): the owner
// CRUD (CreateModifierGroup / AddModifier), the loader (loadItemModifierGroups),
// and the pure resolver driven off DB-loaded groups. Skipped unless
// TEST_DATABASE_URL is set. Requires the restaurant + menu_modifiers
// migrations. No escrow/wallet is exercised — this covers the catalog + pricing
// resolution, not the money move.
// ---------------------------------------------------------------------------

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func modifiersLivePool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping live-DB modifier test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping: %v", err)
	}
	return pool
}

func TestLiveDB_MenuModifiers(t *testing.T) {
	pool := modifiersLivePool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	svc := NewService(pool, nil)

	// Seed owner + restaurant + one menu item (base 200_000 kobo).
	owner := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, owner, owner+"@seed.test"); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	restID := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO restaurants (id, owner_id, name, address, is_open) VALUES ($1,$2,'Mod Kitchen','1 St',TRUE)`, restID, owner); err != nil {
		t.Fatalf("seed restaurant: %v", err)
	}
	itemID := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO menu_items (id, restaurant_id, name, price_kobo) VALUES ($1,$2,'Burger',200000)`, itemID, restID); err != nil {
		t.Fatalf("seed item: %v", err)
	}

	// Owner creates a required select-one "Size" group + two options.
	size, err := svc.CreateModifierGroup(ctx, restID, owner, itemID, CreateModifierGroupRequest{Name: "Size", Required: true, MinSelect: 1, MaxSelect: 1})
	if err != nil {
		t.Fatalf("create size group: %v", err)
	}
	small, err := svc.AddModifier(ctx, restID, owner, size.ID, AddModifierRequest{Name: "Small", PriceDeltaKobo: 0})
	if err != nil {
		t.Fatalf("add small: %v", err)
	}
	large, err := svc.AddModifier(ctx, restID, owner, size.ID, AddModifierRequest{Name: "Large", PriceDeltaKobo: 50000})
	if err != nil {
		t.Fatalf("add large: %v", err)
	}

	// A stranger cannot add options to the owner's group (object-level authz).
	stranger := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, stranger, stranger+"@seed.test"); err != nil {
		t.Fatalf("seed stranger: %v", err)
	}
	if _, err := svc.AddModifier(ctx, restID, stranger, size.ID, AddModifierRequest{Name: "Hacked", PriceDeltaKobo: 0}); err == nil {
		t.Fatal("stranger must not add a modifier to another owner's group")
	}

	// Load groups back and drive the resolver off the DB rows.
	groups, err := svc.loadItemModifierGroups(ctx, itemID)
	if err != nil {
		t.Fatalf("load groups: %v", err)
	}
	if len(groups) != 1 || len(groups[0].Modifiers) != 2 {
		t.Fatalf("expected 1 group with 2 options, got %d groups", len(groups))
	}

	// Valid: choose Large → +50_000 delta.
	if _, delta, err := resolveLineModifiers(groups, []string{large.ID}); err != nil || delta != 50000 {
		t.Fatalf("large selection: delta=%d err=%v (want 50000, nil)", delta, err)
	}
	// Invalid: a required group with no choice is rejected.
	if _, _, err := resolveLineModifiers(groups, nil); !errors.Is(err, ErrInvalidModifierSelection) {
		t.Fatalf("missing required size: want ErrInvalidModifierSelection, got %v", err)
	}
	// Invalid: two sizes exceeds max=1.
	if _, _, err := resolveLineModifiers(groups, []string{small.ID, large.ID}); !errors.Is(err, ErrInvalidModifierSelection) {
		t.Fatalf("two sizes: want ErrInvalidModifierSelection, got %v", err)
	}
}
