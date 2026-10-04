package restaurant

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"math/big"
	"sort"
	"time"

	"github.com/google/uuid"
)

// dispatchFanOut is how many nearest available riders a ready order is offered
// to at once. The first to accept wins; the rest are expired on acceptance.
const dispatchFanOut = 7

// DispatchOrder auto-offers a ready order to the nearest available riders.
// "Available" = a verified, online rider in the shared transport `drivers`
// pool (status='online', verification_status='approved'). Riders are ranked by
// straight-line distance to the restaurant when both have coordinates, so the
// closest get the offer first. This is what marking an order "ready for pickup"
// activates: rider sourcing, with no manual assignment by the restaurant.
// Idempotent: re-dispatching an order simply re-offers to any newly-online
// riders (UNIQUE(order_id, rider_id) prevents duplicate offers). A delivery
// code for the customer↔rider handoff is generated here if not already set.
func (s *Service) DispatchOrder(ctx context.Context, orderID string) error {
	// Resolve the order, its restaurant, the restaurant's pin, and the SLA clock.
	var restaurantID string
	var existingRider *string
	var status string
	var readyAt *time.Time
	var attempts int
	if err := s.db.QueryRow(ctx,
		`SELECT restaurant_id, rider_id, status, ready_at, dispatch_attempts FROM orders WHERE id=$1`, orderID).
		Scan(&restaurantID, &existingRider, &status, &readyAt, &attempts); err != nil {
		return errors.New("restaurant: order not found")
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
	// Also (re-)ensure the restaurant pickup code — idempotent, so this is the
	// retry path if the ready-transition's own generation hit a hiccup: the
	// restaurant re-triggering dispatch (Redispatch) picks it up here too.
	if _, err := s.ensurePickupCode(ctx, orderID); err != nil {
		return err
	}
	if _, err := s.db.Exec(ctx,
		`UPDATE orders SET dispatch_status='searching', ready_at=COALESCE(ready_at, now()) WHERE id=$1`,
		orderID); err != nil {
		return err
	}

	// Gather sourcing candidates with the fairness signals (proximity, in-flight
	// load, last assignment), then rank + trim via selectFairRiders. The fan-out
	// and load cap escalate on a re-dispatch that has slipped past the SLA target
	// (dispatchTuning). drivers.user_id is the rider's auth user id (rider_id).
	fanOut, maxLoad, _ := dispatchTuning(readyAt, time.Now(), attempts)
	const q = `
		SELECT d.user_id,
		       (d.current_lat IS NOT NULL AND $1::float8 IS NOT NULL) AS has_distance,
		       CASE WHEN d.current_lat IS NOT NULL AND $1::float8 IS NOT NULL
		            THEN (d.current_lat - $1::float8) * (d.current_lat - $1::float8)
		               + (d.current_lng - $2::float8) * (d.current_lng - $2::float8)
		            ELSE 0 END AS dist_sq,
		       (SELECT count(*) FROM orders o
		          WHERE o.rider_id = d.user_id
		            AND o.status NOT IN ('delivered','cancelled','rejected','dispatch_failed','delivery_failed')) AS active_load,
		       (SELECT max(o2.assigned_at) FROM orders o2 WHERE o2.rider_id = d.user_id) AS last_assigned
		FROM drivers d
		WHERE d.status = 'online' AND d.verification_status = 'approved'`
	rows, err := s.db.Query(ctx, q, rlat, rlng)
	if err != nil {
		return fmt.Errorf("restaurant: find riders: %w", err)
	}
	defer rows.Close()
	var cands []riderCandidate
	for rows.Next() {
		var c riderCandidate
		if err := rows.Scan(&c.RiderID, &c.HasDistance, &c.DistanceSq, &c.ActiveLoad, &c.LastAssigned); err != nil {
			return err
		}
		cands = append(cands, c)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	var riders []string
	for _, c := range selectFairRiders(cands, fanOut, maxLoad) {
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
		s.broadcastStatus(orderID, OrderStatus("searching_rider")) //nolint:contextcheck // WS publish outlives the request by design
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
	// SLA timeline: stamp the first time offers actually went out, and count this
	// sourcing attempt (dispatchTuning escalates once attempts > 0 past the target).
	if _, err := s.db.Exec(ctx,
		`UPDATE orders SET first_offered_at = COALESCE(first_offered_at, now()),
		        dispatch_attempts = dispatch_attempts + 1 WHERE id=$1`, orderID); err != nil {
		return err
	}
	s.broadcastStatus(orderID, OrderStatus("searching_rider")) //nolint:contextcheck // WS publish outlives the request by design
	_ = code
	return nil
}

// ConfirmPickup lets the assigned rider mark a ready order as picked up. Only
// the order's rider may call it, and only with the restaurant's pickup code
// (generated when the order went ready — ensurePickupCode) — this proves the
// rider actually collected the food from the restaurant, distinct from the
// delivery_code proof-of-delivery at the customer end. Advances ready → picked_up.
func (s *Service) ConfirmPickup(ctx context.Context, orderID, riderID, code string) error {
	var rider *string
	var dbCode *string
	var status string
	if err := s.db.QueryRow(ctx,
		`SELECT rider_id, pickup_code, status FROM orders WHERE id=$1`, orderID).
		Scan(&rider, &dbCode, &status); err != nil {
		return errors.New("restaurant: order not found")
	}
	if rider == nil || *rider != riderID {
		return errors.New("restaurant: only the assigned rider may confirm pickup")
	}
	if dbCode == nil || *dbCode == "" {
		return errors.New("restaurant: no pickup code on this order")
	}
	if code == "" || code != *dbCode {
		return errors.New("restaurant: incorrect pickup code")
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
		return errors.New("restaurant: order not found")
	}
	if rider == nil || *rider != riderID {
		return errors.New("restaurant: only the assigned rider may confirm handoff")
	}
	if dbCode == nil || *dbCode == "" {
		return errors.New("restaurant: no delivery code on this order")
	}
	if code == "" || code != *dbCode {
		return errors.New("restaurant: incorrect delivery code")
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
	customer, _, _, _ := s.orderParties(ctx, orderID) //nolint:dogsled // tuple unpack; unused positions
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
		return "", errors.New("restaurant: order not found")
	}
	if existing != nil && *existing != "" {
		return *existing, nil
	}
	code, err := generateHandoffCode()
	if err != nil {
		return "", err
	}
	if _, err := s.db.Exec(ctx, `UPDATE orders SET delivery_code=$1 WHERE id=$2`, code, orderID); err != nil {
		return "", err
	}
	return code, nil
}

// ensurePickupCode sets a 4-digit restaurant-pickup code on the order if
// absent and returns it. Generated as soon as the order goes `ready` — the
// restaurant hands it to the rider, who must enter it in ConfirmPickup before
// the order advances to picked_up. Distinct from delivery_code (rider→customer).
func (s *Service) ensurePickupCode(ctx context.Context, orderID string) (string, error) {
	var existing *string
	if err := s.db.QueryRow(ctx, `SELECT pickup_code FROM orders WHERE id=$1`, orderID).Scan(&existing); err != nil {
		return "", errors.New("restaurant: order not found")
	}
	if existing != nil && *existing != "" {
		return *existing, nil
	}
	code, err := generateHandoffCode()
	if err != nil {
		return "", err
	}
	if _, err := s.db.Exec(ctx, `UPDATE orders SET pickup_code=$1 WHERE id=$2`, code, orderID); err != nil {
		return "", err
	}
	return code, nil
}

// generateHandoffCode returns a random 4-digit handoff code (0000–9999), used
// for both the restaurant pickup code and the customer delivery code.
func generateHandoffCode() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(10000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%04d", n.Int64()), nil
}

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
		return errors.New("restaurant: you have no open offer for this order")
	}
	// Re-dispatch only if nobody has taken it and no other offers are still open.
	var riderAssigned *string
	var openOffers int
	if err := s.db.QueryRow(ctx, `SELECT rider_id FROM orders WHERE id=$1`, orderID).Scan(&riderAssigned); err != nil {
		return errors.New("restaurant: order not found")
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
	defer func() { _ = tx.Rollback(ctx) }()

	var status string
	var rider *string
	if err := tx.QueryRow(ctx, `SELECT status, rider_id FROM orders WHERE id=$1 FOR UPDATE`, orderID).Scan(&status, &rider); err != nil {
		return errors.New("restaurant: order not found")
	}
	if status == string(OrderPickedUp) || status == string(OrderDelivered) {
		return errors.New("restaurant: cannot reassign an order already picked up or delivered")
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
			Body: "A delivery was reassigned.", Data: map[string]any{"order_id": orderID, keyReason: reason}})
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

// Dispatch fairness + SLA tuning. These bounds shape rider sourcing so a ready order
// reaches a nearby rider quickly (SLA) without repeatedly dumping every order on the
// same one or two riders (fairness).
const (
	// baseDispatchFanOut is how many riders a fresh ready order is offered to.
	baseDispatchFanOut = 7
	// escalatedDispatchFanOut widens the net on a re-dispatch once the SLA target has
	// slipped (more riders, and the load cap is relaxed — see dispatchTuning).
	escalatedDispatchFanOut = 15
	// baseMaxRiderLoad caps how many in-flight deliveries a rider may hold before they
	// are skipped for new offers (protects delivery time + spreads work).
	baseMaxRiderLoad = 3
	// escalatedMaxRiderLoad relaxes the cap when the order is breaching SLA — getting
	// it moving beats perfect load-balancing.
	escalatedMaxRiderLoad = 6

	// dispatchSLATarget is the time-to-assign goal from "ready". Past it an order is
	// "at risk" and a re-dispatch escalates.
	dispatchSLATarget = 2 * time.Minute
	// dispatchSLABreach is when an unassigned order is considered breached (ops-visible).
	dispatchSLABreach = 5 * time.Minute
)

// riderCandidate is one sourcing candidate with the fairness signals: proximity to the
// restaurant, current in-flight load, and when they were last given an order.
type riderCandidate struct {
	RiderID      string
	HasDistance  bool       // false when the restaurant or rider has no pin
	DistanceSq   float64    // squared straight-line distance (monotonic; only compared, never shown)
	ActiveLoad   int        // non-terminal orders currently assigned to this rider
	LastAssigned *time.Time // nil = never assigned (gets fairness priority)
}

// selectFairRiders ranks and trims sourcing candidates. Riders at/over maxLoad are
// filtered out entirely (never pile more onto a saturated rider). The rest are ordered
// so food still reaches the customer fast while work is spread fairly:
//  1. known-distance riders before unknown (a pinned rider can be routed);
//  2. nearest first (fresher food);
//  3. lighter current load first (tiebreak among equally-near riders);
//  4. longest-waiting first — never-assigned, then oldest last-assignment (round-robin
//     fairness, and the ONLY signal when neither side has a pin, e.g. no restaurant
//     coordinates — which turns sourcing into a fair rotation instead of the old
//     most-recently-online bias).
//
// It returns at most fanOut candidates and never mutates its input.
func selectFairRiders(cands []riderCandidate, fanOut, maxLoad int) []riderCandidate {
	pool := make([]riderCandidate, 0, len(cands))
	for _, c := range cands {
		if c.ActiveLoad < maxLoad {
			pool = append(pool, c)
		}
	}
	sort.SliceStable(pool, func(i, j int) bool {
		a, b := pool[i], pool[j]
		if a.HasDistance != b.HasDistance {
			return a.HasDistance // known distance ranks ahead of unknown
		}
		if a.HasDistance && a.DistanceSq != b.DistanceSq {
			return a.DistanceSq < b.DistanceSq
		}
		if a.ActiveLoad != b.ActiveLoad {
			return a.ActiveLoad < b.ActiveLoad
		}
		return lastAssignedEarlier(a.LastAssigned, b.LastAssigned)
	})
	if len(pool) > fanOut && fanOut >= 0 {
		pool = pool[:fanOut]
	}
	return pool
}

// lastAssignedEarlier orders never-assigned (nil) first, then by oldest assignment —
// so the rider who has waited longest for work is offered first.
func lastAssignedEarlier(a, b *time.Time) bool {
	if a == nil && b == nil {
		return false
	}
	if a == nil {
		return true // never assigned wins
	}
	if b == nil {
		return false
	}
	return a.Before(*b)
}

// SLAStatus is the dispatch time-to-assign health of an order.
type SLAStatus string

const (
	SLAOnTime   SLAStatus = "on_time"
	SLAAtRisk   SLAStatus = "at_risk"
	SLABreached SLAStatus = "breached"
)

// dispatchSLAStatus computes the time-to-assign health of an order. `elapsed` is
// measured from readyAt to assignedAt when a rider has been assigned (the realized
// time-to-assign), otherwise from readyAt to now (still ticking). A nil readyAt (the
// order never reached "ready") is on_time with zero elapsed — there is no SLA clock yet.
func dispatchSLAStatus(readyAt, assignedAt *time.Time, now time.Time, target, breach time.Duration) (SLAStatus, time.Duration) {
	if readyAt == nil {
		return SLAOnTime, 0
	}
	end := now
	if assignedAt != nil {
		end = *assignedAt
	}
	elapsed := max(end.Sub(*readyAt), 0)
	switch {
	case elapsed > breach:
		return SLABreached, elapsed
	case elapsed > target:
		return SLAAtRisk, elapsed
	default:
		return SLAOnTime, elapsed
	}
}

// dispatchTuning picks the fan-out + load cap for a (re-)dispatch. The first attempt on
// a fresh order uses the base bounds; once the order has been searching past the SLA
// target (an escalating re-dispatch), it widens the net and relaxes the load cap so a
// stuck order gets moving.
func dispatchTuning(readyAt *time.Time, now time.Time, attempt int) (int, int, bool) {
	elapsed := time.Duration(0)
	if readyAt != nil {
		elapsed = now.Sub(*readyAt)
	}
	if attempt > 0 && elapsed > dispatchSLATarget {
		return escalatedDispatchFanOut, escalatedMaxRiderLoad, true
	}
	return baseDispatchFanOut, baseMaxRiderLoad, false
}
