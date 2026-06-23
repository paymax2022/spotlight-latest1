package transport

import (
	"context"
	"net/http"

	"github.com/google/uuid"
)

// RateTrip records a bidirectional rating + optional tip. The rater must be a
// participant of the trip and the trip must be completed. The ratee's aggregate
// rating is recomputed; a tip is escrowed+settled directly to the driver.
func (s *Service) RateTrip(ctx context.Context, tripID, raterID string, req RateRequest) (*TripRating, error) {
	var t tripRow
	if err := s.loadTrip(ctx, tripID, &t); err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "trip not found")
	}
	if t.Phase != PhaseCompleted {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "trip not completed")
	}

	// Determine role + ratee.
	var role, rateeID string
	var driverUserID string
	if t.DriverID != nil {
		s.db.QueryRow(ctx, `SELECT user_id FROM drivers WHERE id=$1`, *t.DriverID).Scan(&driverUserID)
	}
	switch raterID {
	case t.RiderID:
		role = "rider" // a rider is rating the driver
		rateeID = driverUserID
	case driverUserID:
		role = "driver" // a driver is rating the rider
		rateeID = t.RiderID
	default:
		return nil, codedErr(http.StatusForbidden, CodeForbidden, "not a trip participant")
	}
	if rateeID == "" {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "no counterparty to rate")
	}

	r := &TripRating{ID: uuid.New().String(), TripID: tripID, RaterID: raterID, RateeID: rateeID, Role: role, Stars: req.Stars, Comment: req.Comment, TipKobo: req.TipKobo}
	if _, err := s.db.Exec(ctx, `
		INSERT INTO trip_ratings (id, trip_id, rater_id, ratee_id, role, stars, comment, tip_kobo)
		VALUES ($1,$2,$3,$4,$5,$6,NULLIF($7,''),$8)
		ON CONFLICT (trip_id, rater_id) DO NOTHING`,
		r.ID, tripID, raterID, rateeID, role, req.Stars, req.Comment, req.TipKobo); err != nil {
		return nil, err
	}

	// Tip: escrow from rater, settle 100% to the driver (no commission on tips).
	if req.TipKobo > 0 && role == "rider" && driverUserID != "" {
		tipRef := "trip:" + tripID + ":tip"
		if sett, err := s.settlement.Escrow(ctx, raterID, tipRef, tipRef, "transport", req.TipKobo); err == nil {
			s.settleTipDirect(ctx, sett.ID, driverUserID)
		}
	}

	s.recomputeRating(ctx, rateeID, role)
	return r, nil
}

// settleTipDirect releases a tip escrow 100% to the driver.
func (s *Service) settleTipDirect(ctx context.Context, settlementID, driverUserID string) {
	// 100% provider, 0% platform — tips are not commissioned.
	s.settlement.Settle(ctx, settlementID, settlementSplitAllProvider(driverUserID))
}

// recomputeRating recalculates a ratee's average rating from their received
// ratings and writes it back to drivers (when rated as driver) or
// mobility_profiles (when rated as rider).
func (s *Service) recomputeRating(ctx context.Context, rateeID, raterRole string) {
	// raterRole 'rider' means the ratee is a driver; 'driver' means ratee is a rider.
	var avg float64
	if raterRole == "rider" {
		s.db.QueryRow(ctx, `SELECT COALESCE(AVG(stars),5.0) FROM trip_ratings WHERE ratee_id=$1 AND role='rider'`, rateeID).Scan(&avg)
		s.db.Exec(ctx, `UPDATE drivers SET rating=$1, updated_at=NOW() WHERE user_id=$2`, avg, rateeID)
	} else {
		s.db.QueryRow(ctx, `SELECT COALESCE(AVG(stars),5.0) FROM trip_ratings WHERE ratee_id=$1 AND role='driver'`, rateeID).Scan(&avg)
		s.db.Exec(ctx, `UPDATE mobility_profiles SET rating=$1, updated_at=NOW() WHERE user_id=$2`, avg, rateeID)
	}
}
