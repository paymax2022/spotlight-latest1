package transport

// Shared LIVE-DB fixtures for the wallet bus-path regression suite (cancel/refund
// truth, idempotent replay, seat re-booking, deferred settlement, schedule cancel).
// Everything here skips unless TEST_DATABASE_URL is set.

import (
	"context"
	"fmt"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/settlement"
	"spotlight/backend/internal/testsupport"
)

type busFx struct {
	t    *testing.T
	ctx  context.Context
	pool *pgxpool.Pool
	led  *ledger.Service
	svc  *Service
}

func newBusFx(t *testing.T) *busFx {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping bus wallet live-DB test")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := pool.Ping(ctx); err != nil {
		t.Fatalf("ping: %v", err)
	}
	t.Cleanup(pool.Close)
	led := ledger.NewService(ledger.NewRepository(pool), nil)
	svc := NewService(pool, settlement.NewService(pool, led)).WithLedger(led)
	return &busFx{t: t, ctx: ctx, pool: pool, led: led, svc: svc}
}

// user seeds a KYC-tier-2 user holding fundKobo in the wallet.
func (f *busFx) user(fundKobo int64) string {
	f.t.Helper()
	id := uuid.New().String()
	if _, err := f.pool.Exec(f.ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, id, id+"@buswallet.test"); err != nil {
		f.t.Fatalf("seed user: %v", err)
	}
	testsupport.CleanupUser(f.t, f.pool, id)
	testsupport.SetKycTier(f.t, f.ctx, f.pool, id, 2)
	if fundKobo > 0 {
		rev, err := f.led.GetOrCreateStandingAccount(f.ctx, ledger.AccountPaymaxRevenue)
		if err != nil {
			f.t.Fatalf("revenue account: %v", err)
		}
		if err := f.led.Credit(f.ctx, id, "seed:buswallet", "seed-fund-"+id, rev.ID, fundKobo); err != nil {
			f.t.Fatalf("fund user: %v", err)
		}
	}
	return id
}

func (f *busFx) balance(userID string) int64 {
	f.t.Helper()
	b, err := f.led.GetBalance(f.ctx, userID)
	if err != nil {
		f.t.Fatalf("balance(%s): %v", userID, err)
	}
	return b
}

// busRoute is a marketplace route owned by a verified+active provider.
type busRoute struct{ ProviderID, OwnerID, RouteID string }

func (f *busFx) provider(verification, status string) busRoute {
	f.t.Helper()
	owner := f.user(0)
	var pid string
	if err := f.pool.QueryRow(f.ctx, `
		INSERT INTO bus_providers (owner_user_id, business_name, contact_phone, verification_status, status)
		VALUES ($1,'Fixture Coaches','08000000000',$2,$3) RETURNING id`, owner, verification, status).Scan(&pid); err != nil {
		f.t.Fatalf("seed provider: %v", err)
	}
	var rid string
	if err := f.pool.QueryRow(f.ctx, `
		INSERT INTO bus_routes (operator_id, provider_id, origin_terminal, dest_terminal, from_state, to_state, active, status)
		VALUES ($1,$2,'Lagos','Abuja','Lagos','FCT',TRUE,'active') RETURNING id`, owner, pid).Scan(&rid); err != nil {
		f.t.Fatalf("seed route: %v", err)
	}
	f.t.Cleanup(func() {
		c := context.Background()
		_, _ = f.pool.Exec(c, `DELETE FROM bus_tickets WHERE schedule_id IN (SELECT id FROM bus_schedules WHERE route_id=$1)`, rid)
		_, _ = f.pool.Exec(c, `DELETE FROM bus_schedules WHERE route_id=$1`, rid)
		_, _ = f.pool.Exec(c, `DELETE FROM bus_routes WHERE id=$1`, rid)
		_, _ = f.pool.Exec(c, `DELETE FROM bus_providers WHERE id=$1`, pid)
	})
	return busRoute{ProviderID: pid, OwnerID: owner, RouteID: rid}
}

func (f *busFx) verifiedRoute() busRoute { return f.provider("verified", "active") }

func (f *busFx) schedule(routeID string, departure time.Time, seats int, fare int64) string {
	f.t.Helper()
	var id string
	if err := f.pool.QueryRow(f.ctx, `
		INSERT INTO bus_schedules (route_id, departure_time, total_seats, fare_kobo, fare_approved, status)
		VALUES ($1,$2,$3,$4,TRUE,'scheduled') RETURNING id`, routeID, departure, seats, fare).Scan(&id); err != nil {
		f.t.Fatalf("seed schedule: %v", err)
	}
	return id
}

func (f *busFx) book(userID, scheduleID string, seat int, key string) (map[string]any, error) {
	return f.svc.BookBusTicket(f.ctx, userID, BusBookRequest{
		ScheduleID: scheduleID, SeatNumber: seat, PassengerName: "Test Pax",
	}, key)
}

func (f *busFx) settlementStatus(settID string) string {
	f.t.Helper()
	var st string
	if err := f.pool.QueryRow(f.ctx, `SELECT status FROM settlements WHERE id=$1`, settID).Scan(&st); err != nil {
		f.t.Fatalf("settlement status: %v", err)
	}
	return st
}

func (f *busFx) ticketRow(ticketID string) (status, payment, refund, settID string) {
	f.t.Helper()
	var sid *string
	if err := f.pool.QueryRow(f.ctx,
		`SELECT status, payment_status, refund_status, settlement_id::text FROM bus_tickets WHERE id=$1`, ticketID).
		Scan(&status, &payment, &refund, &sid); err != nil {
		f.t.Fatalf("ticket row %s: %v", ticketID, err)
	}
	if sid != nil {
		settID = *sid
	}
	return
}

func (f *busFx) ticketCountForKey(key string) int {
	f.t.Helper()
	var n int
	if err := f.pool.QueryRow(f.ctx, `SELECT COUNT(*) FROM bus_tickets WHERE idempotency_key=$1`, key).Scan(&n); err != nil {
		f.t.Fatalf("count tickets: %v", err)
	}
	return n
}

func str(m map[string]any, k string) string { v, _ := m[k].(string); return v }

// failSettleFor installs (once per process) a trigger that makes any UPDATE of a
// settlements row to 'settled' FAIL for payers registered in busfix_fail_settle -
// the only deterministic way to model "Settle failed after the ticket was issued".
var failSettleOnce sync.Once

func (f *busFx) failSettleFor(payer string) (restore func()) {
	f.t.Helper()
	failSettleOnce.Do(func() {
		for _, q := range []string{
			`CREATE TABLE IF NOT EXISTS busfix_fail_settle (payer_id uuid PRIMARY KEY)`,
			`CREATE OR REPLACE FUNCTION busfix_block_settle() RETURNS trigger AS $$
			 BEGIN
			   IF NEW.status='settled' AND EXISTS (SELECT 1 FROM busfix_fail_settle WHERE payer_id=NEW.payer_id) THEN
			     RAISE EXCEPTION 'busfix: induced settle failure';
			   END IF;
			   RETURN NEW;
			 END $$ LANGUAGE plpgsql`,
			`DROP TRIGGER IF EXISTS busfix_block_settle_trg ON settlements`,
			`CREATE TRIGGER busfix_block_settle_trg BEFORE UPDATE ON settlements FOR EACH ROW EXECUTE FUNCTION busfix_block_settle()`,
		} {
			if _, err := f.pool.Exec(context.Background(), q); err != nil {
				f.t.Fatalf("install settle-failure trigger: %v", err)
			}
		}
	})
	if _, err := f.pool.Exec(f.ctx, `INSERT INTO busfix_fail_settle VALUES ($1) ON CONFLICT DO NOTHING`, payer); err != nil {
		f.t.Fatalf("arm settle failure: %v", err)
	}
	done := false
	restore = func() {
		if !done {
			done = true
			_, _ = f.pool.Exec(context.Background(), `DELETE FROM busfix_fail_settle WHERE payer_id=$1`, payer)
		}
	}
	f.t.Cleanup(restore)
	return restore
}

func ptrTime(t time.Time) *time.Time { return &t }

var _ = fmt.Sprintf
