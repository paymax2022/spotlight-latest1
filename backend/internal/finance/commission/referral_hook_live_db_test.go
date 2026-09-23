package commission_test

// ---------------------------------------------------------------------------
// LIVE-DB test proving commission.Service.ReferralHook fires exactly once per
// GENUINELY NEW earning — never on an idempotent-replay duplicate — since the
// referral purchase-commission-split engine (referral/commissionsplit) relies
// on that guarantee to never double-increment a referral code's reward cap.
//
// SKIPPED whenever TEST_DATABASE_URL is unset.
//
// Bring-up:
//   export TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
//   cd backend && go test ./internal/finance/commission/... -run TestReferralHook -v -count=1
// ---------------------------------------------------------------------------

import (
	"context"
	"os"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/commission"
)

func mustLiveCommissionPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping live-DB test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect TEST_DATABASE_URL: %v", err)
	}
	t.Cleanup(pool.Close)
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping TEST_DATABASE_URL: %v", err)
	}
	return pool
}

type countingHook struct {
	mu      sync.Mutex
	earning []commission.Earning
}

func (h *countingHook) OnEarningRecorded(_ context.Context, e commission.Earning) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.earning = append(h.earning, e)
}

func (h *countingHook) calls() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.earning)
}

func TestReferralHook_FiresOnceOnNewEarning_NeverOnReplay(t *testing.T) {
	pool := mustLiveCommissionPool(t)
	ctx := context.Background()

	repo := commission.NewRepository(pool)
	svc := commission.NewService(repo, nil)
	hook := &countingHook{}
	svc.SetReferralHook(hook)

	userID := uuid.NewString()
	idempotencyKey := "test:referral-hook:" + uuid.NewString()
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM public.commission_earnings WHERE idempotency_key = $1`, idempotencyKey)
	})

	earning, err := svc.RecordExact(ctx, "test", "test", "test", 1_000_00, 20_000, "test_module", "ref-"+uuid.NewString(), &userID, idempotencyKey)
	if err != nil {
		t.Fatalf("RecordExact (first call): %v", err)
	}
	if hook.calls() != 1 {
		t.Fatalf("hook calls after first RecordExact = %d, want 1", hook.calls())
	}
	if hook.earning[0].ID != earning.ID {
		t.Fatalf("hook received earning ID %q, want %q", hook.earning[0].ID, earning.ID)
	}

	// Replay with the SAME idempotency key — the underlying row already exists
	// (ON CONFLICT DO NOTHING), so InsertEarning reports inserted=false and the
	// hook must NOT fire again.
	replayed, err := svc.RecordExact(ctx, "test", "test", "test", 1_000_00, 20_000, "test_module", "ref-"+uuid.NewString(), &userID, idempotencyKey)
	if err != nil {
		t.Fatalf("RecordExact (replay): %v", err)
	}
	if replayed.ID != earning.ID {
		t.Fatalf("replay returned a different earning row (%q vs %q) — idempotency key did not dedupe", replayed.ID, earning.ID)
	}
	if hook.calls() != 1 {
		t.Fatalf("hook calls after replay = %d, want still 1 (a duplicate must never re-fire the referral hook)", hook.calls())
	}
}

func TestReferralHook_FiresOnRecordEarning(t *testing.T) {
	pool := mustLiveCommissionPool(t)
	ctx := context.Background()

	repo := commission.NewRepository(pool)
	svc := commission.NewService(repo, nil)
	hook := &countingHook{}
	svc.SetReferralHook(hook)

	// Seed a minimal active config so RecordEarning can resolve one.
	category := "test-cat-" + uuid.NewString()[:8]
	service := "test-svc"
	subtype := "test-sub"
	var configID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO public.commission_config (service_category, service, service_subtype, fee_model, commission_bps, active)
		VALUES ($1, $2, $3, 'commission', 500, true)
		RETURNING id`, category, service, subtype).Scan(&configID); err != nil {
		t.Fatalf("seed commission_config: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM public.commission_config WHERE id = $1`, configID)
	})

	userID := uuid.NewString()
	idempotencyKey := "test:referral-hook-record-earning:" + uuid.NewString()
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM public.commission_earnings WHERE idempotency_key = $1`, idempotencyKey)
	})

	_, err := svc.RecordEarning(ctx, commission.EarningInput{
		ServiceCategory: category,
		Service:         service,
		ServiceSubtype:  subtype,
		GrossAmountKobo: 1_000_00,
		SourceModule:    "test_module",
		SourceRef:       "ref-" + uuid.NewString(),
		UserID:          &userID,
	}, idempotencyKey)
	if err != nil {
		t.Fatalf("RecordEarning: %v", err)
	}
	if hook.calls() != 1 {
		t.Fatalf("hook calls after RecordEarning = %d, want 1", hook.calls())
	}
}
