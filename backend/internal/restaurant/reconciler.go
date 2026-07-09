package restaurant

import (
	"context"
	"log"
	"strconv"
	"time"
)

// stuckSettlementSelect is the authoritative crash-recovery predicate for food
// delivery. UpdateStatus(delivered) flips orders.status='delivered' FIRST and
// only THEN calls settlement.Settle — so a crash (or Settle error) between the
// two leaves an order that is delivered while its escrow is still 'escrowed'.
// That pair — a terminal (delivered) order whose linked settlement row is still
// escrowed — is the stranded-escrow signature, and the settlements table is the
// money source of truth (not any mirrored order flag).
//
// The grace window keeps the sweep from racing an in-flight UpdateStatus that is
// mid-Settle: a normal delivery settles within milliseconds. We gate on the
// settlement's escrowed_at (order-placement time, which is reliably set) rather
// than orders.updated_at, because UpdateStatus does not bump updated_at on the
// delivery flip — so escrowed_at is the trustworthy "how long has this money sat
// held" clock. Any delivered order still escrowed longer than the grace window has
// genuinely stalled. $1 is the grace interval as a Postgres interval literal.
const stuckSettlementSelect = `
	SELECT o.id, o.restaurant_id, o.settlement_id
	FROM orders o
	JOIN settlements s ON s.id = o.settlement_id
	WHERE o.status = 'delivered'
	  AND s.status = 'escrowed'
	  AND s.module_type = 'food_delivery'
	  AND s.escrowed_at < NOW() - $1::interval
	ORDER BY s.escrowed_at ASC
	LIMIT 200`

// ReconcileStuckSettlements re-drives Settle for orders that were marked delivered
// but whose escrow never released (process crashed or Settle errored after the
// status flip). It reuses the SAME settleOrder path as the live delivery flow, so
// it is idempotent: settlement.Settle no-ops once the row is 'settled' and every
// ledger leg is ON CONFLICT DO NOTHING. Returns the count actually reconciled to
// 'settled'. Safe to run concurrently with the live path and across instances —
// the FOR UPDATE row lock inside Settle serialises competing attempts.
func (s *Service) ReconcileStuckSettlements(ctx context.Context, graceInterval time.Duration) (int, error) {
	// Render the grace window as a Postgres interval literal (seconds).
	grace := formatInterval(graceInterval)
	rows, err := s.db.Query(ctx, stuckSettlementSelect, grace)
	if err != nil {
		return 0, err
	}
	type stuck struct{ orderID, restaurantID, settlementID string }
	var pending []stuck
	for rows.Next() {
		var st stuck
		if err := rows.Scan(&st.orderID, &st.restaurantID, &st.settlementID); err != nil {
			rows.Close()
			return 0, err
		}
		pending = append(pending, st)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}

	reconciled := 0
	for _, st := range pending {
		if err := s.settleOrder(ctx, st.orderID, st.restaurantID, st.settlementID); err != nil {
			// Do not abort the sweep on one stuck order — log and continue so a
			// single poison order cannot block the rest.
			log.Printf("[restaurant] reconcile settle order=%s settlement=%s failed: %v", st.orderID, st.settlementID, err)
			continue
		}
		reconciled++
		log.Printf("[restaurant] reconcile settled stranded escrow order=%s settlement=%s", st.orderID, st.settlementID)
	}
	return reconciled, nil
}

// formatInterval renders a duration as a whole-second Postgres interval literal
// (e.g. "300 seconds"). Extracted as a pure function so the grace-window
// predicate can be unit-tested without a database. A non-positive duration
// clamps to 0 seconds (every delivered-but-escrowed order is eligible).
func formatInterval(d time.Duration) string {
	secs := int64(d / time.Second)
	if secs < 0 {
		secs = 0
	}
	return strconv.FormatInt(secs, 10) + " seconds"
}

// StartStuckSettlementReconciler runs ReconcileStuckSettlements on a ticker until
// ctx is cancelled. Mirrors top5events.StartPendingOrderReconciler. interval is
// the tick cadence; grace is how long an order may sit delivered-but-escrowed
// before it is swept (kept longer than a live Settle takes so the sweep never
// races an in-flight delivery). Wired from RegisterFinance under the food flag.
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
			log.Printf("[restaurant] stuck-settlement sweep error: %v", err)
			return
		}
		if n > 0 {
			log.Printf("[restaurant] stuck-settlement sweep: reconciled=%d", n)
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
	log.Printf("[restaurant] stuck-settlement reconciler started (interval %s, grace %s)", interval, grace)
}
