package cryptosvc

// Live-DB tests for the production adapters. SKIPPED unless TEST_DATABASE_URL is set.

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/testsupport"
)

func seedPlatformUser(t *testing.T, r *liveRig, status string, tier int) string {
	t.Helper()
	ctx := context.Background()
	u := uuid.NewString()
	if _, err := r.pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test"); err != nil {
		t.Fatal(err)
	}
	testsupport.CleanupUserCtx(t, ctx, r.pool, u)
	if _, err := r.pool.Exec(ctx,
		`INSERT INTO public.platform_users (id, email, first_name, last_name, status, user_type, password_hash)
		 VALUES ($1::uuid, $2, 'Ada', 'Obi', $3, 'member', 'x')
		 ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, first_name = 'Ada', last_name = 'Obi'`,
		u, u+"@seed.test", status); err != nil {
		t.Skipf("cannot seed platform_users in this schema: %v", err)
	}
	testsupport.SetKycTier(t, ctx, r.pool, u, tier)
	return u
}

func TestLive_TierTradeGate(t *testing.T) {
	r := newLiveRig(t, 1, 0)
	g := &TierTradeGate{Pool: r.pool, Tiers: tiers.NewService(r.pool), MinTier: tiers.Tier1}
	ctx := context.Background()

	ok := seedPlatformUser(t, r, "active", 1)
	if err := g.CanTrade(ctx, ok); err != nil {
		t.Fatalf("active tier-1 refused: %v", err)
	}
	low := seedPlatformUser(t, r, "active", 0)
	if err := g.CanTrade(ctx, low); !errors.Is(err, ErrTradeNotAllowed) {
		t.Fatalf("tier 0 -> %v", err)
	}
	frozen := seedPlatformUser(t, r, "suspended", 2)
	if err := g.CanTrade(ctx, frozen); !errors.Is(err, ErrTradeNotAllowed) {
		t.Fatalf("suspended -> %v", err)
	}
	if err := g.CanTrade(ctx, uuid.NewString()); !errors.Is(err, ErrTradeNotAllowed) {
		t.Fatalf("unknown user -> %v", err)
	}
	if err := (&TierTradeGate{}).CanTrade(ctx, ok); !errors.Is(err, ErrTradeNotAllowed) {
		t.Fatalf("unconfigured gate allowed trading: %v", err)
	}
}

func TestLive_UserDirectory(t *testing.T) {
	r := newLiveRig(t, 1, 0)
	u := seedPlatformUser(t, r, "active", 1)
	ref, err := (&PGUserDirectory{Pool: r.pool}).UserRef(context.Background(), u)
	if err != nil || ref.UserID != u || ref.FirstName != "Ada" || ref.LastName != "Obi" || ref.Email == "" {
		t.Fatalf("ref = %+v, %v", ref, err)
	}
	if _, err := (&PGUserDirectory{Pool: r.pool}).UserRef(context.Background(), uuid.NewString()); err == nil {
		t.Fatal("an unknown user produced a provider identity")
	}
}
