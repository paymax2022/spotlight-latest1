package doctor_test

// LIVE-DB (ADR-PR879, ledger audit of PR #879, L-M1): a console appointment in a
// terminal state (completed / cancelled / no_show) cannot be moved to another
// state; repeating the same terminal state stays idempotent. And for an
// appointment bridged from a telemedicine booking, End records commission only
// once the telemedicine side actually settled. Skipped unless TEST_DATABASE_URL.

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/doctor"
)

type fakeTele struct{ bridged, settled bool }

func (f fakeTele) SyncFromDoctorConsole(context.Context, string, string, string) error { return nil }
func (f fakeTele) ConsultSettled(context.Context, string) (bool, bool, error) {
	return f.bridged, f.settled, nil
}

type countingRecorder struct{ n int }

func (c *countingRecorder) RecordFor(context.Context, string, string, string, int64, string, string, *string, string) error {
	c.n++
	return nil
}

func consolePool(t *testing.T) (*pgxpool.Pool, string) {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	owner := uuid.NewString()
	if _, err := pool.Exec(context.Background(), `INSERT INTO auth.users (id,email) VALUES ($1::uuid,$2)`, owner, owner+"@console.test"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM auth.users WHERE id=$1::uuid`, owner) })
	return pool, owner
}

func seedConsoleAppointment(t *testing.T, pool *pgxpool.Pool, owner, status string) string {
	t.Helper()
	id := uuid.NewString()
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO doctor_appointments (id, user_id, status, fee_kobo) VALUES ($1::uuid,$2::uuid,$3,500000)`, id, owner, status); err != nil {
		t.Fatalf("seed: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM doctor_appointments WHERE id=$1::uuid`, id)
	})
	return id
}

func TestLiveDB_ConsoleTerminalStatesAreFinal(t *testing.T) {
	pool, owner := consolePool(t)
	ctx := context.Background()
	svc := doctor.NewService(pool, nil, nil, nil)
	id := seedConsoleAppointment(t, pool, owner, "cancelled")
	if _, err := svc.EndAppointment(ctx, owner, id, nil); !errors.Is(err, doctor.ErrNotFound) {
		t.Fatalf("End on a cancelled appointment: got %v, want refusal (ErrNotFound)", err)
	}
	if _, err := svc.CancelAppointment(ctx, owner, id, nil); err != nil {
		t.Fatalf("repeating the same terminal state must stay idempotent: %v", err)
	}
}

func TestLiveDB_ConsoleEndRecordsCommissionOnlyAfterARealSettle(t *testing.T) {
	pool, owner := consolePool(t)
	ctx := context.Background()
	for _, tc := range []struct {
		name            string
		tele            fakeTele
		wantCommissions int
	}{
		{"standalone console appointment", fakeTele{bridged: false}, 1},
		{"bridged and settled", fakeTele{bridged: true, settled: true}, 1},
		{"bridged but not settled", fakeTele{bridged: true, settled: false}, 0},
	} {
		rec := &countingRecorder{}
		svc := doctor.NewService(pool, nil, nil, nil).WithTelemedicineSync(tc.tele)
		svc.SetCommissionRecorder(rec)
		id := seedConsoleAppointment(t, pool, owner, "in_progress")
		if _, err := svc.EndAppointment(ctx, owner, id, nil); err != nil {
			t.Fatalf("%s: End: %v", tc.name, err)
		}
		if rec.n != tc.wantCommissions {
			t.Fatalf("%s: recorded %d commissions, want %d", tc.name, rec.n, tc.wantCommissions)
		}
	}
}
