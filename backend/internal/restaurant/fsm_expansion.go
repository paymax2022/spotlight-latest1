package restaurant

import (
	"context"
	"fmt"
	"time"
)

// dispatchStaleMinutes is how long an order may sit in dispatch_status='searching'
// (no rider sourced) before the stalled-dispatch sweeper fails + refunds it (DP-003).
const dispatchStaleMinutes = 20

// RejectOrder lets the restaurant owner decline an order before it is prepared, with a
// reason, refunding the customer (RM-003). Only the owner may reject, and only a
// pending/confirmed order (canTransition enforces the stage). Money moves through the
// single guarded refundAndClose path.
func (s *Service) RejectOrder(ctx context.Context, orderID, actorID, reason string) error {
	customer, owner, rider, err := s.orderParties(ctx, orderID)
	if err != nil {
		return err
	}
	if classifyOrderActor(actorID, customer, owner, rider) != roleOwner {
		return ErrForbidden
	}
	if reason == "" {
		return fmt.Errorf("restaurant: a reason is required to reject an order")
	}
	var status string
	if err := s.db.QueryRow(ctx, `SELECT status FROM orders WHERE id=$1`, orderID).Scan(&status); err != nil {
		return fmt.Errorf("restaurant: order not found")
	}
	if !canTransition(OrderStatus(status), OrderRejected) {
		return fmt.Errorf("restaurant: cannot reject an order that is %s", status)
	}
	return s.refundAndClose(ctx, orderID, actorID, OrderRejected, reason)
}

// MarkDispatchFailed fails + refunds an order for which no rider could be sourced
// (DP-003). Ops/system path (no per-user authz — mounted behind restaurant.admin.dispatch
// or called by the sweeper). Only a 'ready' order that was still searching qualifies.
func (s *Service) MarkDispatchFailed(ctx context.Context, orderID, reason string) error {
	if reason == "" {
		reason = "no_rider_available"
	}
	var status string
	if err := s.db.QueryRow(ctx, `SELECT status FROM orders WHERE id=$1`, orderID).Scan(&status); err != nil {
		return fmt.Errorf("restaurant: order not found")
	}
	if !canTransition(OrderStatus(status), OrderDispatchFailed) {
		return fmt.Errorf("restaurant: cannot fail dispatch from %s", status)
	}
	return s.refundAndClose(ctx, orderID, "", OrderDispatchFailed, reason)
}

// MarkDeliveryFailed records that the assigned rider could not complete the drop-off
// (customer unreachable / wrong address). Only the assigned rider may set it, and only
// from picked_up. NO auto-refund: the food is already with the rider, so resolution
// (refund vs re-attempt) goes through the dispute/cancel flow — this just marks the
// failure + reason for that resolution.
func (s *Service) MarkDeliveryFailed(ctx context.Context, orderID, riderID, reason string) error {
	customer, _, rider, err := s.orderParties(ctx, orderID)
	if err != nil {
		return err
	}
	if rider == "" || rider != riderID {
		return ErrForbidden
	}
	if reason == "" {
		return fmt.Errorf("restaurant: a reason is required to report a failed delivery")
	}
	var status string
	if err := s.db.QueryRow(ctx, `SELECT status FROM orders WHERE id=$1`, orderID).Scan(&status); err != nil {
		return fmt.Errorf("restaurant: order not found")
	}
	if !canTransition(OrderStatus(status), OrderDeliveryFailed) {
		return fmt.Errorf("restaurant: cannot report failed delivery from %s", status)
	}
	if _, err := s.db.Exec(ctx, `UPDATE orders SET status='delivery_failed', status_reason=$2 WHERE id=$1`, orderID, reason); err != nil {
		return err
	}
	s.recordOrderEvent(ctx, orderID, riderID, OrderStatus(status), OrderDeliveryFailed)
	if customer != "" {
		s.notify(ctx, Notification{UserID: customer, Event: EventOrderCancelled, Title: "Delivery problem",
			Body: "We couldn't complete your delivery — support will reach out.", Data: map[string]any{"order_id": orderID, "reason": reason}})
	}
	s.broadcastStatus(orderID, OrderDeliveryFailed)
	return nil
}

// SweepStalledDispatch fails + refunds orders that have been searching for a rider
// longer than dispatchStaleMinutes with none found (DP-003 auto-path). Returns the
// count swept. Intended for a periodic ops job (mirrors SweepUnacceptedOrders).
func (s *Service) SweepStalledDispatch(ctx context.Context, now time.Time) (int, error) {
	const q = `
		SELECT id FROM orders
		WHERE status = 'ready'
		  AND rider_id IS NULL
		  AND COALESCE(dispatch_status,'none') = 'searching'
		  AND ready_at IS NOT NULL
		  AND ready_at < ($1::timestamptz - make_interval(mins => $2))`
	rows, err := s.db.Query(ctx, q, now, dispatchStaleMinutes)
	if err != nil {
		return 0, err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return 0, err
		}
		ids = append(ids, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}
	swept := 0
	for _, id := range ids {
		if err := s.MarkDispatchFailed(ctx, id, "no_rider_available"); err == nil {
			swept++
		}
	}
	return swept, nil
}
