// Command marketplace-indexer drains mkt_listings_outbox (written by package
// marketplace on every listing state change that affects search — see §2.1 of
// Paymax_Marketplace_CLAUDE_BUILD_CONTRACT.md) and applies the corresponding
// upsert/delete to Elasticsearch, via search.Indexer.RunOnce.
//
// House pattern: a plain ticker-goroutine-style loop (this repo has no
// pg_cron and no asynq periodic scheduler — see
// internal/fractionalre/autoinvest_runner.go for the established convention),
// run here as its own process rather than a goroutine so it can be deployed,
// scaled, and restarted independently of the API server.
//
// Run with: `go run ./cmd/marketplace-indexer` (sources DATABASE_URL, ES_URL
// from env). Exits non-zero only on unrecoverable startup failure (bad
// DATABASE_URL); a down Elasticsearch is logged per-tick and retried, never
// fatal.
package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	"spotlight/backend/internal/marketplace/search"
	platformDB "spotlight/backend/internal/platform/db"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		log.Fatal("marketplace-indexer: DATABASE_URL is required")
	}
	esURL := os.Getenv("ES_URL")
	if esURL == "" {
		esURL = "http://localhost:9200"
		log.Printf("marketplace-indexer: ES_URL not set, defaulting to %s", esURL)
	}

	pool, err := platformDB.New(ctx, dsn)
	if err != nil {
		log.Fatalf("marketplace-indexer: connect to database: %v", err)
	}
	defer pool.Close()

	// The loop body is shared with the in-process worker path (RUN_WORKERS_INPROCESS)
	// so behaviour is identical whether run here as its own process or inside the API.
	interval := search.ResolveInterval(os.Getenv("MARKETPLACE_INDEXER_INTERVAL_MS"), search.DefaultIndexerInterval)
	search.RunIndexerLoop(ctx, pool, esURL, interval)
}
