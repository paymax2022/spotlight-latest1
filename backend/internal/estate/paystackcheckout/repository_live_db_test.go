package paystackcheckout

// Live-DB integration test for IntentRepository over
// public.estate_dues_paystack_intents. Skipped unless TEST_DATABASE_URL is
// set (mirrors restaurant/paystackcheckout/repository_live_db_test.go).
// Pins the caller-scoped replay fix: a foreign payer reusing an existing
// idempotency key must get an error, never the owner's intent row.

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func estateRepoPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping live-DB paystackcheckout repository test")
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

func TestLiveDB_PutIntent_ForeignKeyIsCollisionNotReplay(t *testing.T) {
	pool := estateRepoPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	repo := NewIntentStore(pool)

	idemKey := "estate-scope-" + uuid.New().String()
	owner := intentRecord{
		Reference:      "estedues:owner-" + uuid.New().String(),
		EstateID:       uuid.New().String(),
		InvoiceID:      uuid.New().String(),
		PayerID:        uuid.New().String(),
		AmountKobo:     250_000,
		IdempotencyKey: idemKey,
		Status:         "pending",
	}
	if _, inserted, err := repo.PutIntent(ctx, owner); err != nil || !inserted {
		t.Fatalf("owner PutIntent: inserted=%v err=%v", inserted, err)
	}

	foreign := owner
	foreign.Reference = "estedues:foreign-" + uuid.New().String()
	foreign.PayerID = uuid.New().String()
	foreign.InvoiceID = uuid.New().String()
	existing, inserted, err := repo.PutIntent(ctx, foreign)
	if err == nil {
		t.Fatalf("foreign PutIntent returned no error and existing=%+v — a foreign key replayed the owner's intent", existing)
	}
	if inserted {
		t.Fatal("foreign PutIntent reported a fresh insert under a taken key")
	}
	if existing != nil {
		t.Fatalf("foreign PutIntent leaked the owner's intent record: %+v", existing)
	}

	replay, inserted, err := repo.PutIntent(ctx, owner)
	if err != nil || inserted {
		t.Fatalf("owner replay PutIntent: inserted=%v err=%v", inserted, err)
	}
	if replay == nil || replay.PayerID != owner.PayerID {
		t.Fatalf("owner replay resolved to %+v, want their own row", replay)
	}
}
