package restaurant

import (
	"context"
	"fmt"
)

// DeclineDelivery lets an offered rider explicitly decline a delivery (DP-002). Their
// offer is marked 'declined'; if the order still has no rider and no other open offers
// remain, it is re-dispatched to source new riders. No money moves (pre-settlement).
func (s *Service) DeclineDelivery(ctx context.Context, orderID, riderID string) error {
	tag, err := s.db.Exec(ctx,
		`UPDATE restaurant_delivery_offers SET status='declined', responded_at=now()
		 WHERE order_id=$1 AND rider_id=$2 AND status='offered'`, orderID, riderID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("restaurant: you have no open offer for this order")
	}
	// Re-dispatch only if nobody has taken it and no other offers are still open.
	var riderAssigned *string
	var openOffers int
	if err := s.db.QueryRow(ctx, `SELECT rider_id FROM orders WHERE id=$1`, orderID).Scan(&riderAssigned); err != nil {
		return fmt.Errorf("restaurant: order not found")
	}
	if riderAssigned != nil {
		return nil // already claimed by someone else
	}
	if err := s.db.QueryRow(ctx,
		`SELECT count(*) FROM restaurant_delivery_offers WHERE order_id=$1 AND status='offered'`, orderID).Scan(&openOffers); err != nil {
		return err
	}
	if openOffers == 0 {
		return s.DispatchOrder(ctx, orderID) // re-offer to a fresh set of nearby riders
	}
	return nil
}

// ReassignOrder unassigns an order's rider and re-dispatches it (DP-005 manual path:
// e.g. the assigned rider went offline or is unresponsive). Only valid BEFORE pickup —
// once the rider has the food, reassignment goes through the delivery-failed/dispute
// flow instead. Ops/admin action. No money moves. The prior rider's accepted offer is
// expired and their assignment cleared.
func (s *Service) ReassignOrder(ctx context.Context, orderID, reason string) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var status string
	var rider *string
	if err := tx.QueryRow(ctx, `SELECT status, rider_id FROM orders WHERE id=$1 FOR UPDATE`, orderID).Scan(&status, &rider); err != nil {
		return fmt.Errorf("restaurant: order not found")
	}
	if status == string(OrderPickedUp) || status == string(OrderDelivered) {
		return fmt.Errorf("restaurant: cannot reassign an order already picked up or delivered")
	}
	if isRefundedClose(OrderStatus(status)) || status == string(OrderDeliveryFailed) {
		return fmt.Errorf("restaurant: cannot reassign a %s order", status)
	}
	// Clear the assignment + return the order to searching; expire the old offers so the
	// prior rider drops it from their list.
	if _, err := tx.Exec(ctx, `UPDATE orders SET rider_id=NULL, dispatch_status='searching', assigned_at=NULL WHERE id=$1`, orderID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx,
		`UPDATE restaurant_delivery_offers SET status='expired', responded_at=now()
		 WHERE order_id=$1 AND status IN ('offered','accepted')`, orderID); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	if rider != nil {
		s.notify(ctx, Notification{UserID: *rider, Event: EventOrderCancelled, Title: "Delivery reassigned",
			Body: "A delivery was reassigned.", Data: map[string]any{"order_id": orderID, "reason": reason}})
	}
	s.recordOrderEvent(ctx, orderID, "", OrderStatus(status), OrderReady)
	return s.DispatchOrder(ctx, orderID)
}

// SweepOfflineAssigned reassigns orders that are assigned (but not yet picked up) to a
// rider who has since gone offline (DP-005 auto-path). Returns the count reassigned.
// Intended for a periodic ops job.
func (s *Service) SweepOfflineAssigned(ctx context.Context) (int, error) {
	const q = `
		SELECT o.id
		FROM orders o
		JOIN drivers d ON d.user_id = o.rider_id
		WHERE o.status = 'ready'
		  AND COALESCE(o.dispatch_status,'none') = 'assigned'
		  AND o.rider_id IS NOT NULL
		  AND d.status = 'offline'`
	rows, err := s.db.Query(ctx, q)
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
	n := 0
	for _, id := range ids {
		if err := s.ReassignOrder(ctx, id, "rider_offline"); err == nil {
			n++
		}
	}
	return n, nil
}
