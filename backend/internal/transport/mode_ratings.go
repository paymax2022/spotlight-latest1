package transport

import (
	"context"
	"fmt"
	"net/http"

	"github.com/google/uuid"
)

// Multi-modal ratings (parcel / towing / movers).
//
// trip_ratings.trip_id has an FK to trips(id); parcel/towing/mover ids are not
// trips, so they are recorded in the additive mode_ratings table instead
// (mode + free-text job_id, no FK). The pattern otherwise mirrors RateTrip:
// the customer rates the provider on a finished job, a tip (optional) is
// escrowed and settled 100% to the provider, and the provider's aggregate
// drivers.rating is recomputed. ratee_id is the provider's auth user id.

// rateMode records a customer→provider rating for a finished mode job and
// recomputes the provider's aggregate rating. providerUserID must be the
// provider's auth.users id (resolved from drivers.user_id by the caller).
func (s *Service) rateMode(ctx context.Context, mode, jobID, raterID, providerUserID string, req RateRequest) (*TripRating, error) {
	return s.rateModeCore(ctx, mode, jobID, raterID, providerUserID, req, func(ctx context.Context) {
		s.recomputeModeRating(ctx, providerUserID)
	})
}

// rateModeCore is the shared rating money path for every provider type. The
// `recompute` callback updates the provider-type-specific aggregate (drivers.rating
// for driver modes, bus_providers.rating_avg for bus) — it runs BEFORE the optional
// tip so the rating persists independently of the tip's money path.
func (s *Service) rateModeCore(ctx context.Context, mode, jobID, raterID, providerUserID string, req RateRequest, recompute func(context.Context)) (*TripRating, error) {
	if providerUserID == "" {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "no provider to rate")
	}
	r := &TripRating{
		ID:      uuid.New().String(),
		TripID:  jobID,
		RaterID: raterID,
		RateeID: providerUserID,
		Role:    "rider", // customer rating the provider
		Stars:   req.Stars,
		Comment: req.Comment,
		TipKobo: req.TipKobo,
	}
	if _, err := s.db.Exec(ctx, `
		INSERT INTO mode_ratings (id, mode, job_id, rater_id, ratee_id, stars, comment, tip_kobo)
		VALUES ($1,$2,$3,$4,$5,$6,NULLIF($7,''),$8)
		ON CONFLICT (mode, job_id, rater_id) DO NOTHING`,
		r.ID, mode, jobID, raterID, providerUserID, req.Stars, req.Comment, req.TipKobo); err != nil {
		return nil, err
	}

	// The rating is durably persisted above; recompute the aggregate first so the
	// rating always succeeds independently of the tip money path.
	recompute(ctx)

	// Tip: escrow from rater, settle 100% to the provider (no commission on tips).
	// This is a MONEY MUTATION — do not swallow errors, and gate it fail-closed on
	// the rider's tier/daily-spend limit before any wallet escrow. tipRef is a
	// stable idempotency key, so a retried tip cannot double-charge.
	if req.TipKobo > 0 {
		if err := s.enforceTierLimit(ctx, raterID, req.TipKobo); err != nil {
			return r, err
		}
		tipRef := mode + ":" + jobID + ":tip"
		sett, err := s.settlement.Escrow(ctx, raterID, tipRef, tipRef, "transport", req.TipKobo)
		if err != nil {
			return r, fmt.Errorf("transport: mode tip escrow failed (rating saved): %w", err)
		}
		if err := s.settleTipDirect(ctx, sett.ID, providerUserID); err != nil {
			return r, fmt.Errorf("transport: mode tip settlement failed (rating saved, tip escrowed — reconcile settlement %s): %w", sett.ID, err)
		}
	}

	s.recordModeEvent(ctx, raterID, mode+".rated", mode+"_job", jobID, "", "rated",
		map[string]any{"stars": req.Stars, "ratee_id": providerUserID})
	return r, nil
}

// recomputeModeRating recalculates a provider's aggregate drivers.rating across
// all received mode ratings (parcel/towing/mover).
func (s *Service) recomputeModeRating(ctx context.Context, providerUserID string) {
	var avg float64
	s.db.QueryRow(ctx,
		`SELECT COALESCE(AVG(stars),5.0) FROM mode_ratings WHERE ratee_id=$1`, providerUserID).Scan(&avg)
	s.db.Exec(ctx, `UPDATE drivers SET rating=$1, updated_at=NOW() WHERE user_id=$2`, avg, providerUserID)
}

// providerUserID resolves a driver row id to its owning auth user id.
func (s *Service) providerUserID(ctx context.Context, driverID string) string {
	var userID string
	s.db.QueryRow(ctx, `SELECT user_id FROM drivers WHERE id=$1`, driverID).Scan(&userID)
	return userID
}

// RateParcel: the sender rates the courier on a delivered parcel.
func (s *Service) RateParcel(ctx context.Context, id, raterID string, req RateRequest) (*TripRating, error) {
	var p parcelRow
	if err := s.loadParcel(ctx, id, &p); err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "parcel not found")
	}
	if p.SenderID != raterID {
		return nil, codedErr(http.StatusForbidden, CodeForbidden, "not your parcel")
	}
	if p.Status != "delivered" {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "parcel not delivered")
	}
	if p.CourierID == nil {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "no courier to rate")
	}
	return s.rateMode(ctx, "parcel", id, raterID, s.providerUserID(ctx, *p.CourierID), req)
}

// RateTowing: the user rates the operator on a completed tow.
func (s *Service) RateTowing(ctx context.Context, id, raterID string, req RateRequest) (*TripRating, error) {
	var t towingRow
	if err := s.loadTowing(ctx, id, &t); err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "towing job not found")
	}
	if t.UserID != raterID {
		return nil, codedErr(http.StatusForbidden, CodeForbidden, "not your job")
	}
	if t.Status != "completed" {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "towing job not completed")
	}
	if t.OperatorID == nil {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "no operator to rate")
	}
	return s.rateMode(ctx, "towing", id, raterID, s.providerUserID(ctx, *t.OperatorID), req)
}

// RateMover: the customer rates the provider on a confirmed/completed move.
func (s *Service) RateMover(ctx context.Context, id, raterID string, req RateRequest) (*TripRating, error) {
	var m moverRow
	if err := s.loadMover(ctx, id, &m); err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "mover job not found")
	}
	if m.UserID != raterID {
		return nil, codedErr(http.StatusForbidden, CodeForbidden, "not your job")
	}
	if m.Status != "completion_confirmed" {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "move not completed")
	}
	if m.ProviderID == nil {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "no provider to rate")
	}
	return s.rateMode(ctx, "mover", id, raterID, s.providerUserID(ctx, *m.ProviderID), req)
}

// RateBusTrip: a passenger rates the bus operator after a completed/boarded trip.
// Keyed on the ticket (one rating per ticket per rater). The operator is resolved
// ticket→schedule→route→provider; the rating recomputes the operator's aggregate
// bus_providers.rating_avg / rating_count (which drives the trust/verified surface).
func (s *Service) RateBusTrip(ctx context.Context, ticketID, raterID string, req RateRequest) (*TripRating, error) {
	var userID, scheduleID, status string
	if err := s.db.QueryRow(ctx,
		`SELECT user_id, schedule_id, status FROM bus_tickets WHERE id=$1`, ticketID).
		Scan(&userID, &scheduleID, &status); err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "ticket not found")
	}
	if userID != raterID {
		return nil, codedErr(http.StatusForbidden, CodeForbidden, "not your ticket")
	}
	if status != "completed" && status != "boarded" {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "trip not completed")
	}
	var providerID, ownerUserID string
	if err := s.db.QueryRow(ctx, `
		SELECT p.id, p.owner_user_id
		FROM bus_schedules s
		JOIN bus_routes r    ON r.id = s.route_id
		JOIN bus_providers p ON p.id = r.provider_id
		WHERE s.id=$1`, scheduleID).Scan(&providerID, &ownerUserID); err != nil {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "no operator to rate")
	}
	return s.rateModeCore(ctx, "bus", ticketID, raterID, ownerUserID, req, func(ctx context.Context) {
		s.recomputeBusRating(ctx, providerID, ownerUserID)
	})
}

// recomputeBusRating recalculates a bus operator's aggregate rating_avg + rating_count
// from all received 'bus' mode_ratings (ratee = the operator's owner user id).
func (s *Service) recomputeBusRating(ctx context.Context, providerID, ownerUserID string) {
	var avg float64
	var cnt int
	s.db.QueryRow(ctx,
		`SELECT COALESCE(AVG(stars),0), COUNT(*) FROM mode_ratings WHERE ratee_id=$1 AND mode='bus'`,
		ownerUserID).Scan(&avg, &cnt)
	s.db.Exec(ctx, `UPDATE bus_providers SET rating_avg=$1, rating_count=$2, updated_at=NOW() WHERE id=$3`,
		avg, cnt, providerID)
}

// BusSeatMap returns the seat map for a schedule: total seats plus the set of
// taken (issued, non-cancelled/non-refunded) seat numbers and the available
// count. Mirrors the ListBusSchedules query style.
func (s *Service) BusSeatMap(ctx context.Context, scheduleID string) (map[string]any, error) {
	var totalSeats int
	if err := s.db.QueryRow(ctx,
		`SELECT total_seats FROM bus_schedules WHERE id=$1`, scheduleID).Scan(&totalSeats); err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "schedule not found")
	}
	rows, err := s.db.Query(ctx, `
		SELECT seat_number FROM bus_tickets
		WHERE schedule_id=$1 AND status NOT IN ('cancelled','refunded')
		ORDER BY seat_number`, scheduleID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	taken := []int{}
	for rows.Next() {
		var seat int
		if err := rows.Scan(&seat); err != nil {
			return nil, err
		}
		taken = append(taken, seat)
	}
	available := totalSeats - len(taken)
	if available < 0 {
		available = 0
	}
	return map[string]any{
		"schedule_id": scheduleID,
		"total_seats": totalSeats,
		"taken":       taken,
		"available":   available,
	}, nil
}
