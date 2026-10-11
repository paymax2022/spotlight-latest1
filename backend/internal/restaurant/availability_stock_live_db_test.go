package restaurant

// LIVE-DB test for timed restock and the bulk toggle. Skipped unless TEST_DATABASE_URL
// is set.

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func avPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping live-DB availability test")
	}
	p, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(p.Close)
	return p
}

func avItem(t *testing.T, db *pgxpool.Pool, rid string, available bool, until *time.Time) string {
	t.Helper()
	id := uuid.NewString()
	if _, err := db.Exec(context.Background(),
		`INSERT INTO menu_items (id, restaurant_id, name, price_kobo, is_available, unavailable_until)
		 VALUES ($1,$2,'Item',1000,$3,$4)`, id, rid, available, until); err != nil {
		t.Fatal(err)
	}
	return id
}

func avEffective(t *testing.T, db *pgxpool.Pool, id string) bool {
	t.Helper()
	var ok bool
	if err := db.QueryRow(context.Background(),
		`SELECT `+availableNow+` FROM menu_items WHERE id=$1`, id).Scan(&ok); err != nil {
		t.Fatal(err)
	}
	return ok
}

func TestLiveDB_TimedRestock_DecidedOnRead_Integration(t *testing.T) {
	db := avPool(t)
	rid := tiRestaurant(t, db)

	off := avItem(t, db, rid, false, nil)
	if avEffective(t, db, off) {
		t.Fatal("an item the owner switched off must stay off")
	}

	passed := time.Now().Add(-time.Minute)
	restocked := avItem(t, db, rid, false, &passed)
	if !avEffective(t, db, restocked) {
		t.Fatal("a restock time that has passed must make the item orderable without a job")
	}

	later := time.Now().Add(time.Hour)
	pending := avItem(t, db, rid, false, &later)
	if avEffective(t, db, pending) {
		t.Fatal("a restock time still in the future must keep the item off")
	}
}

func TestLiveDB_BulkToggle_OnlyThisRestaurantsItems_Integration(t *testing.T) {
	db := avPool(t)
	ctx := context.Background()
	mine := tiRestaurant(t, db)
	theirs := tiRestaurant(t, db)
	a := avItem(t, db, mine, true, nil)
	b := avItem(t, db, mine, true, nil)
	foreign := avItem(t, db, theirs, true, nil)

	n, err := setItemsAvailable(ctx, db, mine, []string{a, b, foreign}, false)
	if err != nil {
		t.Fatal(err)
	}
	if n != 2 {
		t.Fatalf("updated %d rows, want 2 (the foreign item must be ignored)", n)
	}
	if avEffective(t, db, a) || avEffective(t, db, b) {
		t.Fatal("bulk off did not take")
	}
	if !avEffective(t, db, foreign) {
		t.Fatal("bulk toggle changed another restaurant's item")
	}

	// Turning them back on clears a restock time that a manual flip supersedes.
	later := time.Now().Add(time.Hour)
	timed := avItem(t, db, mine, false, &later)
	if _, err := setItemsAvailable(ctx, db, mine, []string{timed}, true); err != nil {
		t.Fatal(err)
	}
	var until *time.Time
	if err := db.QueryRow(ctx, `SELECT unavailable_until FROM menu_items WHERE id=$1`, timed).Scan(&until); err != nil {
		t.Fatal(err)
	}
	if until != nil {
		t.Fatal("a manual on must clear the restock time")
	}

	if _, err := setItemsAvailable(ctx, db, mine, nil, true); err == nil {
		t.Fatal("an empty selection must be refused")
	}
	tooMany := make([]string, maxBulkAvailabilityIDs+1)
	for i := range tooMany {
		tooMany[i] = uuid.NewString()
	}
	if _, err := setItemsAvailable(ctx, db, mine, tooMany, true); err == nil {
		t.Fatal("more than the bulk limit must be refused")
	}
}
