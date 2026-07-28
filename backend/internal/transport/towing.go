package transport

import (
	"context"
	"fmt"
	"math"
	"net/http"
	"time"

	"github.com/google/uuid"
)

// ─── Towing / roadside ───────────────────────────────────────────────────────
//
// State machine:
//   requested → operator_accepted → operator_en_route → pin_verified
//            → in_progress → completed   (cancelled)
//
// Escrow: book → Escrow(user, "towing:<id>", idemKey, "transport", fare).
// Settle operator split on complete. Cancel → Refund.

var towingTransitions = map[string]map[string]bool{
	"requested":         {"operator_accepted": true, "cancelled": true},
	"operator_accepted": {"operator_en_route": true, "cancelled": true},
	"operator_en_route": {"pin_verified": true, "cancelled": true},
	"pin_verified":      {"in_progress": true, "cancelled": true},
	"in_progress":       {"completed": true},
}

func canTransitionTowing(from, to string) bool {
	if from == to {
		return false
	}
	m, ok := towingTransitions[from]
	if !ok {
		return false
	}
	return m[to]
}

// ─── Request bodies ──────────────────────────────────────────────────────────

// TowingEstimateRequest is POST /mobility/towing/estimate.
type TowingEstimateRequest struct {
	ServiceType string `json:"service_type"`
	Pickup      Place  `json:"pickup" binding:"required"`
	Dest        *Place `json:"dest"`
}

// TowingBookRequest is POST /mobility/towing.
type TowingBookRequest struct {
	ServiceType    string `json:"service_type"`
	VehicleType    string `json:"vehicle_type"`
	IssueType      string `json:"issue_type"`
	Pickup         Place  `json:"pickup" binding:"required"`
	Dest           *Place `json:"dest"`
	IdempotencyKey string `json:"idempotency_key"`
}

// TowingEstimate is the estimate response.
type TowingEstimate struct {
	DistanceM   int   `json:"distanceM"`
	CalloutKobo int64 `json:"calloutKobo"`
	FareKobo    int64 `json:"fareKobo"`
}

// towingRow is the internal projection of a towing job.
type towingRow struct {
	ID           string
	UserID       string
	OperatorID   *string
	Status       string
	FareKobo     int64
	Pin          *string
	SettlementID *string
}

func (s *Service) loadTowing(ctx context.Context, id string, t *towingRow) error {
	const q = `SELECT id, user_id, operator_id, status, fare_kobo, pin, settlement_id FROM towing_jobs WHERE id=$1`
	return s.db.QueryRow(ctx, q, id).Scan(
		&t.ID, &t.UserID, &t.OperatorID, &t.Status, &t.FareKobo, &t.Pin, &t.SettlementID,
	)
}

// towingFare = callout (base) + per_km*km. per_min ignored (towing per_min=0).
func towingFare(distanceM int, cfg *PricingConfig) int64 {
	km := float64(distanceM) / 1000.0
	raw := float64(cfg.BaseFareKobo) + km*float64(cfg.PerKMKobo)
	fare := int64(math.Round(raw))
	if fare < cfg.MinFareKobo {
		fare = cfg.MinFareKobo
	}
	return fare
}

// EstimateTowing returns callout + distance fare.
func (s *Service) EstimateTowing(ctx context.Context, req TowingEstimateRequest) (*TowingEstimate, error) {
	cfg, err := s.loadPricingConfig(ctx, "default", "towing")
	if err != nil {
		return nil, err
	}
	distanceM := 0
	if req.Dest != nil {
		route, err := s.maps.Route(ctx,
			LatLng{Lat: req.Pickup.Lat, Lng: req.Pickup.Lng},
			LatLng{Lat: req.Dest.Lat, Lng: req.Dest.Lng},
		)
		if err != nil {
			return nil, err
		}
		distanceM = route.DistanceM
	}
	fare := towingFare(distanceM, cfg)
	return &TowingEstimate{DistanceM: distanceM, CalloutKobo: cfg.BaseFareKobo, FareKobo: fare}, nil
}

// BookTowing books + escrows a towing job and generates an operator PIN.
func (s *Service) BookTowing(ctx context.Context, userID string, req TowingBookRequest, idempotencyKey string) (map[string]any, error) {
	if idempotencyKey == "" {
		idempotencyKey = req.IdempotencyKey
	}
	if idempotencyKey == "" {
		return nil, codedErr(http.StatusBadRequest, "MISSING_IDEMPOTENCY_KEY", "idempotency key required")
	}
	cfg, err := s.loadPricingConfig(ctx, "default", "towing")
	if err != nil {
		return nil, err
	}
	distanceM := 0
	if req.Dest != nil {
		route, err := s.maps.Route(ctx,
			LatLng{Lat: req.Pickup.Lat, Lng: req.Pickup.Lng},
			LatLng{Lat: req.Dest.Lat, Lng: req.Dest.Lng},
		)
		if err != nil {
			return nil, err
		}
		distanceM = route.DistanceM
	}
	fare := towingFare(distanceM, cfg)
	serviceType := req.ServiceType
	if serviceType == "" {
		serviceType = "tow"
	}

	// Fail-closed tier/spending-limit gate BEFORE any wallet escrow (same contract
	// as RequestRide): a Tier0/over-limit user cannot move money.
	if err := s.enforceTierLimit(ctx, userID, fare); err != nil {
		return nil, err
	}

	jobID := uuid.New().String()
	ref := "towing:" + jobID
	sett, err := s.settlement.Escrow(ctx, userID, ref, idempotencyKey, "transport", fare)
	if err != nil {
		return nil, fmt.Errorf("transport: escrow towing fare: %w", err)
	}
	pin := generatePin()
	var destAddr any
	if req.Dest != nil {
		destAddr = req.Dest.Address
	}
	const q = `
		INSERT INTO towing_jobs
			(id, user_id, service_type, vehicle_type, issue_type, pickup_address, pickup_lat, pickup_lng,
			 dest_address, fare_kobo, status, pin, settlement_id, idempotency_key)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'requested',$11,$12,$13)`
	if _, err := s.db.Exec(ctx, q,
		jobID, userID, serviceType, nullStr(req.VehicleType), nullStr(req.IssueType),
		req.Pickup.Address, req.Pickup.Lat, req.Pickup.Lng, destAddr,
		fare, pin, sett.ID, idempotencyKey,
	); err != nil {
		return nil, fmt.Errorf("transport: insert towing job: %w", err)
	}
	s.recordModeEvent(ctx, userID, "towing.requested", "towing_job", jobID, "", "requested",
		map[string]any{"fare_kobo": fare, "service_type": serviceType})
	return s.TowingDetail(ctx, jobID, userID)
}

// TowingDetail returns a towing job; user sees the PIN, operator does not.
func (s *Service) TowingDetail(ctx context.Context, id, callerID string) (map[string]any, error) {
	const q = `
		SELECT id, user_id, operator_id, service_type, vehicle_type, issue_type,
		       pickup_address, dest_address, fare_kobo, status, pin, created_at
		FROM towing_jobs WHERE id=$1`
	var (
		jid, uid, serviceType, pickup, status      string
		operatorID, vtype, issue, dest, pin        *string
		fare                                       int64
		createdAt                                  time.Time
	)
	if err := s.db.QueryRow(ctx, q, id).Scan(
		&jid, &uid, &operatorID, &serviceType, &vtype, &issue,
		&pickup, &dest, &fare, &status, &pin, &createdAt,
	); err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "towing job not found")
	}
	isUser := callerID == uid
	if !isUser {
		if operatorID == nil {
			return nil, codedErr(http.StatusForbidden, CodeForbidden, "not permitted")
		}
		var ownerUser string
		s.db.QueryRow(ctx, `SELECT user_id FROM drivers WHERE id=$1`, *operatorID).Scan(&ownerUser)
		if ownerUser != callerID {
			return nil, codedErr(http.StatusForbidden, CodeForbidden, "not permitted")
		}
	}
	out := map[string]any{
		"id": jid, "userId": uid, "operatorId": operatorID, "serviceType": serviceType,
		"vehicleType": vtype, "issueType": issue, "pickupAddress": pickup, "destAddress": dest,
		"fareKobo": fare, "status": status, "createdAt": createdAt,
	}
	if isUser {
		out["pin"] = pin
	}
	return out, nil
}

// ListTowing returns the user's towing jobs.
func (s *Service) ListTowing(ctx context.Context, userID string) ([]map[string]any, error) {
	const q = `
		SELECT id, service_type, pickup_address, dest_address, fare_kobo, status, created_at
		FROM towing_jobs WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100`
	rows, err := s.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, serviceType, pickup, status string
		var dest *string
		var fare int64
		var createdAt time.Time
		if err := rows.Scan(&id, &serviceType, &pickup, &dest, &fare, &status, &createdAt); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"id": id, "serviceType": serviceType, "pickupAddress": pickup, "destAddress": dest,
			"fareKobo": fare, "status": status, "createdAt": createdAt,
		})
	}
	return out, nil
}

// CancelTowing refunds + cancels a job (user only).
func (s *Service) CancelTowing(ctx context.Context, id, userID, reason string) error {
	var t towingRow
	if err := s.loadTowing(ctx, id, &t); err != nil {
		return codedErr(http.StatusNotFound, CodeNotFound, "towing job not found")
	}
	if t.UserID != userID {
		return codedErr(http.StatusForbidden, CodeForbidden, "not your job")
	}
	if !canTransitionTowing(t.Status, "cancelled") {
		return codedErr(http.StatusConflict, CodeInvalidState, fmt.Sprintf("cannot cancel from status %s", t.Status))
	}
	if err := s.towingSetStatus(ctx, id, t.Status, "cancelled"); err != nil {
		return err
	}
	if t.SettlementID != nil {
		s.settlement.Refund(ctx, *t.SettlementID, "towing_cancelled:"+reason)
	}
	if t.OperatorID != nil {
		s.db.Exec(ctx, `UPDATE drivers SET status='online', cancelled_trips=cancelled_trips+1, updated_at=NOW() WHERE id=$1`, *t.OperatorID)
	}
	s.recordModeEvent(ctx, userID, "towing.cancelled", "towing_job", id, t.Status, "cancelled", map[string]any{"reason": reason})
	return nil
}

// towingSetStatus performs a guarded status update.
func (s *Service) towingSetStatus(ctx context.Context, id, from, to string) error {
	if !canTransitionTowing(from, to) {
		return codedErr(http.StatusConflict, CodeInvalidState, fmt.Sprintf("illegal towing transition %s → %s", from, to))
	}
	tag, err := s.db.Exec(ctx, `UPDATE towing_jobs SET status=$1, updated_at=NOW() WHERE id=$2 AND status=$3`, to, id, from)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return codedErr(http.StatusConflict, CodeInvalidState, "towing status changed concurrently")
	}
	return nil
}

// ─── Operator (driver) flows ─────────────────────────────────────────────────

// OpenTowingRequests returns unassigned, requested jobs for operators.
func (s *Service) OpenTowingRequests(ctx context.Context, driverUserID string) ([]map[string]any, error) {
	if _, err := s.driverGate(ctx, driverUserID); err != nil {
		return nil, err
	}
	const q = `
		SELECT id, service_type, vehicle_type, issue_type, pickup_address, fare_kobo, created_at
		FROM towing_jobs WHERE operator_id IS NULL AND status='requested' ORDER BY created_at DESC LIMIT 50`
	rows, err := s.db.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, serviceType, pickup string
		var vtype, issue *string
		var fare int64
		var createdAt time.Time
		if err := rows.Scan(&id, &serviceType, &vtype, &issue, &pickup, &fare, &createdAt); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"id": id, "serviceType": serviceType, "vehicleType": vtype, "issueType": issue,
			"pickupAddress": pickup, "fareKobo": fare, "createdAt": createdAt,
		})
	}
	return out, nil
}

// AcceptTowing assigns an approved operator → operator_accepted.
func (s *Service) AcceptTowing(ctx context.Context, id, driverUserID string) (map[string]any, error) {
	operatorID, err := s.driverGate(ctx, driverUserID)
	if err != nil {
		return nil, err
	}
	var t towingRow
	if err := s.loadTowing(ctx, id, &t); err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "towing job not found")
	}
	if t.Status != "requested" {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "job not open for acceptance")
	}
	tag, err := s.db.Exec(ctx,
		`UPDATE towing_jobs SET operator_id=$1, status='operator_accepted', updated_at=NOW() WHERE id=$2 AND operator_id IS NULL AND status='requested'`,
		operatorID, id)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "job already taken")
	}
	s.db.Exec(ctx, `UPDATE drivers SET status='on_trip', updated_at=NOW() WHERE id=$1`, operatorID)
	s.recordModeEvent(ctx, driverUserID, "towing.operator_accepted", "towing_job", id, "requested", "operator_accepted",
		map[string]any{"operator_id": operatorID})
	return s.TowingDetail(ctx, id, driverUserID)
}

// TowingEnRoute: operator_accepted → operator_en_route.
func (s *Service) TowingEnRoute(ctx context.Context, id, driverUserID string) error {
	return s.towingOperatorTransition(ctx, id, driverUserID, "operator_accepted", "operator_en_route", "towing.operator_en_route")
}

// VerifyTowingPin: operator_en_route → pin_verified (PIN must match).
func (s *Service) VerifyTowingPin(ctx context.Context, id, driverUserID, pin string) error {
	t, err := s.operatorOwnedTowing(ctx, id, driverUserID)
	if err != nil {
		return err
	}
	if t.Status != "operator_en_route" {
		return codedErr(http.StatusConflict, CodeInvalidState, "job not awaiting PIN")
	}
	if t.Pin == nil || *t.Pin != pin {
		return codedErr(http.StatusUnprocessableEntity, CodePinMismatch, "PIN does not match")
	}
	if err := s.towingSetStatus(ctx, id, "operator_en_route", "pin_verified"); err != nil {
		return err
	}
	s.recordModeEvent(ctx, driverUserID, "towing.pin_verified", "towing_job", id, "operator_en_route", "pin_verified", nil)
	return nil
}

// StartTowing: pin_verified → in_progress.
func (s *Service) StartTowing(ctx context.Context, id, driverUserID string) error {
	return s.towingOperatorTransition(ctx, id, driverUserID, "pin_verified", "in_progress", "towing.in_progress")
}

// CompleteTowing: in_progress → completed + settle operator.
func (s *Service) CompleteTowing(ctx context.Context, id, driverUserID string) error {
	t, err := s.operatorOwnedTowing(ctx, id, driverUserID)
	if err != nil {
		return err
	}
	if t.Status != "in_progress" {
		return codedErr(http.StatusConflict, CodeInvalidState, "job not in progress")
	}
	if err := s.towingSetStatus(ctx, id, "in_progress", "completed"); err != nil {
		return err
	}
	if t.SettlementID != nil && t.OperatorID != nil {
		if err := s.settleModeProvider(ctx, *t.SettlementID, *t.OperatorID); err != nil {
			return fmt.Errorf("transport: settle towing: %w", err)
		}
	}
	if t.OperatorID != nil {
		s.db.Exec(ctx, `UPDATE drivers SET status='online', completed_trips=completed_trips+1, updated_at=NOW() WHERE id=$1`, *t.OperatorID)
	}
	s.recordModeEvent(ctx, driverUserID, "towing.completed", "towing_job", id, "in_progress", "completed", nil)
	return nil
}

// towingOperatorTransition is a guarded operator-initiated transition with authz.
func (s *Service) towingOperatorTransition(ctx context.Context, id, driverUserID, from, to, action string) error {
	t, err := s.operatorOwnedTowing(ctx, id, driverUserID)
	if err != nil {
		return err
	}
	if t.Status != from {
		return codedErr(http.StatusConflict, CodeInvalidState, "job not in expected status "+from)
	}
	if err := s.towingSetStatus(ctx, id, from, to); err != nil {
		return err
	}
	s.recordModeEvent(ctx, driverUserID, action, "towing_job", id, from, to, nil)
	return nil
}

// operatorOwnedTowing loads a job and asserts the caller is the assigned operator.
func (s *Service) operatorOwnedTowing(ctx context.Context, id, driverUserID string) (*towingRow, error) {
	driverID, err := s.driverGate(ctx, driverUserID)
	if err != nil {
		return nil, err
	}
	var t towingRow
	if err := s.loadTowing(ctx, id, &t); err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "towing job not found")
	}
	if t.OperatorID == nil || *t.OperatorID != driverID {
		return nil, codedErr(http.StatusForbidden, CodeForbidden, "not the assigned operator")
	}
	return &t, nil
}
