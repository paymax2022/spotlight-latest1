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
	"fmt"
	"log"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

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
	// listings-and-connect pivot): the marketplace no longer holds escrow orders,
	// so there is nothing to release or reconcile. The only remaining periodic job
	// is listing auto-expiry (§2.1), which is ledger-free.
	log.Println("marketplace-cron: starting (listing auto-expire every 5m)")

	var wg sync.WaitGroup
	wg.Add(1)
	go runLoop(ctx, &wg, "listing-auto-expire", 5*time.Minute, func(c context.Context) {
		expireListings(c, pool)
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

// expireListings implements §2.1's `active` -> auto_expire -> `expired`
// transition: `expires_at < now()`, cron job, side effect "insert outbox
// delete". This is read/write-only (no ledger involvement), so it is safe to
// implement here directly rather than depending on package marketplace.
func expireListings(ctx context.Context, pool *pgxpool.Pool) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		log.Printf("marketplace-cron: expire-listings: begin tx: %v", err)
		return
	}
	defer tx.Rollback(ctx)

	rows, err := tx.Query(ctx, `
		UPDATE mkt_listings
		SET status = 'expired', updated_at = now()
		WHERE status = 'active' AND expires_at < now()
		RETURNING id, market_id`)
	if err != nil {
		log.Printf("marketplace-cron: expire-listings: update: %v", err)
		return
	}

	type expired struct{ id, market string }
	var out []expired
	for rows.Next() {
		var e expired
		if err := rows.Scan(&e.id, &e.market); err != nil {
			rows.Close()
			log.Printf("marketplace-cron: expire-listings: scan: %v", err)
			return
		}
		out = append(out, e)
	}
	if err := rows.Err(); err != nil {
		log.Printf("marketplace-cron: expire-listings: rows: %v", err)
		return
	}
	rows.Close()

	// Outbox delete per expired listing (§2.1 side effect: "insert outbox
	// delete"), same transaction as the status flip so a crash can't strand a
	// listing that's `expired` in Postgres but still `active` in the ES index.
	for _, e := range out {
		payload := fmt.Sprintf(`{"listing_id":%q,"market_id":%q}`, e.id, e.market)
		if _, err := tx.Exec(ctx, `
			INSERT INTO mkt_listings_outbox (listing_id, op, payload) VALUES ($1, 'delete', $2::jsonb)`,
			e.id, payload); err != nil {
			log.Printf("marketplace-cron: expire-listings: outbox insert for %s: %v", e.id, err)
			return
		}
	}

	if err := tx.Commit(ctx); err != nil {
		log.Printf("marketplace-cron: expire-listings: commit: %v", err)
		return
	}
	if len(out) > 0 {
		log.Printf("marketplace-cron: expire-listings: expired %d listing(s)", len(out))
	}
}
