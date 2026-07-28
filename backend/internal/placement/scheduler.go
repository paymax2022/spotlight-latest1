package placement

import (
	"context"
	"log"
	"time"
)

// Scheduler jobs are idempotent sweeps over the campaign table. They are safe to run
// repeatedly (every transition is guarded + optimistic-locked, every money leg is
// ledger-idempotent). There is no in-repo cron framework wired here; the orchestrator
// should schedule these on a ticker. See RegisterPlacement / placement_routes.go for
// the suggested wiring point.
//
// TODO(scheduler): wire RunActivations + RunExpirations on a ~1-minute ticker and
// RunReminders / RunReconciliation on a slower cadence (e.g. hourly) from the app
// bootstrap, alongside the other StartXxxMonitor calls in finance_routes.go.

// RunActivations flips SCHEDULED campaigns whose window_start has arrived to ACTIVE.
// For POOLED zones it re-checks capacity (oversubscription is allowed per v1 spec, so
// over-capacity activations are permitted and rotation is handled by the resolver).
// Eligibility is re-checked at activation; a now-ineligible campaign is skipped (left
// SCHEDULED for the next sweep / manual review).
func (s *Service) RunActivations(ctx context.Context) (int, error) {
	now := time.Now().UTC()
	due, err := s.repo.DueForActivation(ctx, now, 0)
	if err != nil {
		return 0, err
	}
	n := 0
	for i := range due {
		c := due[i]
		// Re-check eligibility at activation (fail-soft: skip, don't error the sweep).
		if err := s.checkEligibility(ctx, &c); err != nil {
			log.Printf("[placement] activation skipped (ineligible) campaign=%s: %v", c.ID, err)
			continue
		}
		if err := s.repo.SetActivated(ctx, c.ID, c.Version); err != nil {
			log.Printf("[placement] activation conflict campaign=%s: %v", c.ID, err)
			continue
		}
		_ = s.repo.SetReservationState(ctx, c.ID, StateActive)
		s.writeAudit(ctx, c.ID, "", "placement.scheduler.activate", map[string]any{"state": string(StateScheduled)}, map[string]any{"state": string(StateActive)})
		s.notifySafe(ctx, c.MerchantID, "placement.active", "Your placement is now live.")
		n++
	}
	return n, nil
}

// RunExpirations completes ACTIVE/PAUSED campaigns whose window_end has passed:
// recognize the full held escrow into revenue, then COMPLETED.
func (s *Service) RunExpirations(ctx context.Context) (int, error) {
	now := time.Now().UTC()
	due, err := s.repo.DueForExpiration(ctx, now, 0)
	if err != nil {
		return 0, err
	}
	n := 0
	for i := range due {
		c := due[i]
		if err := s.recognizeFull(ctx, &c); err != nil {
			log.Printf("[placement] expiration recognize failed campaign=%s: %v", c.ID, err)
			continue
		}
		if err := s.repo.SetCompleted(ctx, c.ID, c.Version); err != nil {
			log.Printf("[placement] expiration conflict campaign=%s: %v", c.ID, err)
			continue
		}
		_ = s.repo.SetReservationState(ctx, c.ID, StateCompleted)
		s.writeAudit(ctx, c.ID, "", "placement.scheduler.complete", map[string]any{"state": string(c.State)}, map[string]any{
			"state": string(StateCompleted), "revenue_kobo": c.QuotedPriceKobo,
		})
		s.notifySafe(ctx, c.MerchantID, "placement.completed", "Your placement run has completed.")
		n++
	}
	return n, nil
}

// RunReminders notifies merchants of SCHEDULED campaigns starting within the next 24h.
// Pure side-effect (notifications); no state/money change.
func (s *Service) RunReminders(ctx context.Context) (int, error) {
	now := time.Now().UTC()
	soon, err := s.repo.StartingSoon(ctx, now, now.Add(24*time.Hour), 0)
	if err != nil {
		return 0, err
	}
	for i := range soon {
		s.notifySafe(ctx, soon[i].MerchantID, "placement.starting_soon", "Your placement goes live within 24 hours.")
	}
	return len(soon), nil
}

// RunPauseAccounting is a no-op accounting hook for PAUSE: pausing moves NO money (the
// window_end is extended on resume instead). It exists for symmetry with the other
// sweeps and to host any future paused-interval reconciliation. Currently it only
// audits long-paused campaigns for ops visibility (none today).
func (s *Service) RunPauseAccounting(ctx context.Context) (int, error) {
	// No money accrues or releases while paused; window extension happens on resume.
	return 0, nil
}

// RunReconciliation sweeps orphaned escrow holds: SCHEDULED campaigns whose window_end
// has already passed but never activated (e.g. activation kept failing). It refunds the
// full hold and CANCELs the campaign so no escrow is left stranded.
func (s *Service) RunReconciliation(ctx context.Context) (int, error) {
	now := time.Now().UTC()
	orphans, err := s.repo.OrphanedHolds(ctx, now, 0)
	if err != nil {
		return 0, err
	}
	n := 0
	for i := range orphans {
		c := orphans[i]
		if err := s.refundFull(ctx, &c); err != nil {
			log.Printf("[placement] reconcile refund failed campaign=%s: %v", c.ID, err)
			continue
		}
		_ = s.repo.SetReservationState(ctx, c.ID, StateCancelled)
		if err := s.repo.SetState(ctx, c.ID, StateCancelled, c.Version); err != nil {
			log.Printf("[placement] reconcile cancel conflict campaign=%s: %v", c.ID, err)
			continue
		}
		s.writeAudit(ctx, c.ID, "", "placement.scheduler.reconcile", map[string]any{"state": string(StateScheduled)}, map[string]any{
			"state": string(StateCancelled), "refunded_kobo": c.QuotedPriceKobo, "reason": "orphaned_hold",
		})
		n++
	}
	return n, nil
}
