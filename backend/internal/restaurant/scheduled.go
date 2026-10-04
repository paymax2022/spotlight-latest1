package restaurant

import (
	"context"
	"fmt"
	"log"
	"time"

	"spotlight/backend/go-common/timeutil"
)

const (
	scheduledMinLead = 15 * time.Minute   // earliest a slot may be (no instant "scheduled")
	scheduledHorizon = 7 * 24 * time.Hour // furthest out a slot may be
)

// validateScheduledFor checks a requested future slot (SG-001/002): it must be at least
// scheduledMinLead ahead, within scheduledHorizon, and — when the restaurant has a weekly
// schedule — fall inside an opening window at the slot time (so a slot that lands while
// the restaurant is closed is rejected up front). Pure (no DB).
func validateScheduledFor(now, slot time.Time, hours []BusinessHour, loc *time.Location) error {
	if !slot.After(now.Add(scheduledMinLead)) {
		return fmt.Errorf("restaurant: a scheduled slot must be at least %v in the future", scheduledMinLead)
	}
	if slot.After(now.Add(scheduledHorizon)) {
		return fmt.Errorf("restaurant: a scheduled slot may be at most %v out", scheduledHorizon)
	}
	if len(hours) > 0 && !isOpenAt(hours, slot, loc) {
		return fmt.Errorf("restaurant: the restaurant is closed at the requested slot")
	}
	return nil
}

// resolveScheduledFor validates a requested future slot for an order and returns the
// value to persist in orders.scheduled_for (nil for a normal, immediate order).
// The slot is checked against the restaurant's WEEKLY HOURS, not against whether it
// happens to be open at this instant — scheduling is most often done outside opening
// hours, which is the whole point of the feature. Whether the restaurant is actually
// open when the slot arrives is decided later by ActivateScheduledOrders, which releases
// the order into the live queue if it is open and auto-cancels + REFUNDS it if it is not
// (SG-002). So a manual "closed" switch cannot silently swallow a scheduled order's
// money; it just ends in a refund at the slot.
func (s *Service) resolveScheduledFor(ctx context.Context, restaurantID string, requested *time.Time, now time.Time) (*time.Time, error) {
	if requested == nil {
		return nil, nil
	}
	hours, err := s.loadBusinessHours(ctx, restaurantID)
	if err != nil {
		return nil, fmt.Errorf("restaurant: load hours for scheduling: %w", err)
	}
	slot := requested.UTC()
	if err := validateScheduledFor(now, slot, hours, lagosTZ); err != nil {
		return nil, err
	}
	return &slot, nil
}

// ActivateScheduledOrders processes scheduled orders whose slot has arrived (a periodic
// ops job). For each pending scheduled order with scheduled_for <= now: if the restaurant
// is open right now, the slot is "released" (scheduled_for cleared → it becomes a normal
// live order in the queue) and the customer + restaurant are reminded (SG-005); if the
// restaurant is closed at the slot (e.g. a last-minute closure), it is auto-cancelled +
// refunded (SG-002). Returns (released, cancelled).
func (s *Service) ActivateScheduledOrders(ctx context.Context, now time.Time) (released, cancelled int, err error) {
	rows, qerr := s.db.Query(ctx,
		`SELECT id, restaurant_id, customer_id FROM orders
		 WHERE status='pending' AND scheduled_for IS NOT NULL AND scheduled_for <= $1`, now)
	if qerr != nil {
		return 0, 0, qerr
	}
	type sched struct{ id, restaurantID, customerID string }
	var due []sched
	for rows.Next() {
		var d sched
		if err := rows.Scan(&d.id, &d.restaurantID, &d.customerID); err != nil {
			rows.Close()
			return 0, 0, err
		}
		due = append(due, d)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, 0, err
	}
	for _, d := range due {
		open, oerr := s.isRestaurantOpenNow(ctx, d.restaurantID, now)
		if oerr != nil {
			continue
		}
		if !open {
			// SG-002: closed at the slot → auto-cancel + refund (owner as system actor).
			var owner string
			_ = s.db.QueryRow(ctx, `SELECT owner_id FROM restaurants WHERE id=$1`, d.restaurantID).Scan(&owner)
			if err := s.refundAndClose(ctx, d.id, owner, OrderCancelled, "scheduled_slot_closed"); err == nil {
				cancelled++
			}
			continue
		}
		// SG-005: release it into the live queue + remind.
		if _, err := s.db.Exec(ctx, `UPDATE orders SET scheduled_for=NULL WHERE id=$1`, d.id); err != nil {
			continue
		}
		s.notify(ctx, Notification{UserID: d.customerID, Event: EventOrderDispatch, Title: "Your scheduled order is starting",
			Body: "Your scheduled order slot has arrived and is being prepared.", Data: map[string]any{"order_id": d.id}})
		released++
	}
	return released, cancelled, nil
}

// StartScheduledOrderSweeper runs ActivateScheduledOrders on a ticker until ctx is
// cancelled. Mirrors StartStuckSettlementReconciler.
// This is NOT optional infrastructure. A scheduled order is escrowed at placement and
// then sits `pending` with scheduled_for set: nothing in the live flow touches it, the
// kitchen never sees it, and the only thing that can either release it into the queue or
// cancel-and-refund it is this sweep. Without a runner the money has no automated path
// out at all — the sole caller of ActivateScheduledOrders was an admin handler that is
// registered on no route. Wired from RegisterFinance alongside the settlement
// reconciler, under the same food flag.
// Idempotent and multi-instance safe: releasing is a single UPDATE guarded on
// scheduled_for IS NOT NULL, and cancelling goes through refundAndClose, whose refund
// is guarded on the settlement status.
func StartScheduledOrderSweeper(ctx context.Context, svc *Service, interval time.Duration) {
	if svc == nil || svc.db == nil {
		return
	}
	if interval <= 0 {
		interval = time.Minute
	}
	run := func() {
		cctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
		defer cancel()
		released, cancelled, err := svc.ActivateScheduledOrders(cctx, time.Now())
		if err != nil {
			log.Printf("[restaurant] scheduled-order sweep error: %v", err)
			return
		}
		if released > 0 || cancelled > 0 {
			log.Printf("[restaurant] scheduled-order sweep: released=%d cancelled+refunded=%d", released, cancelled)
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
	log.Printf("[restaurant] scheduled-order sweeper started (interval %s)", interval)
}

// isRestaurantOpenNow evaluates the manual switch + weekly hours + holiday override at t.
func (s *Service) isRestaurantOpenNow(ctx context.Context, restaurantID string, t time.Time) (bool, error) {
	var isOpen bool
	if err := s.db.QueryRow(ctx, `SELECT is_open FROM restaurants WHERE id=$1`, restaurantID).Scan(&isOpen); err != nil {
		return false, err
	}
	hours, err := s.loadBusinessHours(ctx, restaurantID)
	if err != nil {
		return false, err
	}
	holiday, err := s.loadHolidayForDate(ctx, restaurantID, t, lagosTZ)
	if err != nil {
		return false, err
	}
	return effectiveOpenWithHoliday(isOpen, hours, holiday, t, lagosTZ), nil
}

// stuckSettlementSelect is the authoritative crash-recovery predicate for food
// delivery. UpdateStatus(delivered) flips orders.status='delivered' FIRST and
// only THEN calls settlement.Settle — so a crash (or Settle error) between the
// two leaves an order that is delivered while its escrow is still 'escrowed'.
// That pair — a terminal (delivered) order whose linked settlement row is still
// escrowed — is the stranded-escrow signature, and the settlements table is the
// money source of truth (not any mirrored order flag).
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
	return timeutil.IntervalSeconds(d)
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
