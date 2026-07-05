package maps

import (
	"context"
	"log"
	"time"

	"spotlight/backend/internal/scheduler"
)

// contribution_scheduler.go — wires the moderated OSM upload pipeline onto the
// shared recurring-job scheduler (backend/internal/scheduler).
//
// The handler simply drains the approved queue via OSMPipeline.RunBatch. It is
// safe to run repeatedly: RunBatch is rate-limited, small-batch, idempotent
// per-candidate (approved→uploaded only flips approved rows), and with the default
// NoopOSMUploader it stages rather than uploads. Actual job creation/registration
// is performed at integration time (see ScheduleContributionBatch).

// OSMContributionBatchJobType is the scheduler handler key for the OSM upload batch.
const OSMContributionBatchJobType = "maps.osm_contribution_batch"

// defaultContributionBatchInterval is how often the batch runs by default (15 min).
const defaultContributionBatchInterval int64 = 15 * 60

// RegisterContributionJob binds the OSM batch handler to the scheduler. Call once at
// wiring time. Nil-safe: a nil scheduler or pipeline is a no-op.
func RegisterContributionJob(sched *scheduler.Service, p *OSMPipeline) {
	if sched == nil || p == nil {
		return
	}
	sched.RegisterJobType(OSMContributionBatchJobType, func(jc scheduler.HandlerCtx) error {
		n, err := p.RunBatch(jc.Context())
		if err != nil {
			return err
		}
		if n > 0 {
			log.Printf("[maps] OSM contribution batch uploaded %d candidate(s)", n)
		}
		return nil
	})
}

// ScheduleContributionBatch creates the durable recurring job that drives the OSM
// upload batch. Provide a system/service owner user id (the scheduler requires a
// non-empty owner). Optional intervalSecs<=0 falls back to the 15-minute default.
// This is the integration-phase helper; RegisterContributionJob must have been
// called so a handler exists for the job type.
func ScheduleContributionBatch(ctx context.Context, sched *scheduler.Service, ownerUserID string, intervalSecs int64) (*scheduler.Job, error) {
	if intervalSecs <= 0 {
		intervalSecs = defaultContributionBatchInterval
	}
	return sched.Schedule(ctx, scheduler.Job{
		JobType:      OSMContributionBatchJobType,
		OwnerUserID:  ownerUserID,
		EntityRef:    "osm_contribution_pipeline",
		IntervalSecs: intervalSecs,
		NextRunAt:    time.Now().Add(time.Duration(intervalSecs) * time.Second),
		Status:       scheduler.JobActive,
		// No MaxRuns: this is a perpetual recurring drain of the approved queue.
	})
}
