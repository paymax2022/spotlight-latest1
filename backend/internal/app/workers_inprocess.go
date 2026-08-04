package app

import (
	"context"
	"log"
	"os"

	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/config"
	"spotlight/backend/internal/marketplace/search"
)

// startInProcessWorkers launches background worker loops INSIDE the API process when
// RUN_WORKERS_INPROCESS is on. This lets a single-instance / free-tier deploy (e.g.
// Render free, which has no always-on worker dynos — see ADR-026) run the marketplace
// search indexer without a separate `cmd/marketplace-indexer` process.
//
// It is NOT a substitute for dedicated worker processes at scale: a second API replica
// would run a second indexer. That is safe for the outbox drain (idempotent) but
// wasteful, so this stays OFF by default — promote to real worker processes off free
// tier. The goroutine lives for the process lifetime and stops when the process exits
// (SIGTERM); the outbox drain is idempotent, so an abrupt stop re-processes on restart.
func startInProcessWorkers(cfg config.Config, pool *pgxpool.Pool) {
	if !cfg.RunWorkersInProcess {
		return
	}
	if pool == nil {
		log.Println("[workers] RUN_WORKERS_INPROCESS set but no DB pool — in-process workers disabled")
		return
	}

	// Marketplace search indexer — only useful when a search cluster is configured.
	// With Elasticsearch disabled (the free-tier default) there is nowhere to index,
	// so skip cleanly rather than spin a loop that logs ES errors every tick.
	if cfg.ElasticsearchURL == "" {
		log.Println("[workers] RUN_WORKERS_INPROCESS on, but ELASTICSEARCH_URL is empty — marketplace indexer skipped (search disabled)")
		return
	}

	interval := search.ResolveInterval(os.Getenv("MARKETPLACE_INDEXER_INTERVAL_MS"), search.DefaultIndexerInterval)
	log.Printf("[workers] starting in-process marketplace indexer (interval=%s, es=%s)", interval, cfg.ElasticsearchURL)
	go search.RunIndexerLoop(context.Background(), pool, cfg.ElasticsearchURL, interval)
}
