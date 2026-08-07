package restaurant

import (
	"context"
	"crypto/rand"
	"fmt"
	"math/big"

	"github.com/google/uuid"
)

// dispatchFanOut is how many nearest available riders a ready order is offered
// to at once. The first to accept wins; the rest are expired on acceptance.
const dispatchFanOut = 7

// DispatchOrder auto-offers a ready order to the nearest available riders.
//
// "Available" = a verified, online rider in the shared transport `drivers`
// pool (status='online', verification_status='approved'). Riders are ranked by
// straight-line distance to the restaurant when both have coordinates, so the
// closest get the offer first. This is what marking an order "ready for pickup"
// activates: rider sourcing, with no manual assignment by the restaurant.
//
// Idempotent: re-dispatching an order simply re-offers to any newly-online
// riders (UNIQUE(order_id, rider_id) prevents duplicate offers). A delivery
// code for the customer↔rider handoff is generated here if not already set.
func (s *Service) DispatchOrder(ctx context.Context, orderID string) error {
	// Resolve the order, its restaurant, and the restaurant's pin.
	var restaurantID string
	var existingRider *string
	var status string
	if err := s.db.QueryRow(ctx,
		`SELECT restaurant_id, rider_id, status FROM orders WHERE id=$1`, orderID).
		Scan(&restaurantID, &existingRider, &status); err != nil {
		return fmt.Errorf("restaurant: order not found")
	}
	if existingRider != nil {
		return nil // already has a rider — nothing to dispatch
	}

	var rlat, rlng *float64
	_ = s.db.QueryRow(ctx, `SELECT geo_lat, geo_lng FROM restaurants WHERE id=$1`, restaurantID).Scan(&rlat, &rlng)

	// Ensure the customer has a handoff code, and mark the order as searching.
	code, err := s.ensureDeliveryCode(ctx, orderID)
	if err != nil {
		return err
	}
	if _, err := s.db.Exec(ctx,
		`UPDATE orders SET dispatch_status='searching', ready_at=COALESCE(ready_at, now()) WHERE id=$1`,
		orderID); err != nil {
		return err
	}

	// Find the nearest available riders. When the restaurant has no pin (rlat
	// nil), fall back to most-recently-online. drivers.user_id is the rider's
	// auth user id used everywhere else (rider_id).
	const q = `
		SELECT user_id
		FROM drivers
		WHERE status = 'online' AND verification_status = 'approved'
		ORDER BY
		  CASE WHEN $2::float8 IS NULL OR current_lat IS NULL THEN 1 ELSE 0 END,
		  CASE WHEN $2::float8 IS NULL OR current_lat IS NULL THEN 0
		       ELSE (current_lat - $2::float8) * (current_lat - $2::float8)
		          + (current_lng - $3::float8) * (current_lng - $3::float8) END ASC,
		  updated_at DESC
		LIMIT $1`
	rows, err := s.db.Query(ctx, q, dispatchFanOut, rlat, rlng)
	if err != nil {
		return fmt.Errorf("restaurant: find riders: %w", err)
	}
	defer rows.Close()
	var riders []string
	for rows.Next() {
		var rid string
		if err := rows.Scan(&rid); err != nil {
			return err
		}
		riders = append(riders, rid)
	}
	if err := rows.Err(); err != nil {
		return err
	}

	// No riders online — leave the order searching and tell the restaurant so it
	// can retry. The order is never lost; the customer keeps their code.
	if len(riders) == 0 {
		_, owner, _, _ := s.orderParties(ctx, orderID)
		if owner != "" {
			s.notify(ctx, Notification{UserID: owner, Event: EventOrderNoRiders,
				Title: "No riders available yet",
				Body:  "We're still finding a delivery rider — we'll keep trying.",
				Data:  map[string]any{"order_id": orderID}})
		}
		s.broadcastStatus(orderID, OrderStatus("searching_rider"))
		return nil
	}

	// Offer the delivery to each nearest rider and notify them.
	for _, rid := range riders {
		if _, err := s.db.Exec(ctx,
			`INSERT INTO restaurant_delivery_offers (id, order_id, rider_id, status)
			 VALUES ($1,$2,$3,'offered')
			 ON CONFLICT (order_id, rider_id) DO NOTHING`,
			uuid.New().String(), orderID, rid); err != nil {
			return fmt.Errorf("restaurant: create offer: %w", err)
		}
		s.notify(ctx, Notification{UserID: rid, Event: EventOrderDispatch,
			Title: "New delivery offer",
			Body:  "A nearby order is ready for pickup — accept to deliver.",
			Data:  map[string]any{"order_id": orderID}})
	}
	s.broadcastStatus(orderID, OrderStatus("searching_rider"))
	_ = code
	return nil
}

// ConfirmPickup lets the assigned rider mark a ready order as picked up. Only
// the order's rider may call it; advances ready → picked_up.
func (s *Service) ConfirmPickup(ctx context.Context, orderID, riderID string) error {
	_, _, rider, err := s.orderParties(ctx, orderID)
	if err != nil {
		return err
	}
	if rider == "" || rider != riderID {
		return fmt.Errorf("restaurant: only the assigned rider may confirm pickup")
	}
	if _, err := s.db.Exec(ctx, `UPDATE orders SET picked_up_at=COALESCE(picked_up_at, now()) WHERE id=$1`, orderID); err != nil {
		return err
	}
	return s.UpdateStatus(ctx, orderID, riderID, OrderPickedUp)
}

// ConfirmHandoff completes the delivery: the rider enters the customer's
// delivery code at drop-off to prove the handoff, which settles the order.
// Only the assigned rider may call it; advances picked_up → delivered.
func (s *Service) ConfirmHandoff(ctx context.Context, orderID, riderID, code string) error {
	var rider *string
	var dbCode *string
	var status string
	if err := s.db.QueryRow(ctx,
		`SELECT rider_id, delivery_code, status FROM orders WHERE id=$1`, orderID).
		Scan(&rider, &dbCode, &status); err != nil {
		return fmt.Errorf("restaurant: order not found")
	}
	if rider == nil || *rider != riderID {
		return fmt.Errorf("restaurant: only the assigned rider may confirm handoff")
	}
	if dbCode == nil || *dbCode == "" {
		return fmt.Errorf("restaurant: no delivery code on this order")
	}
	if code == "" || code != *dbCode {
		return fmt.Errorf("restaurant: incorrect delivery code")
	}
	if _, err := s.db.Exec(ctx,
		`UPDATE orders SET delivered_at=COALESCE(delivered_at, now()), dispatch_status='delivered' WHERE id=$1`,
		orderID); err != nil {
		return err
	}
	// The delivery-code POD has been verified above, so advance to delivered via the
	// internal transition (the public UpdateStatus forbids `delivered` to close the POD
	// bypass). This runs the settlement split + notifies.
	if err := s.transitionInternal(ctx, orderID, OrderDelivered); err != nil {
		return err
	}
	customer, _, _, _ := s.orderParties(ctx, orderID)
	if customer != "" {
		s.notify(ctx, Notification{UserID: customer, Event: EventOrderHandoff,
			Title: "Delivered", Body: "Your order was handed off. Enjoy your meal!",
			Data: map[string]any{"order_id": orderID}})
	}
	return nil
}

// ensureDeliveryCode sets a 4-digit handoff code on the order if absent and
// returns it. The code is shown to the customer and entered by the rider at
// drop-off (ConfirmHandoff).
func (s *Service) ensureDeliveryCode(ctx context.Context, orderID string) (string, error) {
	var existing *string
	if err := s.db.QueryRow(ctx, `SELECT delivery_code FROM orders WHERE id=$1`, orderID).Scan(&existing); err != nil {
		return "", fmt.Errorf("restaurant: order not found")
	}
	if existing != nil && *existing != "" {
		return *existing, nil
	}
	code, err := generateDeliveryCode()
	if err != nil {
		return "", err
	}
	if _, err := s.db.Exec(ctx, `UPDATE orders SET delivery_code=$1 WHERE id=$2`, code, orderID); err != nil {
		return "", err
	}
	return code, nil
}

// generateDeliveryCode returns a random 4-digit handoff code (0000–9999).
func generateDeliveryCode() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(10000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%04d", n.Int64()), nil
}
