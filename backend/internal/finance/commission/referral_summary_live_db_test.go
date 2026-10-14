package commission

// LIVE-DB tests for the profit page's referral figures. Skip unless
// TEST_DATABASE_URL is set.

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func referralSummaryPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping referral summary live-DB tests")
	}
	pool, err := pgxpool.New(t.Context(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func TestLiveDB_ReferralSummary_CountsOnlyCommissionSplitRewards(t *testing.T) {
	ctx := t.Context()
	pool := referralSummaryPool(t)
	referrer := uuid.NewString()
	referred := uuid.NewString()
	for _, id := range []string{referrer, referred} {
		if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, id, id+"@seed.test"); err != nil {
			t.Fatalf("seed user: %v", err)
		}
	}
	t.Cleanup(func() {
		c := context.WithoutCancel(ctx)
		_, _ = pool.Exec(c, `DELETE FROM public.referral_rewards WHERE referrer_id = $1`, referrer)
		_, _ = pool.Exec(c, `DELETE FROM auth.users WHERE id = ANY($1::uuid[])`, []string{referrer, referred})
	})

	now := time.Now().UTC()
	from := now.Add(-time.Hour)
	to := now.Add(time.Hour)
	insert := func(src, status string, reward int64, at time.Time) {
		t.Helper()
		if _, err := pool.Exec(ctx, `
			INSERT INTO public.referral_rewards
			  (referrer_id, referred_user_id, source_transaction_id, module, margin_kobo, applied_rate, reward_kobo, status, config_version, created_at)
			VALUES ($1,$2,$3,'transport',$4,0.20,$5,$6,0,$7)`,
			referrer, referred, src, reward*5, reward, status, at); err != nil {
			t.Fatalf("insert %s: %v", src, err)
		}
	}
	insert("commission:"+uuid.NewString(), "CREDITED", 200, now)
	insert("commission:"+uuid.NewString(), "PENDING", 100, now)
	insert("commission:"+uuid.NewString(), "REVERSED", 50, now)
	insert("legacy-tiered-"+uuid.NewString(), "CREDITED", 999, now)                 // older engine: not commission profit
	insert("commission:"+uuid.NewString(), "CREDITED", 777, now.Add(-48*time.Hour)) // outside the range

	svc := NewRepository(pool)
	s, err := svc.ReferralSummaryFor(ctx, from, to)
	if err != nil {
		t.Fatal(err)
	}
	// Other tests may share the database; assert on the rows this test wrote by
	// checking a lower bound and the exclusions the test is about.
	if s.CreditedKobo < 200 || s.PendingKobo < 100 || s.ReversedKobo < 50 {
		t.Fatalf("summary missing this test's rows: %+v", s)
	}
	if s.EarnedKobo != s.CreditedKobo+s.PendingKobo {
		t.Fatalf("earned must be credited+pending, got %+v", s)
	}
	if s.CreditedKobo >= 200+999 {
		t.Fatalf("legacy-engine or out-of-range rows leaked into the summary: %+v", s)
	}

	rows, err := svc.ListReferralRewards(ctx, from, to, 50)
	if err != nil {
		t.Fatal(err)
	}
	mine := 0
	for _, r := range rows {
		if r.ReferrerRef != referrer[:8] {
			continue
		}
		mine++
		if len(r.ReferrerRef) != 8 || len(r.ReferredUserRef) != 8 {
			t.Fatalf("ids must be truncated for display: %+v", r)
		}
	}
	if mine != 3 {
		t.Fatalf("expected this test's three commission rewards in the list, got %d", mine)
	}
}
