package cryptosvc

// Live-DB end-to-end: quote -> confirm -> provider completes -> settle, over the REAL
// Postgres store, ledger, tier gate and advisory locks. SKIPPED unless TEST_DATABASE_URL is set.

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/shopspring/decimal"

	"spotlight/backend/internal/cryptoprov"
)

func newLiveService(t *testing.T, r *liveRig) (*Service, *cryptoprov.Mock, *PGStore) {
	t.Helper()
	m := cryptoprov.NewMock("livemock", time.Now)
	m.SetPrice("NGNUSDT", decimal.RequireFromString("0.000666"))
	reg := cryptoprov.NewRegistry("livemock")
	if err := reg.Register(m); err != nil {
		t.Fatal(err)
	}
	store := NewPGStore(r.pool)
	locker := lockLocker(t)
	settler := NewSettler(r.led).WithLocker(locker)
	ing := NewIngest(reg, store).WithSettler(settler)
	svc := NewService(ServiceConfig{
		Registry: reg, Provider: "livemock", Store: store, Settler: settler, Ingest: ing,
		Fees: DefaultFeeSchedule(), Users: dir{}, Gate: okGate{}, Locker: locker,
	})
	t.Cleanup(func() {
		_, _ = r.pool.Exec(context.Background(), `DELETE FROM public.crypto_swaps WHERE user_id = $1::uuid`, r.user)
		_, _ = r.pool.Exec(context.Background(), `DELETE FROM public.crypto_accounts WHERE user_id = $1::uuid`, r.user)
	})
	return svc, m, store
}

func TestLive_BuyEndToEnd(t *testing.T) {
	r := newLiveRig(t, 1, 3_000_000)
	svc, m, store := newLiveService(t, r)
	ctx := context.Background()
	before := r.snap(t)

	q, err := svc.Quote(ctx, QuoteRequest{UserID: r.user, IdempotencyKey: "live-" + r.user, Asset: "USDT", NGNKobo: 1_000_000})
	if err != nil {
		t.Fatal(err)
	}
	again, err := svc.Quote(ctx, QuoteRequest{UserID: r.user, IdempotencyKey: "live-" + r.user, Asset: "USDT", NGNKobo: 1_000_000})
	if err != nil || again.ID != q.ID {
		t.Fatalf("quote replay: %+v %v", again, err)
	}

	conf, err := svc.Confirm(ctx, r.user, q.ID)
	if err != nil || conf.State != cryptoprov.SwapStateProcessing || conf.ProviderSwapID == "" {
		t.Fatalf("confirm: %+v %v", conf, err)
	}
	mid := r.snap(t)
	if mid.w-before.w != -1_007_500 || mid.c-before.c != 1_007_500 {
		t.Fatalf("hold: wallet %d clearing %d", mid.w-before.w, mid.c-before.c)
	}

	_ = m.CompleteSwap(conf.ProviderSwapID, cryptoprov.SwapCompleted)
	done, err := svc.Resolve(ctx, r.user, q.ID)
	if err != nil || done.State != cryptoprov.SwapStateCompleted {
		t.Fatalf("resolve: %+v %v", done, err)
	}
	after := r.snap(t)
	if after.w-before.w != -1_007_500 || after.c-before.c != 1_000_000 || after.rev-before.rev != 7_500 {
		t.Fatalf("settled deltas wallet=%d clearing=%d revenue=%d", after.w-before.w, after.c-before.c, after.rev-before.rev)
	}
	// Another user cannot see it.
	if _, ok, _ := store.SwapByID(ctx, "00000000-0000-0000-0000-000000000001", q.ID); ok {
		t.Fatal("cross-user read returned a swap")
	}
}

func TestLive_ConcurrentConfirmsHoldOnce(t *testing.T) {
	r := newLiveRig(t, 1, 3_000_000)
	svc, _, _ := newLiveService(t, r)
	ctx := context.Background()
	q, err := svc.Quote(ctx, QuoteRequest{UserID: r.user, IdempotencyKey: "live2-" + r.user, Asset: "USDT", NGNKobo: 1_000_000})
	if err != nil {
		t.Fatal(err)
	}
	before := r.snap(t)
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); _, _ = svc.Confirm(ctx, r.user, q.ID) }()
	}
	wg.Wait()
	if got := before.w - r.snap(t).w; got != 1_007_500 {
		t.Fatalf("wallet debited %d, want exactly one hold of 1007500", got)
	}
}

func TestLive_ConcurrentFirstQuotesCreateOneAccount(t *testing.T) {
	r := newLiveRig(t, 1, 0)
	svc, m, _ := newLiveService(t, r)
	var wg sync.WaitGroup
	for i := 0; i < 6; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, _ = svc.Quote(context.Background(), QuoteRequest{UserID: r.user, IdempotencyKey: "acct-" + string(rune('a'+i)), Asset: "USDT", NGNKobo: 1_000_000})
		}(i)
	}
	wg.Wait()
	if n := m.AccountsCreated(); n != 1 {
		t.Fatalf("provider accounts created = %d, want 1", n)
	}
}
