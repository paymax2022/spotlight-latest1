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

	platformDB "spotlight/backend/internal/platform/db"
	"spotlight/backend/internal/marketplace"
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
	// listings-and-connect pivot): the marketplace no longer holds escrow orders,
	// so there is nothing to release or reconcile. The only remaining periodic job
	// is listing auto-expiry (§2.1), which is ledger-free.
	log.Println("marketplace-cron: starting (listing auto-expire every 5m)")

	repo := marketplace.NewRepository(pool)

	var wg sync.WaitGroup
	wg.Add(1)
	go runLoop(ctx, &wg, "listing-auto-expire", 5*time.Minute, func(c context.Context) {
		expireListings(c, repo)
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

// expireListings runs §2.1's `active` -> auto_expire -> `expired` transition via
// the ONE canonical path (marketplace.Repository.ExpireDueListings): a single
// transaction that flips status and inserts the search-delete outbox row per
// listing, so a crash can't strand a listing that's `expired` in Postgres but
// still `active` in the search index. No divergent reimplementation lives here.
func expireListings(ctx context.Context, repo *marketplace.Repository) {
	ids, err := repo.ExpireDueListings(ctx, time.Now(), 500)
	if err != nil {
		log.Printf("marketplace-cron: expire-listings: %v", err)
		return
	}
	if len(ids) > 0 {
		log.Printf("marketplace-cron: expire-listings: expired %d listing(s)", len(ids))
	}
}
