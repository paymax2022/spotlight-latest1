package ratings

// ---------------------------------------------------------------------------
// LIVE-DB regression guard for RAT-3: Create() used to return a FABRICATED
// Rating on a duplicate (rater_id, transaction_ref) submission — a fresh
// random id, whatever score/comment the SECOND request sent, and time.Now()
// — even though the ON CONFLICT DO NOTHING meant nothing was actually
// written. A caller had no way to tell "recorded" from "already recorded",
// and if the second submission's score differed from the first, the response
// body actively lied about what ended up in the table.
//
// Fixed: Create now returns (rating, created bool, err). On a conflict it
// fetches and returns the row that actually exists, with created=false —
// never a fabricated echo of the request that was rejected.
//
// Skips unless TEST_DATABASE_URL is set.
// ---------------------------------------------------------------------------

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/testsupport"
)

func ratingsPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping live-DB ratings test")
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

func TestLiveDB_Create_DuplicateReturnsRealRowNotFabricated(t *testing.T) {
	pool := ratingsPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	svc := NewService(pool)

	rater := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, rater, rater+"@seed.test"); err != nil {
		t.Fatalf("seed rater: %v", err)
	}
	testsupport.CleanupUser(t, pool, rater)
	txnRef := "order-" + uuid.New().String()

	first, created, err := svc.Create(ctx, rater, CreateRequest{
		EntityID: "restaurant-1", EntityType: EntityRestaurant, TransactionRef: txnRef, Score: 5,
	})
	if err != nil {
		t.Fatalf("first submission: %v", err)
	}
	if !created {
		t.Fatal("first submission: created = false, want true")
	}
	if first.Score != 5 {
		t.Fatalf("first submission score = %v, want 5", first.Score)
	}

	// Second submission for the SAME transaction, with a DIFFERENT score — the
	// exact scenario where the old fabrication bug would silently substitute
	// the new score into the response despite writing nothing.
	second, created2, err := svc.Create(ctx, rater, CreateRequest{
		EntityID: "restaurant-1", EntityType: EntityRestaurant, TransactionRef: txnRef, Score: 1,
	})
	if err != nil {
		t.Fatalf("duplicate submission: %v", err)
	}
	if created2 {
		t.Fatal("duplicate submission: created = true, want false")
	}
	if second.ID != first.ID {
		t.Errorf("duplicate submission returned a different id (%s) than the real stored rating (%s) — still fabricating", second.ID, first.ID)
	}
	if second.Score != 5 {
		t.Errorf("duplicate submission returned score=%v (the REJECTED second request's own score), want %v (the real first submission's score) — response is lying about what's stored", second.Score, first.Score)
	}
	if !second.CreatedAt.Equal(first.CreatedAt) {
		t.Errorf("duplicate submission returned a different created_at (%v) than the real row (%v)", second.CreatedAt, first.CreatedAt)
	}

	var count int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM ratings WHERE rater_id=$1 AND transaction_ref=$2`, rater, txnRef).Scan(&count); err != nil {
		t.Fatalf("count ratings: %v", err)
	}
	if count != 1 {
		t.Fatalf("ratings row count = %d, want exactly 1 (no second row from the duplicate submission)", count)
	}
}
