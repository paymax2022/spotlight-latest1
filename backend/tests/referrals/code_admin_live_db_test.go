package referrals_test

// Live-DB coverage for admin-chosen referral codes.
//
// The unit tests in internal/finance/referrals cover the code SHAPE. What needs
// a database is UNIQUENESS, because the rule spans two tables that only the
// database knows about — and getting it wrong silently redirects one user's
// referral rewards to another.

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/referrals"
)

func poolOrSkip(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping live-DB test")
	}
	p, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	// Registered first so it runs last; every fixture teardown below still needs
	// an open pool (cleanups are last-in-first-out).
	t.Cleanup(p.Close)
	return p
}

func newUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool) string {
	t.Helper()
	id := uuid.NewString()
	if _, err := pool.Exec(ctx,
		`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, id, "zzref-"+id+"@seed.test"); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	t.Cleanup(func() {
		c := context.Background()
		_, _ = pool.Exec(c, `DELETE FROM public.referral_links WHERE referrer_id=$1`, id)
		_, _ = pool.Exec(c, `DELETE FROM public.finance_referral_codes WHERE user_id=$1`, id)
		_, _ = pool.Exec(c, `DELETE FROM auth.users WHERE id=$1`, id)
	})
	return id
}

func svc(pool *pgxpool.Pool) *referrals.RewardService {
	return referrals.NewRewardService(pool, ledger.NewService(ledger.NewRepository(pool), nil))
}

// The headline requirement: issued codes are 5 characters, not 11.
func TestLiveDB_ReferralCode_IssuedCodeIsFiveChars(t *testing.T) {
	pool := poolOrSkip(t)
	ctx := context.Background()
	s := svc(pool)

	link, err := s.GetOrCreateLink(ctx, newUser(t, ctx, pool))
	if err != nil {
		t.Fatalf("GetOrCreateLink: %v", err)
	}
	if n := len([]rune(link.Code)); n != referrals.CodeMaxLen {
		t.Errorf("issued code %q is %d chars, want %d", link.Code, n, referrals.CodeMaxLen)
	}
	if err := referrals.ValidateCode(link.Code); err != nil {
		t.Errorf("issued code %q fails validation: %v", link.Code, err)
	}
}

func TestLiveDB_ReferralCode_AdminCanSetACustomCode(t *testing.T) {
	pool := poolOrSkip(t)
	ctx := context.Background()
	s := svc(pool)
	user := newUser(t, ctx, pool)

	link, err := s.SetLinkCode(ctx, user, "jide4") // lowercase on purpose
	if err != nil {
		t.Fatalf("SetLinkCode: %v", err)
	}
	if link.Code != "JIDE4" {
		t.Errorf("stored code = %q, want the normalised JIDE4", link.Code)
	}

	// And it is what the user's own screen will show.
	back, err := s.GetOrCreateLink(ctx, user)
	if err != nil {
		t.Fatalf("re-read: %v", err)
	}
	if back.Code != "JIDE4" {
		t.Errorf("re-read code = %q, want JIDE4", back.Code)
	}
}

// The requirement: check for a duplicate before saving.
func TestLiveDB_ReferralCode_RefusesACodeAnotherUserHolds(t *testing.T) {
	pool := poolOrSkip(t)
	ctx := context.Background()
	s := svc(pool)
	first, second := newUser(t, ctx, pool), newUser(t, ctx, pool)

	if _, err := s.SetLinkCode(ctx, first, "TAKEN"); err != nil {
		t.Fatalf("seed first code: %v", err)
	}
	_, err := s.SetLinkCode(ctx, second, "TAKEN")
	if !errors.Is(err, referrals.ErrCodeTaken) {
		t.Fatalf("second user got %v, want ErrCodeTaken — two people would share one code", err)
	}
	// The first owner must be untouched.
	back, _ := s.GetOrCreateLink(ctx, first)
	if back.Code != "TAKEN" {
		t.Errorf("first owner's code became %q — a rejected write still mutated it", back.Code)
	}
}

// Case-folding matters: without normalisation "taken" would pass the duplicate
// check against a stored "TAKEN" and both rows would exist.
func TestLiveDB_ReferralCode_DuplicateCheckIgnoresCase(t *testing.T) {
	pool := poolOrSkip(t)
	ctx := context.Background()
	s := svc(pool)
	first, second := newUser(t, ctx, pool), newUser(t, ctx, pool)

	if _, err := s.SetLinkCode(ctx, first, "MIXED"); err != nil {
		t.Fatalf("seed: %v", err)
	}
	if _, err := s.SetLinkCode(ctx, second, "mixed"); !errors.Is(err, referrals.ErrCodeTaken) {
		t.Fatalf("lowercase variant got %v, want ErrCodeTaken", err)
	}
}

// THE ONE THAT MATTERS MOST. Attribution resolves referral_links FIRST and falls
// back to finance_referral_codes. A link code equal to a LEGACY code would mean
// every signup typing it credits the new owner, and the legacy owner silently
// stops being paid — no error raised anywhere. A one-table check ships that bug.
func TestLiveDB_ReferralCode_RefusesACodeHeldInTheLegacyTable(t *testing.T) {
	pool := poolOrSkip(t)
	ctx := context.Background()
	s := svc(pool)
	legacyOwner, newcomer := newUser(t, ctx, pool), newUser(t, ctx, pool)

	if _, err := pool.Exec(ctx,
		`INSERT INTO public.finance_referral_codes (user_id, code) VALUES ($1, 'LEGCY')`, legacyOwner); err != nil {
		t.Fatalf("seed legacy code: %v", err)
	}

	_, err := s.SetLinkCode(ctx, newcomer, "LEGCY")
	if !errors.Is(err, referrals.ErrCodeTaken) {
		t.Fatalf("got %v, want ErrCodeTaken — this would hijack the legacy owner's attribution", err)
	}
}

// Re-submitting a user's own code is a no-op, not an error: the admin UI must
// not report failure when someone double-clicks save.
func TestLiveDB_ReferralCode_ReassigningYourOwnCodeSucceeds(t *testing.T) {
	pool := poolOrSkip(t)
	ctx := context.Background()
	s := svc(pool)
	user := newUser(t, ctx, pool)

	if _, err := s.SetLinkCode(ctx, user, "SAME4"); err != nil {
		t.Fatalf("first set: %v", err)
	}
	link, err := s.SetLinkCode(ctx, user, "SAME4")
	if err != nil {
		t.Fatalf("re-setting the same code errored: %v", err)
	}
	if link.Code != "SAME4" {
		t.Errorf("code = %q, want SAME4", link.Code)
	}
}

func TestLiveDB_ReferralCode_RejectsBadShapesBeforeTouchingTheDatabase(t *testing.T) {
	pool := poolOrSkip(t)
	ctx := context.Background()
	s := svc(pool)
	user := newUser(t, ctx, pool)

	for _, bad := range []string{"", "AB", "TOOLONG", "R3F9A2B1C4D", "AB CD", "AB-CD"} {
		if _, err := s.SetLinkCode(ctx, user, bad); err == nil {
			t.Errorf("SetLinkCode accepted %q", bad)
		} else if errors.Is(err, referrals.ErrCodeTaken) {
			t.Errorf("SetLinkCode(%q) reported a duplicate; want a validation error", bad)
		}
	}
}
