package healthrx

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// DP-004 live-DB integration test for prescription refills.
//
// SKIPPED whenever TEST_DATABASE_URL is unset (same env-gate as the
// FX / lab-amendment live-DB suites). Bring-up:
//
//	supabase start   # or any Postgres with the migrations applied
//	export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//	go test ./internal/health/rx/ -run TestRefills_LiveDB
//
// It seeds a DISPENSED prescription (no POM items) with 2 refills authorized, then
// dispenses refills: the first two succeed and increment refills_used, the third is
// blocked with ErrRefillsExhausted — refills allowed within count, blocked after.

func refillLivePool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping live-DB rx refills test; see bring-up note in refill_live_db_test.go")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func TestRefills_LiveDB(t *testing.T) {
	ctx := context.Background()
	pool := refillLivePool(t)
	svc := NewService(pool, nil)

	prescriberID := uuid.New().String()
	patientID := uuid.New().String()
	rxID := uuid.New().String()

	seed := func(q string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, q, args...); err != nil {
			t.Fatalf("seed %q: %v", q, err)
		}
	}
	seed(`INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, prescriberID, prescriberID+"@seed.test")
	seed(`INSERT INTO auth.users (id, email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, patientID, patientID+"@seed.test")
	// A prescription already dispensed once (initial fill done), 2 refills authorized,
	// no POM items so the refill needs no separate verification.
	seed(`INSERT INTO public.health_prescriptions (id, prescriber_id, patient_id, state, refills_authorized, refills_used, dispensed_at)
	      VALUES ($1,$2,$3,'DISPENSED',2,0,now())`, rxID, prescriberID, patientID)

	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM public.health_prescription_items WHERE prescription_id=$1`, rxID)
		_, _ = pool.Exec(bg, `DELETE FROM public.health_prescriptions WHERE id=$1`, rxID)
		_, _ = pool.Exec(bg, `DELETE FROM auth.users WHERE id IN ($1,$2)`, prescriberID, patientID)
	})

	// First two refills succeed and increment the counter.
	for i := 1; i <= 2; i++ {
		p, err := svc.DispenseRefill(ctx, "pharmacist", rxID)
		if err != nil {
			t.Fatalf("refill %d should succeed: %v", i, err)
		}
		if p.RefillsUsed != i {
			t.Fatalf("after refill %d, refills_used = %d, want %d", i, p.RefillsUsed, i)
		}
	}

	// Third refill is blocked — authorized count exhausted.
	if _, err := svc.DispenseRefill(ctx, "pharmacist", rxID); !errors.Is(err, ErrRefillsExhausted) {
		t.Fatalf("refill beyond the authorized count must be blocked with ErrRefillsExhausted, got %v", err)
	}

	// The counter did not advance past the authorized number.
	var used, authorized int
	if err := pool.QueryRow(ctx, `SELECT refills_used, refills_authorized FROM public.health_prescriptions WHERE id=$1`, rxID).
		Scan(&used, &authorized); err != nil {
		t.Fatal(err)
	}
	if used != 2 || authorized != 2 {
		t.Fatalf("refills_used=%d authorized=%d, want 2/2 (never overshoot)", used, authorized)
	}
}
