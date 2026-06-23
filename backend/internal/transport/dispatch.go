package transport

import (
	"context"
	"math"
	"net/http"
	"time"
)

// nearbyDriver is a dispatch candidate.
type nearbyDriver struct {
	DriverID   string   `json:"driver_id"`
	UserID     string   `json:"user_id"`
	Name       string   `json:"name"`
	Rating     float64  `json:"rating"`
	DistanceM  float64  `json:"distance_m"`
	CurrentLat *float64 `json:"current_lat,omitempty"`
	CurrentLng *float64 `json:"current_lng,omitempty"`
}

// NearbyDrivers returns approved, online drivers within radiusM of a point.
func (s *Service) NearbyDrivers(ctx context.Context, lat, lng float64, radiusM float64) ([]nearbyDriver, error) {
	const q = `
		SELECT id, user_id, name, rating, current_lat, current_lng
		FROM drivers
		WHERE status='online' AND verification_status='approved'
		  AND current_lat IS NOT NULL AND current_lng IS NOT NULL`
	rows, err := s.db.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []nearbyDriver
	for rows.Next() {
		var d nearbyDriver
		if err := rows.Scan(&d.DriverID, &d.UserID, &d.Name, &d.Rating, &d.CurrentLat, &d.CurrentLng); err != nil {
			return nil, err
		}
		dist := haversineM(LatLng{Lat: lat, Lng: lng}, LatLng{Lat: *d.CurrentLat, Lng: *d.CurrentLng})
		if dist <= radiusM {
			d.DistanceM = dist
			out = append(out, d)
		}
	}
	return out, nil
}

// OpenRequests returns open ride requests visible to a driver (dispatch feed).
func (s *Service) OpenRequests(ctx context.Context, driverUserID string) ([]map[string]any, error) {
	const q = `
		SELECT id, pickup_address, dest_address, pickup_lat, pickup_lng, dest_lat, dest_lng,
		       fare_kobo, fare_estimate_kobo, pricing_mode, phase, distance_m, duration_s, created_at
		FROM trips
		WHERE driver_id IS NULL AND phase IN ('requested','fare_negotiating')
		ORDER BY created_at DESC LIMIT 50`
	rows, err := s.db.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, pickup, dest, mode, phase string
		var plat, plng, dlat, dlng *float64
		var fare int64
		var est *int64
		var distM, durS *int
		var createdAt time.Time
		if err := rows.Scan(&id, &pickup, &dest, &plat, &plng, &dlat, &dlng, &fare, &est, &mode, &phase, &distM, &durS, &createdAt); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"id": id, "pickup_address": pickup, "dest_address": dest,
			"pickup": map[string]any{"lat": plat, "lng": plng},
			"dest":   map[string]any{"lat": dlat, "lng": dlng},
			"fare_kobo": fare, "fare_estimate_kobo": est, "pricing_mode": mode,
			"phase": phase, "distance_m": distM, "duration_s": durS, "created_at": createdAt,
		})
	}
	return out, nil
}

// DriverAccept assigns a driver to a request at the current fare, enforcing the
// driver-profit floor, then moves the trip to driver_assigned.
func (s *Service) DriverAccept(ctx context.Context, tripID, driverUserID string) (*tripDetail, error) {
	driverID, err := s.driverGate(ctx, driverUserID)
	if err != nil {
		return nil, err
	}
	var t tripRow
	if err := s.loadTrip(ctx, tripID, &t); err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "trip not found")
	}
	if t.Phase != PhaseRequested && t.Phase != PhaseFareNegotiating {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "trip not open for acceptance")
	}
	fo, _ := s.loadFareOffer(ctx, tripID)
	var systemFare, accepted int64
	if fo != nil {
		systemFare = fo.SystemFareKobo
	}
	// Accept at the rider's standing fare (offer if present, else system fare).
	var fareKobo int64
	s.db.QueryRow(ctx, `SELECT fare_kobo FROM trips WHERE id=$1`, tripID).Scan(&fareKobo)
	accepted = fareKobo
	cfg, err := s.loadPricingConfig(ctx, "default", t.ServiceType)
	if err != nil {
		return nil, err
	}
	var tier string
	s.db.QueryRow(ctx, `SELECT commission_tier FROM drivers WHERE id=$1`, driverID).Scan(&tier)
	if err := s.validateAcceptedFare(ctx, accepted, systemFare, tier, cfg); err != nil {
		return nil, err
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	// Single-winner: the conditional UPDATE (driver_id IS NULL) is an atomic
	// compare-and-set. If a concurrent driver already claimed the trip, this
	// affects 0 rows — we MUST reject here (a 0-row UPDATE returns no error), or
	// two drivers would both be told they won the same trip.
	tag, err := tx.Exec(ctx, `UPDATE trips SET driver_id=$1, final_fare_kobo=$2 WHERE id=$3 AND driver_id IS NULL`, driverID, accepted, tripID)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "trip already accepted by another driver")
	}
	if err := s.transitionPhase(ctx, tx, tripID, driverUserID, t.Phase, PhaseDriverAssigned, "accepted", map[string]any{"accepted_kobo": accepted}); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `UPDATE fare_offers SET accepted_fare_kobo=$1, status='accepted', updated_at=NOW() WHERE trip_id=$2`, accepted, tripID); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	s.db.Exec(ctx, `UPDATE drivers SET status='on_trip', updated_at=NOW() WHERE id=$1`, driverID)
	return s.TripDetail(ctx, tripID, driverUserID, false)
}

// DriverCounter records a driver counter-offer, validating range + profit floor.
func (s *Service) DriverCounter(ctx context.Context, tripID, driverUserID string, counter int64) (*FareOffer, error) {
	driverID, err := s.driverGate(ctx, driverUserID)
	if err != nil {
		return nil, err
	}
	var t tripRow
	if err := s.loadTrip(ctx, tripID, &t); err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "trip not found")
	}
	if t.Phase != PhaseRequested && t.Phase != PhaseFareNegotiating {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "trip not open for counter")
	}
	fo, err := s.loadFareOffer(ctx, tripID)
	if err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "no fare offer")
	}
	cfg, err := s.loadPricingConfig(ctx, "default", t.ServiceType)
	if err != nil {
		return nil, err
	}
	var tier string
	s.db.QueryRow(ctx, `SELECT commission_tier FROM drivers WHERE id=$1`, driverID).Scan(&tier)
	// Counter must be within range AND keep the driver above the profit floor.
	if err := s.validateAcceptedFare(ctx, counter, fo.SystemFareKobo, tier, cfg); err != nil {
		return nil, err
	}
	if t.Phase == PhaseRequested {
		s.db.Exec(ctx, `UPDATE trips SET phase='fare_negotiating', updated_at=NOW() WHERE id=$1 AND phase='requested'`, tripID)
		s.recordEvent(ctx, tripID, "fare_negotiating", driverUserID, PhaseRequested, PhaseFareNegotiating, nil)
	}
	s.db.Exec(ctx, `UPDATE fare_offers SET driver_counter_kobo=$1, status='driver_countered', updated_at=NOW() WHERE trip_id=$2`, counter, tripID)
	return s.loadFareOffer(ctx, tripID)
}

// driverGate resolves a driver and ensures they are approved.
func (s *Service) driverGate(ctx context.Context, userID string) (string, error) {
	var id, vstatus string
	if err := s.db.QueryRow(ctx, `SELECT id, verification_status FROM drivers WHERE user_id=$1`, userID).Scan(&id, &vstatus); err != nil {
		return "", codedErr(http.StatusForbidden, CodeForbidden, "not a registered driver")
	}
	if vstatus != "approved" {
		return "", codedErr(http.StatusForbidden, CodeNotApproved, "driver not approved")
	}
	return id, nil
}

// DriverArrive: driver_assigned → driver_arriving.
func (s *Service) DriverArrive(ctx context.Context, tripID, driverUserID string) error {
	return s.driverTransition(ctx, tripID, driverUserID, PhaseDriverAssigned, PhaseDriverArriving, "", "arrived")
}

// VerifyPin: driver_arriving → pin_verified, PIN must match.
func (s *Service) VerifyPin(ctx context.Context, tripID, driverUserID, pin string) error {
	t, err := s.driverOwnedTrip(ctx, tripID, driverUserID)
	if err != nil {
		return err
	}
	if t.TripPin == nil || *t.TripPin != pin {
		return codedErr(http.StatusUnprocessableEntity, CodePinMismatch, "trip PIN does not match")
	}
	return s.driverTransition(ctx, tripID, driverUserID, PhaseDriverArriving, PhasePinVerified, "", "pin_verified")
}

// StartTrip: pin_verified → in_progress.
func (s *Service) StartTrip(ctx context.Context, tripID, driverUserID string) error {
	if err := s.driverTransition(ctx, tripID, driverUserID, PhasePinVerified, PhaseInProgress, "picked_up", "started"); err != nil {
		return err
	}
	s.db.Exec(ctx, `UPDATE trips SET started_at=NOW() WHERE id=$1`, tripID)
	return nil
}

// CompleteTrip: in_progress → completed, then settle the fare split.
func (s *Service) CompleteTrip(ctx context.Context, tripID, driverUserID string) error {
	t, err := s.driverOwnedTrip(ctx, tripID, driverUserID)
	if err != nil {
		return err
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := s.transitionPhase(ctx, tx, tripID, driverUserID, t.Phase, PhaseCompleted, "completed", nil); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE trips SET completed_at=NOW() WHERE id=$1`, tripID); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	if err := s.settleTrip(ctx, t); err != nil {
		return err
	}
	if t.DriverID != nil {
		s.db.Exec(ctx, `UPDATE drivers SET status='online', completed_trips=completed_trips+1, updated_at=NOW() WHERE id=$1`, *t.DriverID)
	}
	// Bump rider completed-trip count.
	s.db.Exec(ctx, `UPDATE mobility_profiles SET completed_trips=completed_trips+1, updated_at=NOW() WHERE user_id=$1`, t.RiderID)
	return nil
}

// driverTransition: a guarded driver-initiated phase change with object authz.
func (s *Service) driverTransition(ctx context.Context, tripID, driverUserID string, from, to TripPhase, coarse, event string) error {
	t, err := s.driverOwnedTrip(ctx, tripID, driverUserID)
	if err != nil {
		return err
	}
	if t.Phase != from {
		return codedErr(http.StatusConflict, CodeInvalidState, "trip not in expected phase "+string(from))
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := s.transitionPhase(ctx, tx, tripID, driverUserID, from, to, coarse, nil); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// driverOwnedTrip loads a trip and asserts the caller is the assigned driver.
func (s *Service) driverOwnedTrip(ctx context.Context, tripID, driverUserID string) (*tripRow, error) {
	var t tripRow
	if err := s.loadTrip(ctx, tripID, &t); err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "trip not found")
	}
	if t.DriverID == nil {
		return nil, codedErr(http.StatusForbidden, CodeForbidden, "trip has no assigned driver")
	}
	var ownerUser string
	s.db.QueryRow(ctx, `SELECT user_id FROM drivers WHERE id=$1`, *t.DriverID).Scan(&ownerUser)
	if ownerUser != driverUserID {
		return nil, codedErr(http.StatusForbidden, CodeForbidden, "not the assigned driver")
	}
	return &t, nil
}

// Earnings summarises a driver's economic dashboard figures.
func (s *Service) Earnings(ctx context.Context, driverUserID string) (map[string]any, error) {
	var driverID, tier string
	var completed, cancelled int
	if err := s.db.QueryRow(ctx,
		`SELECT id, commission_tier, completed_trips, cancelled_trips FROM drivers WHERE user_id=$1`,
		driverUserID).Scan(&driverID, &tier, &completed, &cancelled); err != nil {
		return nil, codedErr(http.StatusForbidden, CodeForbidden, "not a registered driver")
	}
	comm, _ := s.commissionForTier(ctx, tier)
	// Gross / net from settled settlements attributable to this driver.
	var gross int64
	s.db.QueryRow(ctx, `
		SELECT COALESCE(SUM(s.total_kobo),0)
		FROM settlements s
		JOIN trips t ON ('trip:'||t.id) = s.reference OR s.reference LIKE ('trip:'||t.id||':%')
		WHERE t.driver_id=$1 AND s.status='settled'`, driverID).Scan(&gross)
	platformFee := int64(math.Round(float64(gross) * comm.PlatformPct))
	net := gross - platformFee
	total := completed + cancelled
	cancelRate := 0.0
	if total > 0 {
		cancelRate = float64(cancelled) / float64(total)
	}
	return map[string]any{
		"gross_kobo":       gross,
		"platform_fee_kobo": platformFee,
		"net_kobo":         net,
		"completed_trips":  completed,
		"cancelled_trips":  cancelled,
		"cancel_rate":      cancelRate,
		"commission_tier":  tier,
		"provider_pct":     comm.ProviderPct,
		"platform_pct":     comm.PlatformPct,
	}, nil
}
