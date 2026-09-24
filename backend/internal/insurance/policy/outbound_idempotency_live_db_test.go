package policy

// ---------------------------------------------------------------------------
// LIVE-DB regression test for the bind-replay ORIGINAL-POLICY lookup.
//
// Found via live UAT execution (2026-09-17): BindFromQuote always creates a
// fresh Policy row BEFORE it learns whether the Idempotency-Key was already
// used. On replay it used to try to stamp the SAME provider_policy_ref onto
// that fresh row via SetBound — which insurance_policy's
// uq_insurance_policy_provider_ref unique index rejects (two rows can never
// share one provider policy ref), returning a raw 500 instead of the
// idempotent "same result back" the caller is owed, and leaving the fresh row
// stranded in BINDING forever (a state the FSM never resolves on its own).
//
// The fix threads the ORIGINAL policy_id through BindClaim so the replay path
// can look up and return the FIRST bound policy directly, instead of
// re-persisting onto the throwaway row. This test pins the low-level piece of
// that fix: Claim() must round-trip the original policy_id on a successful
// key, distinct from whatever policy_id a later (replay) caller passes in.
//
// Skipped unless TEST_DATABASE_URL is set.
// ---------------------------------------------------------------------------

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func liveBindRegistryPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping live-DB bind-registry test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping: %v", err)
	}
	return pool
}

func TestBindRegistry_Claim_ReplayReturnsOriginalPolicyID(t *testing.T) {
	pool := liveBindRegistryPool(t)
	ctx := context.Background()
	reg := NewBindRegistry(pool)

	key := "uat-regression-" + uuid.NewString()
	originalPolicyID := uuid.NewString()
	replayPolicyID := uuid.NewString() // a DIFFERENT fresh row, as the real saga creates on replay

	// First attempt: claims the key fresh, against originalPolicyID.
	c1, err := reg.Claim(ctx, key, "mycover", "test-product", originalPolicyID)
	if err != nil {
		t.Fatalf("first claim: %v", err)
	}
	if !c1.Fresh {
		t.Fatalf("expected first claim to be Fresh, got %+v", c1)
	}

	reg.Succeeded(ctx, key, "provider-ref-123", 50000)

	// Replay: a NEW caller passes a DIFFERENT (throwaway) policy id — this is
	// exactly what BindFromQuote does, since it creates the Policy row before
	// the claim check runs. Claim() must NOT report that new id back; it must
	// report the ORIGINAL one so the caller can void the throwaway row and
	// return the real, already-bound policy instead of crashing on a duplicate
	// provider_policy_ref.
	c2, err := reg.Claim(ctx, key, "mycover", "test-product", replayPolicyID)
	if err != nil {
		t.Fatalf("replay claim: %v", err)
	}
	if c2.Fresh {
		t.Fatalf("expected replay claim to be non-Fresh, got %+v", c2)
	}
	if c2.ProviderPolicyRef != "provider-ref-123" {
		t.Fatalf("expected provider ref to replay, got %q", c2.ProviderPolicyRef)
	}
	if c2.PolicyID != originalPolicyID {
		t.Fatalf("replay must report the ORIGINAL policy_id %q, got %q (this is the bug: it must never equal the throwaway replayPolicyID %q)",
			originalPolicyID, c2.PolicyID, replayPolicyID)
	}
}
