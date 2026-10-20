package restaurant

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"spotlight/backend/internal/testsupport"
)

// Regression guards for FOOD-UAT-D-001: transitionInternal used a plain SELECT then an
// unguarded UPDATE, so a concurrent accept + cancel could leave orders.status =
// 'preparing' on an already-refunded escrow. Live-DB (gated by fsmPool's
// TEST_DATABASE_URL skip).

func raceSetup(t *testing.T) (*pgxpool.Pool, *Service, string, string, string) {
	pool := fsmPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	owner, customer := uuid.New().String(), uuid.New().String()
	for _, u := range []string{owner, customer} {
		_, _ = pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test")
		testsupport.CleanupUser(t, pool, u)
	}
	restID := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO restaurants (id, owner_id, name, address, is_open) VALUES ($1,$2,'Race Kitchen','1 St',TRUE)`, restID, owner); err != nil {
		t.Fatal(err)
	}
	return pool, fsmService(pool), restID, owner, customer
}

// A refunded escrow must never coexist with a live (non-terminal) order status.
func TestTransitionRace_AcceptVsCancel_NeverRefundedButPreparing(t *testing.T) {
	pool, svc, restID, owner, customer := raceSetup(t)
	ctx := context.Background()
	const rounds = 300
	for r := 0; r < rounds; r++ {
		oid, settID := seedOrderWithEscrow(t, ctx, pool, restID, customer, nil, "confirmed", "none", nil)
		var wg sync.WaitGroup
		start := make(chan struct{})
		var aerr error
		wg.Add(2)
		go func() { defer wg.Done(); <-start; aerr = svc.UpdateStatus(ctx, oid, owner, OrderPreparing) }()
		go func() { defer wg.Done(); <-start; _ = svc.UpdateStatus(ctx, oid, customer, OrderCancelled) }()
		close(start)
		wg.Wait()
		st := orderStatusFSM(t, ctx, pool, oid)
		ss := settlementStatusFSM(t, ctx, pool, settID)
		if ss == "refunded" && st != "cancelled" {
			t.Fatalf("round %d: order=%s settlement=%s (accept_err=%v) — refunded escrow on a live order", r, st, ss, aerr)
		}
		if aerr != nil && !errors.Is(aerr, ErrOrderTransitionConflict) && st == "preparing" {
			t.Fatalf("round %d: accept errored (%v) yet order is preparing", r, aerr)
		}
	}
}

// Deterministic stale-read replay: an accept that read 'confirmed' before a cancel
// committed must be refused, not overwrite the cancelled state.
func TestTransitionRace_StaleWriteCannotOverwriteCancel(t *testing.T) {
	pool, svc, restID, owner, customer := raceSetup(t)
	ctx := context.Background()
	oid, _ := seedOrderWithEscrow(t, ctx, pool, restID, customer, nil, "confirmed", "none", nil)
	if err := svc.UpdateStatus(ctx, oid, customer, OrderCancelled); err != nil {
		t.Fatal(err)
	}
	if err := svc.UpdateStatus(ctx, oid, owner, OrderPreparing); err == nil {
		t.Fatal("transition out of cancelled must be refused")
	}
	if st := orderStatusFSM(t, ctx, pool, oid); st != "cancelled" {
		t.Fatalf("order=%s, want cancelled", st)
	}
}

// N parallel identical transitions: exactly one wins, the rest are refused.
func TestTransitionRace_ParallelAcceptExactlyOnce(t *testing.T) {
	pool, svc, restID, owner, customer := raceSetup(t)
	ctx := context.Background()
	for r := 0; r < 50; r++ {
		oid, _ := seedOrderWithEscrow(t, ctx, pool, restID, customer, nil, "pending", "none", nil)
		var wg sync.WaitGroup
		start := make(chan struct{})
		var mu sync.Mutex
		ok := 0
		for i := 0; i < 8; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				<-start
				if svc.UpdateStatus(ctx, oid, owner, OrderConfirmed) == nil {
					mu.Lock()
					ok++
					mu.Unlock()
				}
			}()
		}
		close(start)
		wg.Wait()
		if ok != 1 {
			t.Fatalf("round %d: %d concurrent confirms succeeded, want exactly 1", r, ok)
		}
	}
}
