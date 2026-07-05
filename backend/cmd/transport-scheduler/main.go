// Command transport-scheduler runs the periodic (non-request-driven) jobs the
// Transport Trip Scheduling feature depends on:
//
//   - dispatch-due       every 60s: find `scheduled` bookings whose lead window
//                        has arrived, flip to `dispatch_pending`, and materialize
//                        the real trip/parcel/bus artifact via the existing
//                        transport.Service (which escrows via `settlement` at
//                        dispatch). Idempotent per booking (deterministic idem key
//                        sched:<id>:dispatch).
//   - reminders          every 60s: send idempotent 24h/1h pre-pickup reminders
//                        (guarded by reminder_*_sent_at columns).
//   - expire-stale       every 60s: safety-net expiry of past-due, never-dispatched
//                        `scheduled` bookings.
//
// House pattern: ticker-goroutine-style runLoop per job, mirroring
// backend/cmd/marketplace-cron/main.go — this repo has no pg_cron / asynq
// periodic scheduler.
//
// Money-path note: this binary NEVER posts ledger entries itself. All escrow /
// refund goes through transport.Service.DispatchScheduled → the per-mode service
// → `settlement`, the exact same guarded, idempotent path the request-driven API
// uses. Flag-guarded: does nothing unless FEATURE_TRANSPORT_SCHEDULING_ENABLED.
package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"spotlight/backend/internal/config"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/settlement"
	platformDB "spotlight/backend/internal/platform/db"
	"spotlight/backend/internal/transport"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	cfg := config.Load()
	if !cfg.FeatureTransportSchedulingEnabled {
		log.Println("transport-scheduler: FEATURE_TRANSPORT_SCHEDULING_ENABLED is off — nothing to do, exiting")
		return
	}

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		log.Fatal("transport-scheduler: DATABASE_URL is required")
	}
	pool, err := platformDB.New(ctx, dsn)
	if err != nil {
		log.Fatalf("transport-scheduler: connect to database: %v", err)
	}
	defer pool.Close()

	// Build the transport Service EXACTLY as the API does in
	// internal/app/finance_routes.go (~L1280): settlement over the finance
	// ledger, then transport.NewService(pool, settlementSvc). Redis is not
	// required for the scheduler (settlement/ledger key their idempotency on the
	// DB-unique settlements.idempotency_key + ledger idempotency), so we pass a
	// nil redis client to the ledger — the same graceful-degradation contract the
	// marketplace-cron uses.
	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), nil)
	settlementSvc := settlement.NewService(pool, ledgerSvc)
	svc := transport.NewService(pool, settlementSvc)
	// NOTE: MockMaps is used for dispatch fare computation here (no MapService is
	// wired into the worker). Fares/escrow at dispatch are computed by the same
	// per-mode path the API uses; in production the maps provider should be wired
	// identically to the API if scheduled fares must match live routing exactly.

	log.Println("transport-scheduler: starting (dispatch-due / reminders / expire-stale every 60s)")

	var wg sync.WaitGroup
	wg.Add(3)
	go runLoop(ctx, &wg, "dispatch-due", 60*time.Second, func(c context.Context) {
		dispatchDue(c, svc)
	})
	go runLoop(ctx, &wg, "reminders", 60*time.Second, func(c context.Context) {
		if n, err := svc.SendDueReminders(c); err != nil {
			log.Printf("transport-scheduler: reminders: %v", err)
		} else if n > 0 {
			log.Printf("transport-scheduler: reminders: sent %d", n)
		}
	})
	go runLoop(ctx, &wg, "expire-stale", 60*time.Second, func(c context.Context) {
		if n, err := svc.ExpireStale(c); err != nil {
			log.Printf("transport-scheduler: expire-stale: %v", err)
		} else if n > 0 {
			log.Printf("transport-scheduler: expire-stale: expired %d", n)
		}
	})

	wg.Wait()
	log.Println("transport-scheduler: shut down")
}

// dispatchDue selects every booking whose dispatch window has arrived and drives
// the single guarded, idempotent DispatchScheduled path for each. A per-booking
// error is logged and does not stop the batch (the booking either retries next
// tick or has been parked in failed_no_driver by DispatchScheduled).
func dispatchDue(ctx context.Context, svc *transport.Service) {
	due, err := svc.DueForDispatch(ctx, 100)
	if err != nil {
		log.Printf("transport-scheduler: dispatch-due: select: %v", err)
		return
	}
	var dispatched int
	for _, b := range due {
		if _, derr := svc.DispatchScheduled(ctx, b.ID); derr != nil {
			log.Printf("transport-scheduler: dispatch booking=%s: %v", b.ID, derr)
			continue
		}
		dispatched++
	}
	if dispatched > 0 {
		log.Printf("transport-scheduler: dispatch-due: dispatched %d booking(s)", dispatched)
	}
}

// runLoop runs fn immediately and then every interval until ctx is done. Each
// job is isolated in its own goroutine + timeout + panic recovery so a slow or
// panicking job never blocks the others (mirrors marketplace-cron's convention).
func runLoop(ctx context.Context, wg *sync.WaitGroup, name string, interval time.Duration, fn func(context.Context)) {
	defer wg.Done()
	run := func() {
		tctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
		defer cancel()
		defer func() {
			if r := recover(); r != nil {
				log.Printf("transport-scheduler: job %s panicked (recovered): %v", name, r)
			}
		}()
		fn(tctx)
	}
	run()
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			run()
		}
	}
}
