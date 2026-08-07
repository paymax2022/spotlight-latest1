package transport

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"
)

// ─── Bus booking ─────────────────────────────────────────────────────────────
//
// Ticket machine: booked → issued(QR) → boarding → boarded → completed
//                 (rescheduled / cancelled / refunded)
//
// Fixed, admin-approved fares. On book the fare is escrowed then immediately
// settled to the operator (the catalog is trusted, no proof-of-completion gate).
// QR = uuid. Seats are uniquely allocated per schedule (UNIQUE(schedule_id, seat)).

// ─── Request bodies ──────────────────────────────────────────────────────────

// BusBookRequest is POST /mobility/bus/book.
type BusBookRequest struct {
	ScheduleID     string `json:"schedule_id" binding:"required"`
	SeatNumber     int    `json:"seat_number" binding:"required,min=1"`
	PassengerName  string `json:"passenger_name" binding:"required"`
	PassengerPhone string `json:"passenger_phone"`
	IdempotencyKey string `json:"idempotency_key"`
}

// BusValidateRequest is POST /driver/bus/validate.
type BusValidateRequest struct {
	QRCode string `json:"qr_code" binding:"required"`
}

// BusRouteRequest is admin route create.
type BusRouteRequest struct {
	OperatorID     string `json:"operator_id" binding:"required"`
	OriginTerminal string `json:"origin_terminal" binding:"required"`
	DestTerminal   string `json:"dest_terminal" binding:"required"`
	DistanceM      int    `json:"distance_m"`
	EstDurationS   int    `json:"est_duration_s"`
	Category       string `json:"category"`
	Reason         string `json:"reason"`
}

// BusScheduleRequest is admin schedule create.
type BusScheduleRequest struct {
	RouteID         string `json:"route_id" binding:"required"`
	DepartureTime   string `json:"departure_time" binding:"required"` // RFC3339
	ArrivalEstimate string `json:"arrival_estimate"`
	TotalSeats      int    `json:"total_seats" binding:"required,min=1,max=80"`
	FareKobo        int64  `json:"fare_kobo" binding:"required,min=0"`
	Reason          string `json:"reason"`
}

// ─── Customer search / catalog ───────────────────────────────────────────────

// SearchBusRoutes returns active routes filtered by origin/dest terminals.
func (s *Service) SearchBusRoutes(ctx context.Context, origin, dest string) ([]map[string]any, error) {
	q := `SELECT id, operator_id, origin_terminal, dest_terminal, distance_m, est_duration_s, category, status
	      FROM bus_routes WHERE status='active'`
	args := []any{}
	i := 1
	if origin != "" {
		q += fmt.Sprintf(" AND origin_terminal ILIKE $%d", i)
		args = append(args, "%"+origin+"%")
		i++
	}
	if dest != "" {
		q += fmt.Sprintf(" AND dest_terminal ILIKE $%d", i)
		args = append(args, "%"+dest+"%")
		i++
	}
	q += " ORDER BY origin_terminal LIMIT 100"
	rows, err := s.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, opID, o, d, category, status string
		var distM, durS *int
		if err := rows.Scan(&id, &opID, &o, &d, &distM, &durS, &category, &status); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"id": id, "operatorId": opID, "originTerminal": o, "destTerminal": d,
			"distanceM": distM, "estDurationS": durS, "category": category, "status": status,
		})
	}
	return out, nil
}

// ListBusSchedules returns schedules for a route on a date, with seats-left
// computed as total_seats − issued (non-cancelled, non-refunded) tickets.
func (s *Service) ListBusSchedules(ctx context.Context, routeID, date string) ([]map[string]any, error) {
	q := `
		SELECT s.id, s.route_id, s.departure_time, s.arrival_estimate, s.total_seats, s.fare_kobo,
		       s.fare_approved, s.status,
		       (s.total_seats - COALESCE((
		           SELECT COUNT(*) FROM bus_tickets t
		           WHERE t.schedule_id = s.id AND t.status NOT IN ('cancelled','refunded')
		       ), 0)) AS seats_left
		FROM bus_schedules s
		WHERE s.route_id=$1 AND s.fare_approved=TRUE`
	args := []any{routeID}
	if date != "" {
		q += " AND s.departure_time::date = $2::date"
		args = append(args, date)
	}
	q += " ORDER BY s.departure_time LIMIT 100"
	rows, err := s.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, routeID, status string
		var dep time.Time
		var arr *time.Time
		var totalSeats, seatsLeft int
		var fare int64
		var approved bool
		if err := rows.Scan(&id, &routeID, &dep, &arr, &totalSeats, &fare, &approved, &status, &seatsLeft); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"id": id, "routeId": routeID, "departureTime": dep, "arrivalEstimate": arr,
			"totalSeats": totalSeats, "fareKobo": fare, "fareApproved": approved,
			"status": status, "seatsLeft": seatsLeft,
		})
	}
	return out, nil
}

// BookBusTicket books a seat: escrow → settle operator → issue QR. The unique
// (schedule_id, seat_number) constraint guarantees one passenger per seat.
func (s *Service) BookBusTicket(ctx context.Context, userID string, req BusBookRequest, idempotencyKey string) (map[string]any, error) {
	if idempotencyKey == "" {
		idempotencyKey = req.IdempotencyKey
	}
	if idempotencyKey == "" {
		return nil, codedErr(http.StatusBadRequest, "MISSING_IDEMPOTENCY_KEY", "idempotency key required")
	}
	// Load schedule + operator + (optional) marketplace provider, enforce approved
	// fare and bookable status.
	var fare int64
	var totalSeats int
	var approved bool
	var status, operatorID string
	var providerID *string
	const sq = `
		SELECT s.fare_kobo, s.total_seats, s.fare_approved, s.status, r.operator_id, r.provider_id
		FROM bus_schedules s JOIN bus_routes r ON r.id = s.route_id
		WHERE s.id=$1`
	if err := s.db.QueryRow(ctx, sq, req.ScheduleID).Scan(&fare, &totalSeats, &approved, &status, &operatorID, &providerID); err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "schedule not found")
	}
	// Resolve the settlement recipient: for a marketplace route the payout goes to
	// the PROVIDER's owner user (provider_id → bus_providers.owner_user_id); for a
	// legacy admin route it stays the route operator_id.
	settleUserID := operatorID
	if providerID != nil {
		var owner string
		if err := s.db.QueryRow(ctx, `SELECT owner_user_id FROM bus_providers WHERE id=$1`, *providerID).Scan(&owner); err == nil && owner != "" {
			settleUserID = owner
		}
	}
	if !approved {
		return nil, codedErr(http.StatusUnprocessableEntity, "FARE_NOT_APPROVED", "schedule fare not yet approved")
	}
	if status != "scheduled" && status != "boarding" {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "schedule not open for booking")
	}
	if req.SeatNumber > totalSeats {
		return nil, codedErr(http.StatusUnprocessableEntity, "INVALID_SEAT", "seat number exceeds capacity")
	}

	// Fail-closed tier/spending-limit gate BEFORE any wallet escrow (same contract
	// as RequestRide): a Tier0/over-limit passenger cannot move money.
	if err := s.enforceTierLimit(ctx, userID, fare); err != nil {
		return nil, err
	}

	ticketID := uuid.New().String()
	ref := "bus:" + ticketID
	sett, err := s.settlement.Escrow(ctx, userID, ref, idempotencyKey, "transport", fare)
	if err != nil {
		return nil, fmt.Errorf("transport: escrow bus fare: %w", err)
	}
	qr := uuid.New().String()
	const q = `
		INSERT INTO bus_tickets
			(id, user_id, schedule_id, seat_number, passenger_name, passenger_phone, qr_code,
			 fare_kobo, payment_status, boarding_status, status, settlement_id, idempotency_key)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'paid','issued','issued',$9,$10)`
	if _, err := s.db.Exec(ctx, q,
		ticketID, userID, req.ScheduleID, req.SeatNumber, req.PassengerName, nullStr(req.PassengerPhone),
		qr, fare, sett.ID, idempotencyKey,
	); err != nil {
		// Seat already taken (unique violation) → refund escrow, surface conflict.
		s.settlement.Refund(ctx, sett.ID, "seat_unavailable")
		return nil, codedErr(http.StatusConflict, "SEAT_TAKEN", "seat already booked")
	}

	// Bus tickets settle immediately on issue (trusted catalog): to the marketplace
	// provider's owner user when the route has a provider, else the legacy operator.
	comm, _ := s.commissionForTier(ctx, "standard")
	if err := s.settlement.Settle(ctx, sett.ID, settlementSplit(settleUserID, comm)); err != nil {
		return nil, fmt.Errorf("transport: settle bus ticket: %w", err)
	}
	// Record realized Spotlight profit (best-effort + idempotent; ticket id as source
	// ref + idempotency key). gross = the full ticket fare the passenger paid. A
	// recorder failure is logged and swallowed — it must NEVER affect the settlement
	// above (earning-row only; no ledger re-post).
	bookerID := userID
	s.recordCommissionSafe(ctx, "Lifestyle", "Bus Booking", "", fare, ticketID, &bookerID)
	s.recordModeEvent(ctx, userID, "bus.ticket_issued", "bus_ticket", ticketID, "", "issued",
		map[string]any{"schedule_id": req.ScheduleID, "seat_number": req.SeatNumber, "settle_user_id": settleUserID})
	return s.BusTicketDetail(ctx, ticketID, userID)
}

// BusTicketDetail returns a ticket (owner only).
func (s *Service) BusTicketDetail(ctx context.Context, id, userID string) (map[string]any, error) {
	const q = `
		SELECT id, user_id, schedule_id, seat_number, passenger_name, passenger_phone, qr_code,
		       fare_kobo, payment_status, boarding_status, status, created_at
		FROM bus_tickets WHERE id=$1`
	var (
		tid, uid, schedID, pname, qr, payStatus, boardStatus, status string
		pphone                                                       *string
		seat                                                         int
		fare                                                         int64
		createdAt                                                    time.Time
	)
	if err := s.db.QueryRow(ctx, q, id).Scan(
		&tid, &uid, &schedID, &seat, &pname, &pphone, &qr,
		&fare, &payStatus, &boardStatus, &status, &createdAt,
	); err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "ticket not found")
	}
	if uid != userID {
		return nil, codedErr(http.StatusForbidden, CodeForbidden, "not your ticket")
	}
	return map[string]any{
		"id": tid, "userId": uid, "scheduleId": schedID, "seatNumber": seat,
		"passengerName": pname, "passengerPhone": pphone, "qrCode": qr,
		"fareKobo": fare, "paymentStatus": payStatus, "boardingStatus": boardStatus,
		"status": status, "createdAt": createdAt,
	}, nil
}

// ListBusTickets returns the user's tickets.
func (s *Service) ListBusTickets(ctx context.Context, userID string) ([]map[string]any, error) {
	const q = `
		SELECT id, schedule_id, seat_number, passenger_name, qr_code, fare_kobo,
		       payment_status, boarding_status, status, created_at
		FROM bus_tickets WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100`
	rows, err := s.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, schedID, pname, qr, payStatus, boardStatus, status string
		var seat int
		var fare int64
		var createdAt time.Time
		if err := rows.Scan(&id, &schedID, &seat, &pname, &qr, &fare, &payStatus, &boardStatus, &status, &createdAt); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"id": id, "scheduleId": schedID, "seatNumber": seat, "passengerName": pname,
			"qrCode": qr, "fareKobo": fare, "paymentStatus": payStatus,
			"boardingStatus": boardStatus, "status": status, "createdAt": createdAt,
		})
	}
	return out, nil
}

// CancelBusTicket refunds + cancels a ticket (owner only). Boarded tickets cannot
// be cancelled.
func (s *Service) CancelBusTicket(ctx context.Context, id, userID, reason string) error {
	var uid, status, boardStatus string
	var settID *string
	if err := s.db.QueryRow(ctx,
		`SELECT user_id, status, boarding_status, settlement_id FROM bus_tickets WHERE id=$1`, id).
		Scan(&uid, &status, &boardStatus, &settID); err != nil {
		return codedErr(http.StatusNotFound, CodeNotFound, "ticket not found")
	}
	if uid != userID {
		return codedErr(http.StatusForbidden, CodeForbidden, "not your ticket")
	}
	if status == "cancelled" || status == "refunded" || status == "completed" || boardStatus == "boarded" {
		return codedErr(http.StatusConflict, CodeInvalidState, "ticket cannot be cancelled")
	}
	tag, err := s.db.Exec(ctx,
		`UPDATE bus_tickets SET status='cancelled', payment_status='refunded'
		 WHERE id=$1 AND status NOT IN ('cancelled','refunded','completed') AND boarding_status<>'boarded'`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return codedErr(http.StatusConflict, CodeInvalidState, "ticket cannot be cancelled")
	}
	// Settlement was already released to the operator on issue; refund reverses it.
	if settID != nil {
		s.settlement.Refund(ctx, *settID, "bus_cancelled:"+reason)
	}
	s.recordModeEvent(ctx, userID, "bus.cancelled", "bus_ticket", id, status, "cancelled", map[string]any{"reason": reason})
	return nil
}

// ValidateBusTicket: operator scans the QR → boarded. Only the route operator may.
func (s *Service) ValidateBusTicket(ctx context.Context, operatorUserID, qrCode string) (map[string]any, error) {
	var ticketID, status, boardStatus, operatorID string
	const q = `
		SELECT t.id, t.status, t.boarding_status, r.operator_id
		FROM bus_tickets t
		JOIN bus_schedules s ON s.id = t.schedule_id
		JOIN bus_routes r ON r.id = s.route_id
		WHERE t.qr_code=$1`
	if err := s.db.QueryRow(ctx, q, qrCode).Scan(&ticketID, &status, &boardStatus, &operatorID); err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "ticket not found")
	}
	// Object-level authz: only the schedule's operator may validate.
	if operatorID != operatorUserID {
		return nil, codedErr(http.StatusForbidden, CodeForbidden, "not the route operator")
	}
	if boardStatus == "boarded" {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "ticket already boarded")
	}
	if status == "cancelled" || status == "refunded" {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "ticket not valid")
	}
	if _, err := s.db.Exec(ctx,
		`UPDATE bus_tickets SET boarding_status='boarded', status='boarded' WHERE id=$1`, ticketID); err != nil {
		return nil, err
	}
	s.recordModeEvent(ctx, operatorUserID, "bus.boarded", "bus_ticket", ticketID, status, "boarded", nil)
	return map[string]any{"ok": true, "ticketId": ticketID, "boardingStatus": "boarded"}, nil
}

// ─── Admin: route / schedule CRUD + fare approval + manifest ─────────────────

// AdminCreateBusRoute creates a route (audited).
func (a *AdminService) CreateBusRoute(ctx context.Context, adminID string, req BusRouteRequest) (map[string]any, error) {
	id := uuid.New().String()
	category := req.Category
	if category == "" {
		category = "standard"
	}
	const q = `
		INSERT INTO bus_routes (id, operator_id, origin_terminal, dest_terminal, distance_m, est_duration_s, category, status)
		VALUES ($1,$2,$3,$4,$5,$6,$7,'active')`
	if _, err := a.svc.db.Exec(ctx, q, id, req.OperatorID, req.OriginTerminal, req.DestTerminal,
		nullInt(req.DistanceM), nullInt(req.EstDurationS), category); err != nil {
		return nil, err
	}
	writeAudit(ctx, a.svc.db, adminID, "bus.route.create", "bus_route", id, nil,
		map[string]any{"origin": req.OriginTerminal, "dest": req.DestTerminal, "operator_id": req.OperatorID}, req.Reason)
	return map[string]any{"id": id, "status": "active"}, nil
}

// ListBusRoutes returns all routes (admin).
func (a *AdminService) ListBusRoutes(ctx context.Context) ([]map[string]any, error) {
	return a.svc.SearchBusRoutesAll(ctx)
}

// SearchBusRoutesAll returns every route regardless of status (admin view).
func (s *Service) SearchBusRoutesAll(ctx context.Context) ([]map[string]any, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id, operator_id, origin_terminal, dest_terminal, distance_m, est_duration_s, category, status, created_at
		FROM bus_routes ORDER BY created_at DESC LIMIT 200`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, opID, o, d, category, status string
		var distM, durS *int
		var createdAt time.Time
		if err := rows.Scan(&id, &opID, &o, &d, &distM, &durS, &category, &status, &createdAt); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"id": id, "operatorId": opID, "originTerminal": o, "destTerminal": d,
			"distanceM": distM, "estDurationS": durS, "category": category,
			"status": status, "createdAt": createdAt,
		})
	}
	return out, nil
}

// CreateBusSchedule creates a schedule (admin, fare unapproved until approved).
func (a *AdminService) CreateBusSchedule(ctx context.Context, adminID string, req BusScheduleRequest) (map[string]any, error) {
	dep, err := time.Parse(time.RFC3339, req.DepartureTime)
	if err != nil {
		return nil, codedErr(http.StatusBadRequest, "INVALID_TIME", "departure_time must be RFC3339")
	}
	var arr *time.Time
	if req.ArrivalEstimate != "" {
		if t, err := time.Parse(time.RFC3339, req.ArrivalEstimate); err == nil {
			arr = &t
		}
	}
	id := uuid.New().String()
	const q = `
		INSERT INTO bus_schedules (id, route_id, departure_time, arrival_estimate, total_seats, fare_kobo, fare_approved, status)
		VALUES ($1,$2,$3,$4,$5,$6,FALSE,'scheduled')`
	if _, err := a.svc.db.Exec(ctx, q, id, req.RouteID, dep, arr, req.TotalSeats, req.FareKobo); err != nil {
		return nil, err
	}
	writeAudit(ctx, a.svc.db, adminID, "bus.schedule.create", "bus_schedule", id, nil,
		map[string]any{"route_id": req.RouteID, "fare_kobo": req.FareKobo, "total_seats": req.TotalSeats}, req.Reason)
	return map[string]any{"id": id, "fareApproved": false, "status": "scheduled"}, nil
}

// ApproveBusFare approves a schedule's fare (audited). Bookings require approval.
func (a *AdminService) ApproveBusFare(ctx context.Context, adminID, scheduleID string, reason string) error {
	var approved bool
	var fare int64
	if err := a.svc.db.QueryRow(ctx, `SELECT fare_approved, fare_kobo FROM bus_schedules WHERE id=$1`, scheduleID).
		Scan(&approved, &fare); err != nil {
		return codedErr(http.StatusNotFound, CodeNotFound, "schedule not found")
	}
	if _, err := a.svc.db.Exec(ctx, `UPDATE bus_schedules SET fare_approved=TRUE WHERE id=$1`, scheduleID); err != nil {
		return err
	}
	return writeAudit(ctx, a.svc.db, adminID, "bus.fare.approve", "bus_schedule", scheduleID,
		map[string]any{"fare_approved": approved}, map[string]any{"fare_approved": true, "fare_kobo": fare}, reason)
}

// SetBusProviderVerification verifies / suspends / re-pends a bus operator (ADR-020
// go-live gate). Admin-only. A 'verified' provider becomes discoverable; 'suspended'
// also flips status='inactive' so its trips drop out of customer discovery
// immediately. Writes an immutable audit row. Reason is required for suspension.
func (a *AdminService) SetBusProviderVerification(ctx context.Context, adminID, providerID, newStatus, reason string) error {
	valid := map[string]bool{"verified": true, "suspended": true, "pending": true}
	if !valid[newStatus] {
		return codedErr(http.StatusBadRequest, CodeInvalidState, "verification status must be verified, suspended or pending")
	}
	if newStatus == "suspended" && reason == "" {
		return codedErr(http.StatusBadRequest, CodeInvalidState, "a reason is required to suspend a provider")
	}
	var oldStatus, oldOpStatus string
	if err := a.svc.db.QueryRow(ctx, `SELECT verification_status, status FROM bus_providers WHERE id=$1`, providerID).
		Scan(&oldStatus, &oldOpStatus); err != nil {
		return codedErr(http.StatusNotFound, CodeNotFound, "bus provider not found")
	}
	if _, err := a.svc.db.Exec(ctx, `UPDATE bus_providers SET verification_status=$1, updated_at=NOW() WHERE id=$2`, newStatus, providerID); err != nil {
		return err
	}
	// Keep the operational status consistent so discovery reflects the decision at once.
	switch newStatus {
	case "suspended":
		a.svc.db.Exec(ctx, `UPDATE bus_providers SET status='inactive' WHERE id=$1`, providerID)
	case "verified":
		a.svc.db.Exec(ctx, `UPDATE bus_providers SET status='active' WHERE id=$1`, providerID)
	}
	return writeAudit(ctx, a.svc.db, adminID, "bus_provider.verification", "bus_provider", providerID,
		map[string]any{"verification_status": oldStatus, "status": oldOpStatus},
		map[string]any{"verification_status": newStatus}, reason)
}

// ListBusProvidersAdmin returns every operator (any status) with verification +
// route count for the admin console. Pending providers sort first (the review queue).
func (a *AdminService) ListBusProvidersAdmin(ctx context.Context) ([]map[string]any, error) {
	rows, err := a.svc.db.Query(ctx, `
		SELECT p.id, p.business_name, p.owner_user_id, p.base_state, p.verification_status, p.status,
		       p.rating_avg, p.rating_count,
		       COALESCE((SELECT COUNT(*) FROM bus_routes r WHERE r.provider_id = p.id), 0) AS route_count,
		       p.created_at
		FROM bus_providers p
		ORDER BY (p.verification_status = 'pending') DESC, p.created_at DESC
		LIMIT 200`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, name, verStatus, opStatus string
		var owner, baseState *string
		var ratingAvg float64
		var ratingCount, routeCount int
		var createdAt time.Time
		if err := rows.Scan(&id, &name, &owner, &baseState, &verStatus, &opStatus, &ratingAvg, &ratingCount, &routeCount, &createdAt); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"id": id, "businessName": name, "ownerUserId": owner, "baseState": baseState,
			"verificationStatus": verStatus, "verified": verStatus == "verified", "status": opStatus,
			"ratingAvg": ratingAvg, "ratingCount": ratingCount, "routeCount": routeCount,
			"createdAt": createdAt.UTC().Format(time.RFC3339),
		})
	}
	return out, rows.Err()
}

// BusManifest lists passengers for a schedule (admin/operator).
func (a *AdminService) BusManifest(ctx context.Context, scheduleID string) ([]map[string]any, error) {
	rows, err := a.svc.db.Query(ctx, `
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

// nullInt returns nil for a zero int so it stores as SQL NULL.
func nullInt(n int) any {
	if n == 0 {
		return nil
	}
	return n
}
