// Command marketplace-cron runs the periodic (non-request-driven) jobs the
// marketplace escrow/listing state machines depend on:
//
//   - listing auto_expire            (§2.1: active -> expired when expires_at < now())
//   - order auto_release             (§2.2: inspection_window -> released when
//                                      inspection_deadline < now() AND no open dispute)
//   - hourly escrow reconciliation   (§2.2 invariant: SUM(escrow ledger balance)
//                                      == SUM(orders in any open-escrow status))
//
// House pattern: ticker-goroutine-style loop per job, mirroring
// internal/fractionalre/autoinvest_runner.go (StartAutoInvestRunner) — this
// repo has no pg_cron and no asynq periodic scheduler.
//
// Money-path note: this binary NEVER posts ledger entries itself. Per
// SWARM_INTEGRATION_CONTRACT.md, package marketplace (Agent A) owns every
// ledger-touching transition; auto_release must go through
// marketplace.Service.AutoReleaseDue so the exact same guarded, idempotent,
// ledger-posting code path used by the API's cron caller is reused here. If
// that symbol is not yet available at build time (Agent A still in
// progress), this file is written so the dependency is explicit and isolated
// to auto-release; the listing auto-expire and reconciliation-check jobs are
// read/write-but-ledger-free raw SQL and do not require package marketplace.
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
	goredis "github.com/redis/go-redis/v9"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/marketplace"
	platformDB "spotlight/backend/internal/platform/db"
	platformRedis "spotlight/backend/internal/platform/redis"
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

	// Build the marketplace Service so auto-release goes through the single
	// guarded, idempotent, ledger-posting code path (Service.AutoReleaseDue) —
	// the same one the confirm-delivery endpoint uses. Redis is optional (the
	// service falls back to the DB-unique idempotency backstop when nil), so a
	// missing REDIS_URL degrades gracefully rather than disabling releases.
	var rdb *goredis.Client
	if url := os.Getenv("REDIS_URL"); url != "" {
		if rc, err := platformRedis.New(url); err != nil {
			log.Printf("marketplace-cron: REDIS_URL set but connect failed (%v) — proceeding with DB-unique idempotency backstop", err)
		} else {
			rdb = rc
		}
	}
	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), rdb)
	svc := marketplace.NewService(pool, ledgerSvc, rdb)

	log.Println("marketplace-cron: starting (listing auto-expire every 5m, order auto-release every 1m, escrow reconciliation every 1h)")

	var wg sync.WaitGroup
	wg.Add(3)
	go runLoop(ctx, &wg, "listing-auto-expire", 5*time.Minute, func(c context.Context) {
		expireListings(c, pool)
	})
	go runLoop(ctx, &wg, "order-auto-release", 1*time.Minute, func(c context.Context) {
		autoReleaseOrders(c, pool, svc)
	})
	go runLoop(ctx, &wg, "escrow-reconciliation", time.Hour, func(c context.Context) {
		reconcileEscrow(c, pool)
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

// autoReleaseOrders implements §2.2's `inspection_window` -> `auto_release` ->
// `released` transition.
//
// PREFERRED PATH: call marketplace.Service.AutoReleaseDue(ctx), which is the
// single source of truth for the guarded, idempotent, ledger-posting
// transition (escrow sub-account -> seller wallet, minus platform fee) that
// the manual `confirm-delivery` endpoint also uses. That call is intentionally
// NOT wired directly in this file: package marketplace is owned by Agent A
// and importing it here would make this binary's compilation depend on
// Agent A's package landing first. Wire it by adding, once marketplace.Service
// is available:
//
//	import "spotlight/backend/internal/marketplace"
//	svc := marketplace.NewService(pool, ledgerSvc, rdb)
//	n, err := svc.AutoReleaseDue(ctx)
//
// FALLBACK PATH (used here so this binary builds and ships independently of
// Agent A's timeline): a read-only detector that finds orders past their
// inspection deadline and logs them for the ledger-owning service to act on.
// It deliberately does NOT flip order status or move money — doing so here
// would duplicate/bypass the guarded FSM and ledger posting that
// marketplace.Service.AutoReleaseDue is responsible for (violates the "every
// terminal state MUST correspond to exactly one balanced ledger posting"
// invariant in §2.2 if two code paths could both attempt the release).
func autoReleaseOrders(ctx context.Context, pool *pgxpool.Pool, svc *marketplace.Service) {
	// Single source of truth: AutoReleaseDue selects every order past its
	// inspection_deadline with no open dispute and performs the guarded,
	// idempotent release (escrow sub-account -> seller wallet minus platform
	// fee, ledger_release_ref stored, status -> released, placeholder review
	// inserted) per §2.2. It is safe to run every minute because each order's
	// release is guarded on status='inspection_window' and posts exactly one
	// balanced ledger entry.
	n, err := svc.AutoReleaseDue(ctx)
	if err != nil {
		log.Printf("marketplace-cron: auto-release: %v", err)
		return
	}
	if n > 0 {
		log.Printf("marketplace-cron: auto-release: released %d order(s) past inspection_deadline", n)
	}
}

// reconcileEscrow implements the §2.2 non-negotiable invariant check:
//
//	SUM(escrow_sub_account_balance) == SUM(orders WHERE status IN
//	  ('funded','seller_accepted','in_delivery','delivered','inspection_window','disputed'))
//
// Escrow balance is derived from the ledger (never a stored column — house
// doctrine, CLAUDE.md "Wallet balances are projections of the ledger"), so we
// read the AccountEscrow standing-account balance via the same
// ledger_entries/ledger_accounts tables and the identical CREDIT/DEBIT +
// REVERSAL_* projection formula as
// internal/finance/ledger/repository.go:balanceProjectionSQL, without
// depending on package marketplace or exporting any ledger internals. Any
// drift is logged loudly for on-call/alerting — this job never attempts to
// "fix" drift automatically (a reconciliation mismatch is a signal for human
// investigation, not a self-healing bug).
func reconcileEscrow(ctx context.Context, pool *pgxpool.Pool) {
	var escrowBalanceKobo int64
	err := pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(
			CASE WHEN e.type IN ('CREDIT','REVERSAL_DEBIT') THEN e.amount_kobo ELSE -e.amount_kobo END
		), 0)
		FROM ledger_entries e
		JOIN ledger_accounts a ON a.id = e.account_id
		WHERE a.type = 'escrow'`).Scan(&escrowBalanceKobo)
	if err != nil {
		log.Printf("marketplace-cron: reconcile-escrow: sum ledger escrow balance: %v (schema may differ — verify ledger_entries/ledger_accounts column names against internal/finance/ledger)", err)
		return
	}

	var openOrdersKobo int64
	err = pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_kobo), 0)
		FROM mkt_orders
		WHERE status IN ('funded','seller_accepted','in_delivery','delivered','inspection_window','disputed')`).
		Scan(&openOrdersKobo)
	if err != nil {
		log.Printf("marketplace-cron: reconcile-escrow: sum open orders: %v", err)
		return
	}

	drift := escrowBalanceKobo - openOrdersKobo
	if drift != 0 {
		log.Printf("marketplace-cron: ESCROW RECONCILIATION DRIFT detected: escrow_ledger_balance_kobo=%d open_orders_kobo=%d drift_kobo=%d — invariant violated, needs investigation",
			escrowBalanceKobo, openOrdersKobo, drift)
		return
	}
	log.Printf("marketplace-cron: escrow reconciliation OK: escrow_ledger_balance_kobo=%d open_orders_kobo=%d", escrowBalanceKobo, openOrdersKobo)
}
