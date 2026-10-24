package stepup

// LIVE-DB coverage for PostgresStore against a fully migrated Postgres
// (TEST_DATABASE_URL-gated, same convention as internal/estate/*_live_db_test.go).
// The middleware fake covers the gate logic; this proves the SQL:
// insert, newest-grant lookup, DB-clock expiry judgement, and the sweep.

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func stepUpLiveStore(t *testing.T) *PostgresStore {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping live-DB step-up store tests")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect test db: %v", err)
	}
	t.Cleanup(pool.Close)
	return NewPostgresStore(pool)
}

func TestLiveDB_StepUpGrantRoundTrip(t *testing.T) {
	store := stepUpLiveStore(t)
	ctx := context.Background()
	userID := uuid.New().String()
	// Any 64-char value; real callers pass sha256 hex via services.HashToken.
	tokenHash := "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

	// Unknown (user, token) pair: found=false, no error.
	st, err := store.GrantState(ctx, userID, tokenHash)
	if err != nil || st.Found {
		t.Fatalf("empty lookup: %+v err=%v", st, err)
	}

	exp := time.Now().Add(5 * time.Minute)
	if err := store.Insert(ctx, Grant{UserID: userID, AccessTokenHash: tokenHash, ExpiresAt: exp}); err != nil {
		t.Fatalf("insert: %v", err)
	}
	st, err = store.GrantState(ctx, userID, tokenHash)
	if err != nil || !st.Found || !st.Active {
		t.Fatalf("active grant must read back active, %+v err=%v", st, err)
	}

	// A different token for the same user sees nothing — the grant is bound.
	st, err = store.GrantState(ctx, userID, "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff")
	if err != nil || st.Found {
		t.Fatalf("grant must not leak across tokens, %+v err=%v", st, err)
	}
}

func TestLiveDB_StepUpExpiredGrantReadsInactive(t *testing.T) {
	store := stepUpLiveStore(t)
	ctx := context.Background()
	userID := uuid.New().String()
	tokenHash := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

	// Expiry already past must violate CHECK(expires_at > created_at) only if
	// created_at were now(); it defaults to now() so a past expiry is rejected —
	// insert one second in the future, then age the row directly.
	if err := store.Insert(ctx, Grant{UserID: userID, AccessTokenHash: tokenHash, ExpiresAt: time.Now().Add(time.Second)}); err != nil {
		t.Fatalf("insert: %v", err)
	}
	time.Sleep(1500 * time.Millisecond)
	st, err := store.GrantState(ctx, userID, tokenHash)
	if err != nil || !st.Found || st.Active {
		t.Fatalf("expired grant must read found+inactive, %+v err=%v", st, err)
	}
}
