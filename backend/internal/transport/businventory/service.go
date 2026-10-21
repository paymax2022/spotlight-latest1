package businventory

import (
	"context"
	"crypto/rand"
	"encoding/base32"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/go-common/fsm"
	"spotlight/backend/go-common/jsonx"
)

// ─── Error model ────────────────────────────────────────────────────────────
// Mirrors transport.CodedError (status + machine code + safe body) so the
// module's handlers map errors exactly like the rest of transport.

const (
	CodeNotFound          = "NOT_FOUND"
	CodeForbidden         = "FORBIDDEN"
	CodeInvalidState      = "INVALID_STATE"
	CodeSeatTaken         = "SEAT_TAKEN"
	CodeSeatHeld          = "SEAT_HELD"
	CodeHoldExpired       = "HOLD_EXPIRED"
	CodeKeyConflict       = "IDEMPOTENCY_KEY_CONFLICT"
	CodeMissingKey        = "MISSING_IDEMPOTENCY_KEY"
	CodeInvalidSeat       = "INVALID_SEAT"
	CodeBookingClosed     = "BOOKING_CLOSED"
	CodeValidation        = "VALIDATION"
	CodePaymentConflict   = "PAYMENT_CONFLICT"
	CodeExceptionRequired = "EXCEPTION_REVIEW"
)

// CodedError carries an HTTP status + machine-readable code alongside a message.
type CodedError struct {
	Status  int
	Code    string
	Message string
	Details map[string]any
}

func (e *CodedError) Error() string { return e.Message }

// Body is the JSON error body: {error, code} plus any Details (which can never
// override those two keys).
func (e *CodedError) Body() map[string]any {
	b := map[string]any{}
	for k, v := range e.Details {
		b[k] = v
	}
	b["error"] = e.Message
	b["code"] = e.Code
	return b
}

func codedErr(status int, code, msg string) *CodedError {
	return &CodedError{Status: status, Code: code, Message: msg}
}

// ─── Booking state machine ──────────────────────────────────────────────────

// BookingState is bus_booking.state.
type BookingState string

const (
	BookingQuoted            BookingState = "quoted"
	BookingInventoryHeld     BookingState = "inventory_held"
	BookingPaymentPending    BookingState = "payment_pending"
	BookingConfirmed         BookingState = "confirmed"
	BookingCancelRequested   BookingState = "cancel_requested"
	BookingCancelled         BookingState = "cancelled"
	BookingChangeRequested   BookingState = "change_requested"
	BookingPartiallyRefunded BookingState = "partially_refunded"
	BookingRefundPending     BookingState = "refund_pending"
	BookingRefunded          BookingState = "refunded"
	BookingExpired           BookingState = "expired"
	BookingPaymentFailed     BookingState = "payment_failed"
	BookingExceptionReview   BookingState = "exception_review"
)

// bookingMoves is the legal transition table. Money-adjacent moves
// (confirmed, cancel/refund) only ever run inside CAS UPDATEs, so a stale
// read can never force an illegal transition.
var bookingMoves = fsm.Table[BookingState]{
	BookingQuoted:            fsm.Set(BookingInventoryHeld, BookingCancelled, BookingExpired),
	BookingInventoryHeld:     fsm.Set(BookingPaymentPending, BookingConfirmed, BookingExpired, BookingCancelled, BookingExceptionReview),
	BookingPaymentPending:    fsm.Set(BookingConfirmed, BookingPaymentFailed, BookingExpired, BookingCancelRequested, BookingCancelled, BookingExceptionReview),
	BookingPaymentFailed:     fsm.Set(BookingPaymentPending, BookingExpired, BookingCancelled),
	BookingConfirmed:         fsm.Set(BookingCancelRequested, BookingChangeRequested, BookingExceptionReview),
	BookingChangeRequested:   fsm.Set(BookingConfirmed, BookingCancelRequested, BookingExceptionReview),
	BookingCancelRequested:   fsm.Set(BookingCancelled, BookingRefundPending, BookingConfirmed, BookingExceptionReview),
	BookingCancelled:         fsm.Set(BookingRefundPending, BookingExceptionReview),
	BookingRefundPending:     fsm.Set(BookingRefunded, BookingPartiallyRefunded, BookingExceptionReview),
	BookingPartiallyRefunded: fsm.Set(BookingRefunded, BookingExceptionReview),
	BookingExceptionReview:   fsm.Set(BookingConfirmed, BookingCancelled, BookingRefundPending, BookingRefunded),
	// expired / refunded are terminal.
}

// canTransition reports whether moving from→to is permitted.
func canTransition(from, to BookingState) bool { return bookingMoves.Can(from, to) }

// ─── Config / Service ───────────────────────────────────────────────────────

// Config tunes the engine. Zero values pick the documented defaults.
type Config struct {
	// DefaultHoldTTL is the hold lifetime when the caller passes ttl<=0.
	DefaultHoldTTL time.Duration
	// MaxHoldTTL caps any caller-supplied TTL (clamped, not rejected — a
	// client asking for longer must never fault a booking flow).
	MaxHoldTTL time.Duration
	// Now is the clock seam for tests; nil → time.Now.
	Now func() time.Time
}

// DefaultConfig is 10-minute holds capped at 30.
func DefaultConfig() Config {
	return Config{DefaultHoldTTL: 10 * time.Minute, MaxHoldTTL: 30 * time.Minute}
}

// Service is the seat-conflict engine + booking core. It owns NO money
// movement: payment arrives through a verified webhook that calls
// ConfirmPayment; refunds are a separate rail. Every mutation is
// transaction-scoped and writes a transport_audit_log row.
type Service struct {
	repo *Repository
	cfg  Config
}

// NewService wires the engine over the shared pgx pool.
func NewService(pool *pgxpool.Pool) *Service {
	return &Service{repo: NewRepository(pool), cfg: DefaultConfig()}
}

// WithConfig applies a custom config (nil-safe defaults preserved).
func (s *Service) WithConfig(c Config) *Service {
	if c.DefaultHoldTTL <= 0 {
		c.DefaultHoldTTL = s.cfg.DefaultHoldTTL
	}
	if c.MaxHoldTTL <= 0 {
		c.MaxHoldTTL = s.cfg.MaxHoldTTL
	}
	if c.Now == nil {
		c.Now = s.cfg.Now
	}
	s.cfg = c
	return s
}

func (s *Service) now() time.Time {
	if s.cfg.Now != nil {
		return s.cfg.Now()
	}
	return time.Now()
}

func (s *Service) clampTTL(ttl time.Duration) time.Duration {
	if ttl <= 0 {
		return s.cfg.DefaultHoldTTL
	}
	if ttl > s.cfg.MaxHoldTTL {
		return s.cfg.MaxHoldTTL
	}
	return ttl
}

// segmentsOverlap is the half-open interval predicate the whole module shares:
// [aFrom,aTo) overlaps [bFrom,bTo) iff aFrom < bTo AND aTo > bFrom. Adjacent
// segments (aTo == bFrom) do NOT overlap — the same physical seat can be sold
// Lagos→Ibadan and Ibadan→Abuja.
func segmentsOverlap(aFrom, aTo, bFrom, bTo int) bool {
	return aFrom < bTo && aTo > bFrom
}

// bookableStatuses are the bus_departure states open for seat mutation.
var bookableStatuses = map[string]bool{"scheduled": true, "published": true, "boarding": true}

// ─── Holds ──────────────────────────────────────────────────────────────────

// HoldResult summarizes one HoldSeats call (a group of per-seat hold rows).
type HoldResult struct {
	DepartureID    string    `json:"departureId"`
	SeatKeys       []string  `json:"seatKeys"`
	FromSeq        int       `json:"fromSeq"`
	ToSeq          int       `json:"toSeq"`
	ExpiresAt      time.Time `json:"expiresAt"`
	HoldIDs        []string  `json:"holdIds"`
	IdempotencyKey string    `json:"idempotencyKey"`
	Replayed       bool      `json:"replayed"` // true when the key already produced these holds
}

// HoldSeats claims seats on a departure segment for ttl, under a mandatory
// Idempotency-Key.
//
// Concurrency: one transaction, departure row locked FOR UPDATE first. Every
// other seat mutation on this departure (hold/confirm/release-into-occupancy)
// takes the same lock, so the check-then-insert inside this txn is serialized —
// two callers racing the last seat cannot both win. The DB unique key
// (departure, seat, segment, key) makes a same-key retry replay rather than
// double-hold.
//
// Rejection reasons: SEAT_TAKEN (overlapping occupied segment), SEAT_HELD
// (overlapping live hold — any owner, including a second key from the same
// owner: re-holding is what the replay key is for), INVALID_SEAT (key unknown
// or non-bookable in the pinned layout), BOOKING_CLOSED, NOT_FOUND.
func (s *Service) HoldSeats(ctx context.Context, departureID string, seatKeys []string, fromSeq, toSeq int, ownerID, idemKey string, ttl time.Duration) (*HoldResult, error) {
	if strings.TrimSpace(idemKey) == "" {
		return nil, codedErr(http.StatusBadRequest, CodeMissingKey, "Idempotency-Key required")
	}
	if strings.TrimSpace(ownerID) == "" {
		return nil, codedErr(http.StatusBadRequest, CodeValidation, "owner required")
	}
	seatKeys = dedupeSorted(seatKeys)
	if len(seatKeys) == 0 {
		return nil, codedErr(http.StatusBadRequest, CodeValidation, "at least one seat required")
	}
	if fromSeq < 1 || toSeq <= fromSeq {
		return nil, codedErr(http.StatusBadRequest, CodeValidation, "segment must satisfy 1 <= from_seq < to_seq")
	}
	expiresAt := s.now().Add(s.clampTTL(ttl))

	tx, err := s.repo.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	dep, err := s.repo.LockDeparture(ctx, tx, departureID)
	if err != nil {
		return nil, mapDepartureErr(err, departureID)
	}
	if err := checkDepartureBookable(dep, s.now()); err != nil {
		return nil, err
	}

	// Replay probe: rows already written under this key. All held → return the
	// group. Any consumed/released/expired row → the key is burned (409).
	if existing, err := s.repo.HoldsByKey(ctx, tx, departureID, idemKey); err != nil {
		return nil, err
	} else if len(existing) > 0 {
		res := &HoldResult{DepartureID: departureID, FromSeq: fromSeq, ToSeq: toSeq, IdempotencyKey: idemKey, Replayed: true}
		for _, h := range existing {
			if h.OwnerUserID != ownerID {
				return nil, codedErr(http.StatusConflict, CodeKeyConflict, "this idempotency key is already bound to another owner")
			}
			if h.State != "held" {
				return nil, codedErr(http.StatusConflict, CodeKeyConflict, "this idempotency key was already used; retry with a new key")
			}
			res.HoldIDs = append(res.HoldIDs, h.ID)
			res.SeatKeys = append(res.SeatKeys, h.SeatKey)
			res.ExpiresAt = h.ExpiresAt
		}
		return res, tx.Commit(ctx)
	}

	if err := s.requireBookableSeats(ctx, tx, dep, seatKeys); err != nil {
		return nil, err
	}
	if err := s.checkSegmentsFree(ctx, tx, departureID, seatKeys, fromSeq, toSeq, s.now()); err != nil {
		return nil, err
	}

	res := &HoldResult{DepartureID: departureID, SeatKeys: seatKeys, FromSeq: fromSeq, ToSeq: toSeq, ExpiresAt: expiresAt, IdempotencyKey: idemKey}
	for _, seat := range seatKeys {
		h := &SeatHold{
			DepartureID: departureID, SeatKey: seat, FromSeq: fromSeq, ToSeq: toSeq,
			OwnerUserID: ownerID, IdempotencyKey: idemKey, ExpiresAt: expiresAt,
		}
		if err := s.repo.InsertHold(ctx, tx, h); err != nil {
			return nil, fmt.Errorf("businventory: insert hold: %w", err)
		}
		res.HoldIDs = append(res.HoldIDs, h.ID)
	}
	if err := s.repo.WriteAudit(ctx, tx, ownerID, "bus2.hold_created", "bus_seat_hold", idemKey,
		nil, map[string]any{"departure_id": departureID, "seats": seatKeys, "from_seq": fromSeq, "to_seq": toSeq, "expires_at": expiresAt}, ""); err != nil {
		return nil, fmt.Errorf("businventory: audit hold: %w", err)
	}
	return res, tx.Commit(ctx)
}

// ReleaseHold releases a live hold early (user abandoned checkout). CAS from
// 'held' so it cannot resurrect a consumed/expired hold; owner-only.
func (s *Service) ReleaseHold(ctx context.Context, holdID, actorID string) error {
	tx, err := s.repo.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	h, err := s.repo.HoldForUpdate(ctx, tx, holdID)
	if errors.Is(err, pgx.ErrNoRows) {
		return codedErr(http.StatusNotFound, CodeNotFound, "hold not found")
	}
	if err != nil {
		return err
	}
	if h.OwnerUserID != actorID {
		return codedErr(http.StatusForbidden, CodeForbidden, "not your hold")
	}
	if h.State == "released" {
		return tx.Commit(ctx) // idempotent replay
	}
	ok, err := s.repo.SetHoldState(ctx, tx, holdID, "released")
	if err != nil {
		return err
	}
	if !ok {
		return codedErr(http.StatusConflict, CodeInvalidState, "hold is no longer active (state "+h.State+")")
	}
	if err := s.repo.WriteAudit(ctx, tx, actorID, "bus2.hold_released", "bus_seat_hold", holdID,
		map[string]any{"state": "held"}, map[string]any{"state": "released"}, ""); err != nil {
		return fmt.Errorf("businventory: audit release: %w", err)
	}
	return tx.Commit(ctx)
}

// ExpireHolds flips every live hold with expires_at < now to 'expired'.
// Idempotent: the UPDATE predicate is self-limiting, and vs a racing
// ConfirmSeats the row lock serializes — whichever commits first wins, the
// other's predicate re-evaluates against the committed state.
func (s *Service) ExpireHolds(ctx context.Context, now time.Time) (int64, error) {
	return s.repo.ExpireDueHolds(ctx, now)
}

// ExpireDueHolds is ExpireHolds at the service clock — the worker tick body.
func (s *Service) ExpireDueHolds(ctx context.Context) (int64, error) {
	return s.ExpireHolds(ctx, s.now())
}

// RunHoldExpiryLoop ticks ExpireDueHolds every interval until ctx is done —
// the runnable entry point for the hold-expiry worker. This repo has no
// asynq periodic scheduler; the house pattern is a ticker loop under
// backend/cmd/transport-scheduler (runLoop in cmd/transport-scheduler/main.go).
// TODO(worker-hook): wire into transport-scheduler (or an asynq periodic task)
// with ~30s cadence once the v2 bus flow is flagged on.
func (s *Service) RunHoldExpiryLoop(ctx context.Context, interval time.Duration) {
	if interval <= 0 {
		interval = 30 * time.Second
	}
	run := func() {
		n, err := s.ExpireDueHolds(ctx)
		if err != nil {
			log.Printf("[businventory] hold expiry sweep: %v", err)
		} else if n > 0 {
			log.Printf("[businventory] hold expiry sweep: expired %d", n)
		}
	}
	run()
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			run()
		}
	}
}

// ─── Confirm ────────────────────────────────────────────────────────────────

// ConfirmSeats converts ONE live hold into occupied inventory inside a single
// transaction: the hold row is locked FOR UPDATE, the departure lock is taken
// (same serialization point as HoldSeats), the hold is claimed atomically
// (state='held' AND expires_at > now()), overlap is re-validated against
// occupied rows, the occupancy row is written, and the audit event is logged.
//
// Deterministic payment-vs-expiry resolution: the claim predicate is evaluated
// at the commit-time serial order of the transaction — if the expiry sweep
// committed first, expires_at is already in the past (or state='expired') and
// the claim fails with HOLD_EXPIRED; if the claim commits first the sweeper's
// WHERE clause stops matching. No third outcome exists.
func (s *Service) ConfirmSeats(ctx context.Context, holdID, bookingID string) (*Occupancy, error) {
	tx, err := s.repo.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	o, err := s.confirmHoldTx(ctx, tx, holdID, bookingID)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return o, nil
}

// confirmHoldTx is the in-transaction single-hold claim shared by ConfirmSeats
// and ConfirmPayment's group path. The caller owns the transaction.
func (s *Service) confirmHoldTx(ctx context.Context, tx pgx.Tx, holdID, bookingID string) (*Occupancy, error) {
	h, err := s.repo.HoldForUpdate(ctx, tx, holdID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "hold not found")
	}
	if err != nil {
		return nil, err
	}
	// Already consumed by THIS booking → replay (return the occupancy row).
	if h.State == "consumed" {
		occ, oerr := s.repo.OccupancyForBooking(ctx, tx, bookingID)
		if oerr != nil {
			return nil, oerr
		}
		for i := range occ {
			if occ[i].SeatKey == h.SeatKey && occ[i].DepartureID == h.DepartureID &&
				occ[i].FromSeq == h.FromSeq && occ[i].ToSeq == h.ToSeq && occ[i].State == "occupied" {
				return &occ[i], nil
			}
		}
		return nil, codedErr(http.StatusConflict, CodeKeyConflict, "hold already consumed by another booking")
	}
	if h.State != "held" {
		return nil, codedErr(http.StatusConflict, CodeHoldExpired, "hold is "+h.State)
	}
	// Serialize with other seat mutations on this departure.
	if _, err := s.repo.LockDeparture(ctx, tx, h.DepartureID); err != nil {
		return nil, mapDepartureErr(err, h.DepartureID)
	}
	// Re-validate overlap vs occupied inventory — defense against an occupancy
	// row that landed between hold creation and confirm (e.g. admin ops).
	free := errSeatConflict(ctx, tx, s.repo, h.DepartureID, []string{h.SeatKey}, h.FromSeq, h.ToSeq, s.now(), h.ID)
	if free != nil {
		return nil, free
	}
	claimed, err := s.repo.ClaimHold(ctx, tx, holdID)
	if err != nil {
		return nil, err
	}
	if !claimed {
		return nil, codedErr(http.StatusConflict, CodeHoldExpired, "hold expired before payment could be captured")
	}
	o := &Occupancy{
		DepartureID: h.DepartureID, SeatKey: h.SeatKey,
		FromSeq: h.FromSeq, ToSeq: h.ToSeq, BookingID: bookingID,
	}
	if err := s.repo.InsertOccupancy(ctx, tx, o); err != nil {
		return nil, fmt.Errorf("businventory: insert occupancy: %w", err)
	}
	if err := s.repo.WriteAudit(ctx, tx, h.OwnerUserID, "bus2.seat_confirmed", "bus_seat_occupancy", o.ID,
		map[string]any{"hold_id": holdID, "state": "held"},
		map[string]any{"booking_id": bookingID, "seat_key": h.SeatKey, "from_seq": h.FromSeq, "to_seq": h.ToSeq, "state": "occupied"}, ""); err != nil {
		return nil, fmt.Errorf("businventory: audit confirm: %w", err)
	}
	return o, nil
}

// ConfirmBookingSeats confirms every hold CreateBooking wrote for a booking —
// all-or-nothing in one transaction (a half-confirmed paid booking must never
// exist). Empty hold set is a no-op returning nil.
func (s *Service) ConfirmBookingSeats(ctx context.Context, bookingID string) ([]Occupancy, error) {
	tx, err := s.repo.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	out, err := s.confirmBookingSeatsTx(ctx, tx, bookingID)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return out, nil
}

func (s *Service) confirmBookingSeatsTx(ctx context.Context, tx pgx.Tx, bookingID string) ([]Occupancy, error) {
	holds, err := s.repo.HoldsForBookingForUpdate(ctx, tx, bookingID)
	if err != nil {
		return nil, err
	}
	var out []Occupancy
	for _, h := range holds {
		o, err := s.confirmHoldTx(ctx, tx, h.ID, bookingID)
		if err != nil {
			return nil, err
		}
		out = append(out, *o)
	}
	return out, nil
}

// ─── Booking ────────────────────────────────────────────────────────────────

// LegInput is one leg of CreateBooking (outbound + optional return).
type LegInput struct {
	DepartureID string `json:"departure_id"`
	FromSeq     int    `json:"from_seq"`
	ToSeq       int    `json:"to_seq"`
	// FareKobo is the PER-PASSENGER fare for this leg's segment, integer minor
	// units. The booking total is Σ leg.FareKobo × passengers-on-that-leg.
	FareKobo int64 `json:"fare_kobo"`
}

// PassengerInput is one traveller. LegIndex (0-based) attaches the passenger —
// and their seat — to a leg; a return journey supplies passengers for both
// legs. DeliverTo defaults to "purchaser".
type PassengerInput struct {
	FullName  string `json:"full_name"`
	Phone     string `json:"phone"`
	Email     string `json:"email"`
	SeatKey   string `json:"seat_key"`
	DeliverTo string `json:"deliver_to"`
	LegIndex  int    `json:"leg_index"`
}

// BookingDetail is a booking plus its legs/passengers/tickets.
type BookingDetail struct {
	Booking  *Booking    `json:"booking"`
	Legs     []LegDetail `json:"legs"`
	Tickets  []Ticket    `json:"tickets,omitempty"`
	Replayed bool        `json:"replayed,omitempty"`
}

// LegDetail is a leg plus its passengers.
type LegDetail struct {
	Leg        BookingLeg         `json:"leg"`
	Departure  *Departure         `json:"departure,omitempty"`
	Passengers []BookingPassenger `json:"passengers"`
}

// bookingHoldKey is the deterministic per-seat hold key CreateBooking writes:
// it both groups a booking's holds (LIKE 'bk:<id>:%') and makes the unique
// index do the replay work.
func bookingHoldKey(bookingID string, legIdx int, seatKey string) string {
	return fmt.Sprintf("bk:%s:%d:%s", bookingID, legIdx, seatKey)
}

func validateBookingInput(legs []LegInput, passengers []PassengerInput) error {
	if len(legs) == 0 {
		return codedErr(http.StatusBadRequest, CodeValidation, "at least one leg required")
	}
	if len(legs) > 2 {
		return codedErr(http.StatusBadRequest, CodeValidation, "at most two legs (outbound + return)")
	}
	for i, l := range legs {
		if strings.TrimSpace(l.DepartureID) == "" {
			return codedErr(http.StatusBadRequest, CodeValidation, fmt.Sprintf("leg %d: departure required", i))
		}
		if l.FromSeq < 1 || l.ToSeq <= l.FromSeq {
			return codedErr(http.StatusBadRequest, CodeValidation, fmt.Sprintf("leg %d: segment must satisfy 1 <= from_seq < to_seq", i))
		}
		if l.FareKobo < 0 {
			return codedErr(http.StatusBadRequest, CodeValidation, fmt.Sprintf("leg %d: fare must be >= 0", i))
		}
	}
	if len(passengers) == 0 {
		return codedErr(http.StatusBadRequest, CodeValidation, "at least one passenger required")
	}
	seen := map[string]bool{}
	for i, p := range passengers {
		if strings.TrimSpace(p.FullName) == "" {
			return codedErr(http.StatusBadRequest, CodeValidation, fmt.Sprintf("passenger %d: full_name required", i))
		}
		if strings.TrimSpace(p.SeatKey) == "" {
			return codedErr(http.StatusBadRequest, CodeValidation, fmt.Sprintf("passenger %d: seat_key required", i))
		}
		if p.LegIndex < 0 || p.LegIndex >= len(legs) {
			return codedErr(http.StatusBadRequest, CodeValidation, fmt.Sprintf("passenger %d: leg_index out of range", i))
		}
		switch p.DeliverTo {
		case "", "purchaser", "traveller", "both":
		default:
			return codedErr(http.StatusBadRequest, CodeValidation, fmt.Sprintf("passenger %d: invalid deliver_to", i))
		}
		k := fmt.Sprintf("%d:%s", p.LegIndex, p.SeatKey)
		if seen[k] {
			return codedErr(http.StatusBadRequest, CodeValidation, fmt.Sprintf("passenger %d: seat %s already assigned on leg %d", i, p.SeatKey, p.LegIndex))
		}
		seen[k] = true
	}
	return nil
}

// CreateBooking books a group of passengers over 1-2 legs. One transaction:
// lock each involved departure FOR UPDATE (sorted order — no deadlock), verify
// bookability + pinned-layout seats + segment overlap vs occupied/live holds,
// insert booking + legs + passengers + per-seat holds, and write the audit
// row. The booking lands in inventory_held with payment_pending legs; the
// holds' expiry is the unpaid-booking deadline (ExpireHeldBookings is the
// sweep's job — see ExpireHolds).
//
// Idempotent on idemKey (bus_booking.idempotency_key UNIQUE): a replay returns
// the existing booking; a key bound to another purchaser or different request
// body is KEY_CONFLICT.
func (s *Service) CreateBooking(ctx context.Context, purchaserID, providerID string, legs []LegInput, passengers []PassengerInput, idemKey string) (*BookingDetail, error) {
	if strings.TrimSpace(idemKey) == "" {
		return nil, codedErr(http.StatusBadRequest, CodeMissingKey, "Idempotency-Key required")
	}
	if strings.TrimSpace(purchaserID) == "" || strings.TrimSpace(providerID) == "" {
		return nil, codedErr(http.StatusBadRequest, CodeValidation, "purchaser and provider are required")
	}
	if err := validateBookingInput(legs, passengers); err != nil {
		return nil, err
	}
	// Replay probe before the expensive lock+hold work.
	if existing, err := s.repo.BookingByKey(ctx, s.repo.Pool(), idemKey); err != nil {
		return nil, err
	} else if existing != nil {
		if existing.PurchaserID != purchaserID {
			return nil, codedErr(http.StatusConflict, CodeKeyConflict, "this idempotency key is already bound to another purchaser")
		}
		d, err := s.loadBookingDetail(ctx, s.repo.Pool(), existing.ID)
		if err != nil {
			return nil, err
		}
		d.Replayed = true
		return d, nil
	}

	now := s.now()
	expiresAt := now.Add(s.cfg.DefaultHoldTTL)
	bookingID := uuid.NewString()
	ref := newBookingRef()

	var total int64
	paxPerLeg := make([]int, len(legs))
	for _, p := range passengers {
		paxPerLeg[p.LegIndex]++
	}
	for i, l := range legs {
		total += l.FareKobo * int64(paxPerLeg[i])
	}
	fareSnapshot := jsonx.Marshal(map[string]any{
		"v": 1, "currency": "NGN", "quoted_at": now.UTC().Format(time.RFC3339),
		"total_kobo": total,
		"legs":       legs,
	})

	tx, err := s.repo.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Lock every involved departure in sorted id order BEFORE touching seats —
	// consistent ordering prevents hold txn deadlocks on multi-leg bookings.
	depByID := map[string]*Departure{}
	depIDs := []string{}
	for _, l := range legs {
		if _, ok := depByID[l.DepartureID]; !ok {
			depIDs = append(depIDs, l.DepartureID)
		}
	}
	sort.Strings(depIDs)
	for _, id := range depIDs {
		dep, err := s.repo.LockDeparture(ctx, tx, id)
		if err != nil {
			return nil, mapDepartureErr(err, id)
		}
		if err := checkDepartureBookable(dep, now); err != nil {
			return nil, err
		}
		depByID[id] = dep
	}

	b := &Booking{
		ID: bookingID, Ref: ref, PurchaserID: purchaserID, ProviderID: providerID,
		IdempotencyKey: idemKey, State: string(BookingInventoryHeld),
		TotalKobo: total, Currency: "NGN", FareSnapshot: fareSnapshot,
	}
	if err := s.repo.InsertBooking(ctx, tx, b); err != nil {
		return nil, fmt.Errorf("businventory: insert booking: %w", err)
	}

	detail := &BookingDetail{Booking: b}
	for i, l := range legs {
		leg := &BookingLeg{BookingID: bookingID, DepartureID: l.DepartureID, FromSeq: l.FromSeq, ToSeq: l.ToSeq, FareKobo: l.FareKobo}
		if err := s.repo.InsertBookingLeg(ctx, tx, leg); err != nil {
			return nil, fmt.Errorf("businventory: insert leg %d: %w", i, err)
		}
		detail.Legs = append(detail.Legs, LegDetail{Leg: *leg, Departure: depByID[l.DepartureID]})
	}
	for i, p := range passengers {
		leg := &detail.Legs[p.LegIndex].Leg
		pax := &BookingPassenger{
			BookingLegID: leg.ID, FullName: strings.TrimSpace(p.FullName),
			Phone: nullIfEmpty(p.Phone), Email: nullIfEmpty(p.Email),
			SeatKey: p.SeatKey, DeliverTo: p.DeliverTo,
		}
		if pax.DeliverTo == "" {
			pax.DeliverTo = "purchaser"
		}
		dep := depByID[leg.DepartureID]
		if err := s.requireBookableSeats(ctx, tx, dep, []string{p.SeatKey}); err != nil {
			return nil, fmt.Errorf("passenger %d: %w", i, err)
		}
		if err := s.checkSegmentsFree(ctx, tx, leg.DepartureID, []string{p.SeatKey}, leg.FromSeq, leg.ToSeq, now); err != nil {
			return nil, fmt.Errorf("passenger %d: %w", i, err)
		}
		h := &SeatHold{
			DepartureID: leg.DepartureID, SeatKey: p.SeatKey,
			FromSeq: leg.FromSeq, ToSeq: leg.ToSeq, OwnerUserID: purchaserID,
			IdempotencyKey: bookingHoldKey(bookingID, p.LegIndex, p.SeatKey),
			ExpiresAt:      expiresAt,
		}
		if err := s.repo.InsertHold(ctx, tx, h); err != nil {
			return nil, fmt.Errorf("businventory: hold passenger %d seat: %w", i, err)
		}
		if err := s.repo.InsertPassenger(ctx, tx, pax); err != nil {
			return nil, fmt.Errorf("businventory: insert passenger %d: %w", i, err)
		}
		detail.Legs[p.LegIndex].Passengers = append(detail.Legs[p.LegIndex].Passengers, *pax)
	}
	if err := s.repo.WriteAudit(ctx, tx, purchaserID, "bus2.booking_created", "bus_booking", bookingID,
		nil, map[string]any{"ref": ref, "state": string(BookingInventoryHeld), "total_kobo": total, "legs": len(legs), "passengers": len(passengers), "hold_expires_at": expiresAt}, ""); err != nil {
		return nil, fmt.Errorf("businventory: audit booking: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return detail, nil
}

// MarkPaymentPending records that a payment intent/checkout exists for the
// booking (inventory_held → payment_pending). Idempotent: already-pending is
// a no-op; confirmed keeps its state.
func (s *Service) MarkPaymentPending(ctx context.Context, bookingID string) error {
	b, err := s.repo.BookingByID(ctx, s.repo.Pool(), bookingID)
	if errors.Is(err, pgx.ErrNoRows) {
		return codedErr(http.StatusNotFound, CodeNotFound, "booking not found")
	}
	if err != nil {
		return err
	}
	cur := BookingState(b.State)
	if cur == BookingPaymentPending || cur == BookingConfirmed {
		return nil
	}
	if !canTransition(cur, BookingPaymentPending) {
		return codedErr(http.StatusConflict, CodeInvalidState, "cannot mark payment_pending from "+b.State)
	}
	ok, err := s.repo.TransitionBooking(ctx, s.repo.Pool(), bookingID, string(BookingPaymentPending), string(cur))
	if err != nil {
		return err
	}
	if !ok {
		return codedErr(http.StatusConflict, CodeInvalidState, "booking state changed concurrently")
	}
	return nil
}

// ConfirmPayment is the WEBHOOK-side hook — call it only from a handler that
// has already verified the payment provider's signature (Paystack HMAC-SHA512
// on the raw body). It must never be reachable from a client callback: the
// payment_ref stored here is the provider-verified reference.
//
// One transaction: lock booking → CAS to confirmed → claim every booking hold
// (see ClaimHold for the deterministic expiry race) → write occupancy → issue
// tickets → audit. If any hold already expired, the booking moves to
// exception_review (paid but unseated — the payment rail must refund) and the
// call returns HOLD_EXPIRED; inventory is never double-booked.
//
// Idempotent: repeated calls with the same booking ref return the booking; a
// differing payment_ref on an already-confirmed booking is PAYMENT_CONFLICT.
func (s *Service) ConfirmPayment(ctx context.Context, bookingRef, paymentRef string) (*BookingDetail, error) {
	if strings.TrimSpace(paymentRef) == "" {
		return nil, codedErr(http.StatusBadRequest, CodeValidation, "payment_ref required")
	}
	tx, err := s.repo.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	b, err := s.repo.BookingByRefForUpdate(ctx, tx, bookingRef)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "booking not found")
	}
	if err != nil {
		return nil, err
	}
	if b.State == string(BookingConfirmed) {
		stored, err := s.repo.PaymentRef(ctx, tx, b.ID)
		if err != nil {
			return nil, err
		}
		if stored != "" && stored != paymentRef {
			return nil, codedErr(http.StatusConflict, CodePaymentConflict, "booking already confirmed under a different payment reference")
		}
		d, err := s.loadBookingDetail(ctx, tx, b.ID)
		if err != nil {
			return nil, err
		}
		d.Tickets, _ = s.repo.TicketsForBooking(ctx, tx, b.ID)
		d.Replayed = true
		return d, tx.Commit(ctx)
	}
	if !canTransition(BookingState(b.State), BookingConfirmed) {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "cannot confirm payment from state "+b.State)
	}

	if _, err := s.confirmBookingSeatsTx(ctx, tx, b.ID); err != nil {
		// Paid but unseated: park for manual review instead of rolling back to
		// a state that hides the money. Transition + audit commit atomically.
		var ce *CodedError
		if errors.As(err, &ce) && (ce.Code == CodeHoldExpired || ce.Code == CodeSeatTaken || ce.Code == CodeSeatHeld) {
			if ok, terr := s.repo.TransitionBooking(ctx, tx, b.ID, string(BookingExceptionReview), b.State); terr != nil {
				return nil, terr
			} else if ok {
				_ = s.repo.WriteAudit(ctx, tx, b.PurchaserID, "bus2.payment_confirm_failed", "bus_booking", b.ID,
					map[string]any{"state": b.State}, map[string]any{"state": string(BookingExceptionReview), "payment_ref": paymentRef, "cause": ce.Code}, "seat inventory lost before payment confirm")
			}
			if cerr := tx.Commit(ctx); cerr != nil {
				return nil, cerr
			}
			return nil, ce
		}
		return nil, err
	}

	ok, err := s.repo.TransitionBooking(ctx, tx, b.ID, string(BookingConfirmed), b.State)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "booking state changed concurrently")
	}
	if err := s.repo.SetPaymentRef(ctx, tx, b.ID, paymentRef); err != nil {
		return nil, fmt.Errorf("businventory: record payment ref: %w", err)
	}
	if err := s.repo.WriteAudit(ctx, tx, b.PurchaserID, "bus2.payment_confirmed", "bus_booking", b.ID,
		map[string]any{"state": b.State}, map[string]any{"state": string(BookingConfirmed), "payment_ref": paymentRef}, ""); err != nil {
		return nil, fmt.Errorf("businventory: audit payment: %w", err)
	}
	if _, err := s.issueTicketsTx(ctx, tx, b.ID, b.PurchaserID); err != nil {
		return nil, err
	}
	legs, err := s.repo.LegsForBooking(ctx, tx, b.ID)
	if err != nil {
		return nil, err
	}
	for _, l := range legs {
		if err := s.repo.SetLegState(ctx, tx, l.ID, "confirmed"); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.GetBookingByID(ctx, b.ID)
}

// IssueTickets issues one bus_ticket_v2 per passenger (per leg), idempotently:
// passengers already carrying ticket_id are skipped and returned, so a repeat
// call (webhook retry, crash recovery after confirmed-but-unticketed) yields
// exactly the same set — never a duplicate. Requires state='confirmed'.
func (s *Service) IssueTickets(ctx context.Context, bookingID string) ([]Ticket, error) {
	tx, err := s.repo.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	b, err := s.repo.BookingByIDForUpdate(ctx, tx, bookingID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "booking not found")
	}
	if err != nil {
		return nil, err
	}
	if b.State != string(BookingConfirmed) {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "tickets can only issue for a confirmed booking")
	}
	if _, err := s.issueTicketsTx(ctx, tx, bookingID, b.PurchaserID); err != nil {
		return nil, err
	}
	tickets, err := s.repo.TicketsForBooking(ctx, tx, bookingID)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return tickets, nil
}

// issueTicketsTx mints tickets for every passenger lacking one. The caller
// owns the transaction; the booking row must already be locked. actorID is
// the booking purchaser — transport_audit_log.admin_id is NOT NULL uuid.
func (s *Service) issueTicketsTx(ctx context.Context, tx pgx.Tx, bookingID, actorID string) ([]Ticket, error) {
	pax, err := s.repo.PassengersForBooking(ctx, tx, bookingID)
	if err != nil {
		return nil, err
	}
	legs, err := s.repo.LegsForBooking(ctx, tx, bookingID)
	if err != nil {
		return nil, err
	}
	legByID := map[string]BookingLeg{}
	for _, l := range legs {
		legByID[l.ID] = l
	}
	var issued []Ticket
	for _, p := range pax {
		if p.TicketID != nil && *p.TicketID != "" {
			continue // already issued — the idempotency guard
		}
		t := &Ticket{
			Token:        newTicketToken(),
			PassengerID:  p.ID,
			BookingLegID: p.BookingLegID,
			Status:       "issued",
		}
		if err := s.repo.InsertTicket(ctx, tx, t); err != nil {
			return nil, fmt.Errorf("businventory: insert ticket: %w", err)
		}
		if err := s.repo.AttachTicketToPassenger(ctx, tx, p.ID, t.ID); err != nil {
			return nil, fmt.Errorf("businventory: attach ticket: %w", err)
		}
		if l, ok := legByID[p.BookingLegID]; ok {
			_ = s.repo.LinkOccupancyTicket(ctx, tx, bookingID, l.DepartureID, p.SeatKey, l.FromSeq, l.ToSeq, t.ID)
		}
		issued = append(issued, *t)
	}
	if len(issued) > 0 {
		if err := s.repo.WriteAudit(ctx, tx, actorID, "bus2.tickets_issued", "bus_booking", bookingID,
			nil, map[string]any{"tickets": len(issued)}, ""); err != nil {
			return nil, fmt.Errorf("businventory: audit tickets: %w", err)
		}
	}
	return issued, nil
}

// ─── Availability / quote ───────────────────────────────────────────────────

// SeatAvailability is one layout seat's availability for a segment.
type SeatAvailability struct {
	LayoutSeat
	Available bool `json:"available"`
}

// Availability is the per-segment seat map of a departure.
type Availability struct {
	DepartureID string             `json:"departureId"`
	FromSeq     int                `json:"fromSeq"`
	ToSeq       int                `json:"toSeq"`
	Seats       []SeatAvailability `json:"seats"`
	Available   int                `json:"available"`
}

// AvailableSeats returns the pinned layout's seats minus those with an
// overlapping occupied segment or an overlapping LIVE hold (held and
// unexpired). Read-only — no lock needed; the caller uses this for display
// and HoldSeats is the authoritative gate.
func (s *Service) AvailableSeats(ctx context.Context, departureID string, fromSeq, toSeq int) (*Availability, error) {
	dep, err := s.repo.GetDeparture(ctx, departureID)
	if err != nil {
		return nil, mapDepartureErr(err, departureID)
	}
	if dep.LayoutID == nil {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "departure has no pinned seat layout")
	}
	layoutSeats, err := s.repo.LayoutSeats(ctx, s.repo.Pool(), *dep.LayoutID)
	if err != nil {
		return nil, err
	}
	blocked, err := s.blockedSeats(ctx, s.repo.Pool(), departureID, fromSeq, toSeq, s.now())
	if err != nil {
		return nil, err
	}
	res := &Availability{DepartureID: departureID, FromSeq: fromSeq, ToSeq: toSeq}
	for _, ls := range layoutSeats {
		avail := ls.Bookable && ls.SeatType != "driver" && ls.SeatType != "blocked" && !blocked[ls.SeatKey]
		res.Seats = append(res.Seats, SeatAvailability{LayoutSeat: ls, Available: avail})
		if avail {
			res.Available++
		}
	}
	return res, nil
}

// QuoteResult is availability plus the fare the departure's fare_snapshot
// quotes for the OD segment (nil when the snapshot does not carry one — the
// snapshot shape is provider-authored, see bus_departure.fare_snapshot).
type QuoteResult struct {
	DepartureID  string `json:"departureId"`
	FromSeq      int    `json:"fromSeq"`
	ToSeq        int    `json:"toSeq"`
	Seats        int    `json:"seats"`
	Available    int    `json:"available"`
	FareKoboEach *int64 `json:"fareKoboEach,omitempty"`
	TotalKobo    *int64 `json:"totalKobo,omitempty"`
	Currency     string `json:"currency"`
}

// Quote prices a segment for seats passengers. The fare comes from the
// departure's pinned fare_snapshot (OD matrix as sold), never recomputed.
func (s *Service) Quote(ctx context.Context, departureID string, fromSeq, toSeq, seats int) (*QuoteResult, error) {
	if seats < 1 {
		seats = 1
	}
	dep, err := s.repo.GetDeparture(ctx, departureID)
	if err != nil {
		return nil, mapDepartureErr(err, departureID)
	}
	avail, err := s.AvailableSeats(ctx, departureID, fromSeq, toSeq)
	if err != nil {
		return nil, err
	}
	res := &QuoteResult{
		DepartureID: departureID, FromSeq: fromSeq, ToSeq: toSeq,
		Seats: seats, Available: avail.Available, Currency: "NGN",
	}
	if fare, ok := fareFromSnapshot(dep.FareSnapshot, fromSeq, toSeq); ok {
		res.FareKoboEach = &fare
		total := fare * int64(seats)
		res.TotalKobo = &total
	}
	return res, nil
}

// fareFromSnapshot reads an OD-pair fare from a departure's fare_snapshot.
// Accepted shapes: {"matrix":[{"from_seq":1,"to_seq":3,"amount_kobo":N},...]}
// or a top-level array of the same entries. Unknown shapes yield false — the
// quote still returns availability.
func fareFromSnapshot(raw []byte, fromSeq, toSeq int) (int64, bool) {
	type cell struct {
		FromSeq    int   `json:"from_seq"`
		ToSeq      int   `json:"to_seq"`
		AmountKobo int64 `json:"amount_kobo"`
		FareKobo   int64 `json:"fare_kobo"`
	}
	var cells []cell
	var obj struct {
		Matrix []cell `json:"matrix"`
		Fares  []cell `json:"fares"`
	}
	if json.Unmarshal(raw, &obj) == nil {
		cells = append(cells, obj.Matrix...)
		cells = append(cells, obj.Fares...)
	}
	var arr []cell
	if json.Unmarshal(raw, &arr) == nil {
		cells = append(cells, arr...)
	}
	for _, c := range cells {
		if c.FromSeq == fromSeq && c.ToSeq == toSeq {
			if c.AmountKobo > 0 {
				return c.AmountKobo, true
			}
			if c.FareKobo > 0 {
				return c.FareKobo, true
			}
		}
	}
	return 0, false
}

// ─── Booking reads / cancel ─────────────────────────────────────────────────

func (s *Service) loadBookingDetail(ctx context.Context, q Querier, bookingID string) (*BookingDetail, error) {
	b, err := s.repo.BookingByID(ctx, q, bookingID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "booking not found")
	}
	if err != nil {
		return nil, err
	}
	legs, err := s.repo.LegsForBooking(ctx, q, bookingID)
	if err != nil {
		return nil, err
	}
	legIDs := make([]string, len(legs))
	for i, l := range legs {
		legIDs[i] = l.ID
	}
	pax, err := s.repo.PassengersForLegs(ctx, q, legIDs)
	if err != nil {
		return nil, err
	}
	d := &BookingDetail{Booking: b}
	for _, l := range legs {
		ld := LegDetail{Leg: l}
		for _, p := range pax {
			if p.BookingLegID == l.ID {
				ld.Passengers = append(ld.Passengers, p)
			}
		}
		d.Legs = append(d.Legs, ld)
	}
	return d, nil
}

// GetBookingByID loads a booking detail (internal/system use — no authz).
func (s *Service) GetBookingByID(ctx context.Context, bookingID string) (*BookingDetail, error) {
	d, err := s.loadBookingDetail(ctx, s.repo.Pool(), bookingID)
	if err != nil {
		return nil, err
	}
	d.Tickets, _ = s.repo.TicketsForBooking(ctx, s.repo.Pool(), bookingID)
	return d, nil
}

// GetBooking loads a booking by public ref — purchaser only (object-level
// authz; the non-guessable ref alone is NOT an auth token).
func (s *Service) GetBooking(ctx context.Context, ref, userID string) (*BookingDetail, error) {
	b, err := s.repo.BookingByRef(ctx, s.repo.Pool(), ref)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "booking not found")
	}
	if err != nil {
		return nil, err
	}
	if b.PurchaserID != userID {
		return nil, codedErr(http.StatusForbidden, CodeForbidden, "not your booking")
	}
	return s.GetBookingByID(ctx, b.ID)
}

// RequestCancel is the purchaser's cancel request. Unpaid bookings
// (inventory_held/payment_pending) cancel immediately and release their holds;
// a confirmed booking moves to cancel_requested for the refund-policy flow —
// occupancy stays put until an operator adjudicates.
func (s *Service) RequestCancel(ctx context.Context, ref, userID, reason string) (*BookingDetail, error) {
	tx, err := s.repo.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	b, err := s.repo.BookingByRefForUpdate(ctx, tx, ref)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "booking not found")
	}
	if err != nil {
		return nil, err
	}
	if b.PurchaserID != userID {
		return nil, codedErr(http.StatusForbidden, CodeForbidden, "not your booking")
	}
	cur := BookingState(b.State)
	var target BookingState
	switch cur {
	case BookingInventoryHeld, BookingPaymentPending, BookingPaymentFailed, BookingQuoted:
		target = BookingCancelled
	case BookingConfirmed, BookingChangeRequested:
		target = BookingCancelRequested
	default:
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "cannot request cancel from state "+b.State)
	}
	if !canTransition(cur, target) {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "illegal transition "+b.State+" → "+string(target))
	}
	ok, err := s.repo.TransitionBooking(ctx, tx, b.ID, string(target), b.State)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, codedErr(http.StatusConflict, CodeInvalidState, "booking state changed concurrently")
	}
	if target == BookingCancelled {
		if _, err := s.repo.ReleaseHoldsForBooking(ctx, tx, b.ID); err != nil {
			return nil, fmt.Errorf("businventory: release holds: %w", err)
		}
	}
	action := "bus2.cancel_requested"
	if target == BookingCancelled {
		action = "bus2.cancelled"
	}
	if err := s.repo.WriteAudit(ctx, tx, userID, action, "bus_booking", b.ID,
		map[string]any{"state": b.State}, map[string]any{"state": string(target)}, reason); err != nil {
		return nil, fmt.Errorf("businventory: audit cancel: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.GetBookingByID(ctx, b.ID)
}

// GetTicket resolves a ticket by its non-guessable token — purchaser only.
func (s *Service) GetTicket(ctx context.Context, token, userID string) (*Ticket, error) {
	t, purchaserID, err := s.repo.TicketByToken(ctx, s.repo.Pool(), token)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "ticket not found")
	}
	if err != nil {
		return nil, err
	}
	if purchaserID != userID {
		return nil, codedErr(http.StatusForbidden, CodeForbidden, "not your ticket")
	}
	return t, nil
}

// ─── Shared guards ──────────────────────────────────────────────────────────

// requireBookableSeats verifies every seat key exists in the departure's
// pinned layout and is bookable.
func (s *Service) requireBookableSeats(ctx context.Context, tx pgx.Tx, dep *Departure, seatKeys []string) error {
	if dep.LayoutID == nil {
		return codedErr(http.StatusConflict, CodeInvalidState, "departure has no pinned seat layout")
	}
	seats, err := s.repo.LayoutSeats(ctx, tx, *dep.LayoutID)
	if err != nil {
		return err
	}
	bookable := map[string]bool{}
	for _, ls := range seats {
		bookable[ls.SeatKey] = ls.Bookable && ls.SeatType != "driver" && ls.SeatType != "blocked"
	}
	for _, k := range seatKeys {
		ok, exists := bookable[k]
		if !exists {
			return codedErr(http.StatusUnprocessableEntity, CodeInvalidSeat, "unknown seat "+k)
		}
		if !ok {
			return codedErr(http.StatusUnprocessableEntity, CodeInvalidSeat, "seat "+k+" is not bookable")
		}
	}
	return nil
}

// checkSegmentsFree rejects when any requested seat has an overlapping
// occupied segment or an overlapping live hold. Must run under the departure
// row lock (see package doc).
func (s *Service) checkSegmentsFree(ctx context.Context, tx pgx.Tx, departureID string, seatKeys []string, fromSeq, toSeq int, now time.Time) error {
	return errSeatConflict(ctx, tx, s.repo, departureID, seatKeys, fromSeq, toSeq, now, "")
}

// errSeatConflict is the shared overlap evaluator. excludeHoldID skips one
// hold row (the one being confirmed). Returns nil when the segment is free.
func errSeatConflict(ctx context.Context, tx pgx.Tx, repo *Repository, departureID string, seatKeys []string, fromSeq, toSeq int, now time.Time, excludeHoldID string) error {
	occ, err := repo.OccupancyForSeats(ctx, tx, departureID, seatKeys)
	if err != nil {
		return err
	}
	for _, o := range occ {
		if o.State == "occupied" && segmentsOverlap(o.FromSeq, o.ToSeq, fromSeq, toSeq) {
			return &CodedError{Status: http.StatusConflict, Code: CodeSeatTaken,
				Message: "seat " + o.SeatKey + " is already occupied on this segment",
				Details: map[string]any{"seat_key": o.SeatKey}}
		}
	}
	holds, err := repo.HoldsForSeats(ctx, tx, departureID, seatKeys)
	if err != nil {
		return err
	}
	for _, h := range holds {
		if h.ID == excludeHoldID {
			continue
		}
		if h.State == "held" && h.ExpiresAt.After(now) && segmentsOverlap(h.FromSeq, h.ToSeq, fromSeq, toSeq) {
			return &CodedError{Status: http.StatusConflict, Code: CodeSeatHeld,
				Message: "seat " + h.SeatKey + " is held on this segment",
				Details: map[string]any{"seat_key": h.SeatKey, "hold_expires_at": h.ExpiresAt}}
		}
	}
	return nil
}

// blockedSeats returns the set of seat_keys unavailable for the segment.
func (s *Service) blockedSeats(ctx context.Context, q Querier, departureID string, fromSeq, toSeq int, now time.Time) (map[string]bool, error) {
	blocked := map[string]bool{}
	// Occupied segments.
	rows, err := q.Query(ctx, `
		SELECT seat_key, from_seq, to_seq FROM bus_seat_occupancy
		WHERE departure_id=$1 AND state='occupied'`, departureID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var keys []string
	for rows.Next() {
		var k string
		var f, t int
		if err := rows.Scan(&k, &f, &t); err != nil {
			return nil, err
		}
		if segmentsOverlap(f, t, fromSeq, toSeq) {
			blocked[k] = true
		}
		keys = append(keys, k)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	// Live holds.
	hrows, err := q.Query(ctx, `
		SELECT seat_key, from_seq, to_seq FROM bus_seat_hold
		WHERE departure_id=$1 AND state='held' AND expires_at > $2`, departureID, now)
	if err != nil {
		return nil, err
	}
	defer hrows.Close()
	for hrows.Next() {
		var k string
		var f, t int
		if err := hrows.Scan(&k, &f, &t); err != nil {
			return nil, err
		}
		if segmentsOverlap(f, t, fromSeq, toSeq) {
			blocked[k] = true
		}
	}
	return blocked, hrows.Err()
}

// checkDepartureBookable verifies the departure accepts seat mutations.
func checkDepartureBookable(dep *Departure, now time.Time) error {
	if !bookableStatuses[dep.Status] {
		return codedErr(http.StatusConflict, CodeInvalidState, "departure is not open for booking (status "+dep.Status+")")
	}
	cutoff := dep.DepartAt.Add(-time.Duration(dep.BookingCutoffMinutes) * time.Minute)
	if !now.Before(cutoff) {
		return codedErr(http.StatusConflict, CodeBookingClosed, "booking cutoff has passed for this departure")
	}
	return nil
}

func mapDepartureErr(err error, id string) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return codedErr(http.StatusNotFound, CodeNotFound, "departure not found")
	}
	return err
}

func dedupeSorted(in []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, s := range in {
		s = strings.TrimSpace(s)
		if s == "" || seen[s] {
			continue
		}
		seen[s] = true
		out = append(out, s)
	}
	sort.Strings(out)
	return out
}

func nullIfEmpty(s string) *string {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return &s
}

// newBookingRef mints the non-guessable public reference (16 base32 chars of
// crypto-random after the BK- prefix).
func newBookingRef() string {
	var b [10]byte // 10 bytes → 16 base32 chars, no padding
	if _, err := rand.Read(b[:]); err != nil {
		// crypto/rand failure is fatal-quality; fall back to uuid entropy.
		return "BK-" + strings.ToUpper(strings.ReplaceAll(uuid.NewString(), "-", ""))[:16]
	}
	return "BK-" + base32.HexEncoding.WithPadding(base32.NoPadding).EncodeToString(b[:])
}

// newTicketToken mints a 32-char lowercase hex ticket token (matches the
// column default's shape: encode(gen_random_bytes(16),'hex')).
func newTicketToken() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return strings.ReplaceAll(uuid.NewString(), "-", "")
	}
	return hex.EncodeToString(b[:])
}
