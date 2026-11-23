package referrals_test

// Live-DB coverage for admin-chosen referral codes.
// The unit tests in internal/finance/referrals cover the code SHAPE. What needs
// a database is UNIQUENESS, because the rule spans the three namespaces a
// registered user's code can live in — referral_links, the legacy
// finance_referral_codes, and platform_users.referral_code — and getting it wrong
// silently redirects one user's referral rewards to another.

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
	"spotlight/backend/internal/testsupport"
)

// codeAdmin stands in for "the admin who clicked save", which SetLinkCode records
// in the audit event next to the code it replaced. The write does not validate it
// (the guard is the route's permission), so a fixed id keeps every case here
// readable; the id never becomes a user or a code.
var codeAdmin = uuid.NewString()

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
	// Covers every namespace a seeded user can end up claiming a code in.
	// An auth.users insert has a trigger (on_auth_user_rbac_bridge) that files a
	// platform_users row for every new user, and platform_users.id has NO foreign
	// key to auth.users — so deleting the auth row does not take that row with it,
	// and anything not deleted here leaks a code claim into the next run.
	testsupport.CleanupUser(t, pool, id)
	t.Cleanup(func() {
		c := context.WithoutCancel(t.Context())
		_, _ = pool.Exec(c, `DELETE FROM public.referral_links WHERE referrer_id=$1`, id)
		_, _ = pool.Exec(c, `DELETE FROM public.finance_referral_codes WHERE user_id=$1`, id)
		_, _ = pool.Exec(c, `DELETE FROM public.platform_users WHERE id=$1`, id)
		_, _ = pool.Exec(c, `DELETE FROM auth.users WHERE id=$1`, id)
	})
	return id
}

// platformUserRow files the platform_users row a real registered user has (the
// name columns are NOT NULL, status/user_type/created_at have defaults) and puts
// a code in its legacy referral_code column. Service.LookupCode reports that
// column as source "platform_users" and the admin user record displays it, so a
// code living there is "a code a registered user is using".
func platformUserRow(t *testing.T, ctx context.Context, pool *pgxpool.Pool, userID, referralCode string) {
	t.Helper()
	_, err := pool.Exec(ctx, `
		INSERT INTO public.platform_users (id, first_name, last_name, referral_code)
		VALUES ($1, 'Referral', 'Seeduser', $2)
		ON CONFLICT (id) DO UPDATE SET referral_code = EXCLUDED.referral_code`,
		userID, referralCode)
	if err != nil {
		t.Fatalf("seed platform_users: %v", err)
	}
}

// codeClaims lists every row claiming a code across all three namespaces, so a
// test can prove one code has exactly one owner and that the owner is who the
// admin just set it for.
func codeClaims(t *testing.T, ctx context.Context, pool *pgxpool.Pool, code string) []string {
	t.Helper()
	rows, err := pool.Query(ctx, `
		SELECT 'referral_links:' || referrer_id::text FROM public.referral_links WHERE UPPER(code) = $1
		UNION ALL
		SELECT 'finance_referral_codes:' || user_id::text FROM public.finance_referral_codes WHERE UPPER(code) = $1
		UNION ALL
		SELECT 'platform_users:' || id::text FROM public.platform_users WHERE referral_code IS NOT NULL AND UPPER(referral_code) = $1
		ORDER BY 1`, strings.ToUpper(code))
	if err != nil {
		t.Fatalf("read code claims: %v", err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			t.Fatalf("scan code claims: %v", err)
		}
		out = append(out, s)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate code claims: %v", err)
	}
	return out
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
				UNION ALL SELECT 1 FROM public.finance_referral_codes WHERE code=$1
				UNION ALL SELECT 1 FROM public.platform_users WHERE UPPER(referral_code)=$1)`,
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

	link, err := s.SetLinkCode(ctx, user, strings.ToLower(code), codeAdmin) // lowercase on purpose
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

	if _, err := s.SetLinkCode(ctx, first, code, codeAdmin); err != nil {
		t.Fatalf("seed first code: %v", err)
	}
	_, err := s.SetLinkCode(ctx, second, code, codeAdmin)
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

	if _, err := s.SetLinkCode(ctx, first, code, codeAdmin); err != nil {
		t.Fatalf("seed: %v", err)
	}
	if _, err := s.SetLinkCode(ctx, second, strings.ToLower(code), codeAdmin); !errors.Is(err, referrals.ErrCodeTaken) {
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

	_, err := s.SetLinkCode(ctx, newcomer, code, codeAdmin)
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

	if _, err := s.SetLinkCode(ctx, user, code, codeAdmin); err != nil {
		t.Fatalf("first set: %v", err)
	}
	link, err := s.SetLinkCode(ctx, user, code, codeAdmin)
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
		if _, err := s.SetLinkCode(ctx, user, bad, codeAdmin); err == nil {
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
		if _, err := s.SetLinkCode(st.Context(), user, code, codeAdmin); err != nil {
			st.Fatalf("SetLinkCode: %v", err)
		}
		if _, err := pool.Exec(st.Context(),
			`INSERT INTO public.finance_referral_codes (user_id, code) VALUES ($1, $2)`,
			user, legacy); err != nil {
			st.Fatalf("seed legacy code: %v", err)
		}
		platformUserRow(st, st.Context(), pool, user, freshCode(st, st.Context(), pool))
	})

	for _, q := range []struct {
		what string
		sql  string
	}{
		{"referral_links", `SELECT count(*) FROM public.referral_links WHERE referrer_id=$1`},
		{"finance_referral_codes", `SELECT count(*) FROM public.finance_referral_codes WHERE user_id=$1`},
		{"platform_users", `SELECT count(*) FROM public.platform_users WHERE id=$1`},
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

// THE THIRD NAMESPACE. platform_users.referral_code is where a code can live when
// neither code table has a row: Service.LookupCode reads it as the last fallback
// and tells the console source="platform_users", and the admin user record shows
// the same column. A user whose only code is there is still "a registered user
// using that code", so the duplicate check has to see it — otherwise the console
// shows two people the same code and attribution quietly picks one of them.
func TestLiveDB_ReferralCode_RefusesACodeHeldByAnotherUserInPlatformUsers(t *testing.T) {
	pool := poolOrSkip(t)
	ctx := t.Context()
	s := svc(pool)
	holder, newcomer := newUser(t, ctx, pool), newUser(t, ctx, pool)

	// The holder has never opened a referral screen: no link row, no legacy row.
	platformUserRow(t, ctx, pool, holder, "PUSER")

	if _, err := s.SetLinkCode(ctx, newcomer, "PUSER", codeAdmin); !errors.Is(err, referrals.ErrCodeTaken) {
		t.Fatalf("got %v, want ErrCodeTaken — the console would show PUSER on two user records", err)
	}
	// The refused write must not have handed the code to the newcomer either.
	if claims := codeClaims(t, ctx, pool, "PUSER"); len(claims) != 1 || claims[0] != "platform_users:"+holder {
		t.Errorf("claims on PUSER = %v, want exactly the platform_users row of %s", claims, holder)
	}
}

// Case-folding has to apply to the LEGACY table too. Its generator emitted
// lowercase codes before REF-004 (see 20270218000000), and attribution resolves
// that table case-INSENSITIVELY, so a stored "legcy" and a new "LEGcy" are the
// same code to every caller — while an exact-match duplicate check sees neither.
func TestLiveDB_ReferralCode_DuplicateCheckIgnoresCaseInTheLegacyTable(t *testing.T) {
	pool := poolOrSkip(t)
	ctx := t.Context()
	s := svc(pool)
	legacyOwner, newcomer := newUser(t, ctx, pool), newUser(t, ctx, pool)

	if _, err := pool.Exec(ctx,
		`INSERT INTO public.finance_referral_codes (user_id, code) VALUES ($1, 'legcy')`,
		legacyOwner); err != nil {
		t.Fatalf("seed lowercase legacy code: %v", err)
	}

	if _, err := s.SetLinkCode(ctx, newcomer, "LEGcy", codeAdmin); !errors.Is(err, referrals.ErrCodeTaken) {
		t.Fatalf("got %v, want ErrCodeTaken — referral_links would resolve first and the "+
			"legacy owner would silently stop being credited", err)
	}
}

// THE USER-VISIBLE HALF OF THE FEATURE. An edit that only moves referral_links is
// an edit nobody sees: the customer's own screen (app/api/v1/referrals/me ->
// getOrCreateCode) returns the legacy row whenever that row was minted first, and
// the admin console's read (Service.LookupCode) checks the legacy row first as
// well. So after a successful save both surfaces must show the new code, and the
// old code must stop being claimed by anyone.
func TestLiveDB_ReferralCode_EditSetsTheCodeEverySurfaceThenShows(t *testing.T) {
	pool := poolOrSkip(t)
	ctx := t.Context()
	s := svc(pool)
	user := newUser(t, ctx, pool)

	// The realistic "long-time user" shape: one code, recorded in all three
	// places, with the legacy row the OLDEST — which is the case where the
	// surfaces read the legacy row rather than the link row.
	old := freshCode(t, ctx, pool)
	if _, err := pool.Exec(ctx,
		`INSERT INTO public.finance_referral_codes (user_id, code, created_at)
		 VALUES ($1, $2, now() - interval '30 days')`, user, old); err != nil {
		t.Fatalf("seed legacy row: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO public.referral_links (referrer_id, code) VALUES ($1, $2)`, user, old); err != nil {
		t.Fatalf("seed link row: %v", err)
	}
	platformUserRow(t, ctx, pool, user, old)

	const code = "JIDE1"
	link, err := s.SetLinkCode(ctx, user, code, codeAdmin)
	if err != nil {
		t.Fatalf("SetLinkCode: %v", err)
	}
	if link.Code != code {
		t.Fatalf("SetLinkCode returned %q, want %q", link.Code, code)
	}

	var legacyNow, puNow string
	if err := pool.QueryRow(ctx,
		`SELECT code FROM public.finance_referral_codes WHERE user_id=$1`, user).Scan(&legacyNow); err != nil {
		t.Fatalf("read legacy row: %v", err)
	}
	if err := pool.QueryRow(ctx,
		`SELECT referral_code FROM public.platform_users WHERE id=$1`, user).Scan(&puNow); err != nil {
		t.Fatalf("read platform_users row: %v", err)
	}
	if legacyNow != code {
		t.Errorf("legacy row still holds %q — the customer's referral screen reads that row "+
			"first, so the admin's edit would be invisible to the user", legacyNow)
	}
	if puNow != code {
		t.Errorf("platform_users still holds %q — the user record shows a code the user no longer has", puNow)
	}

	// The admin console's read agrees.
	got, source, err := referrals.NewService(pool, nil).LookupCode(ctx, user)
	if err != nil {
		t.Fatalf("LookupCode: %v", err)
	}
	if got != code {
		t.Errorf("LookupCode = %q (source %s), want %q", got, source, code)
	}

	// And the replaced code is genuinely released: nobody claims it, so another
	// user may be given it.
	if claims := codeClaims(t, ctx, pool, old); len(claims) != 0 {
		t.Errorf("freed code %q is still claimed by %v", old, claims)
	}
	next := newUser(t, ctx, pool)
	if _, err := s.SetLinkCode(ctx, next, old, codeAdmin); err != nil {
		t.Errorf("a released code cannot be reassigned: %v", err)
	}
}

// Same rule for a user whose code only ever lived in platform_users (they were
// seeded before either code table existed): the edit has to REPLACE that value,
// not leave a second code pointing at the same person.
func TestLiveDB_ReferralCode_EditReplacesAPlatformUsersOnlyCode(t *testing.T) {
	pool := poolOrSkip(t)
	ctx := t.Context()
	s := svc(pool)
	user := newUser(t, ctx, pool)
	old := freshCode(t, ctx, pool)
	platformUserRow(t, ctx, pool, user, old)

	const code = "FLYER"
	if _, err := s.SetLinkCode(ctx, user, code, codeAdmin); err != nil {
		t.Fatalf("SetLinkCode: %v", err)
	}

	var puNow string
	if err := pool.QueryRow(ctx,
		`SELECT referral_code FROM public.platform_users WHERE id=$1`, user).Scan(&puNow); err != nil {
		t.Fatalf("read platform_users row: %v", err)
	}
	if puNow != code {
		t.Errorf("platform_users holds %q, want %q — the user record and the referral case would "+
			"report two different codes for one person", puNow, code)
	}
	if claims := codeClaims(t, ctx, pool, old); len(claims) != 0 {
		t.Errorf("the replaced code %q is still claimed by %v", old, claims)
	}
	if claims := codeClaims(t, ctx, pool, code); len(claims) != 2 {
		t.Errorf("claims on %q = %v, want the link row and platform_users row of the same user", code, claims)
	}
}

// Re-submitting the code the user already holds — including one they hold only in
// platform_users — is a no-op success, not a 409. Same double-click story as
// TestLiveDB_ReferralCode_ReassigningYourOwnCodeSucceeds, from the other table.
func TestLiveDB_ReferralCode_ReassigningYourOwnPlatformUsersCodeSucceeds(t *testing.T) {
	pool := poolOrSkip(t)
	ctx := t.Context()
	s := svc(pool)
	user := newUser(t, ctx, pool)
	platformUserRow(t, ctx, pool, user, "OWNCO")

	link, err := s.SetLinkCode(ctx, user, "OWNCO", codeAdmin)
	if err != nil {
		t.Fatalf("re-setting the user's own platform_users code errored: %v", err)
	}
	if link.Code != "OWNCO" {
		t.Errorf("code = %q, want OWNCO", link.Code)
	}
}
