package transport

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// ─── Scheduled logistics bookings ────────────────────────────────────────────
//
// A scheduling LAYER over the existing per-mode transport services. A user books
// a future movement (ride/parcel/airport/bus); the transport-scheduler worker
// materializes the REAL booking (trip / parcel job / bus ticket) a configurable
// lead time before pickup and escrows funds AT DISPATCH (never at scheduling
// time). See SWARM_INTEGRATION_CONTRACT.md for the frozen model + FSM.
//
// Money invariants (CLAUDE.md iron rules): kobo int64 everywhere; escrow/refund
// go through `settlement` only (never ad-hoc ledger); an Idempotency-Key is
// required on Create + Cancel (24h reuse is enforced by the DB-unique
// idempotency_key column as the backstop — same approach as RequestRide/BookParcel);
// a booking that ever escrowed funds must reach a terminal state that refunds or
// settles them (no stranded escrow). OLA on every read/mutation.

// scheduledModes is the frozen set of supported modes (mirrors the CHECK
// constraint in the migration). ride_hail/ride_share/airport_pickup materialize
// as a trip; parcel_intra/parcel_inter as a parcel job; bus as a seat booking.
var scheduledModes = map[string]bool{
	"ride_hail": true, "ride_share": true, "parcel_intra": true,
	"parcel_inter": true, "airport_pickup": true, "bus": true,
}

// materializationKind maps a scheduled mode to the underlying transport artifact
// the dispatcher creates. Kept as data (config-driven) rather than branching.
func materializationKind(mode string) string {
	switch mode {
	case "ride_hail", "ride_share", "airport_pickup":
		return "trip"
	case "parcel_intra", "parcel_inter":
		return "parcel"
	case "bus":
		return "bus_ticket"
	default:
		return ""
	}
}

// defaultLeadMinutes returns the per-mode default lead time (minutes before
// scheduled_pickup_at) at which the scheduler materializes the booking, when the
// caller does not specify one. Longer for bus (seat availability) / airport.
func defaultLeadMinutes(mode string) int {
	switch mode {
	case "airport_pickup":
		return 90
	case "bus":
		return 120
	case "parcel_intra", "parcel_inter":
		return 45
	default: // ride_hail / ride_share
		return 30
	}
}

// ─── Models ──────────────────────────────────────────────────────────────────

// SchedPlace is a pickup/dropoff point on a scheduled booking. Coordinates are
// optional (a bus booking has none); a label is human-readable.
type SchedPlace struct {
	Label string   `json:"label,omitempty"`
	Lat   *float64 `json:"lat,omitempty"`
	Lng   *float64 `json:"lng,omitempty"`
}

// ScheduledBooking is one user-scheduled future logistics movement.
type ScheduledBooking struct {
	ID                string          `json:"id"`
	MarketID          string          `json:"marketId"`
	UserID            string          `json:"userId"`
	Mode              string          `json:"mode"`
	Status            ScheduledStatus `json:"status"`
	ScheduledPickupAt time.Time       `json:"scheduledPickupAt"`
	LeadTimeMinutes   int             `json:"leadTimeMinutes"`
	Timezone          string          `json:"timezone"`
	PickupLabel       *string         `json:"pickupLabel,omitempty"`
	DropoffLabel      *string         `json:"dropoffLabel,omitempty"`
	ModePayload       map[string]any  `json:"modePayload"`
	EstimatedFareKobo *int64          `json:"estimatedFareKobo,omitempty"`
	Currency          string          `json:"currency"`
	PaymentMethod     string          `json:"paymentMethod"`
	MaterializedRef   *string         `json:"materializedRef,omitempty"`
	MaterializedKind  *string         `json:"materializedKind,omitempty"`
	SettlementID      *string         `json:"settlementId,omitempty"`
	DispatchAttempts  int             `json:"dispatchAttempts"`
	LastDispatchError *string         `json:"lastDispatchError,omitempty"`
	Reminder24hSentAt *time.Time      `json:"reminder24hSentAt,omitempty"`
	Reminder1hSentAt  *time.Time      `json:"reminder1hSentAt,omitempty"`
	CancelReason      *string         `json:"cancelReason,omitempty"`
	CreatedAt         time.Time       `json:"createdAt"`
	UpdatedAt         time.Time       `json:"updatedAt"`
	DispatchedAt      *time.Time      `json:"dispatchedAt,omitempty"`
	CompletedAt       *time.Time      `json:"completedAt,omitempty"`
	CancelledAt       *time.Time      `json:"cancelledAt,omitempty"`
}

// ─── Request bodies ──────────────────────────────────────────────────────────

// ScheduledCreateRequest is POST /mobility/scheduled.
type ScheduledCreateRequest struct {
	Mode              string         `json:"mode" binding:"required"`
	ScheduledPickupAt string         `json:"scheduled_pickup_at" binding:"required"` // RFC3339
	LeadTimeMinutes   *int           `json:"lead_time_minutes"`
	Timezone          string         `json:"timezone"`
	Pickup            SchedPlace     `json:"pickup"`
	Dropoff           SchedPlace     `json:"dropoff"`
	ModePayload       map[string]any `json:"mode_payload"`
	PaymentMethod     string         `json:"payment_method"`
}

// ScheduledPatchRequest is PATCH /mobility/scheduled/:id (reschedule/edit).
// All fields optional; only status='scheduled' bookings may be patched.
type ScheduledPatchRequest struct {
	ScheduledPickupAt *string        `json:"scheduled_pickup_at"` // RFC3339
	LeadTimeMinutes   *int           `json:"lead_time_minutes"`
	Pickup            *SchedPlace    `json:"pickup"`
	Dropoff           *SchedPlace    `json:"dropoff"`
	ModePayload       map[string]any `json:"mode_payload"`
}

// ScheduledEstimateRequest is POST /mobility/scheduled/estimate.
type ScheduledEstimateRequest struct {
	Mode        string         `json:"mode" binding:"required"`
	Pickup      Place          `json:"pickup"`
	Dropoff     Place          `json:"dropoff"`
	ModePayload map[string]any `json:"mode_payload"`
}

// ─── Repository (pgx CRUD) ───────────────────────────────────────────────────

// scheduledCols is the full column projection used by every SELECT so scanning
// stays in one place.
const scheduledCols = `
	id, market_id, user_id, mode, status, scheduled_pickup_at, lead_time_minutes,
	timezone, pickup_label, dropoff_label, mode_payload, estimated_fare_kobo,
	currency, payment_method, materialized_ref, materialized_kind, settlement_id,
	dispatch_attempts, last_dispatch_error, reminder_24h_sent_at, reminder_1h_sent_at,
	cancel_reason, created_at, updated_at, dispatched_at, completed_at, cancelled_at`

// scanScheduled scans one row (pgx.Row) into a ScheduledBooking.
func scanScheduled(row pgx.Row) (*ScheduledBooking, error) {
	var b ScheduledBooking
	var status string
	var payloadJSON []byte
	if err := row.Scan(
		&b.ID, &b.MarketID, &b.UserID, &b.Mode, &status, &b.ScheduledPickupAt, &b.LeadTimeMinutes,
		&b.Timezone, &b.PickupLabel, &b.DropoffLabel, &payloadJSON, &b.EstimatedFareKobo,
		&b.Currency, &b.PaymentMethod, &b.MaterializedRef, &b.MaterializedKind, &b.SettlementID,
		&b.DispatchAttempts, &b.LastDispatchError, &b.Reminder24hSentAt, &b.Reminder1hSentAt,
		&b.CancelReason, &b.CreatedAt, &b.UpdatedAt, &b.DispatchedAt, &b.CompletedAt, &b.CancelledAt,
	); err != nil {
		return nil, err
	}
	b.Status = ScheduledStatus(status)
	if len(payloadJSON) > 0 {
		_ = json.Unmarshal(payloadJSON, &b.ModePayload)
	}
	if b.ModePayload == nil {
		b.ModePayload = map[string]any{}
	}
	return &b, nil
}

// getScheduledRow loads a booking by id (no authz — callers apply OLA).
func (s *Service) getScheduledRow(ctx context.Context, id string) (*ScheduledBooking, error) {
	q := `SELECT ` + scheduledCols + ` FROM transport_scheduled_bookings WHERE id=$1`
	b, err := scanScheduled(s.db.QueryRow(ctx, q, id))
	if err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "scheduled booking not found")
	}
	return b, nil
}

// ─── Service: member CRUD ────────────────────────────────────────────────────

// CreateScheduled validates + persists a new scheduled booking in 'scheduled'
// status. NO money moves here — escrow happens at dispatch. idempotencyKey is
// required and enforced unique at the DB layer (24h reuse backstop): a retry with
// the same key returns the existing booking rather than creating a duplicate.
func (s *Service) CreateScheduled(ctx context.Context, userID string, req ScheduledCreateRequest, idempotencyKey string) (*ScheduledBooking, error) {
	if idempotencyKey == "" {
		return nil, codedErr(http.StatusBadRequest, "MISSING_IDEMPOTENCY_KEY", "idempotency key required")
	}
	if !scheduledModes[req.Mode] {
		return nil, codedErr(http.StatusUnprocessableEntity, "INVALID_MODE", "unsupported scheduling mode")
	}
	pickupAt, err := time.Parse(time.RFC3339, req.ScheduledPickupAt)
	if err != nil {
		return nil, codedErr(http.StatusBadRequest, "INVALID_TIME", "scheduled_pickup_at must be RFC3339")
	}

	// Airport pickup: if arrival_time is supplied in the payload, derive the
	// pickup time from it (+ buffer) unless the caller set an explicit pickup.
	// No live flight API this pass — the arrival time is accepted/adjusted
	// manually; this is the clean hook for a later flight-status integration.
	payload := req.ModePayload
	if payload == nil {
		payload = map[string]any{}
	}
	if req.Mode == "airport_pickup" {
		if at, ok := payload["arrival_time"].(string); ok && at != "" {
			if arr, perr := time.Parse(time.RFC3339, at); perr == nil {
				pickupAt = arr.Add(airportPickupBuffer)
			}
		}
	}

	if pickupAt.Before(time.Now()) {
		return nil, codedErr(http.StatusUnprocessableEntity, "PICKUP_IN_PAST", "scheduled_pickup_at must be in the future")
	}

	lead := defaultLeadMinutes(req.Mode)
	if req.LeadTimeMinutes != nil {
		if *req.LeadTimeMinutes < 0 {
			return nil, codedErr(http.StatusUnprocessableEntity, "INVALID_LEAD_TIME", "lead_time_minutes must be >= 0")
		}
		lead = *req.LeadTimeMinutes
	}
	tz := req.Timezone
	if tz == "" {
		tz = "Africa/Lagos"
	}
	payMethod := req.PaymentMethod
	if payMethod == "" {
		payMethod = "wallet"
	}

	// Best-effort fare estimate at booking (display only; the real escrow amount
	// is computed at dispatch by the mode service). Never block booking on it.
	var estimate *int64
	if est := s.estimateForMode(ctx, req.Mode, req.Pickup.asPlace(), req.Dropoff.asPlace(), payload); est != nil {
		estimate = est
	}

	payloadJSON, _ := json.Marshal(payload)
	id := uuid.New().String()
	q := `
		INSERT INTO transport_scheduled_bookings
			(id, user_id, mode, status, scheduled_pickup_at, lead_time_minutes, timezone,
			 pickup_label, pickup_geo, dropoff_label, dropoff_geo, mode_payload,
			 estimated_fare_kobo, payment_method, idempotency_key)
		VALUES ($1,$2,$3,'scheduled',$4,$5,$6,$7,` + geogArgAt(8, 9) + `,$10,` + geogArgAt(11, 12) + `,$13,$14,$15,$16)
		ON CONFLICT (idempotency_key) DO NOTHING
		RETURNING ` + scheduledCols
	row := s.db.QueryRow(ctx, q,
		id, userID, req.Mode, pickupAt, lead, tz,
		nullStr(req.Pickup.Label), req.Pickup.Lng, req.Pickup.Lat,
		nullStr(req.Dropoff.Label), req.Dropoff.Lng, req.Dropoff.Lat,
		payloadJSON, estimate, payMethod, idempotencyKey,
	)
	b, err := scanScheduled(row)
	if err != nil {
		// ON CONFLICT DO NOTHING → no row returned means the idempotency key was
		// already used. Return the existing booking (idempotent create).
		var existing *ScheduledBooking
		if existing, err = s.byIdempotencyKey(ctx, idempotencyKey); err == nil && existing != nil {
			return existing, nil
		}
		return nil, fmt.Errorf("transport: insert scheduled booking: %w", err)
	}
	s.recordModeEvent(ctx, userID, "scheduled.created", "scheduled_booking", b.ID, "", string(SchedScheduled),
		map[string]any{"mode": b.Mode, "pickup_at": pickupAt, "lead_minutes": lead})
	return b, nil
}

// byIdempotencyKey returns the booking created under a given key, if any.
func (s *Service) byIdempotencyKey(ctx context.Context, key string) (*ScheduledBooking, error) {
	q := `SELECT ` + scheduledCols + ` FROM transport_scheduled_bookings WHERE idempotency_key=$1`
	return scanScheduled(s.db.QueryRow(ctx, q, key))
}

// GetScheduled returns a booking; OLA — only the owner may read it.
func (s *Service) GetScheduled(ctx context.Context, id, userID string) (*ScheduledBooking, error) {
	b, err := s.getScheduledRow(ctx, id)
	if err != nil {
		return nil, err
	}
	if b.UserID != userID {
		return nil, codedErr(http.StatusForbidden, CodeForbidden, "not your booking")
	}
	return b, nil
}

// ListScheduled returns the caller's bookings, filtered by upcoming|past|all.
// Cursor is the created_at of the last item seen (keyset pagination).
func (s *Service) ListScheduled(ctx context.Context, userID, filter, cursor string, limit int) ([]*ScheduledBooking, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	q := `SELECT ` + scheduledCols + ` FROM transport_scheduled_bookings WHERE user_id=$1`
	args := []any{userID}
	switch filter {
	case "upcoming":
		q += ` AND status IN ('scheduled','dispatch_pending','dispatched')`
	case "past":
		q += ` AND status IN ('completed','cancelled','failed_no_driver','expired')`
	}
	if cursor != "" {
		if ts, err := time.Parse(time.RFC3339Nano, cursor); err == nil {
			args = append(args, ts)
			q += fmt.Sprintf(` AND created_at < $%d`, len(args))
		}
	}
	args = append(args, limit)
	q += fmt.Sprintf(` ORDER BY created_at DESC LIMIT $%d`, len(args))
	rows, err := s.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*ScheduledBooking
	for rows.Next() {
		b, err := scanScheduled(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// RescheduleScheduled edits a booking's time/params. Only status='scheduled'
// bookings are editable (409 otherwise) — once dispatch has started the real
// trip/parcel governs. OLA to owner.
func (s *Service) RescheduleScheduled(ctx context.Context, id, userID string, req ScheduledPatchRequest) (*ScheduledBooking, error) {
	b, err := s.GetScheduled(ctx, id, userID)
	if err != nil {
		return nil, err
	}
	if b.Status != SchedScheduled {
		return nil, codedErr(http.StatusConflict, CodeInvalidState,
			fmt.Sprintf("only 'scheduled' bookings can be edited (current: %s)", b.Status))
	}

	sets := []string{"updated_at=NOW()"}
	args := []any{}
	add := func(expr string, val any) {
		args = append(args, val)
		sets = append(sets, fmt.Sprintf("%s=$%d", expr, len(args)))
	}
	if req.ScheduledPickupAt != nil {
		pickupAt, perr := time.Parse(time.RFC3339, *req.ScheduledPickupAt)
		if perr != nil {
			return nil, codedErr(http.StatusBadRequest, "INVALID_TIME", "scheduled_pickup_at must be RFC3339")
		}
		if pickupAt.Before(time.Now()) {
			return nil, codedErr(http.StatusUnprocessableEntity, "PICKUP_IN_PAST", "scheduled_pickup_at must be in the future")
		}
		add("scheduled_pickup_at", pickupAt)
	}
	if req.LeadTimeMinutes != nil {
		if *req.LeadTimeMinutes < 0 {
			return nil, codedErr(http.StatusUnprocessableEntity, "INVALID_LEAD_TIME", "lead_time_minutes must be >= 0")
		}
		add("lead_time_minutes", *req.LeadTimeMinutes)
	}
	if req.Pickup != nil {
		add("pickup_label", nullStr(req.Pickup.Label))
		// geo update via a dedicated expression (parameter order handled below).
		args = append(args, req.Pickup.Lng, req.Pickup.Lat)
		sets = append(sets, fmt.Sprintf("pickup_geo=%s", geogArgAt(len(args)-1, len(args))))
	}
	if req.Dropoff != nil {
		add("dropoff_label", nullStr(req.Dropoff.Label))
		args = append(args, req.Dropoff.Lng, req.Dropoff.Lat)
		sets = append(sets, fmt.Sprintf("dropoff_geo=%s", geogArgAt(len(args)-1, len(args))))
	}
	if req.ModePayload != nil {
		// Merge over the existing payload so a partial edit doesn't clobber it.
		merged := b.ModePayload
		if merged == nil {
			merged = map[string]any{}
		}
		for k, v := range req.ModePayload {
			merged[k] = v
		}
		pj, _ := json.Marshal(merged)
		add("mode_payload", pj)
	}

	args = append(args, id)
	// Guard on status='scheduled' in the WHERE so a concurrent dispatch can't race us.
	q := fmt.Sprintf(
		`UPDATE transport_scheduled_bookings SET %s WHERE id=$%d AND status='scheduled' RETURNING `+scheduledCols,
		joinComma(sets), len(args))
	nb, err := scanScheduled(s.db.QueryRow(ctx, q, args...))
	if err != nil {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "booking changed concurrently")
	}
	s.recordModeEvent(ctx, userID, "scheduled.rescheduled", "scheduled_booking", id, string(b.Status), string(nb.Status), nil)
	return nb, nil
}

// CancelScheduled cancels a booking (user-initiated) and refunds any escrow.
// Legal only from scheduled|dispatch_pending. Idempotency-Key required (24h). If
// the booking already escrowed (settlement_id set), the escrow is refunded via
// settlement so funds are never stranded.
func (s *Service) CancelScheduled(ctx context.Context, id, userID, reason, idempotencyKey string) (*ScheduledBooking, error) {
	if idempotencyKey == "" {
		return nil, codedErr(http.StatusBadRequest, "MISSING_IDEMPOTENCY_KEY", "idempotency key required")
	}
	b, err := s.GetScheduled(ctx, id, userID)
	if err != nil {
		return nil, err
	}
	return s.cancelScheduledInternal(ctx, b, userID, reason, "scheduled.cancelled")
}

// cancelScheduledInternal is the shared cancel path for member + admin cancel.
// It guards the FSM (→cancelled), flips status, and refunds any held escrow.
// actorID is who triggered it (rider for member, admin for admin cancel).
func (s *Service) cancelScheduledInternal(ctx context.Context, b *ScheduledBooking, actorID, reason, event string) (*ScheduledBooking, error) {
	// Idempotent no-op if already cancelled.
	if b.Status == SchedCancelled {
		return b, nil
	}
	if err := guardScheduled(b.Status, SchedCancelled); err != nil {
		return nil, err
	}
	// Flip status guarded on the current status (optimistic concurrency).
	const q = `
		UPDATE transport_scheduled_bookings
		SET status='cancelled', cancel_reason=$2, cancelled_at=NOW(), updated_at=NOW()
		WHERE id=$1 AND status=$3
		RETURNING ` + scheduledCols
	nb, err := scanScheduled(s.db.QueryRow(ctx, q, b.ID, nullStr(reason), string(b.Status)))
	if err != nil {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "booking changed concurrently")
	}
	// Refund any escrow taken at dispatch — never strand funds.
	if b.SettlementID != nil && *b.SettlementID != "" {
		if rerr := s.settlement.Refund(ctx, *b.SettlementID, "scheduled_cancelled:"+reason); rerr != nil {
			// The status is already cancelled; a refund failure must be loud +
			// recoverable rather than reverting the cancel. Record it and surface.
			s.recordModeEvent(ctx, actorID, "scheduled.refund_failed", "scheduled_booking", b.ID,
				string(SchedCancelled), string(SchedCancelled),
				map[string]any{"settlement_id": *b.SettlementID, "error": rerr.Error()})
			return nb, fmt.Errorf("transport: scheduled booking cancelled but refund failed (settlement=%s): %w", *b.SettlementID, rerr)
		}
	}
	s.recordModeEvent(ctx, actorID, event, "scheduled_booking", b.ID, string(b.Status), string(SchedCancelled),
		map[string]any{"reason": reason})
	return nb, nil
}

// EstimateScheduled returns a fare quote for a prospective booking, reusing the
// per-mode pricing path. No side effects.
func (s *Service) EstimateScheduled(ctx context.Context, req ScheduledEstimateRequest) (map[string]any, error) {
	if !scheduledModes[req.Mode] {
		return nil, codedErr(http.StatusUnprocessableEntity, "INVALID_MODE", "unsupported scheduling mode")
	}
	switch materializationKind(req.Mode) {
	case "trip":
		est, err := s.EstimateRide(ctx, EstimateRequest{
			Pickup: req.Pickup, Dest: req.Dropoff, ServiceType: rideServiceType(req.Mode),
		})
		if err != nil {
			return nil, err
		}
		return map[string]any{"mode": req.Mode, "estimatedFareKobo": est.SystemFareKobo, "estimate": est}, nil
	case "parcel":
		pe, err := s.EstimateParcel(ctx, ParcelEstimateRequest{
			Pickup: req.Pickup, Dropoff: req.Dropoff,
			Size:  strFromPayload(req.ModePayload, "size"),
			Speed: strFromPayload(req.ModePayload, "speed"),
		})
		if err != nil {
			return nil, err
		}
		return map[string]any{"mode": req.Mode, "estimatedFareKobo": pe.FareKobo, "estimate": pe}, nil
	case "bus":
		// Bus fare is a fixed catalog fare on the chosen schedule; look it up.
		schedID := strFromPayload(req.ModePayload, "schedule_id")
		if schedID == "" {
			return nil, codedErr(http.StatusUnprocessableEntity, "MISSING_SCHEDULE", "mode_payload.schedule_id required for bus estimate")
		}
		var fare int64
		if err := s.db.QueryRow(ctx, `SELECT fare_kobo FROM bus_schedules WHERE id=$1`, schedID).Scan(&fare); err != nil {
			return nil, codedErr(http.StatusNotFound, CodeNotFound, "bus schedule not found")
		}
		return map[string]any{"mode": req.Mode, "estimatedFareKobo": fare}, nil
	}
	return nil, codedErr(http.StatusUnprocessableEntity, "INVALID_MODE", "unsupported scheduling mode")
}

// estimateForMode returns a best-effort fare estimate (kobo) for the booking
// display, or nil if it can't be computed. Never returns an error — booking must
// not fail on a missing estimate.
func (s *Service) estimateForMode(ctx context.Context, mode string, pickup, dropoff Place, payload map[string]any) *int64 {
	out, err := s.EstimateScheduled(ctx, ScheduledEstimateRequest{
		Mode: mode, Pickup: pickup, Dropoff: dropoff, ModePayload: payload,
	})
	if err != nil {
		return nil
	}
	if v, ok := out["estimatedFareKobo"].(int64); ok {
		return &v
	}
	return nil
}

// ─── small helpers ───────────────────────────────────────────────────────────

// airportPickupBuffer is added to a supplied flight arrival_time to derive the
// scheduled pickup time (baggage claim + walk to pickup).
const airportPickupBuffer = 45 * time.Minute

// rideServiceType maps a scheduled ride mode to the underlying trip service_type.
func rideServiceType(mode string) string {
	switch mode {
	case "ride_share":
		return "ride_sharing"
	case "airport_pickup":
		return "airport_pickup"
	default:
		return "ride_hailing"
	}
}

func (p SchedPlace) asPlace() Place {
	out := Place{Address: p.Label}
	if p.Lat != nil {
		out.Lat = *p.Lat
	}
	if p.Lng != nil {
		out.Lng = *p.Lng
	}
	return out
}

func strFromPayload(m map[string]any, key string) string {
	if m == nil {
		return ""
	}
	if v, ok := m[key].(string); ok {
		return v
	}
	return ""
}

func intFromPayload(m map[string]any, key string) int {
	if m == nil {
		return 0
	}
	switch v := m[key].(type) {
	case float64:
		return int(v)
	case int:
		return v
	case int64:
		return int(v)
	}
	return 0
}

// geogArgAt builds a "ST_SetSRID(ST_MakePoint($lng,$lat),4326)::geography OR NULL"
// SQL fragment for an explicit (lng,lat) placeholder pair. It nulls the geo when
// either coordinate is NULL (e.g. a bus booking with no pickup point).
func geogArgAt(lng, lat int) string {
	return fmt.Sprintf(
		`CASE WHEN $%d IS NULL OR $%d IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($%d,$%d),4326)::geography END`,
		lng, lat, lng, lat)
}

func joinComma(parts []string) string {
	out := ""
	for i, p := range parts {
		if i > 0 {
			out += ", "
		}
		out += p
	}
	return out
}
