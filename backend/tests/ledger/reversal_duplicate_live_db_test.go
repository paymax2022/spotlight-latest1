package ledger_test

// ---------------------------------------------------------------------------
// PostReversalPair (backend/internal/finance/ledger/repository.go) is the ONLY
// correction primitive callers like marketplace CancelBoost/RejectBoost use to
// auto-refund. PostJournal translates a Postgres unique-violation (23505) on
// idempotency_key into the typed ErrDuplicate on BOTH legs (see
// TestLiveDB_LedgerConservationSurvivesPosting's replay assertion, which runs
// against a NIL Redis client — proving PostJournal's DB-level fallback alone
// is sufficient). PostReversalPair never got the same treatment: a replayed
// reversal (double-click, client retry, at-least-once webhook) hits the
// unique index and returns a generic wrapped error instead of ErrDuplicate,
// UNLESS Redis is up and its lock happens to catch the replay first.
//
// Found by a peer session's ledger audit (new-6f), confirmed by reading
// repository.go directly: PostJournal checks isUniqueViolation on both
// inserts; PostReversalPair checks neither.
// ---------------------------------------------------------------------------

import (
	"context"
	"testing"

	"github.com/google/uuid"
	goredis "github.com/redis/go-redis/v9"

	"spotlight/backend/internal/finance/ledger"
)

// TestLiveDB_PostReversal_DuplicateIsErrDuplicate_NoRedis proves the DB-level
// fallback works EVEN WITHOUT Redis — the exact scenario the peer flagged:
// Redis unset/unreachable, or its lock TTL elapsed between two attempts. A nil
// Redis client here means Service.PostReversal's lock-based short-circuit
// never runs, so the assertion can only pass if the repository itself
// translates the unique-violation.
func TestLiveDB_PostReversal_DuplicateIsErrDuplicate_NoRedis(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)

	svc := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))

	restore, err := svc.GetOrCreateStandingAccount(ctx, ledger.AccountSettlement)
	if err != nil {
		t.Fatalf("standing account settlement: %v", err)
	}
	release, err := svc.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
	if err != nil {
		t.Fatalf("standing account provider_clearing: %v", err)
	}

	before, _ := globalResidual(t, ctx, pool)

	idem := "reversal-duplicate-test-" + uuid.New().String()
	if err := svc.PostReversal(ctx, restore.ID, release.ID, 12345, "reversal-duplicate-test", idem); err != nil {
		t.Fatalf("first reversal: %v", err)
	}

	after, _ := globalResidual(t, ctx, pool)
	if after != before {
		t.Fatalf("residual moved from %d to %d kobo after a BALANCED reversal", before, after)
	}

	// The replay — this is the actual bug under test. With no Redis lock to
	// catch it first, this call reaches the DB and hits the unique index on
	// idempotency_key. It MUST come back as ledger.ErrDuplicate, matching
	// PostJournal's contract, not a generic wrapped error.
	replayErr := svc.PostReversal(ctx, restore.ID, release.ID, 12345, "reversal-duplicate-test", idem)
	if replayErr == nil {
		t.Fatal("a replayed reversal posted a SECOND time — the unique index did not stop it")
	}
	if replayErr != ledger.ErrDuplicate {
		t.Fatalf("replayed reversal returned %v, want ledger.ErrDuplicate — callers (e.g. marketplace CancelBoost/RejectBoost) that tolerate ErrDuplicate as a no-op will instead surface this as a hard failure whenever Redis is unavailable", replayErr)
	}

	afterReplay, _ := globalResidual(t, ctx, pool)
	if afterReplay != before {
		t.Fatalf("residual moved from %d to %d kobo after an idempotent REPLAY — the replay posted a second (unbalancing) entry", before, afterReplay)
	}
}
