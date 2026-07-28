package transport

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"
)

// ─── Car hire / chauffeur ────────────────────────────────────────────────────
//
// State machine:
//   requested → quoted → confirmed → active → (extended) → completed
//   (cancelled)
//
// Quote returns fare + deposit from the car_hire pricing config.
// Book escrows fare + deposit (two settlements under one reference prefix).
// Extend escrows the delta. Complete settles the driver split (fare + extends)
// and refunds the deposit. Cancel refunds everything.

var carHireTransitions = map[string]map[string]bool{
	"requested": {"quoted": true, "confirmed": true, "cancelled": true},
	"quoted":    {"confirmed": true, "cancelled": true},
	"confirmed": {"active": true, "cancelled": true},
	"active":    {"extended": true, "completed": true, "cancelled": true},
	"extended":  {"extended": true, "completed": true, "cancelled": true},
}

func canTransitionCarHire(from, to string) bool {
	if from == to {
		// Allow extended → extended (repeat extensions).
		return from == "extended" && to == "extended"
	}
	m, ok := carHireTransitions[from]
	if !ok {
		return false
	}
	return m[to]
}

// ─── Request bodies ──────────────────────────────────────────────────────────

// CarHireQuoteRequest is POST /mobility/car-hire/quote.
type CarHireQuoteRequest struct {
	HireType      string `json:"hire_type"`
	VehicleClass  string `json:"vehicle_class"`
	StartAt       string `json:"start_at" binding:"required"` // RFC3339
	DurationHours int    `json:"duration_hours" binding:"required,min=1"`
	Chauffeur     bool   `json:"chauffeur"`
	PickupAddress string `json:"pickup_address"`
}

// CarHireBookRequest is POST /mobility/car-hire/book.
type CarHireBookRequest struct {
	HireType       string `json:"hire_type"`
	VehicleClass   string `json:"vehicle_class"`
	StartAt        string `json:"start_at" binding:"required"`
	DurationHours  int    `json:"duration_hours" binding:"required,min=1"`
	Chauffeur      bool   `json:"chauffeur"`
	PickupAddress  string `json:"pickup_address"`
	SpecialRequest string `json:"special_request"`
	IdempotencyKey string `json:"idempotency_key"`
}

// CarHireExtendRequest is POST /mobility/car-hire/:id/extend.
type CarHireExtendRequest struct {
	ExtraHours     int    `json:"extra_hours" binding:"required,min=1"`
	IdempotencyKey string `json:"idempotency_key"`
}

// CarHireQuote is the quote response.
type CarHireQuote struct {
	FareKobo    int64 `json:"fareKobo"`
	DepositKobo int64 `json:"depositKobo"`
	TotalKobo   int64 `json:"totalKobo"`
}

// carHireRow is the internal projection of a car-hire booking.
type carHireRow struct {
	ID            string
	UserID        string
	DriverID      *string
	Status        string
	FareKobo      int64
	DepositKobo   int64
	DurationHours int
	SettlementID  *string
}

func (s *Service) loadCarHire(ctx context.Context, id string, b *carHireRow) error {
	const q = `SELECT id, user_id, driver_id, status, fare_kobo, deposit_kobo, duration_hours, settlement_id
	           FROM car_hire_bookings WHERE id=$1`
	return s.db.QueryRow(ctx, q, id).Scan(
		&b.ID, &b.UserID, &b.DriverID, &b.Status, &b.FareKobo, &b.DepositKobo, &b.DurationHours, &b.SettlementID,
	)
}

// carHireFare computes fare (base + per_hour) and deposit (one period base).
// per_km_kobo is reused as the per-hour rate for the car_hire service_type.
func carHireFare(durationHours int, cfg *PricingConfig) (fare, deposit int64) {
	fare = cfg.BaseFareKobo + int64(durationHours)*cfg.PerKMKobo
	if fare < cfg.MinFareKobo {
		fare = cfg.MinFareKobo
	}
	// Deposit = one base period (refundable security hold).
	deposit = cfg.BaseFareKobo
	return fare, deposit
}

// QuoteCarHire returns the fare + deposit for a hire.
func (s *Service) QuoteCarHire(ctx context.Context, req CarHireQuoteRequest) (*CarHireQuote, error) {
	cfg, err := s.loadPricingConfig(ctx, "default", "car_hire")
	if err != nil {
		return nil, err
	}
	fare, deposit := carHireFare(req.DurationHours, cfg)
	return &CarHireQuote{FareKobo: fare, DepositKobo: deposit, TotalKobo: fare + deposit}, nil
}

// BookCarHire escrows fare + deposit and creates a confirmed booking.
func (s *Service) BookCarHire(ctx context.Context, userID string, req CarHireBookRequest, idempotencyKey string) (map[string]any, error) {
	if idempotencyKey == "" {
		idempotencyKey = req.IdempotencyKey
	}
	if idempotencyKey == "" {
		return nil, codedErr(http.StatusBadRequest, "MISSING_IDEMPOTENCY_KEY", "idempotency key required")
	}
	startAt, err := time.Parse(time.RFC3339, req.StartAt)
	if err != nil {
		return nil, codedErr(http.StatusBadRequest, "INVALID_TIME", "start_at must be RFC3339")
	}
	cfg, err := s.loadPricingConfig(ctx, "default", "car_hire")
	if err != nil {
		return nil, err
	}
	fare, deposit := carHireFare(req.DurationHours, cfg)
	hireType := req.HireType
	if hireType == "" {
		hireType = "daily"
	}
	vehicleClass := req.VehicleClass
	if vehicleClass == "" {
		vehicleClass = "economy"
	}

	// Fail-closed tier/spending-limit gate BEFORE any wallet escrow (same contract
	// as RequestRide). The gate covers the FULL wallet debit about to be attempted
	// (fare + deposit), not just the fare, so an over-limit user cannot slip through
	// on the sum of the two escrows.
	if err := s.enforceTierLimit(ctx, userID, fare+deposit); err != nil {
		return nil, err
	}

	bookingID := uuid.New().String()
	// Escrow fare and deposit as two separate settlements under one prefix.
	fareSett, err := s.settlement.Escrow(ctx, userID, "carhire:"+bookingID, idempotencyKey+":fare", "transport", fare)
	if err != nil {
		return nil, fmt.Errorf("transport: escrow car-hire fare: %w", err)
	}
	if deposit > 0 {
		if _, err := s.settlement.Escrow(ctx, userID, "carhire:"+bookingID+":deposit", idempotencyKey+":deposit", "transport", deposit); err != nil {
			return nil, fmt.Errorf("transport: escrow car-hire deposit: %w", err)
		}
	}
	const q = `
		INSERT INTO car_hire_bookings
			(id, user_id, hire_type, vehicle_class, chauffeur, start_at, duration_hours, pickup_address,
			 special_request, deposit_kobo, fare_kobo, status, settlement_id, idempotency_key)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'confirmed',$12,$13)`
	if _, err := s.db.Exec(ctx, q,
		bookingID, userID, hireType, vehicleClass, req.Chauffeur, startAt, req.DurationHours,
		nullStr(req.PickupAddress), nullStr(req.SpecialRequest), deposit, fare, fareSett.ID, idempotencyKey,
	); err != nil {
		return nil, fmt.Errorf("transport: insert car-hire booking: %w", err)
	}
	s.recordModeEvent(ctx, userID, "carhire.confirmed", "car_hire_booking", bookingID, "", "confirmed",
		map[string]any{"fare_kobo": fare, "deposit_kobo": deposit})
	return s.CarHireDetail(ctx, bookingID, userID)
}

// CarHireDetail returns a booking (owner or assigned driver).
func (s *Service) CarHireDetail(ctx context.Context, id, callerID string) (map[string]any, error) {
	const q = `
		SELECT id, user_id, driver_id, hire_type, vehicle_class, chauffeur, start_at, duration_hours,
		       pickup_address, special_request, deposit_kobo, fare_kobo, status, created_at
		FROM car_hire_bookings WHERE id=$1`
	var (
		bid, uid, hireType, vehicleClass, status string
		driverID, pickup, special                *string
		chauffeur                                bool
		startAt                                  time.Time
		duration                                 int
		deposit, fare                            int64
		createdAt                                time.Time
	)
	if err := s.db.QueryRow(ctx, q, id).Scan(
		&bid, &uid, &driverID, &hireType, &vehicleClass, &chauffeur, &startAt, &duration,
		&pickup, &special, &deposit, &fare, &status, &createdAt,
	); err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "booking not found")
	}
	if callerID != uid {
		if driverID == nil {
			return nil, codedErr(http.StatusForbidden, CodeForbidden, "not permitted")
		}
		var ownerUser string
		s.db.QueryRow(ctx, `SELECT user_id FROM drivers WHERE id=$1`, *driverID).Scan(&ownerUser)
		if ownerUser != callerID {
			return nil, codedErr(http.StatusForbidden, CodeForbidden, "not permitted")
		}
	}
	return map[string]any{
		"id": bid, "userId": uid, "driverId": driverID, "hireType": hireType,
		"vehicleClass": vehicleClass, "chauffeur": chauffeur, "startAt": startAt,
		"durationHours": duration, "pickupAddress": pickup, "specialRequest": special,
		"depositKobo": deposit, "fareKobo": fare, "status": status, "createdAt": createdAt,
	}, nil
}

// ExtendCarHire escrows the delta for extra hours and marks the booking extended.
func (s *Service) ExtendCarHire(ctx context.Context, id, userID string, extraHours int, idempotencyKey string) (map[string]any, error) {
	if idempotencyKey == "" {
		return nil, codedErr(http.StatusBadRequest, "MISSING_IDEMPOTENCY_KEY", "idempotency key required")
	}
	var b carHireRow
	if err := s.loadCarHire(ctx, id, &b); err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "booking not found")
	}
	if b.UserID != userID {
		return nil, codedErr(http.StatusForbidden, CodeForbidden, "not your booking")
	}
	if b.Status != "active" && b.Status != "extended" {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "booking not active")
	}
	cfg, err := s.loadPricingConfig(ctx, "default", "car_hire")
	if err != nil {
		return nil, err
	}
	delta := int64(extraHours) * cfg.PerKMKobo
	if delta <= 0 {
		return nil, codedErr(http.StatusUnprocessableEntity, "INVALID_EXTENSION", "extension amount must be positive")
	}
	// Fail-closed tier/spending-limit gate BEFORE the extension escrow (same contract
	// as adjustEscrow's delta gate): an over-limit user cannot extend on wallet.
	if err := s.enforceTierLimit(ctx, userID, delta); err != nil {
		return nil, err
	}
	extRef := fmt.Sprintf("carhire:%s:ext:%d", id, time.Now().UnixNano())
	if _, err := s.settlement.Escrow(ctx, userID, extRef, idempotencyKey, "transport", delta); err != nil {
		return nil, fmt.Errorf("transport: escrow car-hire extension: %w", err)
	}
	// active → extended, or extended → extended (repeat).
	from := b.Status
	if _, err := s.db.Exec(ctx,
		`UPDATE car_hire_bookings SET status='extended', duration_hours=duration_hours+$1, fare_kobo=fare_kobo+$2, updated_at=NOW() WHERE id=$3`,
		extraHours, delta, id); err != nil {
		return nil, err
	}
	s.recordModeEvent(ctx, userID, "carhire.extended", "car_hire_booking", id, from, "extended",
		map[string]any{"extra_hours": extraHours, "delta_kobo": delta})
	return s.CarHireDetail(ctx, id, userID)
}

// ActivateCarHire moves a confirmed booking → active (customer or system).
func (s *Service) ActivateCarHire(ctx context.Context, id, userID string) error {
	var b carHireRow
	if err := s.loadCarHire(ctx, id, &b); err != nil {
		return codedErr(http.StatusNotFound, CodeNotFound, "booking not found")
	}
	if b.UserID != userID {
		return codedErr(http.StatusForbidden, CodeForbidden, "not your booking")
	}
	if b.Status != "confirmed" {
		return codedErr(http.StatusConflict, CodeInvalidState, "booking not confirmed")
	}
	if err := s.carHireSetStatus(ctx, id, "confirmed", "active"); err != nil {
		return err
	}
	s.recordModeEvent(ctx, userID, "carhire.active", "car_hire_booking", id, "confirmed", "active", nil)
	return nil
}

// CompleteCarHire settles the driver split (fare + extensions) and refunds the
// deposit. Owner or assigned driver may complete.
func (s *Service) CompleteCarHire(ctx context.Context, id, callerID string) error {
	var b carHireRow
	if err := s.loadCarHire(ctx, id, &b); err != nil {
		return codedErr(http.StatusNotFound, CodeNotFound, "booking not found")
	}
	// Object-level authz: owner or assigned driver.
	if b.UserID != callerID {
		if b.DriverID == nil {
			return codedErr(http.StatusForbidden, CodeForbidden, "not permitted")
		}
		var ownerUser string
		s.db.QueryRow(ctx, `SELECT user_id FROM drivers WHERE id=$1`, *b.DriverID).Scan(&ownerUser)
		if ownerUser != callerID {
			return codedErr(http.StatusForbidden, CodeForbidden, "not permitted")
		}
	}
	if b.Status != "active" && b.Status != "extended" && b.Status != "confirmed" {
		return codedErr(http.StatusConflict, CodeInvalidState, "booking not completable from "+b.Status)
	}
	from := b.Status
	if err := s.carHireSetStatus(ctx, id, from, "completed"); err != nil {
		return err
	}

	// Settle fare + every extension settlement to the driver; refund the deposit.
	comm, _ := s.commissionForTier(ctx, s.driverTier(ctx, b.DriverID))
	var driverUserID string
	if b.DriverID != nil {
		s.db.QueryRow(ctx, `SELECT user_id FROM drivers WHERE id=$1`, *b.DriverID).Scan(&driverUserID)
	}
	split := settlementSplit(driverUserID, comm)
	// Fare + extensions: reference 'carhire:<id>' and 'carhire:<id>:ext:%' (NOT deposit).
	rows, err := s.db.Query(ctx,
		`SELECT id FROM settlements WHERE status='escrowed' AND (reference=$1 OR reference LIKE $2)`,
		"carhire:"+id, "carhire:"+id+":ext:%")
	if err != nil {
		return fmt.Errorf("transport: load car-hire settlements: %w", err)
	}
	var settleIDs []string
	for rows.Next() {
		var sid string
		if err := rows.Scan(&sid); err != nil {
			rows.Close()
			return err
		}
		settleIDs = append(settleIDs, sid)
	}
	rows.Close()
	for _, sid := range settleIDs {
		if err := s.settlement.Settle(ctx, sid, split); err != nil {
			return fmt.Errorf("transport: settle car-hire %s: %w", sid, err)
		}
	}
	// Refund the deposit settlement back to the customer.
	var depositSettID string
	if err := s.db.QueryRow(ctx,
		`SELECT id FROM settlements WHERE reference=$1 AND status='escrowed' LIMIT 1`,
		"carhire:"+id+":deposit").Scan(&depositSettID); err == nil {
		s.settlement.Refund(ctx, depositSettID, "car_hire_deposit_released")
	}
	if b.DriverID != nil {
		s.db.Exec(ctx, `UPDATE drivers SET status='online', completed_trips=completed_trips+1, updated_at=NOW() WHERE id=$1`, *b.DriverID)
	}
	s.recordModeEvent(ctx, callerID, "carhire.completed", "car_hire_booking", id, from, "completed", nil)
	return nil
}

// driverTier returns a driver's commission tier (default "standard").
func (s *Service) driverTier(ctx context.Context, driverID *string) string {
	tier := "standard"
	if driverID != nil {
		s.db.QueryRow(ctx, `SELECT commission_tier FROM drivers WHERE id=$1`, *driverID).Scan(&tier)
	}
	return tier
}

// CancelCarHire refunds all escrowed amounts (fare, deposit, extensions).
func (s *Service) CancelCarHire(ctx context.Context, id, userID, reason string) error {
	var b carHireRow
	if err := s.loadCarHire(ctx, id, &b); err != nil {
		return codedErr(http.StatusNotFound, CodeNotFound, "booking not found")
	}
	if b.UserID != userID {
		return codedErr(http.StatusForbidden, CodeForbidden, "not your booking")
	}
	if !canTransitionCarHire(b.Status, "cancelled") {
		return codedErr(http.StatusConflict, CodeInvalidState, fmt.Sprintf("cannot cancel from status %s", b.Status))
	}
	if err := s.carHireSetStatus(ctx, id, b.Status, "cancelled"); err != nil {
		return err
	}
	// Refund every escrowed settlement under this booking's prefix.
	rows, err := s.db.Query(ctx,
		`SELECT id FROM settlements WHERE status='escrowed' AND (reference=$1 OR reference LIKE $2)`,
		"carhire:"+id, "carhire:"+id+":%")
	if err == nil {
		var ids []string
		for rows.Next() {
			var sid string
			rows.Scan(&sid)
			ids = append(ids, sid)
		}
		rows.Close()
		for _, sid := range ids {
			s.settlement.Refund(ctx, sid, "car_hire_cancelled:"+reason)
		}
	}
	if b.DriverID != nil {
		s.db.Exec(ctx, `UPDATE drivers SET status='online', cancelled_trips=cancelled_trips+1, updated_at=NOW() WHERE id=$1`, *b.DriverID)
	}
	s.recordModeEvent(ctx, userID, "carhire.cancelled", "car_hire_booking", id, b.Status, "cancelled", map[string]any{"reason": reason})
	return nil
}

// carHireSetStatus performs a guarded status update.
func (s *Service) carHireSetStatus(ctx context.Context, id, from, to string) error {
	if to != "cancelled" && to != "completed" && !canTransitionCarHire(from, to) {
		return codedErr(http.StatusConflict, CodeInvalidState, fmt.Sprintf("illegal car-hire transition %s → %s", from, to))
	}
	if to == "cancelled" && !canTransitionCarHire(from, "cancelled") {
		return codedErr(http.StatusConflict, CodeInvalidState, fmt.Sprintf("cannot cancel from %s", from))
	}
	if to == "completed" {
		ok := from == "active" || from == "extended" || from == "confirmed"
		if !ok {
			return codedErr(http.StatusConflict, CodeInvalidState, fmt.Sprintf("cannot complete from %s", from))
		}
	}
	tag, err := s.db.Exec(ctx, `UPDATE car_hire_bookings SET status=$1, updated_at=NOW() WHERE id=$2 AND status=$3`, to, id, from)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return codedErr(http.StatusConflict, CodeInvalidState, "car-hire status changed concurrently")
	}
	return nil
}

// ListCarHire returns the user's bookings.
func (s *Service) ListCarHire(ctx context.Context, userID string) ([]map[string]any, error) {
	const q = `
		SELECT id, hire_type, vehicle_class, start_at, duration_hours, fare_kobo, deposit_kobo, status, created_at
		FROM car_hire_bookings WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100`
	rows, err := s.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, hireType, vehicleClass, status string
		var startAt, createdAt time.Time
		var duration int
		var fare, deposit int64
		if err := rows.Scan(&id, &hireType, &vehicleClass, &startAt, &duration, &fare, &deposit, &status, &createdAt); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"id": id, "hireType": hireType, "vehicleClass": vehicleClass, "startAt": startAt,
			"durationHours": duration, "fareKobo": fare, "depositKobo": deposit,
			"status": status, "createdAt": createdAt,
		})
	}
	return out, nil
}
