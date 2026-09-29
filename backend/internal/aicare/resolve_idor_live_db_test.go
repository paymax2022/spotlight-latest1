package aicare

// ---------------------------------------------------------------------------
// LIVE-DB regression guard for a real IDOR bug: Resolve accepted an actorID
// parameter but never used it in its UPDATE's WHERE clause, so any
// authenticated user could resolve (close) ANY other user's support session
// by ID — no ownership check at all, unlike SendMessage/Escalate/GetHistory,
// which all scope by user_id. Fixed by adding "AND user_id=$2" and failing
// closed (RowsAffected==0 -> error) instead of silently no-op succeeding.
//
// Skipped unless TEST_DATABASE_URL is set.
// ---------------------------------------------------------------------------

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/testsupport"
)

func aicarePool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping live-DB aicare test")
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

func TestLiveDB_Resolve_RejectsNonOwnerThenOwnerSucceeds(t *testing.T) {
	pool := aicarePool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	svc := NewService(pool, nil)

	owner := uuid.New().String()
	attacker := uuid.New().String()
	for _, u := range []string{owner, attacker} {
		if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test"); err != nil {
			t.Fatalf("seed user: %v", err)
		}
		testsupport.CleanupUser(t, pool, u)
	}

	sess, err := svc.CreateSession(ctx, owner, CreateSessionRequest{Topic: "wallet issue"})
	if err != nil {
		t.Fatalf("create session: %v", err)
	}

	// A different user must never be able to resolve someone else's session.
	if err := svc.Resolve(ctx, sess.ID, attacker); err == nil {
		t.Fatal("expected error when a non-owner resolves another user's session")
	}
	var status string
	if err := pool.QueryRow(ctx, `SELECT status FROM support_sessions WHERE id=$1`, sess.ID).Scan(&status); err != nil {
		t.Fatalf("check status: %v", err)
	}
	if status != string(SessionOpen) {
		t.Fatalf("status = %q after rejected non-owner resolve, want %q (session must be untouched)", status, SessionOpen)
	}

	// The actual owner can resolve their own session.
	if err := svc.Resolve(ctx, sess.ID, owner); err != nil {
		t.Fatalf("owner resolve: %v", err)
	}
	if err := pool.QueryRow(ctx, `SELECT status FROM support_sessions WHERE id=$1`, sess.ID).Scan(&status); err != nil {
		t.Fatalf("check status: %v", err)
	}
	if status != string(SessionResolved) {
		t.Fatalf("status = %q after owner resolve, want %q", status, SessionResolved)
	}

	// Resolving an already-resolved session must fail closed, not silently no-op.
	if err := svc.Resolve(ctx, sess.ID, owner); err == nil {
		t.Fatal("expected error resolving an already-resolved session")
	}
}
