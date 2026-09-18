package app

// ---------------------------------------------------------------------------
// LIVE-DB regression: NewSignupAttributor is the ONE function every Go-backed
// signup calls (frontend-web and mobile-app both funnel through
// POST /api/auth/register — see handlers.AuthHandler.Register). This pins the
// exact composed behavior now wired into production: the §7A engine runs
// first (unchanged), and Module 8's AttributeOrDefault runs second and CLAIMS
// §7A's house-fallback placeholder (referrer_id NULL) rather than silently
// no-op'ing against it — without this claim, "every user has a referrer"
// (the whole point of the Refer & Earn modification) would never actually
// take effect for a real signup, since §7A runs on every one of them today.
//
// SKIPPED whenever TEST_DATABASE_URL is unset — same gate as the other
// live-DB suites in this package.
//
//	export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//	cd backend && go test ./internal/app/... -run SignupAttributor -v
// ---------------------------------------------------------------------------

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/referrals"
	"spotlight/backend/internal/testsupport"
)

func attributorPoolOrSkip(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping live-DB test")
	}
	p, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(p.Close)
	return p
}

func seedAttributorUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool) string {
	t.Helper()
	id := uuid.NewString()
	if _, err := pool.Exec(ctx,
		`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, id, "signup-attr-"+id+"@seed.test"); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	testsupport.CleanupUser(t, pool, id)
	return id
}

func withSignupAttributorAdmin(t *testing.T, ctx context.Context, pool *pgxpool.Pool) string {
	t.Helper()
	adminID := seedAttributorUser(t, ctx, pool)
	prev, had := os.LookupEnv(referrals.EnvSuperAdminUserID)
	if err := os.Setenv(referrals.EnvSuperAdminUserID, adminID); err != nil {
		t.Fatalf("set admin env: %v", err)
	}
	t.Cleanup(func() {
		if had {
			_ = os.Setenv(referrals.EnvSuperAdminUserID, prev)
		} else {
			_ = os.Unsetenv(referrals.EnvSuperAdminUserID)
		}
	})
	return adminID
}

// TestLiveDB_SignupAttributor_NoCodeEndsUpAttributedToAdmin drives the EXACT
// production closure (NewSignupAttributor's return value), not just Module
// 8's own method in isolation, with an empty referral code — the case every
// frontend-web signup hits today (no referral-code field exists there yet)
// and the case a mobile signup hits whenever the user leaves the field blank.
func TestLiveDB_SignupAttributor_NoCodeEndsUpAttributedToAdmin(t *testing.T) {
	pool := attributorPoolOrSkip(t)
	ctx := context.Background()
	adminID := withSignupAttributorAdmin(t, ctx, pool)
	user := seedAttributorUser(t, ctx, pool)

	attributor := NewSignupAttributor(pool)
	if attributor == nil {
		t.Fatal("NewSignupAttributor returned nil for a non-nil pool")
	}
	if err := attributor(ctx, user, ""); err != nil {
		t.Fatalf("signup attributor: %v", err)
	}

	var referrerID *string
	if err := pool.QueryRow(ctx,
		`SELECT referrer_id FROM referral_attributions WHERE referred_user_id=$1`, user).Scan(&referrerID); err != nil {
		t.Fatalf("read attribution: %v", err)
	}
	if referrerID == nil || *referrerID != adminID {
		t.Errorf("referrer_id = %v, want Admin %q — the §7A house-fallback placeholder must be CLAIMED, not left null", referrerID, adminID)
	}

	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), nil)
	rewardSvc := referrals.NewRewardService(pool, ledgerSvc)
	points, err := rewardSvc.TotalPoints(ctx, user)
	if err != nil {
		t.Fatalf("TotalPoints: %v", err)
	}
	if points != referrals.SignupPoints {
		t.Errorf("signup points = %d, want %d — the signup hook must award the point even on a no-code signup", points, referrals.SignupPoints)
	}
}

// TestLiveDB_SignupAttributor_RealCodeAttributesToTheRealReferrer proves the
// fix for the sequencing bug this wiring pass caught: a real referral code
// passed into the SAME call the client's own register() request now carries
// it in (rather than a separate follow-up call racing against an
// already-locked-in Admin default) attributes to the real referrer, not Admin.
func TestLiveDB_SignupAttributor_RealCodeAttributesToTheRealReferrer(t *testing.T) {
	pool := attributorPoolOrSkip(t)
	ctx := context.Background()
	withSignupAttributorAdmin(t, ctx, pool)
	referrer := seedAttributorUser(t, ctx, pool)
	user := seedAttributorUser(t, ctx, pool)

	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), nil)
	rewardSvc := referrals.NewRewardService(pool, ledgerSvc)
	link, err := rewardSvc.GetOrCreateLink(ctx, referrer)
	if err != nil {
		t.Fatalf("GetOrCreateLink: %v", err)
	}

	attributor := NewSignupAttributor(pool)
	if err := attributor(ctx, user, link.Code); err != nil {
		t.Fatalf("signup attributor: %v", err)
	}

	var referrerID *string
	if err := pool.QueryRow(ctx,
		`SELECT referrer_id FROM referral_attributions WHERE referred_user_id=$1`, user).Scan(&referrerID); err != nil {
		t.Fatalf("read attribution: %v", err)
	}
	if referrerID == nil || *referrerID != referrer {
		t.Errorf("referrer_id = %v, want the real referrer %q — a real code passed at signup must win, not the Admin default", referrerID, referrer)
	}
}
