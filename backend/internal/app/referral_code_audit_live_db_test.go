package app

// LIVE-DB regression for the wiring, not the rule: the referral code rules
// themselves are covered in backend/tests/referrals. What only this package can
// prove is that the sink RegisterReferralRewards actually installs (see
// referral_routes.go) files an admin's code rename where Service.OriginalCode
// looks. A payload key renamed on one side, or a sink that drops referrer_id into
// user_id, keeps every unit test green while the console's "original code" row
// stays empty forever.
//
// SKIPPED whenever TEST_DATABASE_URL is unset — same gate as the other live-DB
// suites in this package.
//	export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//	cd backend && go test ./internal/app/... -run ReferralCodeAudit -v

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/referrals"
	referralevents "spotlight/backend/internal/referral/events"
)

func codeAuditPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping live-DB test")
	}
	pool, err := pgxpool.New(t.Context(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func TestLiveDB_ReferralCodeAudit_ShippedWiringLetsTheAdminReadSeeTheOriginal(t *testing.T) {
	pool := codeAuditPool(t)
	ctx := t.Context()

	user := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1, $2)`,
		user, "zzcodeaudit-"+user+"@seed.test"); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	t.Cleanup(func() {
		c := context.WithoutCancel(context.Background())
		_, _ = pool.Exec(c, `DELETE FROM public.referral_engine_events WHERE referrer_id=$1`, user)
		_, _ = pool.Exec(c, `DELETE FROM public.referral_links WHERE referrer_id=$1`, user)
		_, _ = pool.Exec(c, `DELETE FROM public.finance_referral_codes WHERE user_id=$1`, user)
		_, _ = pool.Exec(c, `DELETE FROM public.platform_users WHERE id=$1`, user)
		_, _ = pool.Exec(c, `DELETE FROM auth.users WHERE id=$1`, user)
	})

	// Exactly what RegisterReferralRewards builds.
	svc := referrals.NewRewardService(pool, ledger.NewService(ledger.NewRepository(pool), nil)).
		WithAudit(rewardEngineAuditSink{ev: referralevents.NewService(pool)})

	issued, err := svc.GetOrCreateLink(ctx, user)
	if err != nil {
		t.Fatalf("GetOrCreateLink: %v", err)
	}
	// Random, because go test runs packages concurrently against one shared
	// database and a literal code here could be spoken for by another suite.
	target := "Z" + strings.ToUpper(uuid.NewString()[:4])
	if _, err := svc.SetLinkCode(ctx, user, target, uuid.NewString()); err != nil {
		t.Fatalf("SetLinkCode: %v", err)
	}

	// The row landed in the stream the read uses, keyed by referrer.
	var from string
	if err := pool.QueryRow(ctx, `
		SELECT COALESCE(payload->>'from','') FROM public.referral_engine_events
		WHERE event_type = 'referral.code.changed' AND referrer_id = $1`, user).Scan(&from); err != nil {
		t.Fatalf("read the audit row back: %v — the rename is untraceable, so the console "+
			"has no original to show", err)
	}
	if from != issued.Code {
		t.Errorf("audited from = %q, want the issued code %q", from, issued.Code)
	}

	// And the console's read finds it through the shipped composition.
	got, err := referrals.NewService(pool, nil).OriginalCode(ctx, user)
	if err != nil {
		t.Fatalf("OriginalCode: %v", err)
	}
	if got != issued.Code {
		t.Errorf("OriginalCode = %q, want %q", got, issued.Code)
	}
	// The current code is the customised one, which is the other half of what the
	// section shows side by side.
	now, source, err := referrals.NewService(pool, nil).LookupCode(ctx, user)
	if err != nil || now != target {
		t.Errorf("LookupCode = %q/%s/%v, want the customised %q", now, source, err, target)
	}
}

// The premise the admin page was built on: an account HAS a code from signup, so a
// console reading it should never have to say "no referral code yet".
// NewSignupAttributor is the seam auth_handler.Register calls, so this is the
// signup path in the shape production uses.
//
// The code a stranger typed is not the new account's code, and an unattributable
// signup (unknown code, house disabled, a database fault in the chain) is still a
// registered account — so the mint happens whatever attribution returned.
func TestLiveDB_SignupAttributor_FilesACodeForTheNewAccount(t *testing.T) {
	pool := codeAuditPool(t)
	ctx := t.Context()

	seed := func(tag string) string {
		id := uuid.NewString()
		if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1, $2)`,
			id, "zzsignup-"+tag+"-"+id+"@seed.test"); err != nil {
			t.Fatalf("seed %s user: %v", tag, id)
		}
		t.Cleanup(func() {
			c := context.WithoutCancel(context.Background())
			_, _ = pool.Exec(c, `DELETE FROM public.referral_engine_events WHERE referrer_id=$1`, id)
			_, _ = pool.Exec(c, `DELETE FROM public.referral_attributions WHERE referred_user_id=$1`, id)
			_, _ = pool.Exec(c, `DELETE FROM public.referral_links WHERE referrer_id=$1`, id)
			_, _ = pool.Exec(c, `DELETE FROM public.finance_referral_codes WHERE user_id=$1`, id)
			_, _ = pool.Exec(c, `DELETE FROM public.platform_users WHERE id=$1`, id)
			_, _ = pool.Exec(c, `DELETE FROM auth.users WHERE id=$1`, id)
		})
		return id
	}

	attribute := NewSignupAttributor(pool)
	if attribute == nil {
		t.Fatal("NewSignupAttributor(nil-free pool) returned nil — signup cannot attribute anyone")
	}
	read := referrals.NewService(pool, nil)

	// A signup that typed somebody's code: attribution runs as before.
	withCode := seed("coded")
	_ = attribute(ctx, withCode, "ZZNOPE1") // unknown code: the chain decides, the mint must not depend on it

	// A signup that typed none.
	noCode := seed("plain")
	_ = attribute(ctx, noCode, "")

	for _, pair := range []struct{ who, how string }{{withCode, "with a typed code"}, {noCode, "without one"}} {
		code, source, err := read.LookupCode(ctx, pair.who)
		if err != nil {
			t.Fatalf("a signup %s left the account with no referral code (%v) — this is the "+
				"state the admin console reports as \"No referral code yet\"", pair.how, err)
		}
		if err := referrals.ValidateCode(code); err != nil {
			t.Errorf("signup %s filed %q, which is not a valid code: %v", pair.how, code, err)
		}
		if source != "referral_links" {
			t.Errorf("signup %s filed the code in %s, want referral_links", pair.how, source)
		}
	}

	// And a second call for the same account — a retry, or a re-run of the hook —
	// must not move the code it already has.
	keep, _, err := read.LookupCode(ctx, noCode)
	if err != nil {
		t.Fatal(err)
	}
	if err := attribute(ctx, noCode, ""); err != nil {
		t.Logf("attribution error is tolerated by the caller: %v", err)
	}
	again, _, err := read.LookupCode(ctx, noCode)
	if err != nil || again != keep {
		t.Errorf("second signup pass changed the code from %q to %q (%v)", keep, again, err)
	}
}
