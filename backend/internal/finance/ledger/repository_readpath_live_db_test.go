package ledger_test

// LIVE-DB regression test for AGT1-PERF-001: Repository.GetOrCreateAccount must
// READ FIRST (SELECT) and only INSERT on a genuine first touch. Previously it
// upserted first (INSERT ... ON CONFLICT DO NOTHING RETURNING) and only fell
// back to SELECT when the insert conflicted away — so every wallet balance /
// transaction / transfer read paid a write statement plus a second query on the
// pooled connection (2 RTTs where 1 suffices, a write on a read path).
//
// The assertions below use a pgx.QueryTracer to record the exact statements the
// repository issues — so the test fails if the write-first shape ever returns,
// not just when the result is wrong.
//
// SKIPPED whenever TEST_DATABASE_URL is unset — same gate as the other
// live-DB suites in this package.
//
//	export TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
//	cd backend && go test ./internal/finance/ledger/ -run TestLiveDB_GetOrCreateAccount -v -count=1

import (
	"context"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
)

// queryRecorder is a pgx.QueryTracer that captures every SQL string the pool
// issues. pgx traces QueryRow via the same hook as Query, so both fetch and
// upsert statements are recorded.
type queryRecorder struct {
	mu  sync.Mutex
	sql []string
}

func (r *queryRecorder) TraceQueryStart(ctx context.Context, _ *pgx.Conn, data pgx.TraceQueryStartData) context.Context {
	r.mu.Lock()
	r.sql = append(r.sql, data.SQL)
	r.mu.Unlock()
	return ctx
}

func (r *queryRecorder) TraceQueryEnd(context.Context, *pgx.Conn, pgx.TraceQueryEndData) {}

func (r *queryRecorder) reset() {
	r.mu.Lock()
	r.sql = nil
	r.mu.Unlock()
}

func (r *queryRecorder) countVerb(verb string) int {
	r.mu.Lock()
	defer r.mu.Unlock()
	n := 0
	for _, q := range r.sql {
		if strings.HasPrefix(strings.ToUpper(strings.TrimSpace(q)), verb) {
			n++
		}
	}
	return n
}

// mustTracedPool builds a pool like mustLiveTxPool but with rec installed as
// the connection tracer so issued statements can be asserted on.
func mustTracedPool(t *testing.T, rec *queryRecorder) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping live-DB test")
	}
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatalf("parse TEST_DATABASE_URL: %v", err)
	}
	cfg.ConnConfig.Tracer = rec
	pool, err := pgxpool.NewWithConfig(context.Background(), cfg)
	if err != nil {
		t.Fatalf("connect TEST_DATABASE_URL: %v", err)
	}
	t.Cleanup(pool.Close)
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping TEST_DATABASE_URL: %v", err)
	}
	return pool
}

func seedFixtureUser(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	userID := uuid.NewString()
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
		userID, "readpath-"+uuid.NewString()[:8]+"@fixture.test"); err != nil {
		t.Fatalf("seed auth.users: %v", err)
	}
	return userID
}

// TestLiveDB_GetOrCreateAccount_ReadsFirst proves the steady-state path (account
// already exists) issues NO INSERT at all — a single SELECT returns the row.
func TestLiveDB_GetOrCreateAccount_ReadsFirst(t *testing.T) {
	rec := &queryRecorder{}
	pool := mustTracedPool(t, rec)
	repo := ledger.NewRepository(pool)
	ctx := context.Background()
	userID := seedFixtureUser(t, pool)

	first, err := repo.GetOrCreateAccount(ctx, &userID, ledger.AccountUserWallet)
	if err != nil {
		t.Fatalf("first GetOrCreateAccount: %v", err)
	}
	if first.ID == "" {
		t.Fatal("first call returned empty account id")
	}

	rec.reset()
	for i := range 3 {
		again, err := repo.GetOrCreateAccount(ctx, &userID, ledger.AccountUserWallet)
		if err != nil {
			t.Fatalf("repeat GetOrCreateAccount %d: %v", i, err)
		}
		if again.ID != first.ID {
			t.Fatalf("repeat call returned different account id: %s vs %s", again.ID, first.ID)
		}
	}
	if n := rec.countVerb("INSERT"); n != 0 {
		t.Fatalf("existing-account reads issued %d INSERT statements — write-first upsert is back", n)
	}
	if n := rec.countVerb("SELECT"); n != 3 {
		t.Fatalf("expected 3 SELECTs for 3 existing-account reads, got %d", n)
	}
}

// TestLiveDB_GetOrCreateAccount_CreatesOnMiss proves the first-touch path still
// creates exactly one row: SELECT (miss) → INSERT ... ON CONFLICT.
func TestLiveDB_GetOrCreateAccount_CreatesOnMiss(t *testing.T) {
	rec := &queryRecorder{}
	pool := mustTracedPool(t, rec)
	repo := ledger.NewRepository(pool)
	ctx := context.Background()
	userID := seedFixtureUser(t, pool)

	rec.reset()
	acc, err := repo.GetOrCreateAccount(ctx, &userID, ledger.AccountEscrow)
	if err != nil {
		t.Fatalf("GetOrCreateAccount (new pair): %v", err)
	}
	if acc.ID == "" || acc.Type != ledger.AccountEscrow {
		t.Fatalf("unexpected account: %+v", acc)
	}
	if n := rec.countVerb("INSERT"); n != 1 {
		t.Fatalf("first touch should issue exactly 1 INSERT, got %d", n)
	}

	var rows int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM ledger_accounts WHERE user_id=$1 AND type=$2`,
		userID, string(ledger.AccountEscrow)).Scan(&rows); err != nil {
		t.Fatalf("count accounts: %v", err)
	}
	if rows != 1 {
		t.Fatalf("expected exactly 1 account row for (user,type), got %d", rows)
	}
}

// TestLiveDB_GetOrCreateAccount_ConcurrentCreatorsConverge proves the race path:
// N concurrent first-touches must converge on one row and one account id, with
// no error — ON CONFLICT DO NOTHING plus the re-select absorbs the loser's
// conflict.
func TestLiveDB_GetOrCreateAccount_ConcurrentCreatorsConverge(t *testing.T) {
	rec := &queryRecorder{}
	pool := mustTracedPool(t, rec)
	repo := ledger.NewRepository(pool)
	ctx := context.Background()
	userID := seedFixtureUser(t, pool)

	const goroutines = 16
	ids := make([]string, goroutines)
	errs := make([]error, goroutines)
	var wg sync.WaitGroup
	start := make(chan struct{})
	for i := range goroutines {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			acc, err := repo.GetOrCreateAccount(ctx, &userID, ledger.AccountRefund)
			if err == nil {
				ids[i] = acc.ID
			}
			errs[i] = err
		}(i)
	}
	close(start)
	wg.Wait()

	for i := range errs {
		if errs[i] != nil {
			t.Fatalf("goroutine %d errored: %v", i, errs[i])
		}
		if ids[i] != ids[0] {
			t.Fatalf("goroutine %d got different account id %s vs %s", i, ids[i], ids[0])
		}
	}
	var rows int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM ledger_accounts WHERE user_id=$1 AND type=$2`,
		userID, string(ledger.AccountRefund)).Scan(&rows); err != nil {
		t.Fatalf("count accounts: %v", err)
	}
	if rows != 1 {
		t.Fatalf("concurrent creators left %d account rows, want 1", rows)
	}
}

// TestLiveDB_GetOrCreateAccount_StandingReadsFirst proves standing accounts
// (user_id IS NULL) also take the read-first path once they exist.
func TestLiveDB_GetOrCreateAccount_StandingReadsFirst(t *testing.T) {
	rec := &queryRecorder{}
	pool := mustTracedPool(t, rec)
	repo := ledger.NewRepository(pool)
	ctx := context.Background()

	// provider_clearing is a standing account seeded in every migrated DB.
	first, err := repo.GetOrCreateAccount(ctx, nil, ledger.AccountProviderClearing)
	if err != nil {
		t.Fatalf("GetOrCreateAccount standing: %v", err)
	}
	rec.reset()
	again, err := repo.GetOrCreateAccount(ctx, nil, ledger.AccountProviderClearing)
	if err != nil {
		t.Fatalf("repeat standing GetOrCreateAccount: %v", err)
	}
	if again.ID != first.ID {
		t.Fatalf("standing account id changed: %s vs %s", again.ID, first.ID)
	}
	if n := rec.countVerb("INSERT"); n != 0 {
		t.Fatalf("existing standing account read issued %d INSERTs", n)
	}
}
