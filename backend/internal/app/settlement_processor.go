package app

import (
	"context"
	"log"
	"time"

	"github.com/hibiken/asynq"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/config"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/settlement"
	"spotlight/backend/internal/platform/queue"
	platformRedis "spotlight/backend/internal/platform/redis"
)

// startRecurringSettlementProcessor wires the Task 5.2 recurring settlement
// processor: an asynq server consuming settlement:recurring:{sweep,run} plus a
// sweep-enqueue loop. Gated by FEATURE_RECURRING_SETTLEMENT_ENABLED (default
// off) and requires Redis (queue + Redlock) and the money-path pool; without
// either it stays off rather than running unlocked.
func startRecurringSettlementProcessor(ctx context.Context, cfg config.Config, pool *pgxpool.Pool,
	redisClient *platformRedis.Client, ledgerSvc *ledger.Service, auditor settlement.RecurringAuditor) {
	if !cfg.FeatureRecurringSettlementEnabled {
		return
	}
	if pool == nil || redisClient == nil || cfg.RedisURL == "" {
		log.Println("[settlement] recurring processor requires DB pool and Redis — disabled")
		return
	}
	client, err := queue.NewClient(cfg.RedisURL)
	if err != nil {
		log.Printf("[settlement] recurring processor: queue client: %v — disabled", err)
		return
	}
	srv, err := queue.NewServer(cfg.RedisURL, 4)
	if err != nil {
		log.Printf("[settlement] recurring processor: queue server: %v — disabled", err)
		return
	}

	store := settlement.PGRecurringStore{DB: pool}
	proc := settlement.NewProcessor(store, ledgerSvc, settlement.RedisLocker{Client: redisClient},
		settlement.WithAuditor(auditor))
	h := &settlement.TaskHandlers{Processor: proc, Store: store, Enqueuer: client}

	mux := asynq.NewServeMux()
	h.Register(mux)
	if err := srv.Start(mux); err != nil {
		log.Printf("[settlement] recurring processor: start server: %v", err)
		return
	}
	go func() {
		<-ctx.Done()
		srv.Shutdown()
		_ = client.Close()
	}()
	go settlement.RunSweepLoop(ctx, client, time.Minute)
	log.Println("[settlement] recurring settlement processor started (sweep every 1m)")
}
