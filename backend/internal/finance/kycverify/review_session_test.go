package kycverify

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Live-DB test; SKIPPED whenever TEST_DATABASE_URL is unset.
func reviewSessionPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping live-DB test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect TEST_DATABASE_URL: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func seedSession(t *testing.T, pool *pgxpool.Pool, userID, status, createdAt string) string {
	t.Helper()
	var id string
	err := pool.QueryRow(context.Background(),
		`INSERT INTO verification_session (user_id, target_tier, status, created_at)
		 VALUES ($1::uuid, 1, $2, $3::timestamptz) RETURNING id::text`,
		userID, status, createdAt).Scan(&id)
	if err != nil {
		t.Fatalf("seed session: %v", err)
	}
	return id
}

func TestReviewSession_LatestReviewSessionID(t *testing.T) {
	pool := reviewSessionPool(t)
	ctx := context.Background()
	repo := NewRepository(pool)

	userID := uuid.NewString()
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM verification_session WHERE user_id=$1::uuid`, userID)
	})

	// No sessions at all.
	if _, found, err := repo.LatestReviewSessionID(ctx, userID); err != nil || found {
		t.Fatalf("empty: found=%v err=%v", found, err)
	}

	// Only a terminal-status session.
	seedSession(t, pool, userID, "APPROVED", "2026-01-01T00:00:00Z")
	if _, found, err := repo.LatestReviewSessionID(ctx, userID); err != nil || found {
		t.Fatalf("terminal only: found=%v err=%v", found, err)
	}

	// One NEEDS_REVIEW.
	older := seedSession(t, pool, userID, "NEEDS_REVIEW", "2026-02-01T00:00:00Z")
	got, found, err := repo.LatestReviewSessionID(ctx, userID)
	if err != nil || !found || got != older {
		t.Fatalf("one review: got=%q found=%v err=%v want %q", got, found, err, older)
	}

	// Two NEEDS_REVIEW -> newest wins.
	newer := seedSession(t, pool, userID, "NEEDS_REVIEW", "2026-03-01T00:00:00Z")
	got, found, err = repo.LatestReviewSessionID(ctx, userID)
	if err != nil || !found || got != newer {
		t.Fatalf("two review: got=%q found=%v err=%v want %q", got, found, err, newer)
	}
}
