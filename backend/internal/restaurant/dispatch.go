package restaurant

import (
	"context"
	"crypto/rand"
	"fmt"
	"math/big"
	"time"

	"github.com/google/uuid"
)

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
	var readyAt *time.Time
	var attempts int
	if err := s.db.QueryRow(ctx,
		`SELECT restaurant_id, rider_id, status, ready_at, dispatch_attempts FROM orders WHERE id=$1`, orderID).
		Scan(&restaurantID, &existingRider, &status, &readyAt, &attempts); err != nil {
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

	// SLA-aware tuning: a fresh order uses the base fan-out + load cap; a re-dispatch
	// of an order that has been searching past the SLA target escalates (wider net,
	// relaxed cap) to get it moving.
	effectiveReady := readyAt
	if effectiveReady == nil {
		now := time.Now()
		effectiveReady = &now
	}
	fanOut, maxLoad, _ := dispatchTuning(effectiveReady, time.Now(), attempts)

	// Gather the available-rider pool with the fairness signals — proximity, current
	// in-flight load, and last-assignment time — then rank/trim in pure Go
	// (selectFairRiders) so the offer set balances speed and fairness rather than
	// piling every order on the same nearest rider. drivers.user_id is the rider's
	// auth id (== orders.rider_id).
	candidates, err := s.gatherRiderCandidates(ctx, rlat, rlng)
	if err != nil {
		return fmt.Errorf("restaurant: find riders: %w", err)
	}
	selected := selectFairRiders(candidates, fanOut, maxLoad)
	riders := make([]string, 0, len(selected))
	for _, c := range selected {
		riders = append(riders, c.RiderID)
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
	// Record the SLA timeline: stamp first_offered_at once (start of the time-to-assign
	// clock), and count this (possibly escalating) dispatch attempt.
	if _, err := s.db.Exec(ctx,
		`UPDATE orders SET first_offered_at = COALESCE(first_offered_at, now()), dispatch_attempts = dispatch_attempts + 1 WHERE id=$1`,
		orderID); err != nil {
		return err
	}
	s.broadcastStatus(orderID, OrderStatus("searching_rider"))
	_ = code
	return nil
}

// gatherRiderCandidates loads the available-rider pool (online + approved) with the
// fairness signals used by selectFairRiders: each rider's straight-line distance to the
// restaurant (when both are pinned), their current in-flight load (non-terminal orders
// assigned to them), and when they were last assigned an order. Capped at 200 rows —
// ranking + trimming to the fan-out happens in pure Go.
func (s *Service) gatherRiderCandidates(ctx context.Context, rlat, rlng *float64) ([]riderCandidate, error) {
	const q = `
		SELECT d.user_id, d.current_lat, d.current_lng,
		  (SELECT count(*) FROM orders o WHERE o.rider_id = d.user_id AND o.status NOT IN ('delivered','cancelled')) AS active_load,
		  (SELECT max(o.ready_at) FROM orders o WHERE o.rider_id = d.user_id) AS last_assigned
		FROM drivers d
		WHERE d.status = 'online' AND d.verification_status = 'approved'
		LIMIT 200`
	rows, err := s.db.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []riderCandidate
	for rows.Next() {
		var uid string
		var clat, clng *float64
		var load int
		var last *time.Time
		if err := rows.Scan(&uid, &clat, &clng, &load, &last); err != nil {
			return nil, err
		}
		c := riderCandidate{RiderID: uid, ActiveLoad: load, LastAssigned: last}
		if rlat != nil && rlng != nil && clat != nil && clng != nil {
			dlat := *clat - *rlat
			dlng := *clng - *rlng
			c.HasDistance = true
			c.DistanceSq = dlat*dlat + dlng*dlng
		}
		out = append(out, c)
	}
	return out, rows.Err()
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
	if err := s.transitionInternal(ctx, orderID, riderID, OrderDelivered); err != nil {
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
