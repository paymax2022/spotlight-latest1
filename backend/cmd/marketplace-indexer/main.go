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
	"time"

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

	interval := 2 * time.Second
	if v := os.Getenv("MARKETPLACE_INDEXER_INTERVAL_MS"); v != "" {
		if ms, err := time.ParseDuration(v + "ms"); err == nil && ms > 0 {
			interval = ms
		}
	}

	indexer := search.NewIndexer(pool, esURL)

	// Best-effort template bootstrap. Never fatal — a fresh/empty ES cluster
	// without the mapping template still accepts default-dynamic-mapped
	// documents; a missing es-mapping.json (Agent C not landed yet) or an
	// unreachable ES is logged and the loop proceeds regardless.
	client := search.NewClient(esURL)
	if err := client.EnsureTemplate(ctx); err != nil {
		log.Printf("marketplace-indexer: EnsureTemplate: %v (continuing — will retry has no effect until next deploy)", err)
	}

	log.Printf("marketplace-indexer: starting, interval=%s es=%s", interval, esURL)

	runOnce := func() {
		tctx, cancel := context.WithTimeout(ctx, 30*time.Second)
		defer cancel()
		n, err := indexer.RunOnce(tctx)
		if err != nil {
			log.Printf("marketplace-indexer: RunOnce error: %v", err)
			return
		}
		if n > 0 {
			log.Printf("marketplace-indexer: processed %d outbox row(s)", n)
		}
	}

	runOnce()
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			log.Println("marketplace-indexer: shutting down")
			return
		case <-ticker.C:
			runOnce()
		}
	}
}
