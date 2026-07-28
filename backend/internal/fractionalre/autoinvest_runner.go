package fractionalre

import (
	"context"
	"fmt"
	"log"
	"time"
)

// Auto-invest execution (work order 4). Plans were previously created but never
// run. The house pattern for periodic work is a background ticker goroutine
// (orchestration.StartTreasuryMonitor / symptomsearch.StartRetentionPurge — the
// repo has no pg_cron and no asynq periodic scheduler); this mirrors it.
//
// Every execution goes through the EXISTING Subscribe money path, so every iron
// rule (KYC, risk-ack, 10% cap, tier limit, escrow ledger, audit) applies
// unchanged. The idempotency key is DETERMINISTIC —
// autoinvest:{plan_id}:{scheduled_run_iso} — so a crash between "subscribed"
// and "advanced next_run_at" makes the re-run a replay of the same
// subscription, never a double-invest.
//
// Failures (limit exceeded, KYC, insufficient funds, no open offering, missing
// risk-ack) are FAIL-CLOSED: the plan is marked status='failed' with
// last_error and skipped — never retried in a loop. Every attempt is audited.

// autoInvestStore is the narrow persistence surface the runner needs
// (satisfied by *Repository; faked in tests — no DB).
type autoInvestStore interface {
	ListDueAutoInvest(ctx context.Context, now time.Time, limit int) ([]AutoInvest, error)
	CompleteAutoInvestRun(ctx context.Context, id string, ranAt, nextRun time.Time) error
	FailAutoInvest(ctx context.Context, id, reason string) error
}

// autoInvestRunnerDeps injects the runner's collaborators so the core loop is
// unit-testable with fakes (no DB, no ledger).
type autoInvestRunnerDeps struct {
	store        autoInvestStore
	pickOffering func(ctx context.Context, assetType *string) (*Offering, error)
	subscribe    func(ctx context.Context, userID, idemKey, offeringID string, req SubscribeRequest) (*Subscription, error)
	audit        func(ctx context.Context, actorID, action, entityID, reason string, detail map[string]any)
	now          func() time.Time
}

// autoInvestIdemKey builds the deterministic per-scheduled-run idempotency key.
// scheduledRun is the plan's stored next_run_at (stable until advanced), so
// re-runs after a crash reuse the exact same key.
func autoInvestIdemKey(planID string, scheduledRun time.Time) string {
	return fmt.Sprintf("autoinvest:%s:%s", planID, scheduledRun.UTC().Format(time.RFC3339))
}

// nextAutoInvestRun advances a schedule by one cadence period (pure).
func nextAutoInvestRun(after time.Time, cadence string) time.Time {
	if cadence == "weekly" {
		return after.Add(7 * 24 * time.Hour)
	}
	return after.AddDate(0, 1, 0) // monthly (default)
}

// runAutoInvestOnce executes every due plan exactly once. Returns counts for
// observability. Per-plan failures never abort the sweep.
func runAutoInvestOnce(ctx context.Context, d autoInvestRunnerDeps) (executed, failed int) {
	now := d.now()
	plans, err := d.store.ListDueAutoInvest(ctx, now, 100)
	if err != nil {
		log.Printf("[fractionalre] auto-invest: list due plans: %v", err)
		return 0, 0
	}
	for _, plan := range plans {
		if plan.NextRunAt == nil {
			continue // never scheduled — not due by definition
		}
		scheduled := *plan.NextRunAt

		fail := func(reason string) {
			failed++
			if err := d.store.FailAutoInvest(ctx, plan.ID, reason); err != nil {
				log.Printf("[fractionalre] auto-invest: record failure for plan %s: %v", plan.ID, err)
			}
			d.audit(ctx, plan.UserID, "auto_invest.run.failed", plan.ID, reason,
				map[string]any{"scheduled_run": scheduled.UTC().Format(time.RFC3339)})
		}

		offering, err := d.pickOffering(ctx, plan.AssetType)
		if err != nil {
			fail("no open offering matches the plan preferences")
			continue
		}
		units := plan.AmountKobo / offering.UnitPriceKobo
		if units <= 0 {
			fail(fmt.Sprintf("plan amount %d kobo is below the unit price %d kobo", plan.AmountKobo, offering.UnitPriceKobo))
			continue
		}

		key := autoInvestIdemKey(plan.ID, scheduled)
		sub, err := d.subscribe(ctx, plan.UserID, key, offering.ID, SubscribeRequest{Units: units})
		if err != nil {
			// Fail-closed: KYC / risk-ack / cap / tier / funds — record and skip.
			fail(err.Error())
			continue
		}

		nextRun := nextAutoInvestRun(scheduled, plan.Cadence)
		if !nextRun.After(now) {
			// Catch up a long-overdue plan without a burst of immediate re-runs.
			nextRun = nextAutoInvestRun(now, plan.Cadence)
		}
		if err := d.store.CompleteAutoInvestRun(ctx, plan.ID, now, nextRun); err != nil {
			// The subscription is safe (deterministic key → replay); the schedule
			// advance will be retried on the next tick.
			log.Printf("[fractionalre] auto-invest: advance plan %s: %v", plan.ID, err)
		}
		executed++
		d.audit(ctx, plan.UserID, "auto_invest.run.executed", plan.ID, "",
			map[string]any{
				"subscription_id": sub.ID, "offering_id": offering.ID, "units": units,
				"amount_kobo": sub.AmountKobo, "idempotency_key": key,
				"next_run_at": nextRun.UTC().Format(time.RFC3339),
			})
	}
	return executed, failed
}

// StartAutoInvestRunner starts the background ticker (default interval 1h).
// Wired from route registration behind FEATURE_FRACTIONAL_RE_ENABLED.
// Multi-instance safe: the deterministic idempotency key makes concurrent
// sweeps replay, not duplicate.
func StartAutoInvestRunner(ctx context.Context, svc *Service, interval time.Duration) {
	if svc == nil || svc.repo == nil {
		return
	}
	if interval <= 0 {
		interval = time.Hour
	}
	deps := autoInvestRunnerDeps{
		store:        svc.repo,
		pickOffering: svc.repo.FindOpenOfferingForAutoInvest,
		subscribe:    svc.Subscribe,
		audit: func(ctx context.Context, actorID, action, entityID, reason string, detail map[string]any) {
			_ = svc.audit.log(ctx, actorID, action, "auto_invest", entityID, reason, nil, detail)
		},
		now: svc.now,
	}
	run := func() {
		cctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
		defer cancel()
		if executed, failed := runAutoInvestOnce(cctx, deps); executed > 0 || failed > 0 {
			log.Printf("[fractionalre] auto-invest sweep: executed=%d failed=%d", executed, failed)
		}
	}
	go func() {
		run()
		t := time.NewTicker(interval)
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
	log.Printf("[fractionalre] auto-invest runner started (interval %s)", interval)
}
