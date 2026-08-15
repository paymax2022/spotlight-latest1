package ledger_test

// ---------------------------------------------------------------------------
// ADR-040 — GLOBAL CONSERVATION over the shared public.ledger_entries table.
//
// public.ledger_entries has two independent writers:
//   • the Go finance ledger (backend/internal/finance/ledger) — always posts a
//     balanced DR/CR pair;
//   • the Next.js wallet plane (frontend-web/src/server/wallet) — which, before
//     ADR-040, posted ONE leg per money event.
//
// Because both write to the same table, a single-sided writer in EITHER plane
// destroys the only invariant that can catch a whole class of money bugs:
//
//     SUM(signed amount_kobo) over the entire table == 0
//
// (CREDIT / REVERSAL_DEBIT positive, DEBIT / REVERSAL_CREDIT negative — the same
// sign rule as public.wallet_balance and ledger.balanceProjectionSQL.)
//
// This file is the cross-plane assertion. The pure-logic half — that the wallet
// plane's journal BUILDER cannot emit an unbalanced set — lives in
// frontend-web/tests/unit/finance/ledger-conservation.spec.ts and runs on every
// PR without a database.
//
// ── Bring-up note ─────────────────────────────────────────────────────────
//  1. Apply migrations, in particular:
//       supabase/migrations/20260613030000_ledger_entries.sql
//       supabase/migrations/20261207000000_ledger_balanced_wallet_rpcs.sql
//       supabase/migrations/20261207000100_ledger_legacy_contra_account_type.sql
//       supabase/migrations/20261207000200_ledger_conservation_backfill.sql
//  2. Point at a disposable database — NEVER production:
//       export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//  3. Run:
//       cd backend && go test ./tests/ledger/... -run LiveDB -v
//
// This test is READ-ONLY apart from the two journals it posts itself, each of
// which is balanced and keyed by a fresh uuid — safe to re-run repeatedly.
// ---------------------------------------------------------------------------

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"

	"spotlight/backend/internal/finance/ledger"
)

// residualSQL is the whole point of the file: one number over the whole table.
// Kept inline (rather than reading the ledger_conservation_check view) so the
// assertion still works on a database that predates that view, and so the sign
// rule under test is visible right here.
const residualSQL = `
	SELECT COALESCE(SUM(
		CASE WHEN type IN ('CREDIT','REVERSAL_DEBIT') THEN amount_kobo
		     ELSE -amount_kobo END
	), 0), COUNT(*)
	FROM public.ledger_entries`

// liveDBPool gates on TEST_DATABASE_URL ALONE — never falling back to
// DATABASE_URL, which the root .env points at the PRODUCTION Supabase pooler.
// TestLiveDB_LedgerConservationSurvivesPosting writes a real journal, so a
// fallback would move money in production the moment someone sourced .env and
// ran `go test ./...`. Enforced repo-wide by scripts/ci/check-live-db-gate.sh.
func liveDBPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping live-DB ledger conservation test; see bring-up note in global_conservation_live_db_test.go")
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

// globalResidual returns the signed sum (kobo) and the row count.
func globalResidual(t *testing.T, ctx context.Context, pool *pgxpool.Pool) (int64, int64) {
	t.Helper()
	var residual, count int64
	if err := pool.QueryRow(ctx, residualSQL).Scan(&residual, &count); err != nil {
		t.Fatalf("project global residual: %v", err)
	}
	return residual, count
}

// TestLiveDB_LedgerGlobalConservation is the ADR-040 invariant: whatever history
// the database carries, and whichever plane wrote it, the shared ledger conserves
// value. A non-zero residual means some writer posted a single-sided entry.
func TestLiveDB_LedgerGlobalConservation(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t)
	defer pool.Close()

	residual, count := globalResidual(t, ctx, pool)
	if residual != 0 {
		t.Fatalf("global ledger residual = %d kobo over %d entries, want 0.\n"+
			"Some writer posted an unbalanced (probably single-sided) entry. Find it with:\n"+
			"  SELECT reference, SUM(CASE WHEN type IN ('CREDIT','REVERSAL_DEBIT') THEN amount_kobo ELSE -amount_kobo END) AS residual\n"+
			"    FROM ledger_entries GROUP BY reference HAVING SUM(CASE WHEN type IN ('CREDIT','REVERSAL_DEBIT') THEN amount_kobo ELSE -amount_kobo END) <> 0;\n"+
			"See docs/adr/ADR-040-wallet-plane-double-entry.md.", residual, count)
	}
	t.Logf("ledger conserves: residual 0 kobo over %d entries", count)
}

// TestLiveDB_LedgerConservationCheckView pins the ops-facing probe to the same
// number this test computes, so a query drift in the view is caught too.
func TestLiveDB_LedgerConservationCheckView(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t)
	defer pool.Close()

	want, _ := globalResidual(t, ctx, pool)

	var got int64
	err := pool.QueryRow(ctx, `SELECT residual_kobo FROM public.ledger_conservation_check`).Scan(&got)
	if err != nil {
		t.Fatalf("read ledger_conservation_check (is migration 20261207000200 applied?): %v", err)
	}
	if got != want {
		t.Fatalf("ledger_conservation_check.residual_kobo = %d, want %d — the view's projection has drifted from the sign rule", got, want)
	}
}

// TestLiveDB_LedgerConservationSurvivesPosting proves the invariant is preserved
// by real postings rather than merely true of a quiescent table: it captures the
// residual, posts a balanced journal through the production ledger service, and
// re-checks. A replay of the same idempotency key must also leave it untouched.
func TestLiveDB_LedgerConservationSurvivesPosting(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t)
	defer pool.Close()

	svc := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))

	src, err := svc.GetOrCreateStandingAccount(ctx, ledger.AccountSettlement)
	if err != nil {
		t.Fatalf("standing account settlement: %v", err)
	}
	dst, err := svc.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
	if err != nil {
		t.Fatalf("standing account provider_clearing: %v", err)
	}

	before, _ := globalResidual(t, ctx, pool)

	idem := "wallet-conservation-" + uuid.New().String()
	journal := ledger.JournalEntry{
		Reference:       "wallet-conservation-test",
		IdempotencyKey:  idem,
		AmountKobo:      500_000, // the exact size of the observed top-up break
		DebitAccountID:  src.ID,
		CreditAccountID: dst.ID,
	}
	if err := svc.PostJournal(ctx, journal); err != nil {
		t.Fatalf("post journal: %v", err)
	}

	after, _ := globalResidual(t, ctx, pool)
	if after != before {
		t.Fatalf("residual moved from %d to %d kobo after a BALANCED posting — the posting was not balanced", before, after)
	}

	// Replaying the same key must be a no-op, not a second half-journal.
	if err := svc.PostJournal(ctx, journal); err != nil && err != ledger.ErrDuplicate {
		t.Fatalf("replay posting: %v", err)
	}

	afterReplay, _ := globalResidual(t, ctx, pool)
	if afterReplay != before {
		t.Fatalf("residual moved from %d to %d kobo after an idempotent REPLAY", before, afterReplay)
	}
}
