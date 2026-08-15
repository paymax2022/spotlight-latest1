package restaurant

import (
	"context"
	"fmt"
	"time"
)

// ─────────────────────────────────────────────────────────────────────────────
// Admin (ops-console) READ models + service methods.
//
// These power the platform admin console surfaces (dispatch board, onboarding
// review, payout reconciliation) under /api/restaurant/admin/*. They are thin
// reads over the SAME tables the member/owner/rider flows already use — no new
// money movement is introduced here. Mutations (onboarding decision, manual
// assign) drive the EXISTING idempotent state transitions.
//
// All monetary amounts are integer minor units (kobo).
// ─────────────────────────────────────────────────────────────────────────────

// AdminRider is a row in the platform rider roster. It reads the shared transport
// `drivers` pool (the same pool auto-dispatch offers deliveries to), plus the
// rider's currently-active food order (if any) so ops can see who is mid-delivery.
type AdminRider struct {
	ID            string     `json:"id"`   // drivers.user_id (the rider_id used on orders)
	Name          string     `json:"name"` // drivers.name
	Phone         *string    `json:"phone,omitempty"`
	Vehicle       string     `json:"vehicle"` // bike|car|foot (from drivers.vehicle_type)
	Status        string     `json:"status"`  // available|on_delivery|offline|suspended
	ActiveOrderID *string    `json:"active_order_id,omitempty"`
	Lat           *float64   `json:"lat,omitempty"`
	Lng           *float64   `json:"lng,omitempty"`
	Rating        *float64   `json:"rating,omitempty"`
	LastSeenAt    *time.Time `json:"last_seen_at,omitempty"`
}

// AdminDispatchOrder is an order needing dispatch attention: ready/searching for a
// rider, assigned, or picked_up but not yet delivered. Joined to its restaurant.
type AdminDispatchOrder struct {
	ID              string     `json:"id"`
	RestaurantID    string     `json:"restaurant_id"`
	RestaurantName  string     `json:"restaurant_name"`
	Status          string     `json:"status"`
	RiderID         *string    `json:"rider_id,omitempty"`
	RiderName       *string    `json:"rider_name,omitempty"`
	DeliveryAddr    string     `json:"delivery_address"`
	TotalKobo       int64      `json:"total_kobo"`
	DeliveryFeeKobo int64      `json:"delivery_fee_kobo"`
	ReadyAt         *time.Time `json:"ready_at,omitempty"`
	CreatedAt       time.Time  `json:"created_at"`
	WaitingMinutes  int        `json:"waiting_minutes"`
}

// AdminApplication mirrors the restaurant merchant record for the onboarding/KYC
// review queue. The `restaurants` table is the merchant record; `is_open` gates
// order placement, so onboarding approval == opening the restaurant. Onboarding
// status is derived from is_open (no separate KYC column exists on `restaurants`
// yet — see report; a richer KYC record would live on onb_application).
type AdminApplication struct {
	ID             string    `json:"id"`
	RestaurantName string    `json:"restaurant_name"`
	OwnerID        string    `json:"owner_id"`
	Address        string    `json:"address,omitempty"`
	Status         string    `json:"status"`    // pending|approved (derived from is_open)
	Documents      []any     `json:"documents"` // empty: no KYC doc store on restaurants yet
	SubmittedAt    time.Time `json:"submitted_at"`
	ReviewNote     *string   `json:"review_note,omitempty"`
}

// AdminPayoutRun is a READ-ONLY reconciliation view of settled food-delivery
// escrows grouped into a payout period. It is derived from the immutable
// `settlements` ledger-projection rows (module_type='food_delivery', status
// 'settled'); it does NOT represent a disbursement run and moves no money.
// See report: there is no payout-run service yet, so this is read-only.
type AdminPayoutRun struct {
	ID                string    `json:"id"`
	PayeeType         string    `json:"payee_type"` // restaurant (settled provider share)
	PeriodStart       string    `json:"period_start"`
	PeriodEnd         string    `json:"period_end"`
	Status            string    `json:"status"` // paid (already settled) — read-only
	LinesCount        int       `json:"lines_count"`
	TotalNetKobo      int64     `json:"total_net_kobo"`
	CreatedAt         time.Time `json:"created_at"`
	LedgerSettledKobo int64     `json:"ledger_settled_kobo"`
	Reconciled        bool      `json:"reconciled"`
}

// ── Riders roster ─────────────────────────────────────────────────────────────

// AdminListRiders returns the platform rider roster from the shared transport
// `drivers` pool, mapping transport status/verification to the console's rider
// status and attaching the rider's currently-active food order if any.
func (s *Service) AdminListRiders(ctx context.Context) ([]AdminRider, error) {
	const q = `
		SELECT d.user_id, d.name, d.phone, d.vehicle_type, d.status,
		       d.verification_status, d.current_lat, d.current_lng, d.rating, d.updated_at,
		       (SELECT o.id FROM orders o
		         WHERE o.rider_id = d.user_id
		           AND o.status NOT IN ('delivered','cancelled')
		         ORDER BY o.created_at DESC LIMIT 1) AS active_order_id
		FROM drivers d
		WHERE ARRAY['ride_hailing','food_delivery','delivery'] && d.service_categories
		   OR d.service_categories IS NULL
		ORDER BY d.updated_at DESC`
	rows, err := s.db.Query(ctx, q)
	if err != nil {
		// service_categories may be absent on very old rows; fall back to a plain read.
		return s.adminListRidersFallback(ctx)
	}
	defer rows.Close()
	var out []AdminRider
	for rows.Next() {
		var r AdminRider
		var transportStatus, verification string
		var rating *float64
		var updatedAt *time.Time
		if err := rows.Scan(&r.ID, &r.Name, &r.Phone, &r.Vehicle, &transportStatus,
			&verification, &r.Lat, &r.Lng, &rating, &updatedAt, &r.ActiveOrderID); err != nil {
			return nil, err
		}
		r.Status = mapRiderStatus(transportStatus, verification, r.ActiveOrderID != nil)
		r.Rating = rating
		r.LastSeenAt = updatedAt
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *Service) adminListRidersFallback(ctx context.Context) ([]AdminRider, error) {
	const q = `
		SELECT d.user_id, d.name, d.phone, d.vehicle_type, d.status,
		       COALESCE(d.verification_status,'approved'), d.current_lat, d.current_lng, d.rating, d.updated_at,
		       (SELECT o.id FROM orders o
		         WHERE o.rider_id = d.user_id
		           AND o.status NOT IN ('delivered','cancelled')
		         ORDER BY o.created_at DESC LIMIT 1) AS active_order_id
		FROM drivers d
		ORDER BY d.updated_at DESC`
	rows, err := s.db.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AdminRider
	for rows.Next() {
		var r AdminRider
		var transportStatus, verification string
		var rating *float64
		var updatedAt *time.Time
		if err := rows.Scan(&r.ID, &r.Name, &r.Phone, &r.Vehicle, &transportStatus,
			&verification, &r.Lat, &r.Lng, &rating, &updatedAt, &r.ActiveOrderID); err != nil {
			return nil, err
		}
		r.Status = mapRiderStatus(transportStatus, verification, r.ActiveOrderID != nil)
		r.Rating = rating
		r.LastSeenAt = updatedAt
		out = append(out, r)
	}
	return out, rows.Err()
}

// mapRiderStatus maps the transport driver status + verification onto the ops
// console's rider status vocabulary (available|on_delivery|offline|suspended).
func mapRiderStatus(transportStatus, verification string, onDelivery bool) string {
	switch verification {
	case "suspended", "rejected":
		return "suspended"
	}
	if onDelivery {
		return "on_delivery"
	}
	switch transportStatus {
	case "online":
		return "available"
	case "on_trip":
		return "on_delivery"
	default:
		return "offline"
	}
}

// ── Dispatch queue ────────────────────────────────────────────────────────────

// AdminDispatchQueue lists orders awaiting or in dispatch (ready/searching for a
// rider, assigned, or picked_up but not delivered), newest first. waiting_minutes
// is time since the order became ready (from ready_at when set, else created_at).
func (s *Service) AdminDispatchQueue(ctx context.Context) ([]AdminDispatchOrder, error) {
	const q = `
		SELECT o.id, o.restaurant_id, r.name, o.status, o.rider_id,
		       (SELECT d.name FROM drivers d WHERE d.user_id = o.rider_id) AS rider_name,
		       o.delivery_address, o.total_kobo, o.delivery_kobo, o.ready_at, o.created_at
		FROM orders o
		JOIN restaurants r ON r.id = o.restaurant_id
		WHERE o.status IN ('ready','picked_up')
		   OR (o.status NOT IN ('delivered','cancelled') AND o.dispatch_status IN ('searching','assigned'))
		ORDER BY o.created_at DESC`
	rows, err := s.db.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	now := time.Now()
	var out []AdminDispatchOrder
	for rows.Next() {
		var d AdminDispatchOrder
		if err := rows.Scan(&d.ID, &d.RestaurantID, &d.RestaurantName, &d.Status, &d.RiderID,
			&d.RiderName, &d.DeliveryAddr, &d.TotalKobo, &d.DeliveryFeeKobo, &d.ReadyAt, &d.CreatedAt); err != nil {
			return nil, err
		}
		since := d.CreatedAt
		if d.ReadyAt != nil {
			since = *d.ReadyAt
		}
		if mins := int(now.Sub(since).Minutes()); mins > 0 {
			d.WaitingMinutes = mins
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// ── Onboarding review queue ───────────────────────────────────────────────────

// AdminListApplications lists restaurant merchant records for the onboarding/KYC
// review queue. status filters the derived onboarding status: an open restaurant
// is 'approved', a closed one is 'pending'. Empty status returns all.
func (s *Service) AdminListApplications(ctx context.Context, status string) ([]AdminApplication, error) {
	const q = `
		SELECT r.id, r.name, r.owner_id, COALESCE(r.address,''), r.is_open, r.created_at
		FROM restaurants r
		ORDER BY r.created_at DESC`
	rows, err := s.db.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AdminApplication
	for rows.Next() {
		var a AdminApplication
		var isOpen bool
		if err := rows.Scan(&a.ID, &a.RestaurantName, &a.OwnerID, &a.Address, &isOpen, &a.SubmittedAt); err != nil {
			return nil, err
		}
		if isOpen {
			a.Status = "approved"
		} else {
			a.Status = "pending"
		}
		// No KYC review-note column exists on `restaurants` yet (see report); the
		// review note supplied on reject is delivered to the owner, not persisted.
		a.Documents = []any{}
		if status != "" && a.Status != status {
			continue
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// AdminDecideApplication approves or rejects a restaurant onboarding application.
// Idempotent: approve opens the restaurant (is_open=true), reject closes it
// (is_open=false). Drives only the existing `restaurants.is_open` gate — no money
// movement. `note` is the reviewer's KYC note (recorded on the restaurant
// description-adjacent audit; required by the caller on reject).
func (s *Service) AdminDecideApplication(ctx context.Context, restaurantID, adminID, decision, note string) error {
	var exists bool
	if err := s.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM restaurants WHERE id=$1)`, restaurantID).Scan(&exists); err != nil {
		return fmt.Errorf("restaurant: application lookup: %w", err)
	}
	if !exists {
		return fmt.Errorf("restaurant: application not found")
	}
	var target KYBStatus
	switch decision {
	case "approve":
		target = KYBApproved
	case "reject":
		target = KYBRejected
	case "needs_info":
		target = KYBNeedsInfo
	default:
		return fmt.Errorf("restaurant: invalid decision %q (want approve|reject|needs_info)", decision)
	}
	if decision != "approve" && note == "" {
		return fmt.Errorf("restaurant: a reviewer note is required to %s", decision)
	}

	// When a KYB record exists, the decision must be a legal KYB transition and is
	// recorded on it (plus the restaurants.kyb_status snapshot payout gating reads).
	k, hasKYB, err := s.loadKYB(ctx, restaurantID)
	if err != nil {
		return err
	}
	if hasKYB {
		if !kybCanTransition(k.Status, target) {
			return fmt.Errorf("restaurant: cannot move KYB from %s to %s", k.Status, target)
		}
		if _, err := s.db.Exec(ctx,
			`UPDATE restaurant_kyb SET status=$2, decision_reason=NULLIF($3,''), reviewed_by=$4,
			        decided_at=now(), updated_at=now() WHERE restaurant_id=$1`,
			restaurantID, string(target), note, adminID); err != nil {
			return err
		}
		if _, err := s.db.Exec(ctx,
			`UPDATE restaurants SET kyb_status=$2, updated_at=now() WHERE id=$1`,
			restaurantID, string(target)); err != nil {
			return err
		}
	} else if decision == "needs_info" {
		return fmt.Errorf("restaurant: no KYB submission to request more info on")
	}

	switch decision {
	case "approve":
		if _, err := s.db.Exec(ctx,
			`UPDATE restaurants SET is_open=true, updated_at=now() WHERE id=$1`, restaurantID); err != nil {
			return err
		}
	case "reject":
		if _, err := s.db.Exec(ctx,
			`UPDATE restaurants SET is_open=false, updated_at=now() WHERE id=$1`, restaurantID); err != nil {
			return err
		}
	}
	// Best-effort audit via the shared notifier (owner is informed of the decision).
	var owner string
	_ = s.db.QueryRow(ctx, `SELECT owner_id FROM restaurants WHERE id=$1`, restaurantID).Scan(&owner)
	if owner != "" {
		title := "Restaurant approved"
		body := "Your restaurant has been approved and is now live."
		switch decision {
		case "reject":
			title = "Restaurant application rejected"
			body = note
		case "needs_info":
			title = "More information needed"
			body = note
		}
		s.notify(ctx, Notification{UserID: owner, Event: EventOnboardingDecision, Title: title, Body: body,
			Data: map[string]any{"restaurant_id": restaurantID, "decision": decision, "admin_id": adminID}})
	}
	return nil
}

// ── Manual (ops) rider assignment ─────────────────────────────────────────────

// AdminAssignRider is the ops-console manual assignment. It reuses the exact same
// offer mechanics as the owner-facing AssignRider (sets rider_candidate_id +
// notifies the rider), but authorizes the actor as the restaurant owner so a
// platform admin can assign on the merchant's behalf. Idempotent: re-assigning
// the same candidate simply re-offers. No money movement.
func (s *Service) AdminAssignRider(ctx context.Context, orderID, candidateID string) error {
	_, owner, _, err := s.orderParties(ctx, orderID)
	if err != nil {
		return err
	}
	// Drive the existing owner-authorized transition with the owner as actor.
	return s.AssignRider(ctx, orderID, owner, candidateID)
}

// ── Payout reconciliation (READ-ONLY) ─────────────────────────────────────────

// AdminPayoutRuns returns a READ-ONLY reconciliation view of settled food-delivery
// escrows grouped by ISO week. Derived from the immutable `settlements` rows
// (module_type='food_delivery', status='settled'); provider_kobo is the restaurant
// share already credited. No disbursement is initiated — this is reconciliation
// only (see report: no payout-run service exists yet).
func (s *Service) AdminPayoutRuns(ctx context.Context) ([]AdminPayoutRun, error) {
	const q = `
		SELECT to_char(date_trunc('week', settled_at), 'YYYY-MM-DD')            AS period_start,
		       to_char(date_trunc('week', settled_at) + interval '6 days','YYYY-MM-DD') AS period_end,
		       count(*)                                                          AS lines_count,
		       COALESCE(sum(provider_kobo),0)                                    AS total_net_kobo,
		       COALESCE(sum(total_kobo),0)                                       AS ledger_settled_kobo,
		       min(settled_at)                                                   AS created_at
		FROM settlements
		WHERE module_type = 'food_delivery' AND status = 'settled' AND settled_at IS NOT NULL
		GROUP BY date_trunc('week', settled_at)
		ORDER BY date_trunc('week', settled_at) DESC`
	rows, err := s.db.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AdminPayoutRun
	for rows.Next() {
		var p AdminPayoutRun
		if err := rows.Scan(&p.PeriodStart, &p.PeriodEnd, &p.LinesCount,
			&p.TotalNetKobo, &p.LedgerSettledKobo, &p.CreatedAt); err != nil {
			return nil, err
		}
		p.ID = "food-restaurant-" + p.PeriodStart
		p.PayeeType = "restaurant"
		p.Status = "paid" // already settled to provider wallets via the ledger
		// Reconciled: net provider share never exceeds the settled escrow total.
		p.Reconciled = p.TotalNetKobo <= p.LedgerSettledKobo
		out = append(out, p)
	}
	return out, rows.Err()
}
