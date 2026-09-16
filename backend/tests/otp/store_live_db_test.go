package otp_test

// ---------------------------------------------------------------------------
// LIVE-DB test: the OTP store's atomicity guarantees, against real SQL.
//
// WHY THIS EXISTS
// ---------------
// The unit suite drives an in-memory store whose Consume and IncrementAttempts
// are correct BY CONSTRUCTION — they hold a mutex. That proves the service's
// logic and proves nothing about the property the store was chosen for.
//
// Single use and the attempt ceiling are not statements about one request. They
// are statements about concurrent ones:
//
//   - Two simultaneous submissions of the SAME CORRECT code must produce one
//     success and one failure. If both succeed, the code is replayable and the
//     mechanism is decorative. Nothing in a single-threaded test can see this.
//   - Two simultaneous WRONG guesses must produce attempts 1 and 2, never 1 and
//     1. A lost update there is how an attacker gets unlimited guesses at a
//     six-digit code while the counter reads 5.
//
// Both are guaranteed here by SQL — one DELETE ... WHERE finds the row, and
// UPDATE ... RETURNING serialises on it — and both are worth pinning, because
// the tempting refactor (read, check in Go, then write) reintroduces the race
// and passes every non-concurrent test.
//
// Gated on TEST_DATABASE_URL alone — never DATABASE_URL, which the root .env
// points at the production pooler and this test INSERTs (see
// scripts/ci/check-live-db-gate.sh).
//
// Bring-up:
//
//	export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//	cd backend && go test ./tests/otp/... -v
// ---------------------------------------------------------------------------

import (
	"context"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/otp"
)

func liveDBPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping live-DB OTP store test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping: %v", err)
	}
	// Registered first so it runs LAST: t.Cleanup is LIFO, and closing the pool
	// before the fixture DELETEs would leak rows into the shared dev database.
	t.Cleanup(pool.Close)
	return pool
}

// newKey returns a key namespaced to this test run, and removes it afterwards.
func newKey(t *testing.T, ctx context.Context, pool *pgxpool.Pool) string {
	t.Helper()
	k := "test:" + uuid.NewString()
	t.Cleanup(func() {
		if _, err := pool.Exec(ctx, `DELETE FROM otp_codes WHERE key = $1`, k); err != nil {
			t.Errorf("cleanup code %s: %v", k, err)
		}
	})
	return k
}

const pepper = "live-db-test-pepper"

func put(t *testing.T, ctx context.Context, s *otp.PostgresStore, key, code string, ttl time.Duration, attempts int) {
	t.Helper()
	now := time.Now().UTC()
	rec := otp.Record{
		Hash:      otp.Hash(code, []byte(pepper)),
		Purpose:   otp.PurposeLogin,
		CreatedAt: now,
		ExpiresAt: now.Add(ttl),
	}
	if err := s.Put(ctx, key, rec, ttl); err != nil {
		t.Fatalf("put: %v", err)
	}
	for i := 0; i < attempts; i++ {
		if _, err := s.IncrementAttempts(ctx, key); err != nil {
			t.Fatalf("seed attempt: %v", err)
		}
	}
}

func TestLiveDB_ConsumeIsSingleUseUnderConcurrency(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t)
	store := otp.NewPostgresStore(pool)

	key := newKey(t, ctx, pool)
	const code = "482913"
	put(t, ctx, store, key, code, 10*time.Minute, 0)

	const racers = 16
	var wg sync.WaitGroup
	results := make([]bool, racers)
	start := make(chan struct{})

	for i := 0; i < racers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start // release them together
			ok, err := store.Consume(ctx, key, otp.Hash(code, []byte(pepper)), 5)
			if err != nil {
				t.Errorf("consume: %v", err)
				return
			}
			results[i] = ok
		}(i)
	}
	close(start)
	wg.Wait()

	wins := 0
	for _, ok := range results {
		if ok {
			wins++
		}
	}
	if wins != 1 {
		t.Fatalf("%d of %d concurrent submissions of the same correct code succeeded, want exactly 1 — the code is replayable", wins, racers)
	}
}

// TestLiveDB_ConsumeNeverSucceedsOnARowAnotherWriterTook is the test that
// actually has teeth.
//
// The plain goroutine race above does NOT discriminate: measured against a
// read-check-then-delete implementation of Consume it passed 20 runs out of 20,
// because each racer finishes its read and its delete before the next one is
// scheduled, so the window it is supposed to exercise never opens. A concurrency
// test that cannot fail on the broken implementation is decoration.
//
// This one forces the window open with a row lock instead of hoping for a
// scheduler interleaving:
//
//  1. A separate transaction takes SELECT ... FOR UPDATE on the row.
//  2. The racers call Consume. Under MVCC a plain SELECT does not block, so a
//     read-first implementation reads the row and sees it valid; every
//     implementation then blocks on the DELETE.
//  3. The holding transaction deletes the row and commits — the code has been
//     consumed by someone else.
//  4. The blocked DELETEs unblock and affect ZERO rows.
//
// A Consume that reports success from rows-affected returns false for every
// racer, always. One that decided on its earlier read returns TRUE for a code
// that no longer exists, which is the same defect as accepting a replay.
//
// The assertion is therefore one a correct implementation can never fail,
// independent of timing.
func TestLiveDB_ConsumeNeverSucceedsOnARowAnotherWriterTook(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t)
	store := otp.NewPostgresStore(pool)

	key := newKey(t, ctx, pool)
	const code = "482913"
	put(t, ctx, store, key, code, 10*time.Minute, 0)

	holder, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = holder.Rollback(ctx)
		}
	}()

	var locked string
	if err := holder.QueryRow(ctx,
		`SELECT key FROM otp_codes WHERE key = $1 FOR UPDATE`, key).Scan(&locked); err != nil {
		t.Fatalf("lock the row: %v", err)
	}

	const racers = 8
	var wg sync.WaitGroup
	results := make([]bool, racers)
	for i := 0; i < racers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			ok, err := store.Consume(ctx, key, otp.Hash(code, []byte(pepper)), 5)
			if err != nil {
				t.Errorf("consume: %v", err)
				return
			}
			results[i] = ok
		}(i)
	}

	// Let every racer reach the DELETE and block on the lock. A correct
	// implementation does not depend on this landing perfectly; it only widens
	// the window the broken one needs.
	time.Sleep(300 * time.Millisecond)

	if _, err := holder.Exec(ctx, `DELETE FROM otp_codes WHERE key = $1`, key); err != nil {
		t.Fatalf("consume the row from the holding transaction: %v", err)
	}
	if err := holder.Commit(ctx); err != nil {
		t.Fatalf("commit: %v", err)
	}
	committed = true

	wg.Wait()

	for i, ok := range results {
		if ok {
			t.Fatalf("racer %d reported success for a code another writer had already consumed — Consume decided on a stale read instead of on rows affected, so the code is replayable", i)
		}
	}
}

func TestLiveDB_IncrementAttemptsLosesNoUpdates(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t)
	store := otp.NewPostgresStore(pool)

	key := newKey(t, ctx, pool)
	put(t, ctx, store, key, "111111", 10*time.Minute, 0)

	const racers = 20
	var wg sync.WaitGroup
	seen := make([]int, racers)
	start := make(chan struct{})

	for i := 0; i < racers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			n, err := store.IncrementAttempts(ctx, key)
			if err != nil {
				t.Errorf("increment: %v", err)
				return
			}
			seen[i] = n
		}(i)
	}
	close(start)
	wg.Wait()

	rec, err := store.Get(ctx, key)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if rec.Attempts != racers {
		t.Fatalf("attempts = %d after %d concurrent increments, want %d — a lost update here is unlimited guesses at a 6-digit code", rec.Attempts, racers, racers)
	}
	// Every racer must also have observed a DISTINCT value; two callers both
	// seeing "3" is the same lost update seen from the other side.
	distinct := map[int]bool{}
	for _, n := range seen {
		if n == 0 {
			continue
		}
		if distinct[n] {
			t.Errorf("two callers both observed attempt count %d", n)
		}
		distinct[n] = true
	}
}

// The store must refuse a code that is past its expiry even while the row is
// still present — the sweep is opportunistic and may not have run.
func TestLiveDB_ConsumeRefusesAnExpiredRow(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t)
	store := otp.NewPostgresStore(pool)

	key := newKey(t, ctx, pool)
	const code = "222222"
	put(t, ctx, store, key, code, time.Minute, 0)
	if _, err := pool.Exec(ctx,
		`UPDATE otp_codes SET expires_at = now() - interval '1 second' WHERE key = $1`, key); err != nil {
		t.Fatalf("age the row: %v", err)
	}

	ok, err := store.Consume(ctx, key, otp.Hash(code, []byte(pepper)), 5)
	if err != nil {
		t.Fatalf("consume: %v", err)
	}
	if ok {
		t.Error("an expired code verified — expiry must be enforced at read, not left to the sweep")
	}
}

func TestLiveDB_ConsumeRefusesOnceAttemptsAreExhausted(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t)
	store := otp.NewPostgresStore(pool)

	key := newKey(t, ctx, pool)
	const code = "333333"
	put(t, ctx, store, key, code, 10*time.Minute, 5)

	ok, err := store.Consume(ctx, key, otp.Hash(code, []byte(pepper)), 5)
	if err != nil {
		t.Fatalf("consume: %v", err)
	}
	if ok {
		t.Error("the correct code verified after the attempt ceiling was reached — lockout must destroy the credential, not pause it")
	}
}

// Re-issuing must invalidate the previous code. Two live codes for one address
// double an attacker's guessing surface for free.
func TestLiveDB_PutReplacesTheLiveCodeAndResetsAttempts(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t)
	store := otp.NewPostgresStore(pool)

	key := newKey(t, ctx, pool)
	put(t, ctx, store, key, "444444", 10*time.Minute, 3)
	put(t, ctx, store, key, "555555", 10*time.Minute, 0)

	rec, err := store.Get(ctx, key)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if rec.Attempts != 0 {
		t.Errorf("attempts = %d after re-issue, want 0", rec.Attempts)
	}
	if ok, _ := store.Consume(ctx, key, otp.Hash("444444", []byte(pepper)), 5); ok {
		t.Error("the superseded code still verifies — two live codes at once")
	}
	if ok, err := store.Consume(ctx, key, otp.Hash("555555", []byte(pepper)), 5); err != nil || !ok {
		t.Errorf("the current code did not verify (ok=%v err=%v)", ok, err)
	}
}

func TestLiveDB_DeleteExpiredSweeps(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t)
	store := otp.NewPostgresStore(pool)

	key := newKey(t, ctx, pool)
	put(t, ctx, store, key, "666666", time.Minute, 0)
	if _, err := pool.Exec(ctx,
		`UPDATE otp_codes SET expires_at = now() - interval '1 hour' WHERE key = $1`, key); err != nil {
		t.Fatalf("age: %v", err)
	}
	if _, err := store.DeleteExpired(ctx, 500); err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if _, err := store.Get(ctx, key); err != otp.ErrNotFound {
		t.Errorf("expired row survived the sweep (err=%v)", err)
	}
}

// ── rate limiter ────────────────────────────────────────────────────────────

func TestLiveDB_LimiterCountsAtomicallyAndRollsTheWindow(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t)
	lim := otp.NewPostgresLimiter(pool)

	key := "test:" + uuid.NewString()
	t.Cleanup(func() {
		if _, err := pool.Exec(ctx, `DELETE FROM otp_rate_limits WHERE key = $1`, key); err != nil {
			t.Errorf("cleanup limiter row: %v", err)
		}
	})

	const limit = 10
	const racers = 25
	var wg sync.WaitGroup
	allowed := make([]bool, racers)
	start := make(chan struct{})

	for i := 0; i < racers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			ok, err := lim.Allow(ctx, key, limit, time.Hour)
			if err != nil {
				t.Errorf("allow: %v", err)
				return
			}
			allowed[i] = ok
		}(i)
	}
	close(start)
	wg.Wait()

	granted := 0
	for _, ok := range allowed {
		if ok {
			granted++
		}
	}
	if granted != limit {
		t.Fatalf("%d of %d concurrent calls were allowed, want exactly %d — the counter lost updates and the budget is not a budget", granted, racers, limit)
	}

	// An expired window resets rather than staying exhausted forever.
	if _, err := pool.Exec(ctx,
		`UPDATE otp_rate_limits SET expires_at = now() - interval '1 second' WHERE key = $1`, key); err != nil {
		t.Fatalf("age the window: %v", err)
	}
	ok, err := lim.Allow(ctx, key, limit, time.Hour)
	if err != nil {
		t.Fatalf("allow after window rollover: %v", err)
	}
	if !ok {
		t.Error("the window did not roll over — the caller is locked out permanently")
	}
	var count int
	if err := pool.QueryRow(ctx, `SELECT count FROM otp_rate_limits WHERE key = $1`, key).Scan(&count); err != nil {
		t.Fatalf("read count: %v", err)
	}
	if count != 1 {
		t.Errorf("count = %d after rollover, want 1", count)
	}
}
