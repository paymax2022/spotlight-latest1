// Package busfleet implements the Bus Transport v2 fleet + dated-departure layer
// introduced by supabase/migrations/20271050000000_bus_transport_v2.sql:
// versioned seat layouts (bus_seat_layout / bus_seat_layout_seat), provider
// vehicles (bus_vehicle), and generated departures (bus_departure) carrying a
// frozen itinerary + fare snapshot.
//
// It is deliberately a SEPARATE package from the legacy bus_* code in
// internal/transport (different tables, different lifecycle). Conventions follow
// that package: pgx pool access, fsm.Table state machines, transport_audit_log
// for every mutation, and a coded error type carrying HTTP status + machine code.
//
// Wiring note: nothing here is routed yet. When routes are added they must sit
// behind a FEATURE_* flag (repo rule: no flag, no merge).
package busfleet

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/go-common/fsm"
)

// ─── errors ─────────────────────────────────────────────────────────────────

// Error carries an HTTP status + machine-readable code alongside a message —
// the same convention as transport.CodedError, kept package-local so busfleet
// does not depend on the parent transport package.
type Error struct {
	Status  int
	Code    string
	Message string
	Details map[string]any
}

func (e *Error) Error() string { return e.Message }

// Body is the JSON error body: {error, code} plus any Details (which can never
// override those two keys).
func (e *Error) Body() map[string]any {
	b := map[string]any{}
	for k, v := range e.Details {
		b[k] = v
	}
	b["error"] = e.Message
	b["code"] = e.Code
	return b
}

func codedErr(status int, code, msg string) *Error {
	return &Error{Status: status, Code: code, Message: msg}
}

func codedErrf(status int, code, format string, args ...any) *Error {
	return &Error{Status: status, Code: code, Message: fmt.Sprintf(format, args...)}
}

// Machine codes returned to clients (BUILD-CONTRACT error conventions).
const (
	CodeValidation   = "VALIDATION"
	CodeNotFound     = "NOT_FOUND"
	CodeForbidden    = "FORBIDDEN"
	CodeConflict     = "CONFLICT"
	CodeInvalidState = "INVALID_STATE"
	// CodeSeatUnmapped: a vehicle swap cannot place every confirmed seat on the
	// new layout — a remap entry is missing or lands on a non-bookable seat.
	CodeSeatUnmapped = "SEAT_UNMAPPED"
	// CodeVehicleBusy: the vehicle's existing departures overlap the requested
	// window (turnaround included).
	CodeVehicleBusy = "VEHICLE_BUSY"
	// CodeCapacity: a layout would sell fewer seats than bookings already made.
	CodeCapacity = "CAPACITY_EXCEEDED"
)

// ─── seat types ─────────────────────────────────────────────────────────────

// SeatType enumerates the seat_type CHECK values in bus_seat_layout_seat.
type SeatType string

const (
	SeatStandard   SeatType = "standard"
	SeatPremium    SeatType = "premium"
	SeatAccessible SeatType = "accessible"
	SeatDriver     SeatType = "driver"
	SeatBlocked    SeatType = "blocked"
)

func (t SeatType) valid() bool {
	switch t {
	case SeatStandard, SeatPremium, SeatAccessible, SeatDriver, SeatBlocked:
		return true
	}
	return false
}

// sellable reports whether passengers may ever book this seat type. Driver and
// blocked seats are physical positions that must never sell a ticket, so the
// validator forces bookable=false on them.
func (t SeatType) sellable() bool { return t != SeatDriver && t != SeatBlocked }

// ─── vehicle status ─────────────────────────────────────────────────────────

// VehicleStatus enumerates bus_vehicle.status CHECK values.
type VehicleStatus string

const (
	VehicleAvailable   VehicleStatus = "available"
	VehicleAssigned    VehicleStatus = "assigned"
	VehicleMaintenance VehicleStatus = "maintenance"
	VehicleRetired     VehicleStatus = "retired"
)

// vehicleTransitions is the legal status map. Retired is terminal: a retired
// vehicle never comes back — register a new row instead.
var vehicleTransitions = fsm.Table[VehicleStatus]{
	VehicleAvailable:   fsm.Set(VehicleAssigned, VehicleMaintenance, VehicleRetired),
	VehicleAssigned:    fsm.Set(VehicleAvailable, VehicleMaintenance, VehicleRetired),
	VehicleMaintenance: fsm.Set(VehicleAvailable, VehicleRetired),
}

func canTransitionVehicle(from, to VehicleStatus) bool {
	return vehicleTransitions.Can(from, to)
}

// assignable reports whether the vehicle may take new departures.
func (s VehicleStatus) assignable() bool {
	return s == VehicleAvailable || s == VehicleAssigned
}

// ─── departure status ───────────────────────────────────────────────────────

// DepartureStatus enumerates bus_departure.status CHECK values.
type DepartureStatus string

const (
	DepDraft     DepartureStatus = "draft"
	DepScheduled DepartureStatus = "scheduled"
	DepPublished DepartureStatus = "published"
	DepBoarding  DepartureStatus = "boarding"
	DepDeparted  DepartureStatus = "departed"
	DepArrived   DepartureStatus = "arrived"
	DepDelayed   DepartureStatus = "delayed"
	DepCancelled DepartureStatus = "cancelled"
	DepCompleted DepartureStatus = "completed"
	DepNoShow    DepartureStatus = "no_show"
)

// departureTransitions is the legal lifecycle map. Cancelled/completed/no_show
// are terminal. 'delayed' is an off-ramp that can rejoin the happy path
// (publish again, board, or finally depart) or die (cancelled / no_show).
var departureTransitions = fsm.Table[DepartureStatus]{
	DepDraft:     fsm.Set(DepScheduled, DepCancelled),
	DepScheduled: fsm.Set(DepPublished, DepDelayed, DepCancelled, DepNoShow),
	DepPublished: fsm.Set(DepBoarding, DepDelayed, DepCancelled, DepNoShow),
	DepBoarding:  fsm.Set(DepDeparted, DepDelayed, DepCancelled, DepNoShow),
	DepDelayed:   fsm.Set(DepPublished, DepBoarding, DepDeparted, DepCancelled, DepNoShow),
	DepDeparted:  fsm.Set(DepArrived, DepCancelled), // mid-route incident may still cancel
	DepArrived:   fsm.Set(DepCompleted),
}

func canTransitionDeparture(from, to DepartureStatus) bool {
	return departureTransitions.Can(from, to)
}

// swappableStatuses: a vehicle swap is allowed until the wheels move. Boarding
// is included deliberately — operators swap a broken bus at the terminal while
// passengers wait — but departed/arrived/completed/cancelled/no_show are not.
var swappableStatuses = map[DepartureStatus]bool{
	DepDraft: true, DepScheduled: true, DepPublished: true,
	DepBoarding: true, DepDelayed: true,
}

// DefaultTurnaroundMinutes is the assumed post-arrival turnaround buffer when a
// caller passes 0 — cleaning, refuelling, boarding lead.
const DefaultTurnaroundMinutes = 45

// ─── model ──────────────────────────────────────────────────────────────────

// SeatInput is one seat position supplied when creating/versioning a layout.
// Bookable is a pointer so "not supplied" defaults to true for sellable types
// while a client can still mark an aisle-adjacent standard seat bookable=false.
type SeatInput struct {
	SeatKey  string   `json:"seat_key" binding:"required"`
	Label    string   `json:"label" binding:"required"`
	Deck     int      `json:"deck"`
	Row      int      `json:"row"`
	Col      int      `json:"col"`
	Type     SeatType `json:"seat_type"`
	Bookable *bool    `json:"bookable"`
}

// Seat is a persisted bus_seat_layout_seat row.
type Seat struct {
	ID       string   `json:"id"`
	LayoutID string   `json:"layout_id"`
	SeatKey  string   `json:"seat_key"`
	Label    string   `json:"label"`
	Deck     int      `json:"deck"`
	Row      int      `json:"row"`
	Col      int      `json:"col"`
	Type     SeatType `json:"seat_type"`
	Bookable bool     `json:"bookable"`
}

// SeatLayout is a bus_seat_layout row (one immutable version) plus its seats.
type SeatLayout struct {
	ID         string    `json:"id"`
	ProviderID string    `json:"provider_id"`
	Name       string    `json:"name"`
	Version    int       `json:"version"`
	Decks      int       `json:"decks"`
	Rows       int       `json:"rows"`
	Cols       int       `json:"cols"`
	Capacity   int       `json:"capacity"`
	Active     bool      `json:"active"`
	CreatedAt  time.Time `json:"created_at"`
	Seats      []Seat    `json:"seats,omitempty"`
}

// CreateLayoutRequest is the body for creating version 1 of a named layout.
type CreateLayoutRequest struct {
	ProviderID string      `json:"provider_id" binding:"required"`
	Name       string      `json:"name" binding:"required"`
	Decks      int         `json:"decks"`
	Rows       int         `json:"rows" binding:"required,min=1"`
	Cols       int         `json:"cols" binding:"required,min=1"`
	Capacity   int         `json:"capacity" binding:"required,min=1"`
	Seats      []SeatInput `json:"seats" binding:"required"`
}

// Vehicle is a bus_vehicle row.
type Vehicle struct {
	ID          string        `json:"id"`
	ProviderID  string        `json:"provider_id"`
	PlateNumber string        `json:"plate_number"`
	FleetCode   string        `json:"fleet_code,omitempty"`
	MakeModel   string        `json:"make_model,omitempty"`
	Capacity    int           `json:"capacity"`
	LayoutID    string        `json:"layout_id"`
	Status      VehicleStatus `json:"status"`
	CreatedAt   time.Time     `json:"created_at"`
	UpdatedAt   time.Time     `json:"updated_at"`
}

// VehicleRequest registers a vehicle against a layout.
type VehicleRequest struct {
	ProviderID  string `json:"provider_id" binding:"required"`
	PlateNumber string `json:"plate_number" binding:"required"`
	FleetCode   string `json:"fleet_code"`
	MakeModel   string `json:"make_model"`
	Capacity    int    `json:"capacity" binding:"required,min=1"`
	LayoutID    string `json:"layout_id" binding:"required"`
}

// AssignmentWindow is the road-time window a candidate departure would occupy
// the vehicle for: origin departure to final-stop arrival.
type AssignmentWindow struct {
	DepartAt time.Time `json:"depart_at"`
	ArriveAt time.Time `json:"arrive_at"` // zero ⇒ treated as DepartAt
}

// bounds returns the window padded by the turnaround on both sides — the
// interval during which the vehicle is unavailable for other work.
func (w AssignmentWindow) bounds(turnaround time.Duration) (start, end time.Time) {
	arr := w.ArriveAt
	if arr.IsZero() || arr.Before(w.DepartAt) {
		arr = w.DepartAt
	}
	return w.DepartAt.Add(-turnaround), arr.Add(turnaround)
}

// windowsOverlap is the half-open interval overlap test. Touching boundaries do
// not conflict: a bus free at exactly the candidate's padded start is assignable.
func windowsOverlap(aStart, aEnd, bStart, bEnd time.Time) bool {
	return aStart.Before(bEnd) && bStart.Before(aEnd)
}

// DepartureConflict identifies one existing departure blocking an assignment.
type DepartureConflict struct {
	DepartureID string    `json:"departure_id"`
	DepartAt    time.Time `json:"depart_at"`
	BusyUntil   time.Time `json:"busy_until"` // last-stop arrival + turnaround
}

// OccupiedWindow is the raw busy interval of an existing departure — the input
// the pure conflict checker consumes (kept separate from Departure so tests
// never need a DB row).
type OccupiedWindow struct {
	DepartureID string
	DepartAt    time.Time
	ArriveAt    time.Time
}

// conflictsFor is the pure overlap decision behind CanAssign: every existing
// window padded by turnaround that intersects the candidate's padded window is
// a conflict. Exported seams take ints so behaviour is pinned by unit tests
// without a database.
func conflictsFor(candidate AssignmentWindow, turnaround time.Duration, existing []OccupiedWindow) []DepartureConflict {
	cStart, cEnd := candidate.bounds(turnaround)
	var out []DepartureConflict
	for _, e := range existing {
		eStart, eEnd := AssignmentWindow{DepartAt: e.DepartAt, ArriveAt: e.ArriveAt}.bounds(turnaround)
		if windowsOverlap(cStart, cEnd, eStart, eEnd) {
			out = append(out, DepartureConflict{DepartureID: e.DepartureID, DepartAt: e.DepartAt, BusyUntil: eEnd})
		}
	}
	return out
}

// SnapshotStop is one ordered stop frozen into bus_departure.itinerary_snapshot.
type SnapshotStop struct {
	Seq           int        `json:"seq"`
	TerminalID    string     `json:"terminal_id"`
	TerminalName  string     `json:"terminal_name"`
	CityName      string     `json:"city_name,omitempty"`
	ArriveAt      *time.Time `json:"arrive_at,omitempty"` // nil on the origin stop
	DepartAt      time.Time  `json:"depart_at"`
	BoardAllowed  bool       `json:"board_allowed"`
	AlightAllowed bool       `json:"alight_allowed"`
}

// itineraryEnd returns the last stop's arrival (falling back to its departure,
// then to the supplied fallback) — the moment the vehicle is free minus
// turnaround.
func itineraryEnd(stops []SnapshotStop, fallback time.Time) time.Time {
	if len(stops) == 0 {
		return fallback
	}
	last := stops[len(stops)-1]
	if last.ArriveAt != nil {
		return *last.ArriveAt
	}
	if !last.DepartAt.IsZero() {
		return last.DepartAt
	}
	return fallback
}

// FareEntry is one OD-pair price frozen into bus_departure.fare_snapshot.
type FareEntry struct {
	FromSeq    int    `json:"from_seq"`
	ToSeq      int    `json:"to_seq"`
	AmountKobo int64  `json:"amount_kobo"`
	Currency   string `json:"currency"`
}

// DepartureSlot requests one dated departure in GenerateDepartures. TravelDate
// may be zero — it then defaults to DepartAt's calendar date.
type DepartureSlot struct {
	TravelDate time.Time `json:"travel_date"`
	DepartAt   time.Time `json:"depart_at" binding:"required"`
}

// GenerateRequest drives GenerateDepartures.
type GenerateRequest struct {
	RouteID   string          `json:"route_id" binding:"required"`
	VehicleID string          `json:"vehicle_id" binding:"required"`
	Slots     []DepartureSlot `json:"slots" binding:"required"`
	// TurnaroundMin pads each departure for the vehicle-overlap check;
	// 0 ⇒ DefaultTurnaroundMinutes.
	TurnaroundMin int `json:"turnaround_minutes"`
	// Cutoffs override the column defaults (60 / 120) when > 0.
	BookingCutoffMin int `json:"booking_cutoff_minutes"`
	CancelCutoffMin  int `json:"cancel_cutoff_minutes"`
	// Status seeds the new rows; empty ⇒ 'scheduled'. Only draft/scheduled are
	// accepted — publish is a deliberate later transition.
	Status DepartureStatus `json:"status"`
}

// Departure is a bus_departure row with its decoded snapshots. Created reports
// whether GenerateDepartures inserted it (false ⇒ an idempotent replay returned
// the pre-existing row for that natural key).
type Departure struct {
	ID               string          `json:"id"`
	ProviderID       string          `json:"provider_id"`
	RouteID          string          `json:"route_id"`
	RouteVersion     int             `json:"route_version"`
	TravelDate       time.Time       `json:"travel_date"`
	DepartAt         time.Time       `json:"depart_at"`
	VehicleID        *string         `json:"vehicle_id,omitempty"`
	LayoutID         *string         `json:"layout_id,omitempty"`
	LayoutVersion    *int            `json:"layout_version,omitempty"`
	Capacity         int             `json:"capacity"`
	Status           DepartureStatus `json:"status"`
	BookingCutoffMin int             `json:"booking_cutoff_minutes"`
	CancelCutoffMin  int             `json:"cancel_cutoff_minutes"`
	Itinerary        []SnapshotStop  `json:"itinerary"`
	Fares            []FareEntry     `json:"fares"`
	CreatedAt        time.Time       `json:"created_at"`
	UpdatedAt        time.Time       `json:"updated_at"`
	Created          bool            `json:"created"`
}

// DepartureFilter lists departures; zero fields are ignored.
type DepartureFilter struct {
	ProviderID string
	RouteID    string
	Status     DepartureStatus
	TravelDate *time.Time
	Limit      int
	Offset     int
}

// SwapRequest drives SwapVehicle. SeatRemap maps an occupied seat_key on the
// departure's CURRENT layout to a seat_key on the new vehicle's layout. Keys
// whose seat_key also exists (bookable) in the new layout need no entry.
type SwapRequest struct {
	DepartureID  string            `json:"departure_id" binding:"required"`
	NewVehicleID string            `json:"new_vehicle_id" binding:"required"`
	SeatRemap    map[string]string `json:"seat_remap"`
	Reason       string            `json:"reason"`
}

// ─── service ────────────────────────────────────────────────────────────────

// Service owns fleet + departure operations. Money is never moved here — fares
// are only SNAPSHOT data; the booking/payment path is a separate module.
type Service struct {
	db *pgxpool.Pool
}

// NewService wires the busfleet service against the primary pgx pool.
func NewService(db *pgxpool.Pool) *Service { return &Service{db: db} }

// ─── seat-layout validation ─────────────────────────────────────────────────

// validateSeatSet normalizes and validates one layout version's seats.
// Invariants enforced (all before any DB write):
//   - exactly one seat per seat_key, per label, and per (deck,row,col)
//   - positions inside the deck/row/col bounds
//   - seat_type is a CHECK-valid value; driver/blocked seats are never bookable
//   - sellable seat count ≤ layout capacity
func validateSeatSet(seats []SeatInput, decks, rows, cols, capacity int) ([]SeatInput, int, error) {
	if decks < 1 || rows < 1 || cols < 1 {
		return nil, 0, codedErr(http.StatusBadRequest, CodeValidation, "decks, rows and cols must all be >= 1")
	}
	if capacity < 1 {
		return nil, 0, codedErr(http.StatusBadRequest, CodeValidation, "capacity must be >= 1")
	}
	if len(seats) == 0 {
		return nil, 0, codedErr(http.StatusBadRequest, CodeValidation, "a layout must define at least one seat")
	}
	norm := make([]SeatInput, len(seats))
	keys := make(map[string]bool, len(seats))
	labels := make(map[string]bool, len(seats))
	pos := make(map[[3]int]bool, len(seats))
	bookable := 0
	for i, in := range seats {
		in.SeatKey = strings.TrimSpace(in.SeatKey)
		in.Label = strings.TrimSpace(in.Label)
		if in.SeatKey == "" || in.Label == "" {
			return nil, 0, codedErr(http.StatusBadRequest, CodeValidation, "every seat needs a seat_key and a label")
		}
		if in.Type == "" {
			in.Type = SeatStandard
		}
		if !in.Type.valid() {
			return nil, 0, codedErrf(http.StatusBadRequest, CodeValidation, "seat %q: invalid seat_type %q", in.SeatKey, in.Type)
		}
		if in.Deck < 1 || in.Deck > decks || in.Row < 1 || in.Row > rows || in.Col < 1 || in.Col > cols {
			return nil, 0, codedErrf(http.StatusBadRequest, CodeValidation,
				"seat %q: position (%d,%d,%d) outside %dx%dx%d grid", in.SeatKey, in.Deck, in.Row, in.Col, decks, rows, cols)
		}
		if keys[in.SeatKey] {
			return nil, 0, codedErrf(http.StatusBadRequest, CodeValidation, "duplicate seat_key %q", in.SeatKey)
		}
		keys[in.SeatKey] = true
		if labels[in.Label] {
			return nil, 0, codedErrf(http.StatusBadRequest, CodeValidation, "duplicate seat label %q", in.Label)
		}
		labels[in.Label] = true
		p := [3]int{in.Deck, in.Row, in.Col}
		if pos[p] {
			return nil, 0, codedErrf(http.StatusBadRequest, CodeValidation,
				"two seats occupy deck %d row %d col %d", in.Deck, in.Row, in.Col)
		}
		pos[p] = true
		// Normalize the bookable flag: default true for sellable types,
		// forced false for driver/blocked. An explicit bookable=true on a
		// non-sellable type is a client error, not silently corrected.
		if !in.Type.sellable() {
			if in.Bookable != nil && *in.Bookable {
				return nil, 0, codedErrf(http.StatusBadRequest, CodeValidation,
					"seat %q of type %s cannot be bookable", in.SeatKey, in.Type)
			}
			b := false
			in.Bookable = &b
		} else {
			want := in.Bookable == nil || *in.Bookable
			in.Bookable = &want
		}
		if *in.Bookable {
			bookable++
		}
		norm[i] = in
	}
	if bookable > capacity {
		return nil, 0, codedErrf(http.StatusConflict, CodeCapacity,
			"layout sells %d bookable seats but capacity is %d", bookable, capacity)
	}
	return norm, bookable, nil
}

// cloneSeatInputs re-expresses persisted seats as inputs for a new version —
// seat_key and every positional attribute are preserved verbatim so booked
// seat_keys stay meaningful across versions.
func cloneSeatInputs(seats []Seat) []SeatInput {
	out := make([]SeatInput, len(seats))
	for i, s := range seats {
		b := s.Bookable
		out[i] = SeatInput{
			SeatKey: s.SeatKey, Label: s.Label, Deck: s.Deck, Row: s.Row, Col: s.Col,
			Type: s.Type, Bookable: &b,
		}
	}
	return out
}

// bookableSeatMap indexes the bookable seats of a layout by seat_key — the
// lookup SwapVehicle's accommodation check runs against.
func bookableSeatMap(seats []Seat) map[string]Seat {
	m := make(map[string]Seat, len(seats))
	for _, s := range seats {
		if s.Bookable {
			m[s.SeatKey] = s
		}
	}
	return m
}

// planSeatRemap decides the effective new-layout seat_key for every currently
// occupied seat_key. An occupied key that exists bookable in the new layout
// passes through unchanged; otherwise an explicit remap entry is required.
// Returns (nil, err) when any seat cannot be placed — the caller must abort
// the swap. Two occupied seats landing on one target is also a failure.
func planSeatRemap(occupied []string, newBookable map[string]Seat, remap map[string]string) (map[string]string, error) {
	if len(occupied) > len(newBookable) {
		return nil, codedErrf(http.StatusConflict, CodeCapacity,
			"new layout has %d bookable seats but %d are occupied", len(newBookable), len(occupied))
	}
	plan := make(map[string]string, len(occupied))
	targets := make(map[string]string, len(occupied)) // new key -> old key (collision detect)
	for _, key := range occupied {
		target := key
		if r, ok := remap[key]; ok {
			target = strings.TrimSpace(r)
		}
		if s, ok := newBookable[target]; !ok || !s.Bookable {
			return nil, &Error{
				Status:  http.StatusConflict,
				Code:    CodeSeatUnmapped,
				Message: fmt.Sprintf("occupied seat %q has no bookable seat on the new layout (add a seat_remap entry)", key),
				Details: map[string]any{"seat_key": key},
			}
		}
		if prev, dup := targets[target]; dup {
			return nil, codedErrf(http.StatusConflict, CodeSeatUnmapped,
				"seats %q and %q both remap to %q", prev, key, target)
		}
		targets[target] = key
		plan[key] = target
	}
	return plan, nil
}

// ─── layouts ────────────────────────────────────────────────────────────────

// CreateLayout persists version 1 of a named layout plus its seats in one
// transaction (a seat validation or insert failure rolls back the layout row).
// UNIQUE(provider_id, name, version) violations surface as 409 CONFLICT.
func (s *Service) CreateLayout(ctx context.Context, req CreateLayoutRequest, actorID string) (*SeatLayout, error) {
	decks := req.Decks
	if decks == 0 {
		decks = 1
	}
	norm, _, err := validateSeatSet(req.Seats, decks, req.Rows, req.Cols, req.Capacity)
	if err != nil {
		return nil, err
	}
	layout := &SeatLayout{
		ID: uuid.New().String(), ProviderID: req.ProviderID, Name: strings.TrimSpace(req.Name),
		Version: 1, Decks: decks, Rows: req.Rows, Cols: req.Cols, Capacity: req.Capacity, Active: true,
	}
	seats := materializeSeats(layout.ID, norm)

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if err := insertLayout(ctx, tx, layout); err != nil {
		if isUnique(err) {
			return nil, codedErrf(http.StatusConflict, CodeConflict, "layout %q already exists at version %d", layout.Name, layout.Version)
		}
		return nil, err
	}
	if err := insertSeats(ctx, tx, layout.ID, seats); err != nil {
		return nil, err
	}
	if err := writeAudit(ctx, tx, actorID, "busfleet.layout.create", "bus_seat_layout", layout.ID, nil,
		map[string]any{"name": layout.Name, "version": layout.Version, "capacity": layout.Capacity, "seats": len(seats)}, ""); err != nil {
		return nil, fmt.Errorf("busfleet: layout audit: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	layout.Seats = seats
	return layout, nil
}

// materializeSeats assigns row ids to a validated seat set.
func materializeSeats(layoutID string, norm []SeatInput) []Seat {
	out := make([]Seat, len(norm))
	for i, in := range norm {
		out[i] = Seat{
			ID: uuid.New().String(), LayoutID: layoutID, SeatKey: in.SeatKey, Label: in.Label,
			Deck: in.Deck, Row: in.Row, Col: in.Col, Type: in.Type, Bookable: *in.Bookable,
		}
	}
	return out
}

// GetLayout loads one layout version with its seats.
func (s *Service) GetLayout(ctx context.Context, layoutID string) (*SeatLayout, error) {
	l, err := loadLayout(ctx, s.db, layoutID, false)
	if err != nil {
		return nil, err
	}
	l.Seats, err = loadSeats(ctx, s.db, layoutID)
	if err != nil {
		return nil, err
	}
	return l, nil
}

// ListLayouts returns every layout version for a provider, newest first.
func (s *Service) ListLayouts(ctx context.Context, providerID string) ([]SeatLayout, error) {
	return listLayouts(ctx, s.db, providerID)
}

// LayoutFrozen reports whether any departure references this layout version —
// frozen layouts must be changed via NewLayoutVersion, never edited in place.
func (s *Service) LayoutFrozen(ctx context.Context, layoutID string) (bool, error) {
	return layoutInUse(ctx, s.db, layoutID)
}

// NewLayoutVersion clones a layout — seats verbatim when seats == nil, else the
// supplied (re-validated) seat set — into the next version number for the same
// (provider_id, name). The source version is never touched: departures pin
// (layout_id, layout_version) so old versions stay meaningful forever.
// Returns 409 LAYOUT_FROZEN-adjacent conflicts through the unique key when two
// versions race.
func (s *Service) NewLayoutVersion(ctx context.Context, layoutID string, seats []SeatInput, actorID string) (*SeatLayout, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	src, err := loadLayout(ctx, tx, layoutID, true)
	if err != nil {
		return nil, err
	}
	var inputs []SeatInput
	if seats == nil {
		var srcSeats []Seat
		srcSeats, err = loadSeats(ctx, tx, layoutID)
		if err != nil {
			return nil, err
		}
		inputs = cloneSeatInputs(srcSeats)
	} else {
		inputs = seats
	}
	norm, bookable, err := validateSeatSet(inputs, src.Decks, src.Rows, src.Cols, src.Capacity)
	if err != nil {
		return nil, err
	}
	next, err := nextLayoutVersion(ctx, tx, src.ProviderID, src.Name)
	if err != nil {
		return nil, err
	}
	clone := &SeatLayout{
		ID: uuid.New().String(), ProviderID: src.ProviderID, Name: src.Name, Version: next,
		Decks: src.Decks, Rows: src.Rows, Cols: src.Cols, Capacity: src.Capacity, Active: true,
	}
	newSeats := materializeSeats(clone.ID, norm)
	if err := insertLayout(ctx, tx, clone); err != nil {
		if isUnique(err) {
			return nil, codedErrf(http.StatusConflict, CodeConflict,
				"layout %q version %d already exists — retry the version request", clone.Name, next)
		}
		return nil, err
	}
	if err := insertSeats(ctx, tx, clone.ID, newSeats); err != nil {
		return nil, err
	}
	if err := writeAudit(ctx, tx, actorID, "busfleet.layout.new_version", "bus_seat_layout", clone.ID,
		map[string]any{"source_layout_id": layoutID, "source_version": src.Version},
		map[string]any{"version": clone.Version, "seats": len(newSeats), "bookable": bookable}, ""); err != nil {
		return nil, fmt.Errorf("busfleet: version audit: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	clone.Seats = newSeats
	return clone, nil
}

// ─── vehicles ───────────────────────────────────────────────────────────────

// RegisterVehicle registers a bus against a seat layout. The layout must belong
// to the same provider and be active; its bookable-seat count must fit inside
// the vehicle's physical capacity. UNIQUE(provider_id, plate_number) violations
// surface as 409 CONFLICT.
func (s *Service) RegisterVehicle(ctx context.Context, req VehicleRequest, actorID string) (*Vehicle, error) {
	plate := strings.TrimSpace(req.PlateNumber)
	if plate == "" {
		return nil, codedErr(http.StatusBadRequest, CodeValidation, "plate_number is required")
	}
	layout, err := loadLayout(ctx, s.db, req.LayoutID, false)
	if err != nil {
		return nil, err
	}
	if layout.ProviderID != req.ProviderID {
		return nil, codedErr(http.StatusForbidden, CodeForbidden, "layout belongs to a different provider")
	}
	if !layout.Active {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "layout is inactive")
	}
	seats, err := loadSeats(ctx, s.db, layout.ID)
	if err != nil {
		return nil, err
	}
	bookable := 0
	for _, st := range seats {
		if st.Bookable {
			bookable++
		}
	}
	if bookable > req.Capacity {
		return nil, codedErrf(http.StatusConflict, CodeCapacity,
			"layout sells %d seats but vehicle capacity is %d", bookable, req.Capacity)
	}
	v := &Vehicle{
		ID: uuid.New().String(), ProviderID: req.ProviderID, PlateNumber: plate,
		FleetCode: strings.TrimSpace(req.FleetCode), MakeModel: strings.TrimSpace(req.MakeModel),
		Capacity: req.Capacity, LayoutID: layout.ID, Status: VehicleAvailable,
	}
	if err := insertVehicle(ctx, s.db, v); err != nil {
		if isUnique(err) {
			return nil, codedErrf(http.StatusConflict, CodeConflict, "plate %q is already registered for this provider", plate)
		}
		return nil, err
	}
	_ = writeAudit(ctx, s.db, actorID, "busfleet.vehicle.register", "bus_vehicle", v.ID, nil,
		map[string]any{"plate": v.PlateNumber, "layout_id": v.LayoutID, "capacity": v.Capacity}, "")
	return v, nil
}

// GetVehicle loads one vehicle.
func (s *Service) GetVehicle(ctx context.Context, vehicleID string) (*Vehicle, error) {
	return loadVehicle(ctx, s.db, vehicleID, false)
}

// ListVehicles returns a provider's fleet, newest first.
func (s *Service) ListVehicles(ctx context.Context, providerID string) ([]Vehicle, error) {
	return listVehicles(ctx, s.db, providerID)
}

// BookedCountFunc resolves how many seats are already booked against a vehicle —
// injected into AssignVehicleLayout so the capacity guard can be satisfied by the
// live query (VehicleBookedSeats) in production and a stub in tests.
type BookedCountFunc func(ctx context.Context, vehicleID string) (int, error)

// VehicleBookedSeats is the production BookedCountFunc: occupied seat rows on
// the vehicle's departures that are still ahead of the bus (terminal states
// free the seats).
func (s *Service) VehicleBookedSeats(ctx context.Context, vehicleID string) (int, error) {
	var n int
	err := s.db.QueryRow(ctx, `
		SELECT COUNT(*) FROM bus_seat_occupancy o
		JOIN bus_departure d ON d.id = o.departure_id
		WHERE d.vehicle_id = $1 AND o.state = 'occupied'
		  AND d.status NOT IN ('arrived','completed','cancelled','no_show')`, vehicleID).Scan(&n)
	return n, err
}

// AssignVehicleLayout points a vehicle at a (possibly different) layout. The new
// layout must belong to the same provider, be active, and offer at least as many
// bookable seats as the count returned by booked — booked callers get the live
// count via VehicleBookedSeats; a nil booked func skips the guard (use only when
// the caller has proven no bookings exist).
func (s *Service) AssignVehicleLayout(ctx context.Context, vehicleID, layoutID string, booked BookedCountFunc, actorID, reason string) (*Vehicle, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	v, err := loadVehicle(ctx, tx, vehicleID, true)
	if err != nil {
		return nil, err
	}
	if v.Status == VehicleRetired {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "a retired vehicle cannot be re-layouted")
	}
	layout, err := loadLayout(ctx, tx, layoutID, false)
	if err != nil {
		return nil, err
	}
	if layout.ProviderID != v.ProviderID {
		return nil, codedErr(http.StatusForbidden, CodeForbidden, "layout belongs to a different provider")
	}
	if !layout.Active {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "layout is inactive")
	}
	if booked != nil {
		n, err := booked(ctx, vehicleID)
		if err != nil {
			return nil, fmt.Errorf("busfleet: booked-seat count: %w", err)
		}
		seats, err := loadSeats(ctx, tx, layout.ID)
		if err != nil {
			return nil, err
		}
		bookable := 0
		for _, st := range seats {
			if st.Bookable {
				bookable++
			}
		}
		if bookable < n {
			return nil, codedErrf(http.StatusConflict, CodeCapacity,
				"layout %q has %d bookable seats but %d are already booked on this vehicle", layout.Name, bookable, n)
		}
	}
	old := v.LayoutID
	if _, err := tx.Exec(ctx, `UPDATE bus_vehicle SET layout_id=$1, updated_at=NOW() WHERE id=$2`, layout.ID, vehicleID); err != nil {
		return nil, err
	}
	v.LayoutID = layout.ID
	if err := writeAudit(ctx, tx, actorID, "busfleet.vehicle.assign_layout", "bus_vehicle", vehicleID,
		map[string]any{"layout_id": old}, map[string]any{"layout_id": layout.ID, "layout_version": layout.Version}, reason); err != nil {
		return nil, fmt.Errorf("busfleet: assign audit: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return v, nil
}

// SetVehicleStatus moves a vehicle through available/assigned/maintenance/retired
// with the transition table; illegal moves return 409 INVALID_STATE.
func (s *Service) SetVehicleStatus(ctx context.Context, vehicleID string, to VehicleStatus, actorID, reason string) (*Vehicle, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	v, err := loadVehicle(ctx, tx, vehicleID, true)
	if err != nil {
		return nil, err
	}
	if !canTransitionVehicle(v.Status, to) {
		return nil, codedErrf(http.StatusConflict, CodeInvalidState,
			"cannot move vehicle from %s to %s", v.Status, to)
	}
	if _, err := tx.Exec(ctx, `UPDATE bus_vehicle SET status=$1, updated_at=NOW() WHERE id=$2`, string(to), vehicleID); err != nil {
		return nil, err
	}
	if err := writeAudit(ctx, tx, actorID, "busfleet.vehicle.status", "bus_vehicle", vehicleID,
		map[string]any{"status": v.Status}, map[string]any{"status": to}, reason); err != nil {
		return nil, fmt.Errorf("busfleet: status audit: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	v.Status = to
	return v, nil
}

// CanAssign is the vehicle-overlap check: the candidate window (padded by
// turnaroundMin on both sides) must not intersect any of the vehicle's
// still-occupied departure windows (departures in cancelled/completed/arrived/
// no_show no longer occupy the bus; 'departed' still does — it is on the road).
// Returns the conflicting departures so the caller can surface them.
func (s *Service) CanAssign(ctx context.Context, vehicleID string, window AssignmentWindow, turnaroundMin int) (bool, []DepartureConflict, error) {
	if window.DepartAt.IsZero() {
		return false, nil, codedErr(http.StatusBadRequest, CodeValidation, "depart_at is required")
	}
	if turnaroundMin < 0 {
		return false, nil, codedErr(http.StatusBadRequest, CodeValidation, "turnaround cannot be negative")
	}
	existing, err := occupiedWindows(ctx, s.db, vehicleID)
	if err != nil {
		return false, nil, err
	}
	conflicts := conflictsFor(window, time.Duration(turnaroundMin)*time.Minute, existing)
	return len(conflicts) == 0, conflicts, nil
}

// ─── departures ─────────────────────────────────────────────────────────────

// GenerateDepartures materializes dated departures for a route + vehicle.
// Each row freezes the route's current stop list (terminal names + computed
// per-stop times off depart_at) and the fare matrix effective on the travel
// date into the snapshot columns — later route/fare edits never rewrite a
// departure that was already sold. Idempotent on the natural key
// UNIQUE(route_id, travel_date, depart_at): a replay returns the existing row
// with Created=false instead of erroring.
//
// The whole batch is atomic: a vehicle-overlap on any requested slot fails the
// call with 409 VEHICLE_BUSY; an advisory xact lock on the vehicle id keeps two
// concurrent generators from interleaving the overlap check.
func (s *Service) GenerateDepartures(ctx context.Context, req GenerateRequest, actorID string) ([]*Departure, error) {
	if len(req.Slots) == 0 {
		return nil, codedErr(http.StatusBadRequest, CodeValidation, "at least one departure slot is required")
	}
	for i, sl := range req.Slots {
		if sl.DepartAt.IsZero() {
			return nil, codedErrf(http.StatusBadRequest, CodeValidation, "slot %d: depart_at is required", i)
		}
	}
	status := req.Status
	if status == "" {
		status = DepScheduled
	}
	if status != DepDraft && status != DepScheduled {
		return nil, codedErrf(http.StatusBadRequest, CodeValidation, "departures can only be generated as draft or scheduled, not %q", status)
	}
	turnaround := req.TurnaroundMin
	if turnaround < 0 {
		return nil, codedErr(http.StatusBadRequest, CodeValidation, "turnaround cannot be negative")
	}
	if turnaround == 0 {
		turnaround = DefaultTurnaroundMinutes
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	route, err := loadRoute(ctx, tx, req.RouteID)
	if err != nil {
		return nil, err
	}
	if !route.Active {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "route template is inactive")
	}
	stops, err := loadRouteStops(ctx, tx, req.RouteID)
	if err != nil {
		return nil, err
	}
	if len(stops) == 0 {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "route has no stops — cannot generate departures")
	}
	vehicle, err := loadVehicle(ctx, tx, req.VehicleID, true)
	if err != nil {
		return nil, err
	}
	if vehicle.ProviderID != route.ProviderID {
		return nil, codedErr(http.StatusForbidden, CodeForbidden, "vehicle belongs to a different provider than the route")
	}
	if !vehicle.Status.assignable() {
		return nil, codedErrf(http.StatusConflict, CodeInvalidState, "vehicle is %s — only available/assigned vehicles can take departures", vehicle.Status)
	}
	layout, err := loadLayout(ctx, tx, vehicle.LayoutID, false)
	if err != nil {
		return nil, err
	}
	seats, err := loadSeats(ctx, tx, layout.ID)
	if err != nil {
		return nil, err
	}
	bookable := 0
	for _, st := range seats {
		if st.Bookable {
			bookable++
		}
	}

	// Serialize the overlap check per vehicle for the duration of this tx.
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 7))`, "busfleet:vehicle:"+vehicle.ID); err != nil {
		return nil, err
	}
	existing, err := occupiedWindows(ctx, tx, vehicle.ID)
	if err != nil {
		return nil, err
	}

	out := make([]*Departure, 0, len(req.Slots))
	for _, sl := range req.Slots {
		travelDate := sl.TravelDate
		if travelDate.IsZero() {
			travelDate = time.Date(sl.DepartAt.Year(), sl.DepartAt.Month(), sl.DepartAt.Day(), 0, 0, 0, 0, time.UTC)
		}
		itin := buildItinerary(stops, sl.DepartAt)
		window := AssignmentWindow{DepartAt: sl.DepartAt, ArriveAt: itineraryEnd(itin, sl.DepartAt)}
		if conflicts := conflictsFor(window, time.Duration(turnaround)*time.Minute, existing); len(conflicts) > 0 {
			return nil, &Error{
				Status:  http.StatusConflict,
				Code:    CodeVehicleBusy,
				Message: fmt.Sprintf("vehicle is committed to %d overlapping departure(s)", len(conflicts)),
				Details: map[string]any{"conflicts": conflicts},
			}
		}
		fares, err := loadRouteFares(ctx, tx, req.RouteID, travelDate)
		if err != nil {
			return nil, err
		}
		dep := &Departure{
			ID: uuid.New().String(), ProviderID: route.ProviderID, RouteID: route.ID, RouteVersion: route.Version,
			TravelDate: travelDate, DepartAt: sl.DepartAt,
			VehicleID: &vehicle.ID, LayoutID: &layout.ID, LayoutVersion: &layout.Version,
			Capacity: bookable, Status: status,
			BookingCutoffMin: req.BookingCutoffMin, CancelCutoffMin: req.CancelCutoffMin,
			Itinerary: itin, Fares: fares,
		}
		created, err := insertDeparture(ctx, tx, dep)
		if err != nil {
			return nil, err
		}
		if !created {
			// Idempotent replay: return the row already on the natural key.
			dep, err = loadDepartureByKey(ctx, tx, route.ID, travelDate, sl.DepartAt)
			if err != nil {
				return nil, err
			}
			dep.Created = false
		} else {
			dep.Created = true
			if err := writeAudit(ctx, tx, actorID, "busfleet.departure.generate", "bus_departure", dep.ID, nil,
				map[string]any{"route_id": route.ID, "travel_date": travelDate.Format("2006-01-02"),
					"depart_at": sl.DepartAt, "vehicle_id": vehicle.ID, "capacity": bookable}, ""); err != nil {
				return nil, fmt.Errorf("busfleet: departure audit: %w", err)
			}
		}
		out = append(out, dep)
		// The just-generated departure now occupies the vehicle for later slots.
		existing = append(existing, OccupiedWindow{DepartureID: dep.ID, DepartAt: window.DepartAt, ArriveAt: window.ArriveAt})
	}
	// Mark the vehicle assigned once it owns any live departure.
	if _, err := tx.Exec(ctx, `UPDATE bus_vehicle SET status='assigned', updated_at=NOW() WHERE id=$1 AND status='available'`, vehicle.ID); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return out, nil
}

// GetDeparture loads one departure with decoded snapshots.
func (s *Service) GetDeparture(ctx context.Context, departureID string) (*Departure, error) {
	return loadDeparture(ctx, s.db, departureID, false)
}

// ListDepartures queries departures by the optional filter fields.
func (s *Service) ListDepartures(ctx context.Context, f DepartureFilter) ([]*Departure, error) {
	return listDepartures(ctx, s.db, f)
}

// TransitionDeparture advances the lifecycle via departureTransitions; the
// status move and its audit row commit in one transaction so an audit failure
// never leaves a mutated row. Illegal moves return 409 INVALID_STATE.
func (s *Service) TransitionDeparture(ctx context.Context, departureID string, to DepartureStatus, actorID, reason string) (*Departure, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	dep, err := loadDeparture(ctx, tx, departureID, true)
	if err != nil {
		return nil, err
	}
	if !canTransitionDeparture(dep.Status, to) {
		return nil, codedErrf(http.StatusConflict, CodeInvalidState,
			"cannot move departure from %s to %s", dep.Status, to)
	}
	if _, err := tx.Exec(ctx, `UPDATE bus_departure SET status=$1, updated_at=NOW() WHERE id=$2`, string(to), departureID); err != nil {
		return nil, err
	}
	if err := writeAudit(ctx, tx, actorID, "busfleet.departure.status", "bus_departure", departureID,
		map[string]any{"status": dep.Status}, map[string]any{"status": to}, reason); err != nil {
		return nil, fmt.Errorf("busfleet: transition audit: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	dep.Status = to
	return dep, nil
}

// SwapVehicle re-buses a pre-departure departure. Three guards, all inside one
// tx with the departure row FOR UPDATE:
//  1. status must still be swappable (draft/scheduled/published/boarding/delayed)
//  2. the new vehicle must belong to the same provider, be assignable, and have
//     no overlapping departure (turnaround-padded)
//  3. every currently occupied seat_key must land on a bookable seat of the new
//     layout — either verbatim (same seat_key exists) or via SeatRemap.
//
// Same layout_id+layout_version needs no remap. When a remap is applied the
// occupancy (and still-held hold) rows are rewritten to the new seat_keys so
// inventory stays consistent. Emits one audit row.
func (s *Service) SwapVehicle(ctx context.Context, req SwapRequest, actorID string) (*Departure, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	dep, err := loadDeparture(ctx, tx, req.DepartureID, true)
	if err != nil {
		return nil, err
	}
	if !swappableStatuses[dep.Status] {
		return nil, codedErrf(http.StatusConflict, CodeInvalidState,
			"departure is %s — vehicle can only be swapped before departure", dep.Status)
	}
	newVeh, err := loadVehicle(ctx, tx, req.NewVehicleID, true)
	if err != nil {
		return nil, err
	}
	if newVeh.ProviderID != dep.ProviderID {
		return nil, codedErr(http.StatusForbidden, CodeForbidden, "vehicle belongs to a different provider")
	}
	if dep.VehicleID != nil && *dep.VehicleID == newVeh.ID {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "departure already uses this vehicle")
	}
	if !newVeh.Status.assignable() {
		return nil, codedErrf(http.StatusConflict, CodeInvalidState, "vehicle is %s — only available/assigned vehicles can take departures", newVeh.Status)
	}

	// Serialize against concurrent generation/swap on the new vehicle.
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 7))`, "busfleet:vehicle:"+newVeh.ID); err != nil {
		return nil, err
	}
	existing, err := occupiedWindows(ctx, tx, newVeh.ID)
	if err != nil {
		return nil, err
	}
	window := AssignmentWindow{DepartAt: dep.DepartAt, ArriveAt: itineraryEnd(dep.Itinerary, dep.DepartAt)}
	if conflicts := conflictsFor(window, DefaultTurnaroundMinutes*time.Minute, existing); len(conflicts) > 0 {
		return nil, &Error{
			Status:  http.StatusConflict,
			Code:    CodeVehicleBusy,
			Message: fmt.Sprintf("vehicle is committed to %d overlapping departure(s)", len(conflicts)),
			Details: map[string]any{"conflicts": conflicts},
		}
	}

	newLayout, err := loadLayout(ctx, tx, newVeh.LayoutID, false)
	if err != nil {
		return nil, err
	}
	newSeats, err := loadSeats(ctx, tx, newLayout.ID)
	if err != nil {
		return nil, err
	}
	newBookable := bookableSeatMap(newSeats)

	occupied, err := occupiedSeatKeys(ctx, tx, dep.ID)
	if err != nil {
		return nil, err
	}
	sameLayout := dep.LayoutID != nil && *dep.LayoutID == newLayout.ID &&
		(dep.LayoutVersion == nil || *dep.LayoutVersion == newLayout.Version)
	plan := map[string]string{}
	if !sameLayout {
		plan, err = planSeatRemap(occupied, newBookable, req.SeatRemap)
		if err != nil {
			return nil, err
		}
	} else if err := verifySameLayoutSeats(occupied, newBookable); err != nil {
		return nil, err
	}
	if len(occupied) > len(newBookable) {
		return nil, codedErrf(http.StatusConflict, CodeCapacity,
			"new layout has %d bookable seats but %d are occupied", len(newBookable), len(occupied))
	}

	// Rewrite occupied/held seat keys to the new layout's keys.
	for oldKey, newKey := range plan {
		if oldKey == newKey {
			continue
		}
		if _, err := tx.Exec(ctx,
			`UPDATE bus_seat_occupancy SET seat_key=$1 WHERE departure_id=$2 AND seat_key=$3 AND state='occupied'`,
			newKey, dep.ID, oldKey); err != nil {
			return nil, err
		}
		if _, err := tx.Exec(ctx,
			`UPDATE bus_seat_hold SET seat_key=$1 WHERE departure_id=$2 AND seat_key=$3 AND state='held'`,
			newKey, dep.ID, oldKey); err != nil {
			return nil, err
		}
	}
	capacity := len(newBookable)
	if _, err := tx.Exec(ctx, `
		UPDATE bus_departure SET vehicle_id=$1, layout_id=$2, layout_version=$3, capacity=$4, updated_at=NOW()
		WHERE id=$5`, newVeh.ID, newLayout.ID, newLayout.Version, capacity, dep.ID); err != nil {
		return nil, err
	}
	oldVehicle := ""
	if dep.VehicleID != nil {
		oldVehicle = *dep.VehicleID
	}
	if err := writeAudit(ctx, tx, actorID, "busfleet.departure.swap_vehicle", "bus_departure", dep.ID,
		map[string]any{"vehicle_id": oldVehicle, "layout_id": dep.LayoutID, "layout_version": dep.LayoutVersion},
		map[string]any{"vehicle_id": newVeh.ID, "layout_id": newLayout.ID, "layout_version": newLayout.Version,
			"seat_remap": plan, "occupied_seats": len(occupied)}, req.Reason); err != nil {
		return nil, fmt.Errorf("busfleet: swap audit: %w", err)
	}
	// Free the old vehicle when this was its last live departure; take the new one.
	if oldVehicle != "" {
		if _, err := tx.Exec(ctx, `
			UPDATE bus_vehicle SET status='available', updated_at=NOW()
			WHERE id=$1 AND status='assigned' AND NOT EXISTS (
				SELECT 1 FROM bus_departure d
				WHERE d.vehicle_id=$1 AND d.id<>$2
				  AND d.status NOT IN ('arrived','completed','cancelled','no_show'))`, oldVehicle, dep.ID); err != nil {
			return nil, err
		}
	}
	if _, err := tx.Exec(ctx, `UPDATE bus_vehicle SET status='assigned', updated_at=NOW() WHERE id=$1 AND status='available'`, newVeh.ID); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	dep.VehicleID = &newVeh.ID
	dep.LayoutID = &newLayout.ID
	dep.LayoutVersion = &newLayout.Version
	dep.Capacity = capacity
	return dep, nil
}

// verifySameLayoutSeats is the same-layout sanity check: an occupied seat_key
// that is somehow absent or non-bookable on the same layout blocks the swap —
// that inconsistency must be repaired, not rubber-stamped.
func verifySameLayoutSeats(occupied []string, newBookable map[string]Seat) error {
	for _, key := range occupied {
		if _, ok := newBookable[key]; !ok {
			return codedErrf(http.StatusConflict, CodeSeatUnmapped,
				"occupied seat %q is not bookable on the same layout — repair inventory before swapping", key)
		}
	}
	return nil
}

// buildItinerary freezes the ordered stop list against departAt — per-stop
// clock times are departAt + the route's minute offsets.
func buildItinerary(stops []routeStopRow, departAt time.Time) []SnapshotStop {
	out := make([]SnapshotStop, len(stops))
	for i, st := range stops {
		out[i] = SnapshotStop{
			Seq:           st.Seq,
			TerminalID:    st.TerminalID,
			TerminalName:  st.TerminalName,
			CityName:      st.CityName,
			DepartAt:      departAt.Add(time.Duration(st.DepartOffsetMin) * time.Minute),
			BoardAllowed:  st.BoardAllowed,
			AlightAllowed: st.AlightAllowed,
		}
		if st.ArriveOffsetMin != nil {
			t := departAt.Add(time.Duration(*st.ArriveOffsetMin) * time.Minute)
			out[i].ArriveAt = &t
		}
	}
	return out
}
