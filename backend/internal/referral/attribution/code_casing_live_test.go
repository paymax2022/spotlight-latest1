package attribution_test

// LIVE-DB regression test for a legacy-code casing mismatch, independent of
// REF-002 (see resolve_code_live_test.go / rewards_service_test.go for that).
//
// finance/referrals.Service.GetOrCreateCode is the real code-issuing path behind
// GET /finance/referrals/me, and finance/referrals.Service.ResolveCodeToReferrer
// is the CodeResolver wired live into attribution.Service (see
// internal/app/referral_routes.go: newAttributionService). Before the fix,
// GetOrCreateCode minted lowercase hex codes while normalizeCode() in
// service.go uppercased every code entered at signup before resolving it, so a
// code a real user got from that endpoint could never attribute a referral —
// it always fell through to the house with risk_flag=invalid_code.
//
// The fix makes GetOrCreateCode issue codes via the canonical GenerateCode()
// (code.go), which — like SetLinkCode's admin-chosen codes — is already
// upper-case. This test proves the full path end to end: mint a code through
// the real handler-reachable service call, then resolve it through
// attribution.Service.ResolveReferrer exactly as a live signup would.
//
// Skipped unless TEST_DATABASE_URL is set.

import (
	"context"
	"os"
	"strings"
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

func liveCasingPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping referral code casing live-DB test")
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

func seedCasingUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool) string {
	t.Helper()
	id := uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
		id, id+"@casing.seed.test"); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	testsupport.CleanupUser(t, pool, id)
	return id
}

// newLiveAttributionService mirrors internal/app/referral_routes.go's
// newAttributionService wiring, using the SAME finance/referrals.Service as the
// CodeResolver so this test exercises the real production dependency graph.
func newLiveAttributionService(pool *pgxpool.Pool) (*attribution.Service, *referrals.Service) {
	financeLedgerSvc := financeledger.NewService(financeledger.NewRepository(pool), nil)
	codeSvc := referrals.NewService(pool, financeLedgerSvc)
	cfgSvc := referralconfig.NewService(pool)
	eventsSvc := referralevents.NewService(pool)
	houseSvc := referralhouse.NewService(pool)
	rewardSvc := referralledger.NewService(pool, financeLedgerSvc)
	return attribution.NewService(pool, codeSvc, houseSvc, rewardSvc, cfgSvc, eventsSvc), codeSvc
}

// TestLiveDB_GetOrCreateCode_IsUppercase pins the shape bug directly: a code
// minted via the real /finance/referrals/me path must already be in the form
// attribution's normalizeCode() will look it up in. Before the fix this failed
// because generateCode() emitted lowercase hex (e.g. "a1b2c3d4").
func TestLiveDB_GetOrCreateCode_IsUppercase(t *testing.T) {
	pool := liveCasingPool(t)
	ctx := context.Background()

	referrerID := seedCasingUser(t, ctx, pool)
	financeLedgerSvc := financeledger.NewService(financeledger.NewRepository(pool), nil)
	codeSvc := referrals.NewService(pool, financeLedgerSvc)

	code, err := codeSvc.GetOrCreateCode(ctx, referrerID)
	if err != nil {
		t.Fatalf("GetOrCreateCode: %v", err)
	}
	if code.Code != strings.ToUpper(code.Code) {
		t.Fatalf("GetOrCreateCode issued non-uppercase code %q — signups can never resolve it, "+
			"attribution.normalizeCode() upper-cases every entered code before lookup", code.Code)
	}

	// Idempotent re-fetch must return the same (still uppercase) code.
	again, err := codeSvc.GetOrCreateCode(ctx, referrerID)
	if err != nil {
		t.Fatalf("GetOrCreateCode (2nd call): %v", err)
	}
	if again.Code != code.Code {
		t.Fatalf("GetOrCreateCode not idempotent: got %q then %q", code.Code, again.Code)
	}
}

// TestLiveDB_ResolveReferrer_LegacyCode_EndToEnd proves the full chain: a code
// minted through the real handler-reachable GetOrCreateCode path resolves
// correctly through attribution.Service.ResolveReferrer, exactly as it would for
// a live signup that types in a friend's real referral code.
func TestLiveDB_ResolveReferrer_LegacyCode_EndToEnd(t *testing.T) {
	pool := liveCasingPool(t)
	ctx := context.Background()

	referrerID := seedCasingUser(t, ctx, pool)
	referredID := seedCasingUser(t, ctx, pool)

	attribSvc, codeSvc := newLiveAttributionService(pool)

	code, err := codeSvc.GetOrCreateCode(ctx, referrerID)
	if err != nil {
		t.Fatalf("GetOrCreateCode: %v", err)
	}

	att, err := attribSvc.ResolveReferrer(ctx, referredID, attribution.ResolveOpts{
		CodeEntered: code.Code,
	})
	if err != nil {
		t.Fatalf("ResolveReferrer: %v", err)
	}

	if att.IsHouse {
		t.Fatalf("ResolveReferrer routed to the house (risk_flag=%q) instead of the referrer — "+
			"the legacy code %q issued by GetOrCreateCode failed to resolve", att.RiskFlag, code.Code)
	}
	if att.AttributionType != attribution.TypeCode {
		t.Fatalf("attribution_type = %q, want %q", att.AttributionType, attribution.TypeCode)
	}
	if att.ReferrerID != referrerID {
		t.Fatalf("referrer_id = %q, want %q", att.ReferrerID, referrerID)
	}
	if att.RiskFlag == attribution.RiskInvalidCode {
		t.Fatalf("risk_flag = invalid_code — code %q did not resolve", code.Code)
	}
}

// TestLiveDB_ResolveReferrer_LegacyCode_CaseInsensitiveEntry proves a friend
// typing the code in lowercase (as humans do) still resolves, since
// normalizeCode() upper-cases the entered value — this only works because the
// STORED code is already uppercase after the fix.
func TestLiveDB_ResolveReferrer_LegacyCode_CaseInsensitiveEntry(t *testing.T) {
	pool := liveCasingPool(t)
	ctx := context.Background()

	referrerID := seedCasingUser(t, ctx, pool)
	referredID := seedCasingUser(t, ctx, pool)

	attribSvc, codeSvc := newLiveAttributionService(pool)

	code, err := codeSvc.GetOrCreateCode(ctx, referrerID)
	if err != nil {
		t.Fatalf("GetOrCreateCode: %v", err)
	}

	att, err := attribSvc.ResolveReferrer(ctx, referredID, attribution.ResolveOpts{
		CodeEntered: strings.ToLower(code.Code),
	})
	if err != nil {
		t.Fatalf("ResolveReferrer: %v", err)
	}
	if att.IsHouse || att.ReferrerID != referrerID {
		t.Fatalf("lowercase entry of code %q failed to attribute to %q: is_house=%v referrer_id=%q risk_flag=%q",
			code.Code, referrerID, att.IsHouse, att.ReferrerID, att.RiskFlag)
	}
}
