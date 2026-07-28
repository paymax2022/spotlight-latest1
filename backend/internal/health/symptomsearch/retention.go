package symptomsearch

// NDPR retention loop (PRD §5.4): symptom queries are sensitive health data
// and retention-limited. The purge itself is the SECURITY DEFINER SQL function
// public.pharmacy_symptom_events_purge(retention_days) (migration
// 20260830000000_pharmacy_symptom_hardening.sql, service_role-executable
// only); this loop merely invokes it on a schedule.
//
// Scheduling decision: the repo has NO pg_cron (no cron.schedule anywhere in
// supabase/migrations) and NO asynq periodic scheduler (asynq is used for
// enqueue/serve only) — the house pattern for periodic work is a background
// ticker goroutine (orchestration.StartTreasuryMonitor /
// StartReconScheduler). This mirrors that pattern. Linked rows are never
// orphaned: pharmacy_orders.search_event_id and
// pharmacy_review_cases.search_event_id are ON DELETE SET NULL.

import (
	"context"
	"log"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// DefaultSearchEventRetentionDays is the NDPR retention default for
// symptom_search_events (override via SYMPTOM_EVENTS_RETENTION_DAYS).
const DefaultSearchEventRetentionDays = 180

// StartRetentionPurge runs pharmacy_symptom_events_purge once at startup and
// then every `every` (default 24h) until ctx is cancelled. Multi-instance
// safe: the DELETE is idempotent, so concurrent runs are merely redundant.
func StartRetentionPurge(ctx context.Context, db *pgxpool.Pool, retentionDays int, every time.Duration) {
	if db == nil {
		return
	}
	if retentionDays <= 0 {
		retentionDays = DefaultSearchEventRetentionDays
	}
	if every <= 0 {
		every = 24 * time.Hour
	}
	run := func() {
		cctx, cancel := context.WithTimeout(ctx, time.Minute)
		defer cancel()
		var deleted int
		if err := db.QueryRow(cctx, `SELECT public.pharmacy_symptom_events_purge($1)`, retentionDays).Scan(&deleted); err != nil {
			log.Printf("[health.pharmacy.symptom] retention purge failed: %v", err)
			return
		}
		if deleted > 0 {
			log.Printf("[health.pharmacy.symptom] retention purge: %d symptom_search_events older than %dd removed (NDPR)", deleted, retentionDays)
		}
	}
	go func() {
		run()
		t := time.NewTicker(every)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				run()
			}
		}
	}()
}
