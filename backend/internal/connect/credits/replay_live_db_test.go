package connectcredits

// LIVE-DB regression test for the duplicate-claim hardening on
// connect_credit_txns: ON CONFLICT DO NOTHING used to treat ANY existing row
// under the key as "already applied" — so a foreign claim (same key, different
// user / credit type / signed delta) was silently adopted as this caller's
// grant or spend. A duplicate is now a true replay ONLY when the recorded row
// carries the same identity; anything else fails closed.
//
// SKIPPED whenever TEST_DATABASE_URL is unset — same gate as the other
// live-DB connect suites:
//
//	export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//	go test ./internal/connect/credits/ -run TestLiveDB -v

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/testsupport"
)

func creditsPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping connect credits live-DB test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func creditsUser(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	id := uuid.NewString()
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO auth.users (id, email) VALUES ($1, $2)`,
		id, "credits-replay-"+id+"@example.invalid"); err != nil {
		t.Fatalf("seed auth.users: %v", err)
	}
	testsupport.CleanupUser(t, pool, id)
	return id
}

func TestLiveDB_CreditReplay_VerifiesIdentity(t *testing.T) {
	pool := creditsPool(t)
	ctx := context.Background()
	svc := NewService(pool)

	userA := creditsUser(t, pool)
	userB := creditsUser(t, pool)

	key := "zzcr-grant-" + uuid.NewString()

	// Grant 5 super_likes to A.
	if err := svc.Grant(ctx, userA, "super_likes", key, 5, "test grant"); err != nil {
		t.Fatalf("first grant: %v", err)
	}

	// True replay — same key, same identity: verified no-op, still 5.
	if err := svc.Grant(ctx, userA, "super_likes", key, 5, "test grant"); err != nil {
		t.Fatalf("identical grant replay must be a no-op, got %v", err)
	}
	if bal, _ := svc.Balance(ctx, userA, "super_likes"); bal != 5 {
		t.Fatalf("balance after grant replay = %d, want 5", bal)
	}

	// Foreign claims under the same key — different user, type or delta — must
	// fail closed, never silently adopt the recorded row.
	if err := svc.Grant(ctx, userB, "super_likes", key, 5, "foreign"); err == nil {
		t.Fatal("cross-user key reuse must fail closed")
	}
	if err := svc.Grant(ctx, userA, "inmail", key, 5, "foreign type"); err == nil {
		t.Fatal("cross-type key reuse must fail closed")
	}
	if err := svc.Grant(ctx, userA, "super_likes", key, 99, "foreign amount"); err == nil {
		t.Fatal("tampered-delta key reuse must fail closed")
	}
	// A consume under a GRANT key is also a foreign claim (sign flips the delta).
	if err := svc.Consume(ctx, userA, "super_likes", key, 5, "foreign consume"); err == nil {
		t.Fatal("consume replaying a grant key must fail closed")
	}
	if bal, _ := svc.Balance(ctx, userA, "super_likes"); bal != 5 {
		t.Fatalf("foreign claims must not move the balance, got %d", bal)
	}
	if bal, _ := svc.Balance(ctx, userB, "super_likes"); bal != 0 {
		t.Fatalf("foreign claim leaked a grant to user B, got %d", bal)
	}

	// Consume replay: spend 2, replay it → still spent once.
	consumeKey := "zzcr-consume-" + uuid.NewString()
	if err := svc.Consume(ctx, userA, "super_likes", consumeKey, 2, "spend"); err != nil {
		t.Fatalf("first consume: %v", err)
	}
	if err := svc.Consume(ctx, userA, "super_likes", consumeKey, 2, "spend"); err != nil {
		t.Fatalf("identical consume replay must be a no-op, got %v", err)
	}
	if bal, _ := svc.Balance(ctx, userA, "super_likes"); bal != 3 {
		t.Fatalf("balance after consume replay = %d, want 3", bal)
	}
	if err := svc.Consume(ctx, userA, "super_likes", consumeKey, 1, "tampered"); err == nil {
		t.Fatal("consume replay with a different amount must fail closed")
	}
	if bal, _ := svc.Balance(ctx, userA, "super_likes"); bal != 3 {
		t.Fatalf("tampered consume must not move the balance, got %d", bal)
	}
}
