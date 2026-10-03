package app

import (
	"context"
	"log"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/config"
	"spotlight/backend/internal/scheduler"
)

// startSchedulerPoller launches the durable-job poller inside the API process
// (E2E-BE-005). Modules enqueue into scheduler_jobs and register handlers on
// their own scheduler.Service instances (registrations are process-wide — see
// scheduler.processHandlers); this goroutine is the missing drain that calls
// RunDue on a cadence so due jobs actually execute.
//
// Gates: cfg.SchedulerEnabled (SCHEDULER_ENABLED, default ON) and a non-nil
// shared pool. Tick: cfg.SchedulerPollIntervalSeconds
// (SCHEDULER_POLL_INTERVAL_SECONDS, default 5s).
//
// Graceful shutdown rides the caller's ctx (the signal.NotifyContext from
// main): on SIGTERM the loop stops taking ticks and an in-flight RunDue rolls
// its claim transaction back, leaving due jobs for the next boot. Claiming is
// FOR UPDATE SKIP LOCKED and each occurrence is UNIQUE(run_key)-gated, so a
// poller on every replica cannot double-execute.
//
// Deliberately NOT routed through startInProcessWorkers/RUN_WORKERS_INPROCESS:
// that gate is default-off for optional in-process extras (marketplace
// indexer). The scheduler drain is the only executor of already-scheduled
// durable jobs, so it defaults ON and has its own flag.
func startSchedulerPoller(ctx context.Context, cfg config.Config, pool *pgxpool.Pool) {
	if !cfg.SchedulerEnabled {
		log.Println("[scheduler] SCHEDULER_ENABLED=false — durable-job poller disabled; scheduler_jobs will accumulate until a poller runs")
		return
	}
	if pool == nil {
		log.Println("[scheduler] no database pool — durable-job poller disabled")
		return
	}

	svc := scheduler.NewService(pool)
	registerSchedulerStubHandlers(svc)

	interval := time.Duration(cfg.SchedulerPollIntervalSeconds) * time.Second
	log.Printf("[scheduler] durable-job poller started (interval=%s)", interval)
	go svc.Poll(ctx, interval)
}

// schedulerStubJobTypes are job types that producers write but no domain module
// ever registered a handler for. Each gets a stub that logs a loud
// not-implemented warning and returns success — "complete-with-note" — so the
// poller does not churn them as failed runs on every tick. These stubs only
// fill gaps (HasHandler guard): if the owning module later registers a real
// handler it overwrites the stub.
//
// OWNED-BY-HEALTH-TEAM TODOs:
//   - "health.appointment.reminder" (internal/health/scheduling): scheduled 1h
//     before each appointment; should deliver a patient notification (most
//     likely via internal/notifications). No delivery path exists yet.
//   - "health.vet.vaccination.reminder" (internal/health/vet): scheduled 24h
//     before a pet vaccination due date; same — needs a notification handler.
var schedulerStubJobTypes = []string{
	"health.appointment.reminder",
	"health.vet.vaccination.reminder",
}

func registerSchedulerStubHandlers(svc *scheduler.Service) {
	for _, jt := range schedulerStubJobTypes {
		jobType := jt
		if svc.HasHandler(jobType) {
			continue // real handler already registered by the owning module
		}
		svc.RegisterJobType(jobType, func(hctx scheduler.HandlerCtx) error {
			log.Printf("[scheduler] STUB job_type=%s job=%s entity=%s — scheduled occurrence ran with no domain handler (not yet implemented; see schedulerStubJobTypes TODO)", jobType, hctx.Job().ID(), hctx.Job().EntityRef())
			return nil
		})
	}
}
