package cryptosvc

// Live-DB reconciler tests: the real work-queue SQL, the Postgres leader lock and an end-to-end
// repair. SKIPPED unless TEST_DATABASE_URL is set.

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"spotlight/backend/internal/cryptoprov"
)

func TestLive_StaleSwapsQueueFiltersByStateAndAge(t *testing.T) {
	pool := livePool(t)
	s := NewPGStore(pool)
	ctx := context.Background()
	oldID, _ := seedSwap(t, pool, "processing")
	freshID, _ := seedSwap(t, pool, "processing")
	otherID, _ := seedSwap(t, pool, "completed")
	_, _ = pool.Exec(ctx, `UPDATE public.crypto_swaps SET updated_at = now() - interval '5 minutes' WHERE id IN ($1::uuid, $2::uuid)`, oldID, otherID)

	got, err := s.StaleSwaps(ctx, cryptoprov.SwapStateProcessing, time.Now().Add(-time.Minute), 500)
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, r := range got {
		seen[r.ID] = true
	}
	if !seen[oldID] || seen[freshID] || seen[otherID] {
		t.Fatalf("queue wrong: old=%v fresh=%v otherState=%v", seen[oldID], seen[freshID], seen[otherID])
	}
}

func TestLive_OnlyOneReplicaLeads(t *testing.T) {
	_ = livePool(t) // gate on TEST_DATABASE_URL
	a := lockLocker(t)
	b := lockLocker(t)
	ctx := context.Background()
	relA, okA, err := NewPGLeader(a.pool).TryLead(ctx)
	if err != nil || !okA {
		t.Fatalf("first replica: ok=%v err=%v", okA, err)
	}
	_, okB, err := NewPGLeader(b.pool).TryLead(ctx)
	if err != nil || okB {
		t.Fatalf("second replica also became leader: ok=%v err=%v", okB, err)
	}
	relA()
	relB, okB2, err := NewPGLeader(b.pool).TryLead(ctx)
	if err != nil || !okB2 {
		t.Fatalf("leadership not released: ok=%v err=%v", okB2, err)
	}
	relB()
}

func TestLive_ReconcilerEndToEnd(t *testing.T) {
	r := newLiveRig(t, 1, 5_000_000)
	svc, m, _ := newLiveService(t, r)
	ctx := context.Background()
	q, err := svc.Quote(ctx, QuoteRequest{UserID: r.user, IdempotencyKey: "rec-" + uuid.NewString(), Asset: "USDT", NGNKobo: 1_000_000})
	if err != nil {
		t.Fatal(err)
	}
	conf, err := svc.Confirm(ctx, r.user, q.ID)
	if err != nil {
		t.Fatal(err)
	}
	_ = m.CompleteSwap(conf.ProviderSwapID, cryptoprov.SwapCompleted)
	_, _ = r.pool.Exec(ctx, `UPDATE public.crypto_swaps SET updated_at = now() - interval '5 minutes' WHERE id = $1::uuid`, q.ID)

	before := r.snap(t)
	rec := NewReconciler(ReconcilerConfig{Service: svc, Leader: NewPGLeader(lockLocker(t).pool),
		ClearingBalance: func(ctx context.Context) (int64, error) { return r.led.GetAccountBalance(ctx, r.clearing.ID) }})
	res, err := rec.RunOnce(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if res.Resolved < 1 {
		t.Fatalf("res=%+v", res)
	}
	after := r.snap(t)
	if after.rev-before.rev != 7_500 || after.c-before.c != -7_500 {
		t.Fatalf("fee not recognised: revenue %+d clearing %+d", after.rev-before.rev, after.c-before.c)
	}
	if s, _, _ := svc.cfg.Store.SwapByID(ctx, r.user, q.ID); s.State != cryptoprov.SwapStateCompleted {
		t.Fatalf("state = %s", s.State)
	}
}
