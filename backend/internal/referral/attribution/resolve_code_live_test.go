package attribution_test

// Live-DB regression coverage for REF-002: a referral code minted through the
// Direct Referral Rewards Engine (System B, referral_links) must attribute
// correctly through the §7A signup-attribution engine (System A), exactly like
// a legacy finance_referral_codes code always has.
//
// SKIPPED whenever TEST_DATABASE_URL is unset (same convention as
// internal/finance/referrals/rewards_service_test.go). Point it at a disposable,
// migrated Postgres:
//
//	TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres' \
//	  go test ./internal/referral/attribution/... -v

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	financeledger "spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/referrals"
	"spotlight/backend/internal/referral/attribution"
	referralconfig "spotlight/backend/internal/referral/config"
	referralevents "spotlight/backend/internal/referral/events"
	referralhouse "spotlight/backend/internal/referral/house"
	referralledger "spotlight/backend/internal/referral/ledger"
	"spotlight/backend/internal/testsupport"
)

func liveAttribPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping live-DB attribution test")
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

func mustAttribExec(t *testing.T, pool *pgxpool.Pool, sql string, args ...any) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), sql, args...); err != nil {
		t.Fatalf("exec %q: %v", sql, err)
	}
}

func seedAttribUser(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	uid := uuid.NewString()
	mustAttribExec(t, pool, `INSERT INTO auth.users (id, email) VALUES ($1,$2)`,
		uid, "attrib-"+uid+"@test.local")
	testsupport.CleanupUser(t, pool, uid)
	return uid
}

// newLiveAttributionService builds the §7A service exactly the way
// internal/app/referral_routes.go wires it in production (post REF-002 fix):
// the CodeResolver is finance/referrals.RewardService, which checks
// referral_links THEN the legacy finance_referral_codes table.
func newLiveAttributionService(pool *pgxpool.Pool) *attribution.Service {
	fin := financeledger.NewService(financeledger.NewRepository(pool), nil)
	codeSvc := referrals.NewRewardService(pool, fin)
	cfgSvc := referralconfig.NewService(pool)
	eventsSvc := referralevents.NewService(pool)
	houseSvc := referralhouse.NewService(pool)
	rewardSvc := referralledger.NewService(pool, fin)
	return attribution.NewService(pool, codeSvc, houseSvc, rewardSvc, cfgSvc, eventsSvc)
}

// TestResolveReferrer_CodeMintedViaReferralLinks_Integration is the REF-002
// regression: a code that lives ONLY in referral_links (never touched the
// legacy finance_referral_codes table) — exactly what RewardService.
// GetOrCreateLink mints — must resolve to the real referrer, not the house.
func TestResolveReferrer_CodeMintedViaReferralLinks_Integration(t *testing.T) {
	ctx := context.Background()
	pool := liveAttribPool(t)
	t.Cleanup(pool.Close)

	referrer := seedAttribUser(t, pool)
	referred := seedAttribUser(t, pool)

	fin := financeledger.NewService(financeledger.NewRepository(pool), nil)
	rewardSvc := referrals.NewRewardService(pool, fin)
	link, err := rewardSvc.GetOrCreateLink(ctx, referrer)
	if err != nil {
		t.Fatalf("GetOrCreateLink: %v", err)
	}

	// Sanity: the code must NOT exist in the legacy table, or this test would
	// not actually exercise the referral_links path.
	var legacyCount int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM finance_referral_codes WHERE code = $1`, link.Code,
	).Scan(&legacyCount); err != nil {
		t.Fatalf("check legacy table: %v", err)
	}
	if legacyCount != 0 {
		t.Fatalf("test setup invalid: code %q unexpectedly present in finance_referral_codes", link.Code)
	}

	svc := newLiveAttributionService(pool)
	att, err := svc.ResolveReferrer(ctx, referred, attribution.ResolveOpts{CodeEntered: link.Code})
	if err != nil {
		t.Fatalf("ResolveReferrer: %v", err)
	}

	if att.IsHouse {
		t.Fatalf("attribution routed to house (risk_flag=%q); want direct attribution to referrer %s", att.RiskFlag, referrer)
	}
	if att.RiskFlag == attribution.RiskInvalidCode {
		t.Fatalf("attribution carries RiskInvalidCode; the referral_links-only code was not recognized")
	}
	if att.ReferrerID != referrer {
		t.Fatalf("referrer_id = %q, want %q", att.ReferrerID, referrer)
	}
	if att.AttributionType != attribution.TypeCode {
		t.Fatalf("attribution_type = %q, want %q", att.AttributionType, attribution.TypeCode)
	}
}

// TestResolveReferrer_LegacyFinanceReferralCode_StillWorks_Integration is the
// reverse-regression guard: a code that lives ONLY in the legacy
// finance_referral_codes table (never touched referral_links) must keep
// resolving correctly — the fix must not break the path that already worked.
//
// The code is seeded in upper-case here to isolate the REF-002 fix itself
// ("does the resolver's finance_referral_codes fallback still work at all")
// from case handling, which has its own dedicated regression test below
// (TestResolveReferrer_LegacyFinanceReferralCode_LowercaseStored_Integration,
// REF-008).
func TestResolveReferrer_LegacyFinanceReferralCode_StillWorks_Integration(t *testing.T) {
	ctx := context.Background()
	pool := liveAttribPool(t)
	t.Cleanup(pool.Close)

	referrer := seedAttribUser(t, pool)
	referred := seedAttribUser(t, pool)

	const legacyCode = "LEGACY1"
	mustAttribExec(t, pool,
		`INSERT INTO finance_referral_codes (user_id, code) VALUES ($1,$2)`,
		referrer, legacyCode)

	// Sanity: the code must NOT exist in referral_links.
	var linksCount int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM referral_links WHERE code = $1`, legacyCode,
	).Scan(&linksCount); err != nil {
		t.Fatalf("check referral_links: %v", err)
	}
	if linksCount != 0 {
		t.Fatalf("test setup invalid: code %q unexpectedly present in referral_links", legacyCode)
	}

	svc := newLiveAttributionService(pool)
	att, err := svc.ResolveReferrer(ctx, referred, attribution.ResolveOpts{CodeEntered: legacyCode})
	if err != nil {
		t.Fatalf("ResolveReferrer: %v", err)
	}

	if att.IsHouse {
		t.Fatalf("attribution routed to house (risk_flag=%q); want direct attribution to referrer %s", att.RiskFlag, referrer)
	}
	if att.ReferrerID != referrer {
		t.Fatalf("referrer_id = %q, want %q", att.ReferrerID, referrer)
	}
}

// TestResolveReferrer_LegacyFinanceReferralCode_LowercaseStored_Integration is
// the REF-008 regression: normalizeCode() (service.go) upper-cases whatever
// the signup form sends before calling CodeResolver.ResolveCodeToReferrer, but
// the legacy generator that used to write into finance_referral_codes emitted
// lower-case hex — so a code generated before the REF-004/REF-008 fix landed
// (and any code stored in a case other than what was typed) previously never
// matched and always fell through to the house with RiskInvalidCode. The
// resolution-side fix (case-insensitive match against finance_referral_codes)
// must make this resolve correctly regardless of the stored row's case.
func TestResolveReferrer_LegacyFinanceReferralCode_LowercaseStored_Integration(t *testing.T) {
	ctx := context.Background()
	pool := liveAttribPool(t)
	t.Cleanup(pool.Close)

	referrer := seedAttribUser(t, pool)
	referred := seedAttribUser(t, pool)

	// Lower-case, exactly the shape the pre-fix legacy generator produced.
	const legacyCode = "legacy2"
	mustAttribExec(t, pool,
		`INSERT INTO finance_referral_codes (user_id, code) VALUES ($1,$2)`,
		referrer, legacyCode)

	svc := newLiveAttributionService(pool)
	// Entered in a different case than stored — normalizeCode() will upper-case
	// this before it ever reaches the resolver.
	att, err := svc.ResolveReferrer(ctx, referred, attribution.ResolveOpts{CodeEntered: "LEGACY2"})
	if err != nil {
		t.Fatalf("ResolveReferrer: %v", err)
	}

	if att.IsHouse {
		t.Fatalf("attribution routed to house (risk_flag=%q); want direct attribution to referrer %s — "+
			"a lowercase-stored legacy code must still resolve (REF-008)", att.RiskFlag, referrer)
	}
	if att.ReferrerID != referrer {
		t.Fatalf("referrer_id = %q, want %q", att.ReferrerID, referrer)
	}
}

// TestResolveReferrer_UnknownCode_RoutesToHouseWithRiskFlag_Integration proves
// the fix did not make every code "valid": a code present in neither table must
// still fall through to the house with RiskInvalidCode.
func TestResolveReferrer_UnknownCode_RoutesToHouseWithRiskFlag_Integration(t *testing.T) {
	ctx := context.Background()
	pool := liveAttribPool(t)
	t.Cleanup(pool.Close)

	referred := seedAttribUser(t, pool)

	svc := newLiveAttributionService(pool)
	att, err := svc.ResolveReferrer(ctx, referred, attribution.ResolveOpts{CodeEntered: "NOSUCHCODE-" + uuid.NewString()})
	if err != nil {
		t.Fatalf("ResolveReferrer: %v", err)
	}

	if !att.IsHouse {
		t.Fatalf("attribution.IsHouse = false, want true (unknown code must route to house)")
	}
	if att.RiskFlag != attribution.RiskInvalidCode {
		t.Fatalf("risk_flag = %q, want %q", att.RiskFlag, attribution.RiskInvalidCode)
	}
	if att.ReferrerID != "" {
		t.Fatalf("referrer_id = %q, want empty for a house attribution", att.ReferrerID)
	}
}
