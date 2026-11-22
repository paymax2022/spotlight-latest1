package referrals_test

// Live-DB coverage for the two rules that make the admin console stop saying
// "no referral code yet" for a registered account:
//
//  1. Every account HAS a code. Signup files one, and a bounded sweep covers the
//     accounts that predate that rule and the signup paths that never ran it.
//     The mint primitive is GetOrCreateLink, so the codes the sweep issues are the
//     same shape and the same table the rewards engine already resolves.
//  2. When an admin customises a code, the value it replaced stays readable. The
//     write converges referral_links, finance_referral_codes AND platform_users
//     onto the new code (see code_admin_live_db_test.go), so the original exists
//     nowhere but the append-only event stream.

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	referralevents "spotlight/backend/internal/referral/events"

	"spotlight/backend/internal/finance/referrals"
)

// recordingSink keeps what the service tried to audit. The audit stream is
// best-effort by design (a failed write must not fail the admin's save), so the
// fields are asserted here and the shipped sink's column mapping is asserted in
// internal/app, where that sink lives.
type recordingSink struct {
	events []recorded
}

type recorded struct {
	name   string
	fields map[string]any
}

func (r *recordingSink) Emit(_ context.Context, event string, fields map[string]any) error {
	r.events = append(r.events, recorded{name: event, fields: fields})
	return nil
}

type failingSink struct{}

func (failingSink) Emit(context.Context, string, map[string]any) error {
	return context.DeadlineExceeded
}

func linkRowCount(t *testing.T, ctx context.Context, pool *pgxpool.Pool, userID string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM public.referral_links WHERE referrer_id=$1`, userID).Scan(&n); err != nil {
		t.Fatalf("count referral_links: %v", err)
	}
	return n
}

// account gives a seeded user the roster row the sweep reads. Every real signup
// writes one (services/auth_service.go's RegisterUser PATCH), which is why
// user_profiles — not platform_users, which in this database also carries ~23k seed
// fixtures with no account behind them — is the list of who is registered.
func account(t *testing.T, ctx context.Context, pool *pgxpool.Pool, name string, ageHours int) string {
	t.Helper()
	id := newUser(t, ctx, pool)
	profile(t, ctx, pool, id, name, ageHours)
	return id
}

// The rename has to leave an audit trail, because the console now shows the
// original code and support needs to know who moved it and from what.
func TestLiveDB_SetLinkCode_EmitsTheCodeItReplaced(t *testing.T) {
	pool := poolOrSkip(t)
	ctx := t.Context()
	rec := &recordingSink{}
	s := svc(pool).WithAudit(rec)
	user := newUser(t, ctx, pool)
	actor := uuid.NewString() // the admin who clicked save

	issued, err := s.GetOrCreateLink(ctx, user)
	if err != nil {
		t.Fatalf("GetOrCreateLink: %v", err)
	}
	target := freshCode(t, ctx, pool)
	if _, err := s.SetLinkCode(ctx, user, target, actor); err != nil {
		t.Fatalf("SetLinkCode: %v", err)
	}

	if len(rec.events) != 1 {
		t.Fatalf("audit events = %+v, want exactly the one code change", rec.events)
	}
	got := rec.events[0]
	if got.name != "referral.code.changed" {
		t.Errorf("event type = %q, want referral.code.changed", got.name)
	}
	for key, want := range map[string]string{
		"referrer_id": user,
		"from":        issued.Code,
		"to":          target,
		"changed_by":  actor,
	} {
		if f, _ := got.fields[key].(string); f != want {
			t.Errorf("field %q = %v, want %q", key, got.fields[key], want)
		}
	}

	// Saving the same code again is a no-op, and a no-op must not add a row that
	// the console would then read as "this user changed their code".
	if _, err := s.SetLinkCode(ctx, user, target, actor); err != nil {
		t.Fatalf("re-set: %v", err)
	}
	if len(rec.events) != 1 {
		t.Errorf("after a no-op save there are %d events: %+v", len(rec.events), rec.events)
	}
}

// A failed audit write must not fail the save: the admin's edit is the thing they
// asked for, the trail is best-effort (same posture as every other emit).
func TestLiveDB_SetLinkCode_SavesEvenWhenTheAuditWriteFails(t *testing.T) {
	pool := poolOrSkip(t)
	ctx := t.Context()
	s := svc(pool).WithAudit(failingSink{})
	user := newUser(t, ctx, pool)
	issued, err := s.GetOrCreateLink(ctx, user)
	if err != nil {
		t.Fatal(err)
	}
	target := freshCode(t, ctx, pool)
	link, err := s.SetLinkCode(ctx, user, target, uuid.NewString())
	if err != nil {
		t.Fatalf("a sink failure must not fail the save: %v", err)
	}
	if link.Code != target {
		t.Errorf("code = %q, want the %q the admin asked for", link.Code, target)
	}
	if issued.Code == target {
		t.Skip("the mint happened to draw the same code, so this proves nothing about the write")
	}
}

// The read half, against the real event stream: Service.OriginalCode must find
// what the audit writer filed, and it must report the FIRST change (the code the
// account was issued) rather than the most recent one.
func TestLiveDB_OriginalCode_ReportsTheFirstChangeNotTheLatest(t *testing.T) {
	pool := poolOrSkip(t)
	ctx := t.Context()
	user := newUser(t, ctx, pool)
	ev := referralevents.NewService(pool)

	first, second := freshCode(t, ctx, pool), freshCode(t, ctx, pool)
	// Two renames: issued -> first -> second. The console's "original" is `issued`.
	for i, pair := range [][2]string{{first, second}, {second, "LATESTX"}} {
		if err := ev.Record(ctx, referralevents.Input{
			EventType:      "referral.code.changed",
			ReferrerID:     user,
			Payload:        map[string]any{"referrer_id": user, "from": pair[0], "to": pair[1]},
			IdempotencyKey: uuid.NewString(),
		}); err != nil {
			t.Fatalf("record event %d: %v", i, err)
		}
		// The stream orders by created_at, which defaults to now(); the two rows
		// would otherwise land in the same statement timestamp and the tie-break
		// would decide the answer instead of the history.
		if _, err := pool.Exec(ctx,
			`UPDATE public.referral_engine_events
			    SET created_at = now() - make_interval(mins => $2)
			  WHERE event_type = 'referral.code.changed' AND referrer_id = $1
			    AND payload->>'from' = $3`,
			user, 10-i, pair[0]); err != nil {
			t.Fatalf("backdate event %d: %v", i, err)
		}
	}

	got, err := referrals.NewService(pool, nil).OriginalCode(ctx, user)
	if err != nil {
		t.Fatalf("OriginalCode: %v", err)
	}
	if got != first {
		t.Errorf("original code = %q, want %q (the code the account started on, not %q)", got, first, second)
	}

	// Somebody else's history is not this user's original.
	other := newUser(t, ctx, pool)
	if got, err := referrals.NewService(pool, nil).OriginalCode(ctx, other); err != nil || got != "" {
		t.Errorf("unrelated user read %q / %v, want empty", got, err)
	}
}

// THE HEADLINE RULE FOR THE ADMIN PAGE. An account with a row in none of the three
// code namespaces is what makes the console say "No referral code yet"; the sweep
// has to close that gap, and close it WITHOUT touching an account that already has
// a code somewhere — re-minting for those would move a working code off a user who
// is already sharing it.
func TestLiveDB_EnsureMissingCodes_MintsOnlyForAccountsWithoutACode(t *testing.T) {
	pool := poolOrSkip(t)
	ctx := t.Context()
	s := svc(pool)

	linkHolder := account(t, ctx, pool, "Link Holder", 24) // the normal case: opened the referral screen
	legacyHolder := account(t, ctx, pool, "Legacy Holder", 24)
	puHolder := account(t, ctx, pool, "Record Holder", 24)
	one := account(t, ctx, pool, "First Codeless", 24)
	two := account(t, ctx, pool, "Second Codeless", 24)

	if _, err := s.GetOrCreateLink(ctx, linkHolder); err != nil {
		t.Fatalf("seed link holder: %v", err)
	}
	legacyCode := freshCode(t, ctx, pool)
	if _, err := pool.Exec(ctx,
		`INSERT INTO public.finance_referral_codes (user_id, code) VALUES ($1, $2)`,
		legacyHolder, legacyCode); err != nil {
		t.Fatalf("seed legacy holder: %v", err)
	}
	puCode := freshCode(t, ctx, pool)
	platformUserRow(t, ctx, pool, puHolder, puCode)

	opts := referrals.CodeSweepOpts{Limit: 100, OnlyUserIDs: []string{linkHolder, legacyHolder, puHolder, one, two}}
	n, err := s.EnsureMissingCodes(ctx, opts)
	if err != nil {
		t.Fatalf("EnsureMissingCodes: %v", err)
	}
	if n != 2 { // one, two
		t.Errorf("minted for %d accounts, want 2 — a count above 2 means the sweep is "+
			"walking past the ids it was given, i.e. the whole shared database", n)
	}

	for _, who := range []string{one, two} {
		code, source, err := referrals.NewService(pool, nil).LookupCode(ctx, who)
		if err != nil {
			t.Fatalf("the sweep left account %s with no code: %v", who, err)
		}
		if source != "referral_links" {
			t.Errorf("%s's code came from %s, want referral_links (the table the rewards "+
				"engine resolves first)", who, source)
		}
		if err := referrals.ValidateCode(code); err != nil {
			t.Errorf("minted code %q is not a valid code: %v", code, err)
		}
		// One owner, so the code a user is now shown cannot redirect somebody
		// else's referral rewards.
		if claims := codeClaims(t, ctx, pool, code); len(claims) != 1 {
			t.Errorf("minted code %q is claimed by %v, want only %s", code, claims, who)
		}
	}

	// The holders are untouched: no second row, and still their own code.
	for _, pair := range []struct{ who, code, table string }{
		{legacyHolder, legacyCode, "finance_referral_codes"},
		{puHolder, puCode, "platform_users"},
	} {
		if got := linkRowCount(t, ctx, pool, pair.who); got != 0 {
			t.Errorf("%s holder gained %d referral_links rows — the sweep re-minted an "+
				"account that already had a code", pair.table, got)
		}
		code, source, err := referrals.NewService(pool, nil).LookupCode(ctx, pair.who)
		if err != nil || code != pair.code || source != pair.table {
			t.Errorf("%s holder now reads %q/%s/%v, want %q/%s", pair.table, code, source, err, pair.code, pair.table)
		}
	}
	if issued, _, err := referrals.NewService(pool, nil).LookupCode(ctx, linkHolder); err != nil || issued == "" {
		t.Errorf("the link holder lost its code (%q, %v)", issued, err)
	}

	// Idempotent: the next tick finds nothing to do.
	again, err := s.EnsureMissingCodes(ctx, opts)
	if err != nil {
		t.Fatalf("second sweep: %v", err)
	}
	if again != 0 {
		t.Errorf("second sweep minted %d, want 0", again)
	}
}

// An account created seconds ago may still be inside signup's own attribution. The
// sweep waits (the same grace the house sweep uses) so it never races a
// registration that is still being written.
func TestLiveDB_EnsureMissingCodes_LeavesAccountsYoungerThanMinAge(t *testing.T) {
	pool := poolOrSkip(t)
	ctx := t.Context()
	s := svc(pool)

	young := account(t, ctx, pool, "Fresh", 0)
	old := account(t, ctx, pool, "Aged", 2)

	n, err := s.EnsureMissingCodes(ctx, referrals.CodeSweepOpts{
		MinAge: time.Hour, Limit: 100, OnlyUserIDs: []string{young, old},
	})
	if err != nil {
		t.Fatalf("EnsureMissingCodes: %v", err)
	}
	if n != 1 {
		t.Errorf("minted %d, want 1 (only the account past the age floor)", n)
	}
	if got := linkRowCount(t, ctx, pool, young); got != 0 {
		t.Errorf("a brand-new account got %d link rows inside the grace window", got)
	}
	if _, _, err := referrals.NewService(pool, nil).LookupCode(ctx, old); err != nil {
		t.Errorf("the aged account should have a code by now: %v", err)
	}
}

// LIMIT is the safety valve for a shared database: one tick must not try to issue
// every outstanding code in a single pass.
func TestLiveDB_EnsureMissingCodes_RespectsTheLimit(t *testing.T) {
	pool := poolOrSkip(t)
	ctx := t.Context()
	s := svc(pool)

	var ids []string
	for i := 0; i < 3; i++ {
		ids = append(ids, account(t, ctx, pool, "Limit Case", 24))
	}
	n, err := s.EnsureMissingCodes(ctx, referrals.CodeSweepOpts{Limit: 2, OnlyUserIDs: ids})
	if err != nil {
		t.Fatalf("EnsureMissingCodes: %v", err)
	}
	if n != 2 {
		t.Errorf("minted %d with Limit=2 over 3 accounts, want 2", n)
	}
}
