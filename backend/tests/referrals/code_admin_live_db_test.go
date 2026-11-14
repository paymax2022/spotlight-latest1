package referrals_test

// Live-DB coverage for admin-chosen referral codes.
// The unit tests in internal/finance/referrals cover the code SHAPE. What needs
// a database is UNIQUENESS, because the rule spans two tables that only the
// database knows about — and getting it wrong silently redirects one user's
// referral rewards to another.

import (
	"context"
	"errors"
	"os"
	"strings"
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
	p, err := pgxpool.New(t.Context(), dsn)
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
		c := context.WithoutCancel(t.Context())
		_, _ = pool.Exec(c, `DELETE FROM public.referral_links WHERE referrer_id=$1`, id)
		_, _ = pool.Exec(c, `DELETE FROM public.finance_referral_codes WHERE user_id=$1`, id)
		_, _ = pool.Exec(c, `DELETE FROM auth.users WHERE id=$1`, id)
	})
	return id
}

func svc(pool *pgxpool.Pool) *referrals.RewardService {
	return referrals.NewRewardService(pool, ledger.NewService(ledger.NewRepository(pool), nil))
}

// freshCode issues a code no other run can be holding. The rules these tests
// cover are RELATIONAL — owner A versus owner B, link table versus legacy table —
// so a literal code buys nothing, and a previous run's leaked copy of that
// literal makes the next run see ErrCodeTaken for a reason that has nothing to do
// with the product rule. TEST_STRATEGY: seed with fresh values, assert against
// those.
func freshCode(t *testing.T, ctx context.Context, pool *pgxpool.Pool) string {
	t.Helper()
	for attempt := 0; attempt < 8; attempt++ {
		// The leading letter is not decoration: a code drawn as pure hex can come
		// out as five digits, and strings.ToLower of that is the same string, which
		// would make the case-folding test pass without folding anything.
		code := "Z" + strings.ToUpper(uuid.NewString()[:4])
		var taken bool
		if err := pool.QueryRow(ctx, `
			SELECT EXISTS (
				SELECT 1 FROM public.referral_links WHERE code=$1
				UNION ALL SELECT 1 FROM public.finance_referral_codes WHERE code=$1)`,
			code).Scan(&taken); err != nil {
			t.Fatalf("probe code %s: %v", code, err)
		}
		if !taken {
			return code
		}
	}
	t.Fatalf("no free 5-character code in eight attempts — the code space is not what this test assumed")
	return ""
}

// The headline requirement: issued codes are 5 characters, not 11.
func TestLiveDB_ReferralCode_IssuedCodeIsFiveChars(t *testing.T) {
	pool := poolOrSkip(t)
	ctx := t.Context()
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
	ctx := t.Context()
	s := svc(pool)
	user := newUser(t, ctx, pool)
	code := freshCode(t, ctx, pool)

	link, err := s.SetLinkCode(ctx, user, strings.ToLower(code)) // lowercase on purpose
	if err != nil {
		t.Fatalf("SetLinkCode: %v", err)
	}
	if link.Code != code {
		t.Errorf("stored code = %q, want the normalised %s", link.Code, code)
	}

	// And it is what the user's own screen will show.
	back, err := s.GetOrCreateLink(ctx, user)
	if err != nil {
		t.Fatalf("re-read: %v", err)
	}
	if back.Code != code {
		t.Errorf("re-read code = %q, want %s", back.Code, code)
	}
}

// The requirement: check for a duplicate before saving.
func TestLiveDB_ReferralCode_RefusesACodeAnotherUserHolds(t *testing.T) {
	pool := poolOrSkip(t)
	ctx := t.Context()
	s := svc(pool)
	first, second := newUser(t, ctx, pool), newUser(t, ctx, pool)
	code := freshCode(t, ctx, pool)

	if _, err := s.SetLinkCode(ctx, first, code); err != nil {
		t.Fatalf("seed first code: %v", err)
	}
	_, err := s.SetLinkCode(ctx, second, code)
	if !errors.Is(err, referrals.ErrCodeTaken) {
		t.Fatalf("second user got %v, want ErrCodeTaken — two people would share one code", err)
	}
	// The first owner must be untouched.
	back, _ := s.GetOrCreateLink(ctx, first)
	if back.Code != code {
		t.Errorf("first owner's code became %q — a rejected write still mutated it", back.Code)
	}
}

// Case-folding matters: without normalisation "taken" would pass the duplicate
// check against a stored "TAKEN" and both rows would exist.
func TestLiveDB_ReferralCode_DuplicateCheckIgnoresCase(t *testing.T) {
	pool := poolOrSkip(t)
	ctx := t.Context()
	s := svc(pool)
	first, second := newUser(t, ctx, pool), newUser(t, ctx, pool)
	code := freshCode(t, ctx, pool)

	if _, err := s.SetLinkCode(ctx, first, code); err != nil {
		t.Fatalf("seed: %v", err)
	}
	if _, err := s.SetLinkCode(ctx, second, strings.ToLower(code)); !errors.Is(err, referrals.ErrCodeTaken) {
		t.Fatalf("lowercase variant got %v, want ErrCodeTaken", err)
	}
}

// THE ONE THAT MATTERS MOST. Attribution resolves referral_links FIRST and falls
// back to finance_referral_codes. A link code equal to a LEGACY code would mean
// every signup typing it credits the new owner, and the legacy owner silently
// stops being paid — no error raised anywhere. A one-table check ships that bug.
func TestLiveDB_ReferralCode_RefusesACodeHeldInTheLegacyTable(t *testing.T) {
	pool := poolOrSkip(t)
	ctx := t.Context()
	s := svc(pool)
	legacyOwner, newcomer := newUser(t, ctx, pool), newUser(t, ctx, pool)
	code := freshCode(t, ctx, pool)

	if _, err := pool.Exec(ctx,
		`INSERT INTO public.finance_referral_codes (user_id, code) VALUES ($1, $2)`, legacyOwner, code); err != nil {
		t.Fatalf("seed legacy code: %v", err)
	}

	_, err := s.SetLinkCode(ctx, newcomer, code)
	if !errors.Is(err, referrals.ErrCodeTaken) {
		t.Fatalf("got %v, want ErrCodeTaken — this would hijack the legacy owner's attribution", err)
	}
}

// Re-submitting a user's own code is a no-op, not an error: the admin UI must
// not report failure when someone double-clicks save.
func TestLiveDB_ReferralCode_ReassigningYourOwnCodeSucceeds(t *testing.T) {
	pool := poolOrSkip(t)
	ctx := t.Context()
	s := svc(pool)
	user := newUser(t, ctx, pool)
	code := freshCode(t, ctx, pool)

	if _, err := s.SetLinkCode(ctx, user, code); err != nil {
		t.Fatalf("first set: %v", err)
	}
	link, err := s.SetLinkCode(ctx, user, code)
	if err != nil {
		t.Fatalf("re-setting the same code errored: %v", err)
	}
	if link.Code != code {
		t.Errorf("code = %q, want %s", link.Code, code)
	}
}

func TestLiveDB_ReferralCode_RejectsBadShapesBeforeTouchingTheDatabase(t *testing.T) {
	pool := poolOrSkip(t)
	ctx := t.Context()
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

// A fixture that deletes on t.Context() leaks, every run, invisibly: Go cancels
// that context just before Cleanup-registered functions run, and the teardowns
// discard their errors — so the DELETEs return "context canceled" and nothing is
// removed. The rows outlive the run, and the next run then refuses a code it
// believes someone else holds. A subtest is the only way to watch a cleanup from
// the outside: its cleanups have definitely run by the time t.Run returns.
func TestLiveDB_ReferralCode_FixtureCleanupDeletesWhatItSeeded(t *testing.T) {
	pool := poolOrSkip(t)
	ctx := t.Context()
	s := svc(pool)

	// Random so that a leak cannot collide with this guard and mask it.
	code := freshCode(t, ctx, pool)
	legacy := freshCode(t, ctx, pool)
	var user string
	t.Run("seed", func(st *testing.T) {
		user = newUser(st, st.Context(), pool)
		if _, err := s.SetLinkCode(st.Context(), user, code); err != nil {
			st.Fatalf("SetLinkCode: %v", err)
		}
		if _, err := pool.Exec(st.Context(),
			`INSERT INTO public.finance_referral_codes (user_id, code) VALUES ($1, $2)`,
			user, legacy); err != nil {
			st.Fatalf("seed legacy code: %v", err)
		}
	})

	for _, q := range []struct {
		what string
		sql  string
	}{
		{"referral_links", `SELECT count(*) FROM public.referral_links WHERE referrer_id=$1`},
		{"finance_referral_codes", `SELECT count(*) FROM public.finance_referral_codes WHERE user_id=$1`},
		{"auth.users", `SELECT count(*) FROM auth.users WHERE id=$1`},
	} {
		var n int
		if err := pool.QueryRow(ctx, q.sql, user).Scan(&n); err != nil {
			t.Fatalf("count %s: %v", q.what, err)
		}
		if n != 0 {
			t.Errorf("%s rows left behind for %s: %d — the cleanup did not run its DELETEs; a leaked code makes the next run see ErrCodeTaken",
				q.what, user, n)
		}
	}
}
