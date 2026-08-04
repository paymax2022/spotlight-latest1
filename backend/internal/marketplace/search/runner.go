package search

import (
	"context"
	"log"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// DefaultIndexerInterval is the outbox-drain cadence when none is configured.
const DefaultIndexerInterval = 2 * time.Second

// ResolveInterval parses a milliseconds string (e.g. "2000") into a Duration,
// falling back to def for empty / invalid / non-positive input. Pure + testable;
// shared by cmd/marketplace-indexer and the in-process worker path so both honour
// MARKETPLACE_INDEXER_INTERVAL_MS identically.
func ResolveInterval(rawMS string, def time.Duration) time.Duration {
	if rawMS == "" {
		return def
	}
	if ms, err := time.ParseDuration(rawMS + "ms"); err == nil && ms > 0 {
		return ms
	}
	return def
}

// RunIndexerLoop drains mkt_listings_outbox into Elasticsearch on an interval until
// ctx is cancelled. It is the shared body behind BOTH cmd/marketplace-indexer (its
// own process) and the in-process worker path (RUN_WORKERS_INPROCESS) — so a
// single-instance / free-tier deploy can run the search indexer inside the API
// process instead of a separate always-on worker (see ADR-026).
//
// Best-effort + fail-soft: the mapping-template bootstrap and a down/unreachable ES
// are logged and retried per tick, never fatal. The outbox drain is idempotent, so an
// abrupt stop (SIGTERM) is safe — the next start re-processes any unacked rows.
func RunIndexerLoop(ctx context.Context, pool *pgxpool.Pool, esURL string, interval time.Duration) {
	if interval <= 0 {
		interval = DefaultIndexerInterval
	}
	indexer := NewIndexer(pool, esURL)

	// Best-effort template bootstrap. A fresh/empty ES cluster without the mapping
	// template still accepts default-dynamic-mapped documents; a missing template or
	// an unreachable ES is logged and the loop proceeds regardless.
	if err := NewClient(esURL).EnsureTemplate(ctx); err != nil {
		log.Printf("marketplace-indexer: EnsureTemplate: %v (continuing)", err)
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
