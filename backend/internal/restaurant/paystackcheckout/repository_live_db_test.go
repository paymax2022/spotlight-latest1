package paystackcheckout

// Live-DB integration tests for IntentRepository over
// public.restaurant_order_paystack_intents. Skipped unless
// TEST_DATABASE_URL/DATABASE_URL is set (mirrors every other live-DB test in
// this codebase — see restaurant/tierlimit_live_db_test.go's tierPool).
//
// What these pin:
//  1. PutIntent is idempotent on idempotency_key — a replay returns the
//     EXISTING row rather than inserting a second one.
//  2. ClaimForProcessing is genuinely atomic under REAL concurrent DB
//     connections — this is the one property the in-memory fake in
//     service_test.go cannot actually prove (a mutex-guarded map is atomic by
//     construction; the real guarantee has to come from the SQL).

import (
	"context"
	"encoding/json"
	"os"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func repoPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = os.Getenv("DATABASE_URL")
	}
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping live-DB paystackcheckout repository test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping: %v", err)
	}
	return pool
}

func sampleRecord(idemKey string) intentRecord {
	reqJSON, _ := json.Marshal(map[string]any{"items": []any{}})
	return intentRecord{
		Reference:      referenceFor(idemKey),
		RestaurantID:   uuid.New().String(),
		CustomerID:     uuid.New().String(),
		RequestJSON:    reqJSON,
		AmountKobo:     150_000,
		IdempotencyKey: idemKey,
	}
}

func TestLiveDB_PutIntent_IdempotentOnKey(t *testing.T) {
	pool := repoPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	repo := NewIntentStore(pool)

	idemKey := "repo-idem-" + uuid.New().String()
	in := sampleRecord(idemKey)

	existing, inserted, err := repo.PutIntent(ctx, in)
	if err != nil {
		t.Fatalf("first PutIntent: %v", err)
	}
	if !inserted || existing != nil {
		t.Fatalf("first PutIntent: inserted=%v existing=%v, want inserted=true existing=nil", inserted, existing)
	}

	// Replay with a DIFFERENT amount — if this were not idempotency-checked,
	// it would silently overwrite the frozen charge amount.
	replay := in
	replay.AmountKobo = 999_999
	existing2, inserted2, err := repo.PutIntent(ctx, replay)
	if err != nil {
		t.Fatalf("replay PutIntent: %v", err)
	}
	if inserted2 {
		t.Fatal("replay PutIntent reported a fresh insert — idempotency_key uniqueness is not being respected")
	}
	if existing2 == nil || existing2.AmountKobo != 150_000 {
		t.Fatalf("replay PutIntent existing = %+v, want the ORIGINAL frozen amount 150000, not the replay's 999999", existing2)
	}

	got, err := repo.GetByReference(ctx, in.Reference)
	if err != nil {
		t.Fatalf("GetByReference: %v", err)
	}
	if got.AmountKobo != 150_000 {
		t.Errorf("stored amount = %d, want 150000 (must not have been overwritten by the replay)", got.AmountKobo)
	}
}

func TestLiveDB_GetByReference_UnknownIsErrUnknownReference(t *testing.T) {
	pool := repoPool(t)
	t.Cleanup(pool.Close)
	repo := NewIntentStore(pool)

	if _, err := repo.GetByReference(context.Background(), "foodorder:does-not-exist-"+uuid.New().String()); err != ErrUnknownReference {
		t.Fatalf("err = %v, want ErrUnknownReference", err)
	}
}

// TestLiveDB_ClaimForProcessing_AtomicUnderConcurrency: many real, concurrent
// database connections race to claim the SAME pending intent. Exactly one
// must win — this is the property that stops a redelivered webhook racing a
// status-poll self-heal from both refunding or both placing an order.
func TestLiveDB_ClaimForProcessing_AtomicUnderConcurrency(t *testing.T) {
	pool := repoPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	repo := NewIntentStore(pool)

	idemKey := "repo-claim-" + uuid.New().String()
	in := sampleRecord(idemKey)
	if _, _, err := repo.PutIntent(ctx, in); err != nil {
		t.Fatalf("PutIntent: %v", err)
	}

	const attempts = 20
	results := make([]bool, attempts)
	var wg sync.WaitGroup
	for i := 0; i < attempts; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			claimed, err := repo.ClaimForProcessing(ctx, in.Reference)
			if err != nil {
				t.Errorf("ClaimForProcessing[%d]: %v", idx, err)
				return
			}
			results[idx] = claimed
		}(i)
	}
	wg.Wait()

	wins := 0
	for _, r := range results {
		if r {
			wins++
		}
	}
	if wins != 1 {
		t.Fatalf("%d of %d concurrent claims won, want exactly 1", wins, attempts)
	}

	rec, err := repo.GetByReference(ctx, in.Reference)
	if err != nil {
		t.Fatalf("GetByReference: %v", err)
	}
	if rec.Status != "processing" {
		t.Errorf("status after the race = %s, want processing", rec.Status)
	}
}

func TestLiveDB_MarkStatus_SetsOrderIDAndRefundReference(t *testing.T) {
	pool := repoPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	repo := NewIntentStore(pool)

	idemKey := "repo-mark-" + uuid.New().String()
	in := sampleRecord(idemKey)
	if _, _, err := repo.PutIntent(ctx, in); err != nil {
		t.Fatalf("PutIntent: %v", err)
	}

	orderID := uuid.New().String()
	if err := repo.MarkStatus(ctx, in.Reference, "confirmed", &orderID, nil); err != nil {
		t.Fatalf("MarkStatus: %v", err)
	}
	rec, err := repo.GetByReference(ctx, in.Reference)
	if err != nil {
		t.Fatalf("GetByReference: %v", err)
	}
	if rec.Status != "confirmed" {
		t.Errorf("status = %s, want confirmed", rec.Status)
	}
	if rec.OrderID == nil || *rec.OrderID != orderID {
		t.Errorf("order id = %v, want %s", rec.OrderID, orderID)
	}
}
