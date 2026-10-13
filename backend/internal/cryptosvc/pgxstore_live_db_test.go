package cryptosvc

// Live-DB tests for PGStore. SKIPPED unless TEST_DATABASE_URL is set.

import (
	"context"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shopspring/decimal"

	"spotlight/backend/internal/cryptoprov"
)

func livePool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL — skipping crypto webhook live-DB test")
	}
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	// Deliberately small, like a CI runner: it keeps the pool-starvation regression visible
	// (a locker sharing this pool deadlocks under 8 concurrent confirms).
	cfg.MaxConns = 4
	pool, err := pgxpool.NewWithConfig(context.Background(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func seedSwap(t *testing.T, pool *pgxpool.Pool, status string) (id, providerSwapID string) {
	t.Helper()
	ctx := context.Background()
	user := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, user, user+"@seed.test"); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	providerSwapID = "sw_" + uuid.NewString()
	if err := pool.QueryRow(ctx,
		`INSERT INTO public.crypto_swaps (user_id, provider, provider_account_id, provider_swap_id, from_currency, to_currency,
		   from_amount, quoted_to_amount, quoted_price, status)
		 VALUES ($1,'livetest','acct',$2,'USDT','NGN',10,15000,1500,$3) RETURNING id::text`,
		user, providerSwapID, status).Scan(&id); err != nil {
		t.Fatalf("seed swap: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM public.crypto_swaps WHERE id=$1::uuid`, id)
		_, _ = pool.Exec(context.Background(), `DELETE FROM auth.users WHERE id=$1`, user)
	})
	return id, providerSwapID
}

func TestPGStore_WebhookDedupe(t *testing.T) {
	pool := livePool(t)
	s := NewPGStore(pool)
	ctx := context.Background()
	key := "livetest:" + uuid.NewString()
	t.Cleanup(func() { _ = s.DeleteWebhookEvent(context.Background(), key) })
	ev := WebhookEvent{Key: key, Provider: "livetest", Type: "swap_transaction.completed", Payload: []byte(`{"id":"x"}`), ReceivedAt: time.Now()}
	if ok, err := s.InsertWebhookEvent(ctx, ev); err != nil || !ok {
		t.Fatalf("first insert ok=%v err=%v", ok, err)
	}
	if ok, err := s.InsertWebhookEvent(ctx, ev); err != nil || ok {
		t.Fatalf("duplicate insert ok=%v err=%v (must report not inserted)", ok, err)
	}
	if err := s.DeleteWebhookEvent(ctx, key); err != nil {
		t.Fatal(err)
	}
	if ok, err := s.InsertWebhookEvent(ctx, ev); err != nil || !ok {
		t.Fatalf("insert after release ok=%v err=%v", ok, err)
	}
}

func TestPGStore_ConcurrentDuplicateDeliveriesInsertOnce(t *testing.T) {
	pool := livePool(t)
	s := NewPGStore(pool)
	key := "livetest:" + uuid.NewString()
	t.Cleanup(func() { _ = s.DeleteWebhookEvent(context.Background(), key) })
	var wg sync.WaitGroup
	var mu sync.Mutex
	won := 0
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			ok, err := s.InsertWebhookEvent(context.Background(), WebhookEvent{Key: key, Provider: "livetest", Type: "t", ReceivedAt: time.Now()})
			if err != nil {
				t.Error(err)
				return
			}
			if ok {
				mu.Lock()
				won++
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	if won != 1 {
		t.Fatalf("%d deliveries won the dedupe insert, want exactly 1", won)
	}
}

func TestPGStore_TransitionIsConditional(t *testing.T) {
	pool := livePool(t)
	s := NewPGStore(pool)
	ctx := context.Background()
	id, psid := seedSwap(t, pool, "processing")

	// Two racing writers: exactly one wins.
	var wg sync.WaitGroup
	var mu sync.Mutex
	applied := 0
	for _, to := range []cryptoprov.SwapState{cryptoprov.SwapStateCompleted, cryptoprov.SwapStateFailed} {
		wg.Add(1)
		go func(to cryptoprov.SwapState) {
			defer wg.Done()
			ok, err := s.TransitionSwap(ctx, id, cryptoprov.SwapStateProcessing, to, decimal.RequireFromString("15000.5"), "")
			if err != nil {
				t.Error(err)
				return
			}
			if ok {
				mu.Lock()
				applied++
				mu.Unlock()
			}
		}(to)
	}
	wg.Wait()
	if applied != 1 {
		t.Fatalf("%d writers applied, want exactly 1", applied)
	}
	rec, found, err := s.SwapByProviderID(ctx, "livetest", psid)
	if err != nil || !found || !rec.State.IsTerminal() {
		t.Fatalf("rec=%+v found=%v err=%v", rec, found, err)
	}
	// A terminal swap cannot be moved again.
	if ok, _ := s.TransitionSwap(ctx, id, cryptoprov.SwapStateProcessing, cryptoprov.SwapStateCompleted, decimal.Zero, ""); ok {
		t.Fatal("transition applied from a state the row is no longer in")
	}
}

func TestPGStore_ReceivedAmountKeepsExactDecimals(t *testing.T) {
	pool := livePool(t)
	s := NewPGStore(pool)
	ctx := context.Background()
	id, psid := seedSwap(t, pool, "processing")
	want := decimal.RequireFromString("0.000000000000000001")
	if ok, err := s.TransitionSwap(ctx, id, cryptoprov.SwapStateProcessing, cryptoprov.SwapStateCompleted, want, ""); err != nil || !ok {
		t.Fatalf("ok=%v err=%v", ok, err)
	}
	rec, _, err := s.SwapByProviderID(ctx, "livetest", psid)
	if err != nil || !rec.ReceivedAmount.Equal(want) {
		t.Fatalf("received = %s, want %s (err %v)", rec.ReceivedAmount, want, err)
	}
}

func TestPGStore_UnknownSwapIsNotFound(t *testing.T) {
	pool := livePool(t)
	_, found, err := NewPGStore(pool).SwapByProviderID(context.Background(), "livetest", "sw_"+uuid.NewString())
	if err != nil || found {
		t.Fatalf("found=%v err=%v", found, err)
	}
}
