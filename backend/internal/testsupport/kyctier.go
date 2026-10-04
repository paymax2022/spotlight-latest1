package testsupport

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// KycTierUnlimited is the tier live-DB fixtures promote seeded users to. Tier 3
// carries no daily-debit cap and no max-balance cap, so fixture amounts never
// trip the limit paths the test is not exercising.
const KycTierUnlimited = 3

// SetKycTier promotes a seeded fixture user to a wallet-enabled KYC tier. The
// money-path tier gate (internal/finance/tiers) reads user_profiles.kyc_tier
// and refuses every debit at tier 0; the handle_new_user trigger leaves fixture
// rows at the default, so suites that exercise real debits must promote first.
// The upsert covers both orders — profile row already created by the trigger,
// or not yet.
func SetKycTier(t *testing.T, ctx context.Context, pool *pgxpool.Pool, userID string, tier int) {
	t.Helper()
	if _, err := pool.Exec(ctx, `
		INSERT INTO user_profiles (id, email, kyc_tier) VALUES ($1,$2,$3)
		ON CONFLICT (id) DO UPDATE SET kyc_tier = EXCLUDED.kyc_tier`,
		userID, userID+"@seed.test", tier); err != nil {
		t.Fatalf("set kyc_tier=%d for %s: %v", tier, userID, err)
	}
}
