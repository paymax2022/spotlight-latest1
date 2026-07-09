package transport

import (
	"context"
	"log"
	"strconv"
	"time"
)

// stuckTripSelect is the authoritative crash-recovery predicate for ride-hailing
// settlement. CompleteTrip commits the trip as phase='completed' FIRST and only
// THEN drives settleTrip (which opens the settlement engine's own tx on a separate
// connection). A crash — or a settleTrip error — between the completion commit and
// the escrow release leaves a completed trip with escrow still held. The
// settlements table is the money source of truth: a completed trip that still has
// ANY linked settlement in status='escrowed' is stranded, regardless of whether
// the best-effort trips.settlement_status mirror was written (that mirror UPDATE is
// intentionally non-fatal). We therefore select on the settlements table directly
// so the sweep is correct even when the flag mirror was skipped.
//
// The grace window ($1, a Postgres interval literal) excludes trips completed too
// recently to have finished settling, so the sweep never races an in-flight
// CompleteTrip that is mid-settle. DISTINCT because settleTrip settles base + delta
// escrows for one trip, which can produce multiple escrowed rows per trip.
const stuckTripSelect = `
	SELECT DISTINCT t.id
	FROM trips t
	JOIN settlements s ON s.reference LIKE 'trip:' || t.id || '%'
	WHERE t.phase = 'completed'
	  AND s.status = 'escrowed'
	  AND s.module_type = 'transport'
	  AND t.updated_at < NOW() - $1::interval
	ORDER BY t.id
	LIMIT 200`

// ReconcileStuckSettlements is the reconciliation worker documented in
// service.go / dispatch.go: it re-drives settleTrip for completed trips whose
// escrow never released after a crash. It reuses the SAME settleTrip path as the
// live CompleteTrip flow, so it is idempotent — settleTrip re-queries only the
// still-'escrowed' rows and calls settlement.Settle, which is guarded WHERE the
// row is 'escrowed' (already-settled rows no-op) and posts every ledger leg with
// ON CONFLICT (idempotency_key) DO NOTHING. Overlapping sweeps (or a sweep racing
// a client retry) converge to exactly one payout via the FOR UPDATE lock inside
// Settle. On success it flips the trips.settlement_status mirror back to 'settled'.
// Returns the count of trips fully reconciled.
func (s *Service) ReconcileStuckSettlements(ctx context.Context, graceInterval time.Duration) (int, error) {
	grace := formatInterval(graceInterval)
	rows, err := s.db.Query(ctx, stuckTripSelect, grace)
	if err != nil {
		return 0, err
	}
	var tripIDs []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return 0, err
		}
		tripIDs = append(tripIDs, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}

	reconciled := 0
	for _, id := range tripIDs {
		var t tripRow
		if err := s.loadTrip(ctx, id, &t); err != nil {
			log.Printf("[transport] reconcile load trip=%s failed: %v", id, err)
			continue
		}
		if err := s.settleTrip(ctx, &t); err != nil {
			// One stuck trip must not abort the whole sweep — log and move on.
			log.Printf("[transport] reconcile settle trip=%s failed: %v", id, err)
			continue
		}
		reconciled++
		// Clear the crash-safety mirror now that escrow is released. Best-effort:
		// the settlements table already reflects the truth. A legal CHECK value.
		s.db.Exec(ctx, `UPDATE trips SET settlement_status='settled', updated_at=NOW() WHERE id=$1`, id)
		log.Printf("[transport] reconcile settled stranded escrow trip=%s", id)
	}
	return reconciled, nil
}

// formatInterval renders a duration as a whole-second Postgres interval literal
// (e.g. "300 seconds"). Extracted as a pure function so the grace-window predicate
// is unit-testable without a database. Non-positive clamps to 0 (all completed
// trips with escrow are eligible).
func formatInterval(d time.Duration) string {
	secs := int64(d / time.Second)
	if secs < 0 {
		secs = 0
	}
	return strconv.FormatInt(secs, 10) + " seconds"
}

// StartStuckSettlementReconciler runs ReconcileStuckSettlements on a ticker until
// ctx is cancelled. Mirrors top5events.StartPendingOrderReconciler /
// restaurant.StartStuckSettlementReconciler. interval is the tick cadence; grace
// is how long a completed trip may hold escrow before it is swept (kept longer
// than a live settleTrip takes so the sweep never races an in-flight completion).
// Wired from RegisterFinance under the transport feature flag.
func StartStuckSettlementReconciler(ctx context.Context, svc *Service, interval, grace time.Duration) {
	if svc == nil || svc.db == nil {
		return
	}
	if interval <= 0 {
		interval = 5 * time.Minute
	}
	if grace <= 0 {
		grace = 10 * time.Minute
	}
	run := func() {
		cctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
		defer cancel()
		n, err := svc.ReconcileStuckSettlements(cctx, grace)
		if err != nil {
			log.Printf("[transport] stuck-settlement sweep error: %v", err)
			return
		}
		if n > 0 {
			log.Printf("[transport] stuck-settlement sweep: reconciled=%d", n)
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
	log.Printf("[transport] stuck-settlement reconciler started (interval %s, grace %s)", interval, grace)
}
