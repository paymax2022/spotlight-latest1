// Command marketplace-cron runs the periodic (non-request-driven) jobs the
// marketplace listing lifecycle depends on:
//
//   - listing auto_expire            (§2.1: active -> expired when expires_at < now())
//
// The order auto_release and hourly escrow reconciliation jobs were removed with
// the escrow order FSM (ADR-023 listings-and-connect pivot): the marketplace no
// longer holds escrow orders, so there is nothing to release or reconcile.
//
// House pattern: ticker-goroutine-style loop per job, mirroring
// internal/fractionalre/autoinvest_runner.go (StartAutoInvestRunner) — this
// repo has no pg_cron and no asynq periodic scheduler. This binary is ledger-free
// (the listing auto-expire job is raw SQL with no money movement).
package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	goredis "github.com/redis/go-redis/v9"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/marketplace"
	platformDB "spotlight/backend/internal/platform/db"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		log.Fatal("marketplace-cron: DATABASE_URL is required")
	}

	pool, err := platformDB.New(ctx, dsn)
	if err != nil {
		log.Fatalf("marketplace-cron: connect to database: %v", err)
	}
	defer pool.Close()

	// Order auto-release + escrow reconciliation jobs REMOVED (ADR-023
	// listings-and-connect pivot): the marketplace no longer holds escrow orders.
	// The periodic jobs are listing auto-expiry (§2.1) and boost completion (§2.4).
	log.Println("marketplace-cron: starting (listing auto-expire + boost completion every 5m)")

	// Build the marketplace Service (nil Redis — these jobs are queue-free). The
	// ledger is needed only to satisfy the constructor; the cron jobs here do not
	// move money (listing expiry and boost completion are both non-ledger).
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	svc := marketplace.NewService(pool, led, (*goredis.Client)(nil))

	var wg sync.WaitGroup
	wg.Add(3)
	go runLoop(ctx, &wg, "listing-auto-expire", 5*time.Minute, func(c context.Context) {
		if n, err := svc.ExpireDueListings(c); err != nil {
			log.Printf("marketplace-cron: expire-listings: %v", err)
		} else if n > 0 {
			log.Printf("marketplace-cron: expire-listings: expired %d listing(s)", n)
		}
	})
	go runLoop(ctx, &wg, "boost-completion", 5*time.Minute, func(c context.Context) {
		if n, err := svc.CompleteDueBoosts(c); err != nil {
			log.Printf("marketplace-cron: boost-completion: %v", err)
		} else if n > 0 {
			log.Printf("marketplace-cron: boost-completion: completed %d boost(s)", n)
		}
	})
	// Money owed back to a seller, so it runs more often than the housekeeping
	// jobs. RejectBoost sets the status before posting the reversal; a ledger
	// failure between the two leaves the seller un-promoted AND still charged,
	// and until this existed the only trace was a log line nobody reads.
	go runLoop(ctx, &wg, "boost-refund-retry", time.Minute, func(c context.Context) {
		if n, err := svc.RetryStuckBoostRefunds(c); err != nil {
			log.Printf("marketplace-cron: boost-refund-retry: %v", err)
		} else if n > 0 {
			log.Printf("marketplace-cron: boost-refund-retry: refunded %d stranded boost(s)", n)
		}
	})

	wg.Wait()
	log.Println("marketplace-cron: shut down")
}

// runLoop runs fn immediately and then every interval until ctx is done. Each
// job is isolated in its own goroutine so a slow/stuck job never blocks the
// others (mirrors StartAutoInvestRunner's per-job ticker convention).
func runLoop(ctx context.Context, wg *sync.WaitGroup, name string, interval time.Duration, fn func(context.Context)) {
	defer wg.Done()
	run := func() {
		tctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
		defer cancel()
		defer func() {
			if r := recover(); r != nil {
				log.Printf("marketplace-cron: job %s panicked (recovered): %v", name, r)
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
