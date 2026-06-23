package transport

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"
)

// RequestRide creates a ride: computes the system fare from the route, escrows
// the agreed fare (instant) or the rider's offer (offer mode), records the trip
// in the right phase, and opens a fare_offers row.
func (s *Service) RequestRide(ctx context.Context, riderID string, req RequestRideRequest, idempotencyKey string) (*tripDetail, error) {
	if idempotencyKey == "" {
		idempotencyKey = req.IdempotencyKey
	}
	if idempotencyKey == "" {
		return nil, codedErr(http.StatusBadRequest, "MISSING_IDEMPOTENCY_KEY", "idempotency key required")
	}
	cfg, err := s.loadPricingConfig(ctx, "default", req.ServiceType)
	if err != nil {
		return nil, err
	}
	route, err := s.maps.Route(ctx,
		LatLng{Lat: req.Pickup.Lat, Lng: req.Pickup.Lng},
		LatLng{Lat: req.Dest.Lat, Lng: req.Dest.Lng},
	)
	if err != nil {
		return nil, err
	}
	systemFare := SystemFare(route.DistanceM, route.DurationS, cfg)

	// Determine the escrow amount + initial phase.
	escrowKobo := systemFare
	phase := PhaseRequested
	offerStatus := "pending"
	if req.PricingMode == "offer" {
		if req.OfferKobo <= 0 {
			return nil, codedErr(http.StatusBadRequest, "MISSING_OFFER", "offer_kobo required in offer mode")
		}
		// Validate range; profit floor is enforced when a driver accepts.
		if err := validateFareInRange(req.OfferKobo, systemFare, cfg); err != nil {
			return nil, err
		}
		escrowKobo = req.OfferKobo
		phase = PhaseFareNegotiating
		offerStatus = "rider_offered"
	}

	serviceType := req.ServiceType
	if serviceType == "" {
		serviceType = "ride_hailing"
	}
	paymentMethod := req.PaymentMethod
	if paymentMethod == "" {
		paymentMethod = "wallet"
	}

	tripID := uuid.New().String()
	ref := "trip:" + tripID
	sett, err := s.settlement.Escrow(ctx, riderID, ref, idempotencyKey, "transport", escrowKobo)
	if err != nil {
		return nil, fmt.Errorf("transport: escrow fare: %w", err)
	}

	pin := generatePin()
	const q = `
		INSERT INTO trips
			(id, rider_id, pickup_address, dest_address, fare_kobo, status, phase,
			 service_type, pricing_mode, payment_method, pickup_lat, pickup_lng, dest_lat, dest_lng,
			 distance_m, duration_s, fare_estimate_kobo, route_polyline, trip_pin, idempotency_key, settlement_id)
		VALUES ($1,$2,$3,$4,$5,'requested',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`
	if _, err := s.db.Exec(ctx, q,
		tripID, riderID, req.Pickup.Address, req.Dest.Address, escrowKobo, string(phase),
		serviceType, req.PricingMode, paymentMethod, req.Pickup.Lat, req.Pickup.Lng, req.Dest.Lat, req.Dest.Lng,
		route.DistanceM, route.DurationS, systemFare, route.Polyline, pin, idempotencyKey, sett.ID,
	); err != nil {
		return nil, fmt.Errorf("transport: insert trip: %w", err)
	}

	// Open a fare offer record (negotiation ledger for this trip).
	var riderOffer *int64
	if req.PricingMode == "offer" {
		riderOffer = &req.OfferKobo
	}
	if _, err := s.db.Exec(ctx,
		`INSERT INTO fare_offers (trip_id, system_fare_kobo, rider_offer_kobo, status, expires_at)
		 VALUES ($1,$2,$3,$4,$5)`,
		tripID, systemFare, riderOffer, offerStatus, time.Now().Add(5*time.Minute),
	); err != nil {
		return nil, fmt.Errorf("transport: insert fare offer: %w", err)
	}

	s.recordEvent(ctx, tripID, "requested", riderID, "", phase, map[string]any{"escrow_kobo": escrowKobo, "mode": req.PricingMode})
	return s.TripDetail(ctx, tripID, riderID, true)
}

// RiderOffer records a new rider offer on a trip in negotiation.
func (s *Service) RiderOffer(ctx context.Context, tripID, riderID string, offer int64) (*FareOffer, error) {
	var t tripRow
	if err := s.loadTrip(ctx, tripID, &t); err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "trip not found")
	}
	if t.RiderID != riderID {
		return nil, codedErr(http.StatusForbidden, CodeForbidden, "not your trip")
	}
	if t.Phase != PhaseRequested && t.Phase != PhaseFareNegotiating {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "trip not open for offers")
	}
	cfg, err := s.loadPricingConfig(ctx, "default", t.ServiceType)
	if err != nil {
		return nil, err
	}
	var systemFare int64
	if t.FareEstimate != nil {
		systemFare = *t.FareEstimate
	}
	if err := validateFareInRange(offer, systemFare, cfg); err != nil {
		return nil, err
	}

	// Re-escrow the delta if the new offer raises the held amount.
	if err := s.adjustEscrow(ctx, &t, offer); err != nil {
		return nil, err
	}

	if _, err := s.db.Exec(ctx,
		`UPDATE fare_offers SET rider_offer_kobo=$1, status='rider_offered', updated_at=NOW()
		 WHERE trip_id=$2 AND status NOT IN ('accepted','rejected','expired')`,
		offer, tripID); err != nil {
		return nil, err
	}
	if t.Phase == PhaseRequested {
		s.db.Exec(ctx, `UPDATE trips SET phase='fare_negotiating', updated_at=NOW() WHERE id=$1 AND phase='requested'`, tripID)
		s.recordEvent(ctx, tripID, "fare_negotiating", riderID, PhaseRequested, PhaseFareNegotiating, nil)
	}
	s.db.Exec(ctx, `UPDATE trips SET fare_kobo=$1 WHERE id=$2`, offer, tripID)
	return s.loadFareOffer(ctx, tripID)
}

// AcceptCounter accepts the driver's counter-offer: re-escrows the delta and
// re-validates the driver-profit floor before locking the fare.
func (s *Service) AcceptCounter(ctx context.Context, tripID, riderID string) (*FareOffer, error) {
	var t tripRow
	if err := s.loadTrip(ctx, tripID, &t); err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "trip not found")
	}
	if t.RiderID != riderID {
		return nil, codedErr(http.StatusForbidden, CodeForbidden, "not your trip")
	}
	fo, err := s.loadFareOffer(ctx, tripID)
	if err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "no fare offer")
	}
	if fo.DriverCounterKobo == nil {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "no driver counter to accept")
	}
	accepted := *fo.DriverCounterKobo
	cfg, err := s.loadPricingConfig(ctx, "default", t.ServiceType)
	if err != nil {
		return nil, err
	}
	// Re-check profit floor at acceptance (driver tier may have changed).
	tier := "standard"
	if t.DriverID != nil {
		s.db.QueryRow(ctx, `SELECT commission_tier FROM drivers WHERE id=$1`, *t.DriverID).Scan(&tier)
	}
	if err := s.validateAcceptedFare(ctx, accepted, fo.SystemFareKobo, tier, cfg); err != nil {
		return nil, err
	}
	if err := s.adjustEscrow(ctx, &t, accepted); err != nil {
		return nil, err
	}
	s.db.Exec(ctx, `UPDATE fare_offers SET accepted_fare_kobo=$1, status='accepted', updated_at=NOW() WHERE trip_id=$2`, accepted, tripID)
	s.db.Exec(ctx, `UPDATE trips SET fare_kobo=$1, final_fare_kobo=$1 WHERE id=$2`, accepted, tripID)
	s.recordEvent(ctx, tripID, "counter_accepted", riderID, t.Phase, t.Phase, map[string]any{"accepted_kobo": accepted})
	return s.loadFareOffer(ctx, tripID)
}

// adjustEscrow escrows the positive delta when newFare > currently-held amount.
// Lowering the fare is allowed but the surplus stays in escrow and is settled to
// the rider on completion via the standard split (no partial de-escrow needed).
func (s *Service) adjustEscrow(ctx context.Context, t *tripRow, newFare int64) error {
	var held int64
	s.db.QueryRow(ctx, `SELECT COALESCE(SUM(total_kobo),0) FROM settlements WHERE reference LIKE $1 AND status='escrowed'`, "trip:"+t.ID+"%").Scan(&held)
	delta := newFare - held
	if delta <= 0 {
		return nil
	}
	deltaRef := fmt.Sprintf("trip:%s:delta:%d", t.ID, time.Now().UnixNano())
	idem := deltaRef // natural uniqueness
	if _, err := s.settlement.Escrow(ctx, t.RiderID, deltaRef, idem, "transport", delta); err != nil {
		return fmt.Errorf("transport: escrow delta: %w", err)
	}
	return nil
}

// CancelRide refunds escrow and moves the trip to cancelled (guarded).
func (s *Service) CancelRide(ctx context.Context, tripID, riderID, reason string) error {
	var t tripRow
	if err := s.loadTrip(ctx, tripID, &t); err != nil {
		return codedErr(http.StatusNotFound, CodeNotFound, "trip not found")
	}
	if t.RiderID != riderID {
		return codedErr(http.StatusForbidden, CodeForbidden, "not your trip")
	}
	if !canTransition(t.Phase, PhaseCancelled) {
		return codedErr(http.StatusConflict, CodeInvalidState, fmt.Sprintf("cannot cancel from phase %s", t.Phase))
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := s.transitionPhase(ctx, tx, tripID, riderID, t.Phase, PhaseCancelled, "cancelled", map[string]any{"reason": reason}); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE trips SET cancel_reason=$1 WHERE id=$2`, reason, tripID); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	// Refund all escrowed settlements for this trip.
	s.refundTrip(ctx, &t, "trip_cancelled")
	if t.DriverID != nil {
		s.db.Exec(ctx, `UPDATE drivers SET status='online', cancelled_trips=cancelled_trips+1, updated_at=NOW() WHERE id=$1`, *t.DriverID)
	}
	return nil
}

func (s *Service) refundTrip(ctx context.Context, t *tripRow, reason string) {
	rows, err := s.db.Query(ctx, `SELECT id FROM settlements WHERE reference LIKE $1 AND status='escrowed'`, "trip:"+t.ID+"%")
	if err != nil {
		return
	}
	var ids []string
	for rows.Next() {
		var id string
		rows.Scan(&id)
		ids = append(ids, id)
	}
	rows.Close()
	for _, id := range ids {
		s.settlement.Refund(ctx, id, reason)
	}
}

func (s *Service) loadFareOffer(ctx context.Context, tripID string) (*FareOffer, error) {
	const q = `
		SELECT id, trip_id, system_fare_kobo, rider_offer_kobo, driver_counter_kobo,
		       accepted_fare_kobo, status, expires_at, created_at
		FROM fare_offers WHERE trip_id=$1 ORDER BY created_at DESC LIMIT 1`
	var fo FareOffer
	if err := s.db.QueryRow(ctx, q, tripID).Scan(
		&fo.ID, &fo.TripID, &fo.SystemFareKobo, &fo.RiderOfferKobo, &fo.DriverCounterKobo,
		&fo.AcceptedFareKobo, &fo.Status, &fo.ExpiresAt, &fo.CreatedAt,
	); err != nil {
		return nil, err
	}
	return &fo, nil
}

// tripDetail is the rider/driver-facing view of a trip.
type tripDetail struct {
	Trip      map[string]any `json:"trip"`
	Driver    map[string]any `json:"driver,omitempty"`
	Vehicle   map[string]any `json:"vehicle,omitempty"`
	FareOffer *FareOffer     `json:"fare_offer,omitempty"`
}

// TripDetail returns the full trip view. When includePin is true (rider view),
// the trip PIN is exposed; the driver view hides it (driver verifies, not reads).
func (s *Service) TripDetail(ctx context.Context, tripID, callerID string, includePin bool) (*tripDetail, error) {
	const q = `
		SELECT id, rider_id, driver_id, pickup_address, dest_address, phase, status,
		       service_type, pricing_mode, payment_method, fare_kobo, fare_estimate_kobo,
		       final_fare_kobo, distance_m, duration_s, route_polyline, trip_pin, safety_status, created_at
		FROM trips WHERE id=$1`
	var (
		id, riderID, pickup, dest, phase, status, svc, mode, pay, safety string
		driverID, polyline, pin                                          *string
		fare                                                             int64
		estimate, finalFare                                              *int64
		distM, durS                                                      *int
		createdAt                                                        time.Time
	)
	if err := s.db.QueryRow(ctx, q, tripID).Scan(
		&id, &riderID, &driverID, &pickup, &dest, &phase, &status, &svc, &mode, &pay,
		&fare, &estimate, &finalFare, &distM, &durS, &polyline, &pin, &safety, &createdAt,
	); err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "trip not found")
	}

	// Object-level authz: only the rider or the assigned driver may view.
	if callerID != riderID {
		if driverID == nil {
			return nil, codedErr(http.StatusForbidden, CodeForbidden, "not permitted")
		}
		var ownerUser string
		s.db.QueryRow(ctx, `SELECT user_id FROM drivers WHERE id=$1`, *driverID).Scan(&ownerUser)
		if ownerUser != callerID {
			return nil, codedErr(http.StatusForbidden, CodeForbidden, "not permitted")
		}
	}

	trip := map[string]any{
		"id": id, "rider_id": riderID, "pickup_address": pickup, "dest_address": dest,
		"phase": phase, "status": status, "service_type": svc, "pricing_mode": mode,
		"payment_method": pay, "fare_kobo": fare, "fare_estimate_kobo": estimate,
		"final_fare_kobo": finalFare, "distance_m": distM, "duration_s": durS,
		"route_polyline": polyline, "safety_status": safety, "created_at": createdAt,
	}
	if includePin && callerID == riderID && pin != nil {
		trip["trip_pin"] = *pin
	}

	detail := &tripDetail{Trip: trip}
	if driverID != nil {
		dm := map[string]any{}
		var dname string
		var drating float64
		var dphone, dphoto *string
		s.db.QueryRow(ctx, `SELECT name, rating, phone, photo_url FROM drivers WHERE id=$1`, *driverID).Scan(&dname, &drating, &dphone, &dphoto)
		dm["id"] = *driverID
		dm["name"] = dname
		dm["rating"] = drating
		dm["phone"] = dphone
		dm["photo_url"] = dphoto
		detail.Driver = dm

		vm := map[string]any{}
		var plate, vmake, vmodel, vcolor, vcat *string
		if err := s.db.QueryRow(ctx, `SELECT plate_number, make, model, color, category FROM vehicles WHERE driver_id=$1 ORDER BY created_at DESC LIMIT 1`, *driverID).Scan(&plate, &vmake, &vmodel, &vcolor, &vcat); err == nil {
			vm["plate_number"] = plate
			vm["make"] = vmake
			vm["model"] = vmodel
			vm["color"] = vcolor
			vm["category"] = vcat
			detail.Vehicle = vm
		}
	}
	if fo, err := s.loadFareOffer(ctx, tripID); err == nil {
		detail.FareOffer = fo
	}
	return detail, nil
}

// ActiveRide returns the rider's current non-terminal trip, if any.
func (s *Service) ActiveRide(ctx context.Context, riderID string) (*tripDetail, error) {
	var tripID string
	const q = `
		SELECT id FROM trips
		WHERE rider_id=$1 AND phase NOT IN ('completed','cancelled','no_show')
		ORDER BY created_at DESC LIMIT 1`
	if err := s.db.QueryRow(ctx, q, riderID).Scan(&tripID); err != nil {
		return nil, nil // no active trip
	}
	return s.TripDetail(ctx, tripID, riderID, true)
}

// History returns the rider's past trips.
func (s *Service) History(ctx context.Context, riderID string) ([]map[string]any, error) {
	const q = `
		SELECT id, pickup_address, dest_address, phase, status, fare_kobo, final_fare_kobo, created_at
		FROM trips WHERE rider_id=$1 ORDER BY created_at DESC LIMIT 100`
	rows, err := s.db.Query(ctx, q, riderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, pickup, dest, phase, status string
		var fare int64
		var finalFare *int64
		var createdAt time.Time
		if err := rows.Scan(&id, &pickup, &dest, &phase, &status, &fare, &finalFare, &createdAt); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"id": id, "pickup_address": pickup, "dest_address": dest, "phase": phase,
			"status": status, "fare_kobo": fare, "final_fare_kobo": finalFare, "created_at": createdAt,
		})
	}
	return out, nil
}
