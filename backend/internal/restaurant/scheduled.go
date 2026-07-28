package restaurant

import (
	"context"
	"fmt"
	"time"
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
