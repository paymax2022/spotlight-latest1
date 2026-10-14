package cryptosvc

// Live-DB test for PGStore.Backlog (the admin reconciler-status rollup). SKIPPED without
// TEST_DATABASE_URL (see livePool). The table is shared, so the test asserts on the DELTA its own
// rows cause rather than on absolute values.

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
)

func backlogByState(t *testing.T, s *PGStore) map[string]BacklogState {
	t.Helper()
	rows, err := s.Backlog(context.Background())
	if err != nil {
		t.Fatalf("backlog: %v", err)
	}
	m := map[string]BacklogState{}
	for _, r := range rows {
		m[string(r.State)] = r
	}
	return m
}

func TestPGStore_BacklogRollsUpOpenStatesOnly(t *testing.T) {
	pool := livePool(t)
	s := NewPGStore(pool)
	ctx := context.Background()
	before := backlogByState(t, s)

	user := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2)`, user, user+"@seed.test"); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM public.crypto_swaps WHERE user_id=$1::uuid`, user)
		_, _ = pool.Exec(context.Background(), `DELETE FROM auth.users WHERE id=$1`, user)
	})
	old := time.Now().Add(-48 * time.Hour).UTC().Truncate(time.Second)
	add := func(status string, ngn, fee int64, updated time.Time) {
		t.Helper()
		if _, err := pool.Exec(ctx,
			`INSERT INTO public.crypto_swaps (user_id, provider, provider_account_id, from_currency, to_currency,
			   from_amount, quoted_to_amount, quoted_price, status, ngn_kobo, fee_kobo, updated_at)
			 VALUES ($1::uuid,'livetest','acct','NGN','USDT',10,10,1,$2,$3,$4,$5)`,
			user, status, ngn, fee, updated); err != nil {
			t.Fatalf("seed %s: %v", status, err)
		}
	}
	add("needs_review", 1_000_000, 7_500, old)
	add("needs_review", 2_000_000, 15_000, old.Add(time.Hour))
	add("processing", 500_000, 3_750, old)
	add("completed", 9_000_000, 90_000, old) // terminal: must not show up
	add("failed", 9_000_000, 90_000, old)    // terminal: must not show up

	after := backlogByState(t, s)
	if got := after["needs_review"].Count - before["needs_review"].Count; got != 2 {
		t.Fatalf("needs_review count delta = %d, want 2", got)
	}
	if got := after["needs_review"].HeldKobo - before["needs_review"].HeldKobo; got != 1_007_500+2_015_000 {
		t.Fatalf("needs_review held delta = %d, want %d (ngn+fee, integer kobo)", got, 1_007_500+2_015_000)
	}
	if !after["needs_review"].OldestUpdatedAt.Equal(old) && !after["needs_review"].OldestUpdatedAt.Before(old) {
		t.Fatalf("oldest = %v, want <= %v", after["needs_review"].OldestUpdatedAt, old)
	}
	if got := after["processing"].Count - before["processing"].Count; got != 1 {
		t.Fatalf("processing count delta = %d, want 1", got)
	}
	for _, terminal := range []string{"completed", "failed", "expired"} {
		if _, bad := after[terminal]; bad {
			t.Fatalf("terminal state %q must not be in the backlog", terminal)
		}
	}
}
