package referrals_test

// Live-DB coverage for the Earn Hub headline counts.
//
// Reported: A invites B with a code, B signs up and buys something, and A's Earn
// Hub shows nothing under Invited or Activated. The dashboard used to carry only
// active_referral_count, the tier input that the NIGHTLY recalc fills, so
// nothing appeared until that job ran. invited_count and activated_count are
// live.

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func attribute(t *testing.T, ctx context.Context, pool *pgxpool.Pool, referrer, referred string) {
	t.Helper()
	if _, err := pool.Exec(ctx,
		`INSERT INTO public.referral_attributions (referred_user_id, referrer_id, attribution_type, code_used)
		 VALUES ($1,$2,'code','TESTC')`, referred, referrer); err != nil {
		t.Fatalf("seed attribution: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(t.Context(), `DELETE FROM public.referral_attributions WHERE referred_user_id=$1`, referred)
	})
}

func reward(t *testing.T, ctx context.Context, pool *pgxpool.Pool, referrer, referred, status string, ageDays int) {
	t.Helper()
	txn := "zzref-txn-" + uuid.NewString()
	if _, err := pool.Exec(ctx,
		`INSERT INTO public.referral_rewards
		   (referrer_id, referred_user_id, source_transaction_id, module, margin_kobo, applied_rate, reward_kobo, status, created_at)
		 VALUES ($1,$2,$3,'bills',10000,0.2,2000,$4, now() - make_interval(days => $5))`,
		referrer, referred, txn, status, ageDays); err != nil {
		t.Fatalf("seed reward: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(t.Context(), `DELETE FROM public.referral_rewards WHERE source_transaction_id=$1`, txn)
	})
}

func TestLiveDB_Dashboard_InvitedAndActivatedAreLive_Integration(t *testing.T) {
	pool := poolOrSkip(t)
	ctx := t.Context()
	s := svc(pool)

	a := newUser(t, ctx, pool) // the referrer
	b := newUser(t, ctx, pool) // joined with A's code
	other := newUser(t, ctx, pool)
	strangerReferrer := newUser(t, ctx, pool)

	// Nobody invited yet.
	d, err := s.GetDashboard(ctx, a)
	if err != nil {
		t.Fatal(err)
	}
	if d.InvitedCount != 0 || d.ActivatedCount != 0 {
		t.Fatalf("empty book = invited %d / activated %d, want 0/0", d.InvitedCount, d.ActivatedCount)
	}

	// B signs up with A's code. No nightly recalc has run (no referral_tier_status row).
	attribute(t, ctx, pool, a, b)
	d, _ = s.GetDashboard(ctx, a)
	if d.InvitedCount != 1 || d.ActivatedCount != 0 {
		t.Fatalf("after signup = invited %d / activated %d, want 1/0", d.InvitedCount, d.ActivatedCount)
	}

	// B buys something: the commission split credits A. Activated must move now,
	// while the tier count (nightly) is still 0, which is exactly the old bug.
	reward(t, ctx, pool, a, b, "CREDITED", 0)
	d, _ = s.GetDashboard(ctx, a)
	if d.InvitedCount != 1 || d.ActivatedCount != 1 {
		t.Fatalf("after purchase = invited %d / activated %d, want 1/1", d.InvitedCount, d.ActivatedCount)
	}
	if d.ActiveReferralCount != 0 {
		t.Fatalf("tier count must stay the nightly figure (0), got %d", d.ActiveReferralCount)
	}

	// Things that must NOT activate someone: a reward still pending, a reversed
	// one, and a credited one older than the 30-day window.
	for _, tc := range []struct {
		status string
		age    int
	}{{"PENDING", 0}, {"REVERSED", 0}, {"CREDITED", 45}} {
		u := newUser(t, ctx, pool)
		attribute(t, ctx, pool, a, u)
		reward(t, ctx, pool, a, u, tc.status, tc.age)
	}
	d, _ = s.GetDashboard(ctx, a)
	if d.InvitedCount != 4 || d.ActivatedCount != 1 {
		t.Fatalf("with 3 non-activating referees = invited %d / activated %d, want 4/1", d.InvitedCount, d.ActivatedCount)
	}

	// Another referrer's people are not A's.
	attribute(t, ctx, pool, strangerReferrer, other)
	d, _ = s.GetDashboard(ctx, a)
	if d.InvitedCount != 4 {
		t.Fatalf("someone else's referral leaked into A's count: %d", d.InvitedCount)
	}
}
