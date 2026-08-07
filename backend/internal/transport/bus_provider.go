package transport

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
)

// ─── Bus PROVIDER MARKETPLACE ────────────────────────────────────────────────
//
// Interstate (state→state) bus marketplace layered additively over the existing
// admin bus catalog. A "provider" is the current user's bus_providers row
// (owner_user_id = user_id). Providers self-register, publish interstate routes
// (from_state <> to_state) with amenities + a base fare, and self-schedule
// departures. Customers search by state pair / provider and book seats; the
// booking money-path (BookBusTicket) settles the ROUTE's provider owner when a
// provider_id is set, else the legacy operator_id.
//
// Ownership guard: every provider mutation resolves the caller's provider row via
// owner_user_id and rejects (403) if the target route/provider is not theirs.

// ─── Request bodies (snake_case) ─────────────────────────────────────────────

// BusProviderRegisterRequest is POST /bus/provider/register.
type BusProviderRegisterRequest struct {
	BusinessName string `json:"business_name" binding:"required"`
	ContactPhone string `json:"contact_phone" binding:"required"`
	ContactEmail string `json:"contact_email"`
	BaseState    string `json:"base_state" binding:"required"`
	Description  string `json:"description"`
}

// BusProviderUpdateRequest is PATCH /bus/provider/me. All fields optional.
type BusProviderUpdateRequest struct {
	BusinessName *string `json:"business_name"`
	ContactPhone *string `json:"contact_phone"`
	ContactEmail *string `json:"contact_email"`
	LogoURL      *string `json:"logo_url"`
	Description  *string `json:"description"`
	BaseState    *string `json:"base_state"`
}

// BusProviderRouteRequest is POST /bus/provider/routes.
type BusProviderRouteRequest struct {
	FromState    string   `json:"from_state" binding:"required"`
	ToState      string   `json:"to_state" binding:"required"`
	FromCity     string   `json:"from_city"`
	ToCity       string   `json:"to_city"`
	BusType      string   `json:"bus_type"`
	BaseFareKobo int64    `json:"base_fare_kobo" binding:"required,min=0"`
	Amenities    []string `json:"amenities"`
}

// BusProviderRoutePatchRequest is PATCH /bus/provider/routes/:id. All optional.
type BusProviderRoutePatchRequest struct {
	FromCity     *string  `json:"from_city"`
	ToCity       *string  `json:"to_city"`
	BusType      *string  `json:"bus_type"`
	BaseFareKobo *int64   `json:"base_fare_kobo"`
	Amenities    []string `json:"amenities"`
	Active       *bool    `json:"active"`
}

// BusProviderScheduleRequest is POST /bus/provider/routes/:id/schedules.
type BusProviderScheduleRequest struct {
	DepartureTime string `json:"departure_time" binding:"required"` // RFC3339
	TotalSeats    int    `json:"total_seats" binding:"required,min=1,max=80"`
	FareKobo      int64  `json:"fare_kobo" binding:"required,min=0"`
}

// ─── Provider identity / ownership ───────────────────────────────────────────

// providerForUser resolves the caller's provider row id. Returns a 403 when the
// caller is not a provider — this is the ownership gate for all provider routes.
func (s *Service) providerForUser(ctx context.Context, userID string) (string, error) {
	var id string
	if err := s.db.QueryRow(ctx,
		`SELECT id FROM bus_providers WHERE owner_user_id=$1`, userID).Scan(&id); err != nil {
		return "", codedErr(http.StatusForbidden, CodeForbidden, "not a registered bus provider")
	}
	return id, nil
}

// RegisterBusProvider creates the caller's provider row. 409 if already a provider.
func (s *Service) RegisterBusProvider(ctx context.Context, userID string, req BusProviderRegisterRequest) (map[string]any, error) {
	var existing string
	if err := s.db.QueryRow(ctx, `SELECT id FROM bus_providers WHERE owner_user_id=$1`, userID).Scan(&existing); err == nil {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "already a registered bus provider")
	}
	id := uuid.New().String()
	slug := busProviderSlug(req.BusinessName, id)
	const q = `
		INSERT INTO bus_providers
			(id, owner_user_id, business_name, slug, contact_phone, contact_email, base_state, description)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`
	if _, err := s.db.Exec(ctx, q,
		id, userID, req.BusinessName, slug, req.ContactPhone,
		nullStr(req.ContactEmail), nullStr(req.BaseState), nullStr(req.Description),
	); err != nil {
		return nil, fmt.Errorf("transport: create bus provider: %w", err)
	}
	s.recordModeEvent(ctx, userID, "bus.provider.register", "bus_provider", id, "", "active",
		map[string]any{"business_name": req.BusinessName, "base_state": req.BaseState})
	return s.busProviderRow(ctx, id)
}

// busProviderRow returns a single provider (camelCase projection).
func (s *Service) busProviderRow(ctx context.Context, id string) (map[string]any, error) {
	const q = `
		SELECT id, owner_user_id, business_name, slug, contact_phone, contact_email, logo_url,
		       description, base_state, verification_status, status, rating_avg, rating_count, created_at
		FROM bus_providers WHERE id=$1`
	var (
		pid, ownerID, name, verStatus, status      string
		slug, phone, email, logo, descr, baseState *string
		ratingAvg                                  float64
		ratingCount                                int
		createdAt                                  time.Time
	)
	if err := s.db.QueryRow(ctx, q, id).Scan(
		&pid, &ownerID, &name, &slug, &phone, &email, &logo,
		&descr, &baseState, &verStatus, &status, &ratingAvg, &ratingCount, &createdAt,
	); err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "provider not found")
	}
	return map[string]any{
		"id": pid, "ownerUserId": ownerID, "businessName": name, "slug": slug,
		"contactPhone": phone, "contactEmail": email, "logoUrl": logo,
		"description": descr, "baseState": baseState,
		"verificationStatus": verStatus, "verified": verStatus == "verified",
		"status": status, "ratingAvg": ratingAvg, "ratingCount": ratingCount,
		"createdAt": createdAt,
	}, nil
}

// GetMyBusProvider returns { provider|null, routes, upcomingSchedules } for the
// caller. provider is null (200) when the caller is not a provider.
func (s *Service) GetMyBusProvider(ctx context.Context, userID string) (map[string]any, error) {
	providerID, err := s.providerForUser(ctx, userID)
	if err != nil {
		return map[string]any{"provider": nil, "routes": []any{}, "upcomingSchedules": []any{}}, nil
	}
	prov, err := s.busProviderRow(ctx, providerID)
	if err != nil {
		return nil, err
	}
	routes, err := s.listProviderRoutes(ctx, providerID)
	if err != nil {
		return nil, err
	}
	scheds, err := s.listProviderUpcomingSchedules(ctx, providerID)
	if err != nil {
		return nil, err
	}
	return map[string]any{"provider": prov, "routes": routes, "upcomingSchedules": scheds}, nil
}

// UpdateMyBusProvider patches mutable profile fields on the caller's provider row.
func (s *Service) UpdateMyBusProvider(ctx context.Context, userID string, req BusProviderUpdateRequest) (map[string]any, error) {
	providerID, err := s.providerForUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	const q = `
		UPDATE bus_providers SET
			business_name = COALESCE($2, business_name),
			contact_phone = COALESCE($3, contact_phone),
			contact_email = COALESCE($4, contact_email),
			logo_url      = COALESCE($5, logo_url),
			description   = COALESCE($6, description),
			base_state    = COALESCE($7, base_state),
			updated_at    = NOW()
		WHERE id=$1`
	if _, err := s.db.Exec(ctx, q, providerID,
		req.BusinessName, req.ContactPhone, req.ContactEmail, req.LogoURL, req.Description, req.BaseState,
	); err != nil {
		return nil, fmt.Errorf("transport: update bus provider: %w", err)
	}
	s.recordModeEvent(ctx, userID, "bus.provider.update", "bus_provider", providerID, "", "updated", nil)
	return s.busProviderRow(ctx, providerID)
}

// ─── Provider routes ─────────────────────────────────────────────────────────

// CreateProviderRoute inserts an interstate route owned by the caller's provider.
// Rejects from_state===to_state (interstate-only). Legacy NOT NULL columns
// origin_terminal/dest_terminal are populated from city (or state) so the shared
// bus_routes shape stays valid.
func (s *Service) CreateProviderRoute(ctx context.Context, userID string, req BusProviderRouteRequest) (map[string]any, error) {
	providerID, err := s.providerForUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	if sameState(req.FromState, req.ToState) {
		return nil, codedErr(http.StatusBadRequest, CodeInvalidState, "interstate route requires from_state and to_state to differ")
	}
	category := req.BusType
	if category == "" {
		category = "standard"
	}
	// Legacy NOT NULL terminals: prefer city, fall back to state.
	origin := firstNonEmpty(req.FromCity, req.FromState)
	dest := firstNonEmpty(req.ToCity, req.ToState)
	amenities, err := marshalAmenities(req.Amenities)
	if err != nil {
		return nil, err
	}
	id := uuid.New().String()
	const q = `
		INSERT INTO bus_routes
			(id, operator_id, provider_id, origin_terminal, dest_terminal,
			 from_state, to_state, from_city, to_city, category, base_fare_kobo, amenities, active, status)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,TRUE,'active')`
	if _, err := s.db.Exec(ctx, q,
		id, userID, providerID, origin, dest,
		req.FromState, req.ToState, nullStr(req.FromCity), nullStr(req.ToCity),
		category, req.BaseFareKobo, amenities,
	); err != nil {
		return nil, fmt.Errorf("transport: create provider route: %w", err)
	}
	s.recordModeEvent(ctx, userID, "bus.provider.route.create", "bus_route", id, "", "active",
		map[string]any{"from_state": req.FromState, "to_state": req.ToState, "provider_id": providerID})
	return s.providerRouteRow(ctx, id)
}

// UpdateProviderRoute patches a route the caller owns (ownership enforced).
func (s *Service) UpdateProviderRoute(ctx context.Context, userID, routeID string, req BusProviderRoutePatchRequest) (map[string]any, error) {
	providerID, err := s.providerForUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	if err := s.assertRouteOwned(ctx, routeID, providerID); err != nil {
		return nil, err
	}
	var amenities any
	if req.Amenities != nil {
		m, err := marshalAmenities(req.Amenities)
		if err != nil {
			return nil, err
		}
		amenities = m
	}
	const q = `
		UPDATE bus_routes SET
			from_city      = COALESCE($3, from_city),
			to_city        = COALESCE($4, to_city),
			category       = COALESCE($5, category),
			base_fare_kobo = COALESCE($6, base_fare_kobo),
			amenities      = COALESCE($7::jsonb, amenities),
			active         = COALESCE($8, active)
		WHERE id=$1 AND provider_id=$2`
	tag, err := s.db.Exec(ctx, q, routeID, providerID,
		req.FromCity, req.ToCity, req.BusType, req.BaseFareKobo, amenities, req.Active,
	)
	if err != nil {
		return nil, fmt.Errorf("transport: update provider route: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return nil, codedErr(http.StatusForbidden, CodeForbidden, "not your route")
	}
	s.recordModeEvent(ctx, userID, "bus.provider.route.update", "bus_route", routeID, "", "updated", nil)
	return s.providerRouteRow(ctx, routeID)
}

// CreateProviderSchedule adds a departure to a route the caller owns. Fares are
// self-serve trusted (fare_approved=TRUE) — the provider set them.
func (s *Service) CreateProviderSchedule(ctx context.Context, userID, routeID string, req BusProviderScheduleRequest) (map[string]any, error) {
	providerID, err := s.providerForUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	if err := s.assertRouteOwned(ctx, routeID, providerID); err != nil {
		return nil, err
	}
	dep, err := time.Parse(time.RFC3339, req.DepartureTime)
	if err != nil {
		return nil, codedErr(http.StatusBadRequest, "INVALID_TIME", "departure_time must be RFC3339")
	}
	id := uuid.New().String()
	const q = `
		INSERT INTO bus_schedules
			(id, route_id, departure_time, total_seats, fare_kobo, fare_approved, status)
		VALUES ($1,$2,$3,$4,$5,TRUE,'scheduled')`
	if _, err := s.db.Exec(ctx, q, id, routeID, dep, req.TotalSeats, req.FareKobo); err != nil {
		return nil, fmt.Errorf("transport: create provider schedule: %w", err)
	}
	s.recordModeEvent(ctx, userID, "bus.provider.schedule.create", "bus_schedule", id, "", "scheduled",
		map[string]any{"route_id": routeID, "fare_kobo": req.FareKobo, "total_seats": req.TotalSeats})
	return map[string]any{
		"id": id, "routeId": routeID, "departureTime": dep,
		"totalSeats": req.TotalSeats, "fareKobo": req.FareKobo,
		"fareApproved": true, "status": "scheduled",
	}, nil
}

// ProviderBookings returns the passenger manifest for one of the caller's own
// schedules (ownership: the schedule's route.provider_id must be the caller's).
func (s *Service) ProviderBookings(ctx context.Context, userID, scheduleID string) ([]map[string]any, error) {
	providerID, err := s.providerForUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	var owner string
	if err := s.db.QueryRow(ctx, `
		SELECT r.provider_id FROM bus_schedules s
		JOIN bus_routes r ON r.id = s.route_id
		WHERE s.id=$1`, scheduleID).Scan(&owner); err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "schedule not found")
	}
	if owner != providerID {
		return nil, codedErr(http.StatusForbidden, CodeForbidden, "not your schedule")
	}
	rows, err := s.db.Query(ctx, `
		SELECT id, user_id, seat_number, passenger_name, passenger_phone, boarding_status, status, qr_code
		FROM bus_tickets WHERE schedule_id=$1 AND status NOT IN ('cancelled','refunded')
		ORDER BY seat_number`, scheduleID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, uid, pname, boardStatus, status, qr string
		var pphone *string
		var seat int
		if err := rows.Scan(&id, &uid, &seat, &pname, &pphone, &boardStatus, &status, &qr); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"ticketId": id, "userId": uid, "seatNumber": seat, "passengerName": pname,
			"passengerPhone": pphone, "boardingStatus": boardStatus, "status": status, "qrCode": qr,
		})
	}
	return out, nil
}

// assertRouteOwned is the pure ownership gate: the route must belong to providerID.
func (s *Service) assertRouteOwned(ctx context.Context, routeID, providerID string) error {
	var owner *string
	if err := s.db.QueryRow(ctx, `SELECT provider_id FROM bus_routes WHERE id=$1`, routeID).Scan(&owner); err != nil {
		return codedErr(http.StatusNotFound, CodeNotFound, "route not found")
	}
	if !routeOwnedBy(owner, providerID) {
		return codedErr(http.StatusForbidden, CodeForbidden, "not your route")
	}
	return nil
}

// ─── Customer discovery ──────────────────────────────────────────────────────

// SearchBusTrips returns bookable interstate trips joined provider→route→schedule.
// Only active providers, active routes, upcoming scheduled departures. Rejects
// fromState===toState when both are supplied (interstate-only).
func (s *Service) SearchBusTrips(ctx context.Context, fromState, toState, providerID, date string) ([]map[string]any, error) {
	if fromState != "" && toState != "" && sameState(fromState, toState) {
		return nil, codedErr(http.StatusBadRequest, CodeInvalidState, "fromState and toState must differ")
	}
	q := `
		SELECT s.id, r.id, p.id, p.business_name, p.verification_status, p.rating_avg,
		       r.from_state, r.to_state, r.from_city, r.to_city, r.category,
		       s.departure_time, s.total_seats, s.fare_kobo, r.amenities,
		       (s.total_seats - COALESCE((
		           SELECT COUNT(*) FROM bus_tickets t
		           WHERE t.schedule_id = s.id AND t.status NOT IN ('cancelled','refunded')
		       ), 0)) AS seats_available
		FROM bus_schedules s
		JOIN bus_routes r    ON r.id = s.route_id
		JOIN bus_providers p ON p.id = r.provider_id
		WHERE r.active = TRUE AND p.status = 'active'
		  AND p.verification_status = 'verified'
		  AND s.fare_approved = TRUE AND s.status = 'scheduled'
		  AND s.departure_time >= NOW()`
	args := []any{}
	i := 1
	if fromState != "" {
		q += fmt.Sprintf(" AND r.from_state ILIKE $%d", i)
		args = append(args, fromState)
		i++
	}
	if toState != "" {
		q += fmt.Sprintf(" AND r.to_state ILIKE $%d", i)
		args = append(args, toState)
		i++
	}
	if providerID != "" {
		q += fmt.Sprintf(" AND p.id = $%d", i)
		args = append(args, providerID)
		i++
	}
	if date != "" {
		q += fmt.Sprintf(" AND s.departure_time::date = $%d::date", i)
		args = append(args, date)
		i++
	}
	q += " ORDER BY s.departure_time LIMIT 100"
	rows, err := s.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var schedID, routeID, provID, provName, verStatus, busType, fromSt, toSt string
		var fromCity, toCity *string
		var ratingAvg float64
		var dep time.Time
		var totalSeats, seatsAvail int
		var fare int64
		var amenitiesRaw []byte
		if err := rows.Scan(&schedID, &routeID, &provID, &provName, &verStatus, &ratingAvg,
			&fromSt, &toSt, &fromCity, &toCity, &busType,
			&dep, &totalSeats, &fare, &amenitiesRaw, &seatsAvail); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"scheduleId": schedID, "routeId": routeID,
			"provider": map[string]any{
				"id": provID, "businessName": provName,
				"verified": verStatus == "verified", "ratingAvg": ratingAvg,
			},
			"fromState": fromSt, "toState": toSt, "fromCity": fromCity, "toCity": toCity,
			"busType": busType, "departureTime": dep, "seatsAvailable": seatsAvail,
			"fareKobo": fare, "amenities": unmarshalAmenities(amenitiesRaw),
		})
	}
	return out, nil
}

// ListBusProviders returns active providers with a route count, filtered by state / free-text.
func (s *Service) ListBusProviders(ctx context.Context, state, query string) ([]map[string]any, error) {
	q := `
		SELECT p.id, p.business_name, p.base_state, p.verification_status, p.rating_avg,
		       COALESCE((SELECT COUNT(*) FROM bus_routes r WHERE r.provider_id = p.id AND r.active = TRUE), 0) AS route_count
		FROM bus_providers p
		WHERE p.status = 'active' AND p.verification_status = 'verified'`
	args := []any{}
	i := 1
	if state != "" {
		q += fmt.Sprintf(" AND p.base_state ILIKE $%d", i)
		args = append(args, state)
		i++
	}
	if query != "" {
		q += fmt.Sprintf(" AND p.business_name ILIKE $%d", i)
		args = append(args, "%"+query+"%")
		i++
	}
	q += " ORDER BY p.business_name LIMIT 100"
	rows, err := s.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, name, verStatus string
		var baseState *string
		var ratingAvg float64
		var routeCount int
		if err := rows.Scan(&id, &name, &baseState, &verStatus, &ratingAvg, &routeCount); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"id": id, "businessName": name, "baseState": baseState,
			"verified": verStatus == "verified", "ratingAvg": ratingAvg, "routeCount": routeCount,
		})
	}
	return out, nil
}

// GetBusProvider returns a single active provider's public profile + its active routes.
func (s *Service) GetBusProvider(ctx context.Context, providerID string) (map[string]any, error) {
	var status string
	if err := s.db.QueryRow(ctx, `SELECT status FROM bus_providers WHERE id=$1`, providerID).Scan(&status); err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "provider not found")
	}
	if status != "active" {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "provider not found")
	}
	prov, err := s.busProviderRow(ctx, providerID)
	if err != nil {
		return nil, err
	}
	routes, err := s.listPublicProviderRoutes(ctx, providerID)
	if err != nil {
		return nil, err
	}
	return map[string]any{"provider": prov, "routes": routes}, nil
}

// ─── Route projections ───────────────────────────────────────────────────────

// providerRouteRow returns one route (owner projection).
func (s *Service) providerRouteRow(ctx context.Context, routeID string) (map[string]any, error) {
	const q = `
		SELECT id, provider_id, from_state, to_state, from_city, to_city, category, base_fare_kobo, amenities, active, status
		FROM bus_routes WHERE id=$1`
	var (
		id, category, status             string
		provID, fromSt, toSt, fromC, toC *string
		baseFare                         *int64
		amenitiesRaw                     []byte
		active                           bool
	)
	if err := s.db.QueryRow(ctx, q, routeID).Scan(
		&id, &provID, &fromSt, &toSt, &fromC, &toC, &category, &baseFare, &amenitiesRaw, &active, &status,
	); err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "route not found")
	}
	return map[string]any{
		"id": id, "providerId": provID, "fromState": fromSt, "toState": toSt,
		"fromCity": fromC, "toCity": toC, "busType": category,
		"baseFareKobo": baseFare, "amenities": unmarshalAmenities(amenitiesRaw),
		"active": active, "status": status,
	}, nil
}

// listProviderRoutes returns all of a provider's routes (owner view).
func (s *Service) listProviderRoutes(ctx context.Context, providerID string) ([]map[string]any, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id, from_state, to_state, from_city, to_city, category, base_fare_kobo, amenities, active
		FROM bus_routes WHERE provider_id=$1 ORDER BY from_state, to_state LIMIT 200`, providerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, category string
		var fromSt, toSt, fromC, toC *string
		var baseFare *int64
		var amenitiesRaw []byte
		var active bool
		if err := rows.Scan(&id, &fromSt, &toSt, &fromC, &toC, &category, &baseFare, &amenitiesRaw, &active); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"id": id, "fromState": fromSt, "toState": toSt, "fromCity": fromC, "toCity": toC,
			"busType": category, "baseFareKobo": baseFare, "amenities": unmarshalAmenities(amenitiesRaw), "active": active,
		})
	}
	return out, nil
}

// listPublicProviderRoutes returns a provider's ACTIVE routes with next departure.
func (s *Service) listPublicProviderRoutes(ctx context.Context, providerID string) ([]map[string]any, error) {
	rows, err := s.db.Query(ctx, `
		SELECT r.id, r.from_state, r.to_state, r.from_city, r.to_city, r.category, r.base_fare_kobo, r.amenities,
		       (SELECT MIN(s.departure_time) FROM bus_schedules s
		        WHERE s.route_id = r.id AND s.status='scheduled' AND s.fare_approved=TRUE AND s.departure_time >= NOW())
		FROM bus_routes r
		WHERE r.provider_id=$1 AND r.active = TRUE
		ORDER BY r.from_state, r.to_state LIMIT 200`, providerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, category string
		var fromSt, toSt, fromC, toC *string
		var baseFare *int64
		var amenitiesRaw []byte
		var nextDep *time.Time
		if err := rows.Scan(&id, &fromSt, &toSt, &fromC, &toC, &category, &baseFare, &amenitiesRaw, &nextDep); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"id": id, "fromState": fromSt, "toState": toSt, "fromCity": fromC, "toCity": toC,
			"busType": category, "baseFareKobo": baseFare, "amenities": unmarshalAmenities(amenitiesRaw),
			"nextDepartureTime": nextDep,
		})
	}
	return out, nil
}

// listProviderUpcomingSchedules returns a provider's upcoming departures (owner view).
func (s *Service) listProviderUpcomingSchedules(ctx context.Context, providerID string) ([]map[string]any, error) {
	rows, err := s.db.Query(ctx, `
		SELECT s.id, s.route_id, r.from_state, r.to_state, s.departure_time, s.total_seats, s.fare_kobo, s.status,
		       (s.total_seats - COALESCE((
		           SELECT COUNT(*) FROM bus_tickets t
		           WHERE t.schedule_id = s.id AND t.status NOT IN ('cancelled','refunded')
		       ), 0)) AS seats_available
		FROM bus_schedules s
		JOIN bus_routes r ON r.id = s.route_id
		WHERE r.provider_id=$1 AND s.departure_time >= NOW()
		ORDER BY s.departure_time LIMIT 200`, providerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, routeID, status string
		var fromSt, toSt *string
		var dep time.Time
		var totalSeats, seatsAvail int
		var fare int64
		if err := rows.Scan(&id, &routeID, &fromSt, &toSt, &dep, &totalSeats, &fare, &status, &seatsAvail); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"id": id, "routeId": routeID, "fromState": fromSt, "toState": toSt,
			"departureTime": dep, "totalSeats": totalSeats, "seatsAvailable": seatsAvail,
			"fareKobo": fare, "status": status,
		})
	}
	return out, nil
}

// ─── Small pure helpers ──────────────────────────────────────────────────────

// sameState is the PURE interstate guard: two state names are "the same" iff they
// are equal after trimming, case-insensitively. Extracted so the interstate
// invariant — search and route-create both reject from==to — is provable without a
// DB. Blank on either side is NOT a match (search treats a missing filter as open).
func sameState(a, b string) bool {
	a = strings.TrimSpace(a)
	b = strings.TrimSpace(b)
	if a == "" || b == "" {
		return false
	}
	return strings.EqualFold(a, b)
}

// routeOwnedBy is the PURE ownership decision for a provider route mutation: the
// route belongs to providerID iff its provider_id is non-nil and equal. Extracted
// so the cross-provider guard (provider B cannot edit provider A's route) is
// provable without a DB.
func routeOwnedBy(routeProviderID *string, providerID string) bool {
	return routeProviderID != nil && *routeProviderID == providerID
}

// seatsAvailable is the PURE seat-math used by search / provider dashboards:
// total_seats minus non-cancelled/refunded bookings, floored at 0.
func seatsAvailable(totalSeats, booked int) int {
	n := totalSeats - booked
	if n < 0 {
		return 0
	}
	return n
}

// firstNonEmpty returns the first non-blank string.
func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

// marshalAmenities encodes a string slice as a JSON array (defaults to []).
func marshalAmenities(a []string) (string, error) {
	if a == nil {
		return "[]", nil
	}
	b, err := json.Marshal(a)
	if err != nil {
		return "", fmt.Errorf("transport: encode amenities: %w", err)
	}
	return string(b), nil
}

// unmarshalAmenities decodes a jsonb amenities column into a string slice.
func unmarshalAmenities(raw []byte) []string {
	if len(raw) == 0 {
		return []string{}
	}
	var out []string
	if err := json.Unmarshal(raw, &out); err != nil {
		return []string{}
	}
	return out
}

// busProviderSlug derives a URL-ish slug from a business name + row id suffix.
func busProviderSlug(name, id string) string {
	s := strings.ToLower(strings.TrimSpace(name))
	var b strings.Builder
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == ' ' || r == '-' || r == '_':
			b.WriteRune('-')
		}
	}
	base := strings.Trim(b.String(), "-")
	if base == "" {
		base = "provider"
	}
	suffix := strings.ReplaceAll(id, "-", "")
	if len(suffix) > 8 {
		suffix = suffix[:8]
	}
	return base + "-" + suffix
}
