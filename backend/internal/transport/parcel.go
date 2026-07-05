package transport

import (
	"context"
	"fmt"
	"math"
	"net/http"
	"time"

	"github.com/google/uuid"
)

// ─── Parcel delivery ─────────────────────────────────────────────────────────
//
// State machine:
//   created → courier_assigned → pickup_pin_verified → picked_up
//          → in_transit → dropoff_verified → delivered
//   (failed / disputed / cancelled)
//
// Escrow: book → Escrow(sender, "parcel:<id>", idemKey, "transport", fare).
// Release with Settle(courier split) only on dropoff PIN + proof verification.
// Cancel → Refund.

// parcelTransitions is the guarded state machine for parcels.
var parcelTransitions = map[string]map[string]bool{
	"created":              {"courier_assigned": true, "cancelled": true},
	"courier_assigned":     {"pickup_pin_verified": true, "cancelled": true, "failed": true},
	"pickup_pin_verified":  {"picked_up": true, "cancelled": true, "failed": true},
	"picked_up":            {"in_transit": true, "dropoff_verified": true, "failed": true, "disputed": true},
	"in_transit":           {"dropoff_verified": true, "failed": true, "disputed": true},
	"dropoff_verified":     {"delivered": true},
}

func canTransitionParcel(from, to string) bool {
	if from == to {
		return false
	}
	m, ok := parcelTransitions[from]
	if !ok {
		return false
	}
	return m[to]
}

// parcelSizeMultiplier scales fare by declared package size.
func parcelSizeMultiplier(size string) float64 {
	switch size {
	case "small":
		return 1.0
	case "medium":
		return 1.4
	case "large":
		return 2.0
	default:
		return 1.0
	}
}

// parcelSpeedMultiplier scales fare by requested delivery speed.
func parcelSpeedMultiplier(speed string) float64 {
	switch speed {
	case "express":
		return 1.5
	case "scheduled":
		return 0.9
	default: // standard
		return 1.0
	}
}

// parcelRow is the internal projection of a parcel.
type parcelRow struct {
	ID           string
	SenderID     string
	CourierID    *string
	Status       string
	FareKobo     int64
	PickupPin    *string
	DropoffPin   *string
	SettlementID *string
	DistanceM    *int
}

func (s *Service) loadParcel(ctx context.Context, id string, p *parcelRow) error {
	const q = `SELECT id, sender_id, courier_id, status, fare_kobo, pickup_pin, dropoff_pin, settlement_id, distance_m
	           FROM parcels WHERE id=$1`
	return s.db.QueryRow(ctx, q, id).Scan(
		&p.ID, &p.SenderID, &p.CourierID, &p.Status, &p.FareKobo,
		&p.PickupPin, &p.DropoffPin, &p.SettlementID, &p.DistanceM,
	)
}

// ─── Request bodies ──────────────────────────────────────────────────────────

// ParcelEstimateRequest is POST /mobility/parcels/estimate.
type ParcelEstimateRequest struct {
	Pickup            Place  `json:"pickup" binding:"required"`
	Dropoff           Place  `json:"dropoff" binding:"required"`
	Category          string `json:"category"`
	Size              string `json:"size"`
	Speed             string `json:"speed"`
	DeclaredValueKobo int64  `json:"declared_value_kobo"`
}

// ParcelBookRequest is POST /mobility/parcels.
type ParcelBookRequest struct {
	Pickup            Place  `json:"pickup" binding:"required"`
	Dropoff           Place  `json:"dropoff" binding:"required"`
	ReceiverName      string `json:"receiver_name" binding:"required"`
	ReceiverPhone     string `json:"receiver_phone" binding:"required"`
	Category          string `json:"category"`
	Size              string `json:"size"`
	Speed             string `json:"speed"`
	DeclaredValueKobo int64  `json:"declared_value_kobo"`
	ProhibitedAck     bool   `json:"prohibited_ack"`
	IdempotencyKey    string `json:"idempotency_key"`
}

// ParcelPickedUpRequest carries the parcel photo confirmation.
type ParcelPickedUpRequest struct {
	PhotoURL string `json:"photo_url"`
}

// ParcelVerifyDropoffRequest is POST /driver/parcels/:id/verify-dropoff.
type ParcelVerifyDropoffRequest struct {
	Pin      string `json:"pin" binding:"required"`
	ProofURL string `json:"proof_url" binding:"required"`
}

// ParcelEstimate is the estimate response.
type ParcelEstimate struct {
	DistanceM      int   `json:"distanceM"`
	DurationS      int   `json:"durationS"`
	FareKobo       int64 `json:"fareKobo"`
	SizeMultiplier float64 `json:"sizeMultiplier"`
	SpeedMultiplier float64 `json:"speedMultiplier"`
}

// ─── Service methods ─────────────────────────────────────────────────────────

// parcelFare computes the fare: (base + per_km*km) * size * speed, floored at min.
func parcelFare(distanceM, durationS int, size, speed string, cfg *PricingConfig) int64 {
	km := float64(distanceM) / 1000.0
	mins := float64(durationS) / 60.0
	raw := float64(cfg.BaseFareKobo) + km*float64(cfg.PerKMKobo) + mins*float64(cfg.PerMinKobo)
	raw *= parcelSizeMultiplier(size) * parcelSpeedMultiplier(speed)
	fare := int64(math.Round(raw))
	if fare < cfg.MinFareKobo {
		fare = cfg.MinFareKobo
	}
	return fare
}

// EstimateParcel returns a fare estimate from distance × size × speed.
func (s *Service) EstimateParcel(ctx context.Context, req ParcelEstimateRequest) (*ParcelEstimate, error) {
	cfg, err := s.loadPricingConfig(ctx, "default", "parcel")
	if err != nil {
		return nil, err
	}
	route, err := s.maps.Route(ctx,
		LatLng{Lat: req.Pickup.Lat, Lng: req.Pickup.Lng},
		LatLng{Lat: req.Dropoff.Lat, Lng: req.Dropoff.Lng},
	)
	if err != nil {
		return nil, err
	}
	fare := parcelFare(route.DistanceM, route.DurationS, req.Size, req.Speed, cfg)
	return &ParcelEstimate{
		DistanceM:       route.DistanceM,
		DurationS:       route.DurationS,
		FareKobo:        fare,
		SizeMultiplier:  parcelSizeMultiplier(req.Size),
		SpeedMultiplier: parcelSpeedMultiplier(req.Speed),
	}, nil
}

// BookParcel books + escrows a parcel; generates pickup_pin + dropoff_pin.
func (s *Service) BookParcel(ctx context.Context, senderID string, req ParcelBookRequest, idempotencyKey string) (map[string]any, error) {
	if idempotencyKey == "" {
		idempotencyKey = req.IdempotencyKey
	}
	if idempotencyKey == "" {
		return nil, codedErr(http.StatusBadRequest, "MISSING_IDEMPOTENCY_KEY", "idempotency key required")
	}
	if !req.ProhibitedAck {
		return nil, codedErr(http.StatusUnprocessableEntity, "PROHIBITED_ACK_REQUIRED", "prohibited items acknowledgement required")
	}
	cfg, err := s.loadPricingConfig(ctx, "default", "parcel")
	if err != nil {
		return nil, err
	}
	route, err := s.maps.Route(ctx,
		LatLng{Lat: req.Pickup.Lat, Lng: req.Pickup.Lng},
		LatLng{Lat: req.Dropoff.Lat, Lng: req.Dropoff.Lng},
	)
	if err != nil {
		return nil, err
	}
	size := req.Size
	if size == "" {
		size = "small"
	}
	speed := req.Speed
	if speed == "" {
		speed = "standard"
	}
	category := req.Category
	if category == "" {
		category = "small"
	}
	fare := parcelFare(route.DistanceM, route.DurationS, size, speed, cfg)

	// Fail-closed tier/spending-limit gate BEFORE any wallet escrow (same contract
	// as RequestRide): a Tier0/over-limit sender cannot move money.
	if err := s.enforceTierLimit(ctx, senderID, fare); err != nil {
		return nil, err
	}

	parcelID := uuid.New().String()
	ref := "parcel:" + parcelID
	sett, err := s.settlement.Escrow(ctx, senderID, ref, idempotencyKey, "transport", fare)
	if err != nil {
		return nil, fmt.Errorf("transport: escrow parcel fare: %w", err)
	}
	pickupPin := generatePin()
	dropoffPin := generatePin()

	const q = `
		INSERT INTO parcels
			(id, sender_id, pickup_address, pickup_lat, pickup_lng, dropoff_address, dropoff_lat, dropoff_lng,
			 receiver_name, receiver_phone, category, size, declared_value_kobo, speed, prohibited_ack,
			 fare_kobo, status, pickup_pin, dropoff_pin, distance_m, settlement_id, idempotency_key)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'created',$17,$18,$19,$20,$21)`
	if _, err := s.db.Exec(ctx, q,
		parcelID, senderID, req.Pickup.Address, req.Pickup.Lat, req.Pickup.Lng,
		req.Dropoff.Address, req.Dropoff.Lat, req.Dropoff.Lng,
		req.ReceiverName, req.ReceiverPhone, category, size, req.DeclaredValueKobo, speed, req.ProhibitedAck,
		fare, pickupPin, dropoffPin, route.DistanceM, sett.ID, idempotencyKey,
	); err != nil {
		return nil, fmt.Errorf("transport: insert parcel: %w", err)
	}
	s.recordModeEvent(ctx, senderID, "parcel.created", "parcel", parcelID, "", "created",
		map[string]any{"fare_kobo": fare, "settlement_id": sett.ID})
	return s.ParcelDetail(ctx, parcelID, senderID)
}

// ParcelDetail returns a parcel; sender sees PINs, courier does not.
func (s *Service) ParcelDetail(ctx context.Context, id, callerID string) (map[string]any, error) {
	const q = `
		SELECT id, sender_id, courier_id, pickup_address, dropoff_address, receiver_name, receiver_phone,
		       category, size, speed, declared_value_kobo, fare_kobo, status, pickup_pin, dropoff_pin,
		       photo_url, proof_url, distance_m, created_at
		FROM parcels WHERE id=$1`
	var (
		pid, senderID, pickup, dropoff, receiver, rphone, category, size, speed, status string
		courierID, photoURL, proofURL, pickupPin, dropoffPin                            *string
		declared, fare                                                                 int64
		distM                                                                          *int
		createdAt                                                                      time.Time
	)
	if err := s.db.QueryRow(ctx, q, id).Scan(
		&pid, &senderID, &courierID, &pickup, &dropoff, &receiver, &rphone,
		&category, &size, &speed, &declared, &fare, &status, &pickupPin, &dropoffPin,
		&photoURL, &proofURL, &distM, &createdAt,
	); err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "parcel not found")
	}
	// Object-level authz: sender, or the assigned courier (via driver user_id).
	isSender := callerID == senderID
	if !isSender {
		if courierID == nil {
			return nil, codedErr(http.StatusForbidden, CodeForbidden, "not permitted")
		}
		var ownerUser string
		s.db.QueryRow(ctx, `SELECT user_id FROM drivers WHERE id=$1`, *courierID).Scan(&ownerUser)
		if ownerUser != callerID {
			return nil, codedErr(http.StatusForbidden, CodeForbidden, "not permitted")
		}
	}
	out := map[string]any{
		"id": pid, "senderId": senderID, "courierId": courierID,
		"pickupAddress": pickup, "dropoffAddress": dropoff,
		"receiverName": receiver, "receiverPhone": rphone,
		"category": category, "size": size, "speed": speed,
		"declaredValueKobo": declared, "fareKobo": fare, "status": status,
		"photoUrl": photoURL, "proofUrl": proofURL, "distanceM": distM, "createdAt": createdAt,
	}
	// Only the sender may read the PINs (courier verifies, never reads).
	if isSender {
		out["pickupPin"] = pickupPin
		out["dropoffPin"] = dropoffPin
	}
	return out, nil
}

// ListParcels returns the sender's parcels.
func (s *Service) ListParcels(ctx context.Context, senderID string) ([]map[string]any, error) {
	const q = `
		SELECT id, pickup_address, dropoff_address, category, size, fare_kobo, status, created_at
		FROM parcels WHERE sender_id=$1 ORDER BY created_at DESC LIMIT 100`
	rows, err := s.db.Query(ctx, q, senderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, pickup, dropoff, category, size, status string
		var fare int64
		var createdAt time.Time
		if err := rows.Scan(&id, &pickup, &dropoff, &category, &size, &fare, &status, &createdAt); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"id": id, "pickupAddress": pickup, "dropoffAddress": dropoff,
			"category": category, "size": size, "fareKobo": fare, "status": status, "createdAt": createdAt,
		})
	}
	return out, nil
}

// CancelParcel refunds escrow and moves the parcel to cancelled (sender only).
func (s *Service) CancelParcel(ctx context.Context, id, senderID, reason string) error {
	var p parcelRow
	if err := s.loadParcel(ctx, id, &p); err != nil {
		return codedErr(http.StatusNotFound, CodeNotFound, "parcel not found")
	}
	if p.SenderID != senderID {
		return codedErr(http.StatusForbidden, CodeForbidden, "not your parcel")
	}
	if !canTransitionParcel(p.Status, "cancelled") {
		return codedErr(http.StatusConflict, CodeInvalidState, fmt.Sprintf("cannot cancel from status %s", p.Status))
	}
	if err := s.parcelSetStatus(ctx, id, p.Status, "cancelled"); err != nil {
		return err
	}
	if p.SettlementID != nil {
		s.settlement.Refund(ctx, *p.SettlementID, "parcel_cancelled:"+reason)
	}
	if p.CourierID != nil {
		s.db.Exec(ctx, `UPDATE drivers SET status='online', cancelled_trips=cancelled_trips+1, updated_at=NOW() WHERE id=$1`, *p.CourierID)
	}
	s.recordModeEvent(ctx, senderID, "parcel.cancelled", "parcel", id, p.Status, "cancelled", map[string]any{"reason": reason})
	return nil
}

// parcelSetStatus performs a guarded status update (rejects illegal transitions).
func (s *Service) parcelSetStatus(ctx context.Context, id, from, to string) error {
	if !canTransitionParcel(from, to) {
		return codedErr(http.StatusConflict, CodeInvalidState, fmt.Sprintf("illegal parcel transition %s → %s", from, to))
	}
	tag, err := s.db.Exec(ctx, `UPDATE parcels SET status=$1, updated_at=NOW() WHERE id=$2 AND status=$3`, to, id, from)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return codedErr(http.StatusConflict, CodeInvalidState, "parcel status changed concurrently")
	}
	return nil
}

// ─── Courier (driver) flows ──────────────────────────────────────────────────

// OpenParcelRequests returns unassigned, created parcels for couriers.
func (s *Service) OpenParcelRequests(ctx context.Context, driverUserID string) ([]map[string]any, error) {
	if _, err := s.driverGate(ctx, driverUserID); err != nil {
		return nil, err
	}
	const q = `
		SELECT id, pickup_address, dropoff_address, category, size, speed, fare_kobo, distance_m, created_at
		FROM parcels WHERE courier_id IS NULL AND status='created' ORDER BY created_at DESC LIMIT 50`
	rows, err := s.db.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, pickup, dropoff, category, size, speed string
		var fare int64
		var distM *int
		var createdAt time.Time
		if err := rows.Scan(&id, &pickup, &dropoff, &category, &size, &speed, &fare, &distM, &createdAt); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"id": id, "pickupAddress": pickup, "dropoffAddress": dropoff,
			"category": category, "size": size, "speed": speed,
			"fareKobo": fare, "distanceM": distM, "createdAt": createdAt,
		})
	}
	return out, nil
}

// AcceptParcel assigns an approved courier to a created parcel.
func (s *Service) AcceptParcel(ctx context.Context, id, driverUserID string) (map[string]any, error) {
	courierID, err := s.driverGate(ctx, driverUserID)
	if err != nil {
		return nil, err
	}
	var p parcelRow
	if err := s.loadParcel(ctx, id, &p); err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "parcel not found")
	}
	if p.Status != "created" {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "parcel not open for acceptance")
	}
	tag, err := s.db.Exec(ctx,
		`UPDATE parcels SET courier_id=$1, status='courier_assigned', updated_at=NOW() WHERE id=$2 AND courier_id IS NULL AND status='created'`,
		courierID, id)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "parcel already taken")
	}
	s.db.Exec(ctx, `UPDATE drivers SET status='on_trip', updated_at=NOW() WHERE id=$1`, courierID)
	s.recordModeEvent(ctx, driverUserID, "parcel.courier_assigned", "parcel", id, "created", "courier_assigned",
		map[string]any{"courier_id": courierID})
	return s.ParcelDetail(ctx, id, driverUserID)
}

// VerifyParcelPickupPin: courier_assigned → pickup_pin_verified (PIN must match).
func (s *Service) VerifyParcelPickupPin(ctx context.Context, id, driverUserID, pin string) error {
	p, err := s.courierOwnedParcel(ctx, id, driverUserID)
	if err != nil {
		return err
	}
	if p.Status != "courier_assigned" {
		return codedErr(http.StatusConflict, CodeInvalidState, "parcel not awaiting pickup PIN")
	}
	if p.PickupPin == nil || *p.PickupPin != pin {
		return codedErr(http.StatusUnprocessableEntity, CodePinMismatch, "pickup PIN does not match")
	}
	if err := s.parcelSetStatus(ctx, id, "courier_assigned", "pickup_pin_verified"); err != nil {
		return err
	}
	s.recordModeEvent(ctx, driverUserID, "parcel.pickup_pin_verified", "parcel", id, "courier_assigned", "pickup_pin_verified", nil)
	return nil
}

// MarkParcelPickedUp: pickup_pin_verified → picked_up → in_transit (+ photo).
func (s *Service) MarkParcelPickedUp(ctx context.Context, id, driverUserID, photoURL string) error {
	p, err := s.courierOwnedParcel(ctx, id, driverUserID)
	if err != nil {
		return err
	}
	if p.Status != "pickup_pin_verified" {
		return codedErr(http.StatusConflict, CodeInvalidState, "parcel not pickup-verified")
	}
	if err := s.parcelSetStatus(ctx, id, "pickup_pin_verified", "picked_up"); err != nil {
		return err
	}
	if photoURL != "" {
		s.db.Exec(ctx, `UPDATE parcels SET photo_url=$1, updated_at=NOW() WHERE id=$2`, photoURL, id)
	}
	s.recordModeEvent(ctx, driverUserID, "parcel.picked_up", "parcel", id, "pickup_pin_verified", "picked_up",
		map[string]any{"photo_url": photoURL})
	// Auto-advance to in_transit.
	if err := s.parcelSetStatus(ctx, id, "picked_up", "in_transit"); err != nil {
		return err
	}
	s.recordModeEvent(ctx, driverUserID, "parcel.in_transit", "parcel", id, "picked_up", "in_transit", nil)
	return nil
}

// VerifyParcelDropoff: in_transit/picked_up → dropoff_verified → delivered + settle.
func (s *Service) VerifyParcelDropoff(ctx context.Context, id, driverUserID, pin, proofURL string) error {
	p, err := s.courierOwnedParcel(ctx, id, driverUserID)
	if err != nil {
		return err
	}
	if p.Status != "in_transit" && p.Status != "picked_up" {
		return codedErr(http.StatusConflict, CodeInvalidState, "parcel not in transit")
	}
	if p.DropoffPin == nil || *p.DropoffPin != pin {
		return codedErr(http.StatusUnprocessableEntity, CodePinMismatch, "dropoff PIN does not match")
	}
	if proofURL == "" {
		return codedErr(http.StatusUnprocessableEntity, "PROOF_REQUIRED", "proof of delivery required")
	}
	if err := s.parcelSetStatus(ctx, id, p.Status, "dropoff_verified"); err != nil {
		return err
	}
	s.db.Exec(ctx, `UPDATE parcels SET proof_url=$1, updated_at=NOW() WHERE id=$2`, proofURL, id)
	s.recordModeEvent(ctx, driverUserID, "parcel.dropoff_verified", "parcel", id, p.Status, "dropoff_verified",
		map[string]any{"proof_url": proofURL})

	// Release escrow → settle courier split, then mark delivered.
	if p.SettlementID != nil && p.CourierID != nil {
		if err := s.settleModeProvider(ctx, *p.SettlementID, *p.CourierID); err != nil {
			return fmt.Errorf("transport: settle parcel: %w", err)
		}
	}
	if err := s.parcelSetStatus(ctx, id, "dropoff_verified", "delivered"); err != nil {
		return err
	}
	if p.CourierID != nil {
		s.db.Exec(ctx, `UPDATE drivers SET status='online', completed_trips=completed_trips+1, updated_at=NOW() WHERE id=$1`, *p.CourierID)
	}
	s.recordModeEvent(ctx, driverUserID, "parcel.delivered", "parcel", id, "dropoff_verified", "delivered", nil)
	return nil
}

// courierOwnedParcel loads a parcel and asserts the caller is the assigned courier.
func (s *Service) courierOwnedParcel(ctx context.Context, id, driverUserID string) (*parcelRow, error) {
	driverID, err := s.driverGate(ctx, driverUserID)
	if err != nil {
		return nil, err
	}
	var p parcelRow
	if err := s.loadParcel(ctx, id, &p); err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "parcel not found")
	}
	if p.CourierID == nil || *p.CourierID != driverID {
		return nil, codedErr(http.StatusForbidden, CodeForbidden, "not the assigned courier")
	}
	return &p, nil
}
