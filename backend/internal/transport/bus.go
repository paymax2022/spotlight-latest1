package transport

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"spotlight/backend/go-common/dbutil"
	"spotlight/backend/internal/finance/settlement"
)

// Ticket machine: booked → issued(QR) → boarding → boarded → completed
// Fixed, admin-approved fares. On book the fare is escrowed. Legacy mode settles
// the operator immediately; with FEATURE_TRANSPORT_BUS_DEFERRED_SETTLEMENT it stays
// escrowed (refundable) until departure + grace (see bus_lifecycle.go).
// QR = uuid. Seats are unique per schedule among ACTIVE tickets (partial unique
// index bus_tickets_schedule_seat_active_uidx), so a cancelled seat can be re-sold.

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
	// CancelCutoffMinutes optionally overrides the self-service cancel cutoff for
	// deferred-settlement tickets on this schedule (60-1440; default 120).
	CancelCutoffMinutes *int `json:"cancel_cutoff_minutes"`
}

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

// busTicketByKey finds the ticket (if any) created for an idempotency key.
func (s *Service) busTicketByKey(ctx context.Context, key string) (*busTicketRow, error) {
	t, err := scanBusTicketRow(s.db.QueryRow(ctx, busTicketSelect+` WHERE t.idempotency_key=$1`, key))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return t, err
}

// BookBusTicket books a seat: validate -> escrow -> issue QR -> (immediate mode)
// settle. The ticket id is derived from (user, idempotency key), so a retry of the
// same booking lands on the same ticket / escrow reference and can never produce a
// second ticket, a free ticket, or a refund of an issued ticket.
//
// Settlement: with FEATURE_TRANSPORT_BUS_DEFERRED_SETTLEMENT off the operator is
// paid on issue (legacy; such a ticket can then NOT be cancelled-with-refund).
// With it on the fare stays escrowed until departure + grace and cancel refunds the
// wallet. Either way the provider/platform split and the payout recipient are
// FROZEN on the ticket here.
func (s *Service) BookBusTicket(ctx context.Context, userID string, req BusBookRequest, idempotencyKey string) (map[string]any, error) {
	if idempotencyKey == "" {
		idempotencyKey = req.IdempotencyKey
	}
	if idempotencyKey == "" {
		return nil, codedErr(http.StatusBadRequest, "MISSING_IDEMPOTENCY_KEY", "idempotency key required")
	}
	// Idempotent replay: a ticket already exists for this key.
	if existing, err := s.busTicketByKey(ctx, idempotencyKey); err != nil {
		return nil, err
	} else if existing != nil {
		return s.replayBusBooking(ctx, userID, req, existing)
	}

	// Load schedule + route + (optional) marketplace provider in one read.
	var (
		fare, totalSeats                       int64
		approved, routeActive                  bool
		status, routeStatus, operatorID        string
		departure                              time.Time
		schedCutoff                            *int
		providerID, ownerID, verification, pst *string
	)
	const sq = `
		SELECT s.fare_kobo, s.total_seats::bigint, s.fare_approved, s.status, s.departure_time, s.cancel_cutoff_minutes,
		       r.operator_id::text, r.provider_id::text, COALESCE(r.active, TRUE), r.status,
		       p.owner_user_id::text, p.verification_status, p.status
		FROM bus_schedules s
		JOIN bus_routes r ON r.id = s.route_id
		LEFT JOIN bus_providers p ON p.id = r.provider_id
		WHERE s.id=$1`
	if err := s.db.QueryRow(ctx, sq, req.ScheduleID).Scan(&fare, &totalSeats, &approved, &status, &departure, &schedCutoff,
		&operatorID, &providerID, &routeActive, &routeStatus, &ownerID, &verification, &pst); err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "schedule not found")
	}
	if !approved {
		return nil, codedErr(http.StatusUnprocessableEntity, "FARE_NOT_APPROVED", "schedule fare not yet approved")
	}
	if status != "scheduled" && status != "boarding" {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "schedule not open for booking")
	}
	if !departure.After(time.Now().Add(s.bus.MinBookingLead)) {
		return nil, codedErr(http.StatusConflict, CodeBookingClosed, "this departure is too close (or already gone) to book")
	}
	if !routeActive || routeStatus != "active" {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "route not open for booking")
	}
	// Resolve the settlement recipient. A marketplace route pays the PROVIDER's
	// owner; there is NO silent fallback to routes.operator_id - if the provider or
	// its owner cannot be resolved the booking FAILS (money must not go to the wrong
	// party). A legacy admin route (no provider) pays its operator_id.
	settleUserID := operatorID
	if providerID != nil {
		if ownerID == nil || *ownerID == "" || verification == nil || pst == nil {
			return nil, codedErr(http.StatusConflict, CodeProviderUnavailable, "the operator for this trip cannot be resolved; booking refused")
		}
		if *verification != "verified" || *pst != "active" {
			return nil, codedErr(http.StatusConflict, CodeProviderUnavailable, "this operator is not currently accepting bookings")
		}
		settleUserID = *ownerID
	}
	if req.SeatNumber < 1 || int64(req.SeatNumber) > totalSeats {
		return nil, codedErr(http.StatusUnprocessableEntity, "INVALID_SEAT", "seat number exceeds capacity")
	}

	// Fail-closed tier/spending-limit gate BEFORE any wallet escrow (same contract
	// as RequestRide): a Tier0/over-limit passenger cannot move money.
	if err := s.enforceTierLimit(ctx, userID, fare); err != nil {
		return nil, err
	}

	// Freeze the commercial terms now. Validate the split BEFORE escrow so a bad
	// config can never strand an escrow behind an unsettleable ticket.
	comm, _ := s.commissionForTier(ctx, "standard")
	split := settlementSplit(settleUserID, comm, 0)
	if err := split.Validate(); err != nil {
		return nil, fmt.Errorf("transport: bus commission split invalid: %w", err)
	}
	mode := "immediate"
	var cutoff *int
	if s.bus.DeferredSettlement {
		mode = "deferred"
		c := s.bus.CancelCutoffMin
		if schedCutoff != nil {
			c = ClampCutoffMinutes(*schedCutoff)
		}
		cutoff = &c
	}

	ticketID := busTicketIDForKey(userID, idempotencyKey)
	ref := "bus:" + ticketID
	// The settlement/ledger idempotency key is USER-SCOPED (derived from user+key via
	// the ticket id), so two users sending the same raw key can never share an escrow.
	escrowKey := "bus:" + ticketID
	var payer string
	switch err := s.db.QueryRow(ctx, `SELECT payer_id::text FROM settlements WHERE idempotency_key=$1`, escrowKey).Scan(&payer); {
	case err == nil && payer != userID:
		// Verified BEFORE any wallet debit: never bind to someone else's escrow.
		return nil, codedErr(http.StatusConflict, CodeKeyConflict, "this idempotency key is already bound to another payer")
	case err != nil && !errors.Is(err, pgx.ErrNoRows):
		return nil, err
	}
	sett, err := s.settlement.Escrow(ctx, userID, ref, escrowKey, "transport", fare)
	if err != nil {
		return nil, fmt.Errorf("transport: escrow bus fare: %w", err)
	}
	// Escrow replays the row for a key: it must be OUR still-escrowed fare for the
	// SAME amount. A refunded/settled row means this key was used up by an earlier
	// failed attempt (reusing it would mint a ticket nobody paid for); an amount
	// mismatch means the key belongs to a different booking. Fail closed, no refund.
	if sett.Status != settlement.StatusEscrowed || sett.TotalKobo != fare {
		return nil, codedErr(http.StatusConflict, CodeKeyConflict, "this idempotency key was already used; retry with a new key")
	}

	qr := uuid.New().String()
	issueErr := s.issueBusTicket(ctx, ticketID, userID, req, qr, fare, sett.ID, idempotencyKey,
		mode, cutoff, comm.ProviderPct, comm.PlatformPct, settleUserID)
	if issueErr != nil {
		return s.handleBusIssueFailure(ctx, userID, req, idempotencyKey, sett.ID, issueErr)
	}

	if mode == "immediate" {
		if _, err := s.settleBusTicket(ctx, ticketID); err != nil {
			// The ticket exists and the fare stays escrowed: a retry with the same key
			// resumes the settle (never a second ticket, never a refund).
			return nil, fmt.Errorf("transport: settle bus ticket: %w", err)
		}
	}
	s.recordModeEvent(ctx, userID, "bus.ticket_issued", "bus_ticket", ticketID, "", "issued",
		map[string]any{"schedule_id": req.ScheduleID, "seat_number": req.SeatNumber, "settle_user_id": settleUserID, "settle_mode": mode})
	return s.BusTicketDetail(ctx, ticketID, userID)
}

// issueBusTicket inserts the ticket under a FOR SHARE lock on its schedule so a
// concurrent schedule cancel (which takes the row lock) cannot interleave.
func (s *Service) issueBusTicket(ctx context.Context, ticketID, userID string, req BusBookRequest, qr string,
	fare int64, settlementID, key, mode string, cutoff *int, provPct, platPct float64, settleUserID string) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var st string
	if err := tx.QueryRow(ctx, `SELECT status FROM bus_schedules WHERE id=$1 FOR SHARE`, req.ScheduleID).Scan(&st); err != nil {
		return err
	}
	if st != "scheduled" && st != "boarding" {
		return errScheduleClosed
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO bus_tickets
			(id, user_id, schedule_id, seat_number, passenger_name, passenger_phone, qr_code,
			 fare_kobo, payment_status, boarding_status, status, settlement_id, idempotency_key,
			 settle_mode, payout_state, provider_pct, platform_pct, settle_user_id, cancel_cutoff_minutes)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'paid','issued','issued',$9,$10,$11,'held',$12,$13,$14,$15)`,
		ticketID, userID, req.ScheduleID, req.SeatNumber, req.PassengerName, dbutil.NullStr(req.PassengerPhone),
		qr, fare, settlementID, key, mode, provPct, platPct, settleUserID, cutoff); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

var errScheduleClosed = errors.New("transport: schedule closed while booking")

// handleBusIssueFailure turns a failed ticket insert into the right client error
// and - ONLY when no ticket exists for the key - reverses the escrow. It never
// refunds when a ticket for the key exists (a concurrent/earlier success), and it
// does not guess: if it cannot tell, the escrow is left for reconciliation.
func (s *Service) handleBusIssueFailure(ctx context.Context, userID string, req BusBookRequest, key, settlementID string, issueErr error) (map[string]any, error) {
	kind := classifyBusTicketInsertErr(issueErr)
	existing, lookupErr := s.busTicketByKey(ctx, key)
	if lookupErr != nil {
		log.Printf("[transport] bus booking key=%s: insert failed (%v) and ticket lookup failed (%v); leaving escrow %s for reconciliation",
			key, issueErr, lookupErr, settlementID)
		return nil, fmt.Errorf("transport: issue bus ticket: %w", issueErr)
	}
	if existing != nil {
		// A ticket for this key exists: the booking succeeded elsewhere. Replay it.
		return s.replayBusBooking(ctx, userID, req, existing)
	}
	if rerr := s.settlement.Refund(ctx, settlementID, "bus_issue_failed"); rerr != nil {
		log.Printf("[transport] bus booking key=%s: escrow reversal FAILED settlement=%s: %v", key, settlementID, rerr)
	}
	switch {
	case errors.Is(issueErr, errScheduleClosed):
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "schedule not open for booking")
	case kind == ticketInsertSeatTaken:
		return nil, codedErr(http.StatusConflict, CodeSeatTaken, "seat already booked")
	}
	return nil, fmt.Errorf("transport: issue bus ticket: %w", issueErr)
}

// replayBusBooking returns the ticket already created for this idempotency key.
// A different user, schedule or seat means the key is being reused for another
// booking (409). If the original attempt failed AFTER issuing (settle error) the
// settle is resumed here - never a refund, never a second ticket.
func (s *Service) replayBusBooking(ctx context.Context, userID string, req BusBookRequest, t *busTicketRow) (map[string]any, error) {
	if t.UserID != userID || t.ScheduleID != req.ScheduleID || t.SeatNumber != req.SeatNumber {
		return nil, codedErr(http.StatusConflict, CodeKeyConflict, "this idempotency key was already used for a different booking")
	}
	if t.Status == "cancelled" || t.Status == "refunded" {
		return nil, codedErr(http.StatusConflict, CodeKeyConflict, "this booking was cancelled; start a new booking with a new idempotency key")
	}
	if t.SettleMode == "immediate" && t.PayoutState != "released" && t.Status != "cancelled" && t.Status != "refunded" {
		if _, err := s.settleBusTicket(ctx, t.ID); err != nil {
			return nil, fmt.Errorf("transport: settle bus ticket: %w", err)
		}
	}
	return s.BusTicketDetail(ctx, t.ID, userID)
}

// BusTicketDetail returns a ticket (owner only).
func (s *Service) BusTicketDetail(ctx context.Context, id, userID string) (map[string]any, error) {
	t, err := s.loadBusTicket(ctx, id)
	if err != nil {
		return nil, err
	}
	if t.UserID != userID {
		return nil, codedErr(http.StatusForbidden, CodeForbidden, "not your ticket")
	}
	return busTicketPayload(t, time.Now()), nil
}

// busTicketPayload renders a ticket for the client (camelCase), including the
// server's verdict on whether a self-service cancel would be accepted right now.
func busTicketPayload(t *busTicketRow, now time.Time) map[string]any {
	verdict, _ := decideBusCancel(t, now, true)
	m := map[string]any{
		"id": t.ID, "userId": t.UserID, "scheduleId": t.ScheduleID, "seatNumber": t.SeatNumber,
		"passengerName": t.PassengerName, "passengerPhone": t.PassengerPhone, "qrCode": t.QRCode,
		"fareKobo": t.FareKobo, "paymentStatus": t.PaymentStatus, "boardingStatus": t.BoardStatus,
		"status": t.Status, "createdAt": t.CreatedAt,
		"refundStatus": t.RefundStatus, "departureTime": t.Departure,
		"cancelCutoffMinutes": t.CutoffMin, "cancellable": verdict == verdictProceed,
		"routeLabel": t.OriginTerminal + " → " + t.DestTerminal, "originTerminal": t.OriginTerminal,
		"destTerminal": t.DestTerminal, "operatorName": t.OperatorName, "arriveAt": t.Arrival,
	}
	if t.SettleMode == "deferred" && t.CutoffMin != nil {
		m["cancelDeadline"] = t.cancelDeadline()
	} else {
		m["cancelDeadline"] = nil
	}
	return m
}

// ListBusTickets returns the user's tickets.
func (s *Service) ListBusTickets(ctx context.Context, userID string) ([]map[string]any, error) {
	rows, err := s.db.Query(ctx, busTicketSelect+` WHERE t.user_id=$1 ORDER BY t.created_at DESC LIMIT 100`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	now := time.Now()
	out := []map[string]any{}
	for rows.Next() {
		t, err := scanBusTicketRow(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, busTicketPayload(t, now))
	}
	return out, rows.Err()
}

// ValidateBusTicket: operator scans the QR -> boarded. Only the route operator may,
// only inside the boarding window, never for a cancelled/refunded ticket or a
// cancelled schedule, and the status flip is a compare-and-swap so it cannot race
// a cancel.
func (s *Service) ValidateBusTicket(ctx context.Context, operatorUserID, qrCode string) (map[string]any, error) {
	var ticketID, status, boardStatus, operatorID, schedStatus string
	var departure time.Time
	var arrival *time.Time
	const q = `
		SELECT t.id, t.status, t.boarding_status, r.operator_id, s.departure_time, s.arrival_estimate, s.status
		FROM bus_tickets t
		JOIN bus_schedules s ON s.id = t.schedule_id
		JOIN bus_routes r ON r.id = s.route_id
		WHERE t.qr_code=$1`
	if err := s.db.QueryRow(ctx, q, qrCode).Scan(&ticketID, &status, &boardStatus, &operatorID, &departure, &arrival, &schedStatus); err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "ticket not found")
	}
	// Object-level authz: only the schedule's operator may validate.
	if operatorID != operatorUserID {
		return nil, codedErr(http.StatusForbidden, CodeForbidden, "not the route operator")
	}
	if boardStatus == "boarded" {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "ticket already boarded")
	}
	if status != "booked" && status != "issued" || boardStatus != "issued" {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "ticket not valid")
	}
	if schedStatus == "cancelled" {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "this trip was cancelled")
	}
	open, closes := busBoardingWindow(departure, arrival)
	now := time.Now()
	if now.Before(open) {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "boarding has not opened for this trip yet")
	}
	if now.After(closes) {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "boarding is closed for this trip")
	}
	tag, err := s.db.Exec(ctx,
		`UPDATE bus_tickets SET boarding_status='boarded', status='boarded'
		 WHERE id=$1 AND status IN ('booked','issued') AND boarding_status='issued'`, ticketID)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "ticket not valid")
	}
	s.recordModeEvent(ctx, operatorUserID, "bus.boarded", "bus_ticket", ticketID, status, "boarded", nil)
	return map[string]any{"ok": true, "ticketId": ticketID, "boardingStatus": "boarded"}, nil
}

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
		dbutil.NullInt(int64(req.DistanceM)), dbutil.NullInt(int64(req.EstDurationS)), category); err != nil {
		return nil, err
	}
	_ = writeAudit(ctx, a.svc.db, adminID, "bus.route.create", "bus_route", id, nil,
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
	if err := validateCancelCutoff(req.CancelCutoffMinutes); err != nil {
		return nil, err
	}
	id := uuid.New().String()
	const q = `
		INSERT INTO bus_schedules (id, route_id, departure_time, arrival_estimate, total_seats, fare_kobo, fare_approved, status, cancel_cutoff_minutes)
		VALUES ($1,$2,$3,$4,$5,$6,FALSE,'scheduled',$7)`
	if _, err := a.svc.db.Exec(ctx, q, id, req.RouteID, dep, arr, req.TotalSeats, req.FareKobo, req.CancelCutoffMinutes); err != nil {
		return nil, err
	}
	_ = writeAudit(ctx, a.svc.db, adminID, "bus.schedule.create", "bus_schedule", id, nil,
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
		_, _ = a.svc.db.Exec(ctx, `UPDATE bus_providers SET status='inactive' WHERE id=$1`, providerID)
	case "verified":
		_, _ = a.svc.db.Exec(ctx, `UPDATE bus_providers SET status='active' WHERE id=$1`, providerID)
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
