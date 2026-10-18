// Package businventory is the bus-transport v2 seat-conflict engine and booking
// core (schema: supabase/migrations/20271050000000_bus_transport_v2.sql).
//
// Concurrency contract: every seat mutation runs in a transaction that first
// takes a row lock on the parent bus_departure row (SELECT ... FOR UPDATE).
// That serializes all hold/confirm operations for one departure, so a plain
// check-then-insert inside the same transaction is safe against a concurrent
// "last seat" claim — there is no interval-exclusion constraint Postgres can
// express for segment overlap (see the migration's own note on
// bus_seat_occupancy). Segments are HALF-OPEN [from_seq, to_seq): overlap iff
// a.from_seq < b.to_seq AND a.to_seq > b.from_seq, so an alighting stop can be
// resold from the same stop onward.
package businventory

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/go-common/dbutil"
	"spotlight/backend/go-common/jsonx"
)

// Querier is satisfied by *pgxpool.Pool and pgx.Tx, so repo helpers run either
// standalone or inside a caller's transaction (all-or-nothing mutations).
type Querier interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// Repository is the data-access half of the engine. It owns every SQL
// statement that touches the bus_transport_v2 tables; service.go owns policy.
type Repository struct {
	pool *pgxpool.Pool
}

// NewRepository builds a Repository over the shared pgx pool.
func NewRepository(pool *pgxpool.Pool) *Repository { return &Repository{pool: pool} }

// Begin starts a transaction on the pool.
func (r *Repository) Begin(ctx context.Context) (pgx.Tx, error) { return r.pool.Begin(ctx) }

// Pool exposes the underlying pool for read paths that need no transaction.
func (r *Repository) Pool() *pgxpool.Pool { return r.pool }

// ─── Row types ──────────────────────────────────────────────────────────────

// Departure is a dated bus departure with its pinned layout + fare snapshot.
type Departure struct {
	ID                   string
	ProviderID           string
	RouteID              string
	RouteVersion         int
	Status               string
	LayoutID             *string
	LayoutVersion        *int
	Capacity             int
	DepartAt             time.Time
	BookingCutoffMinutes int
	CancelCutoffMinutes  int
	FareSnapshot         []byte
}

// LayoutSeat is one sellable position in a pinned seat-layout version.
type LayoutSeat struct {
	SeatKey  string
	Label    string
	Deck     int
	RowNo    int
	ColNo    int
	SeatType string
	Bookable bool
}

// SeatHold is a TTL'd claim on a seat segment (bus_seat_hold).
type SeatHold struct {
	ID             string
	DepartureID    string
	SeatKey        string
	FromSeq        int
	ToSeq          int
	OwnerUserID    string
	IdempotencyKey string
	ExpiresAt      time.Time
	State          string
	CreatedAt      time.Time
}

// Occupancy is a sold seat segment (bus_seat_occupancy).
type Occupancy struct {
	ID          string
	DepartureID string
	SeatKey     string
	FromSeq     int
	ToSeq       int
	BookingID   string
	TicketID    *string
	State       string
	CreatedAt   time.Time
}

// Booking is a bus_booking group row.
type Booking struct {
	ID             string
	Ref            string
	PurchaserID    string
	ProviderID     string
	IdempotencyKey string
	State          string
	TotalKobo      int64
	Currency       string
	FareSnapshot   []byte
	PolicyVersion  *string
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

// BookingLeg is one leg of a booking (outbound or return).
type BookingLeg struct {
	ID          string
	BookingID   string
	DepartureID string
	FromSeq     int
	ToSeq       int
	FareKobo    int64
	State       string
}

// BookingPassenger is a third-party traveller attached to a leg.
type BookingPassenger struct {
	ID           string
	BookingLegID string
	FullName     string
	Phone        *string
	Email        *string
	SeatKey      string
	DeliverTo    string
	TicketID     *string
}

// Ticket is an issued bus_ticket_v2 row.
type Ticket struct {
	ID           string
	Token        string
	PassengerID  string
	BookingLegID string
	Status       string
	IssuedAt     time.Time
}

// ─── Departure / layout reads ───────────────────────────────────────────────

const departureCols = `id, provider_id, route_id, route_version, status, layout_id,
	layout_version, capacity, depart_at, booking_cutoff_minutes,
	cancel_cutoff_minutes, fare_snapshot`

func scanDeparture(row pgx.Row) (*Departure, error) {
	var d Departure
	err := row.Scan(&d.ID, &d.ProviderID, &d.RouteID, &d.RouteVersion, &d.Status,
		&d.LayoutID, &d.LayoutVersion, &d.Capacity, &d.DepartAt,
		&d.BookingCutoffMinutes, &d.CancelCutoffMinutes, &d.FareSnapshot)
	if err != nil {
		return nil, err
	}
	return &d, nil
}

// GetDeparture loads a departure (no lock). ErrNoRows → nil, nil? No: the
// caller maps pgx.ErrNoRows itself; this returns the raw error.
func (r *Repository) GetDeparture(ctx context.Context, id string) (*Departure, error) {
	return scanDeparture(r.pool.QueryRow(ctx,
		`SELECT `+departureCols+` FROM bus_departure WHERE id=$1`, id))
}

// LockDeparture takes the serialization point for seat mutations: SELECT ...
// FOR UPDATE on the departure row. Every seat-mutating transaction MUST call
// this before evaluating overlap — see the package doc comment.
func (r *Repository) LockDeparture(ctx context.Context, tx pgx.Tx, id string) (*Departure, error) {
	return scanDeparture(tx.QueryRow(ctx,
		`SELECT `+departureCols+` FROM bus_departure WHERE id=$1 FOR UPDATE`, id))
}

// LayoutSeats returns the seat inventory of the departure's pinned layout
// version, seat_key order for determinism.
func (r *Repository) LayoutSeats(ctx context.Context, q Querier, layoutID string) ([]LayoutSeat, error) {
	rows, err := q.Query(ctx, `
		SELECT seat_key, label, deck, row_no, col_no, seat_type, bookable
		FROM bus_seat_layout_seat WHERE layout_id=$1 ORDER BY deck, row_no, col_no`, layoutID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []LayoutSeat
	for rows.Next() {
		var s LayoutSeat
		if err := rows.Scan(&s.SeatKey, &s.Label, &s.Deck, &s.RowNo, &s.ColNo, &s.SeatType, &s.Bookable); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// ─── Hold / occupancy reads ─────────────────────────────────────────────────

func scanHold(row pgx.Row) (*SeatHold, error) {
	var h SeatHold
	err := row.Scan(&h.ID, &h.DepartureID, &h.SeatKey, &h.FromSeq, &h.ToSeq,
		&h.OwnerUserID, &h.IdempotencyKey, &h.ExpiresAt, &h.State, &h.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &h, nil
}

const holdCols = `id, departure_id, seat_key, from_seq, to_seq, owner_user_id,
	idempotency_key, expires_at, state, created_at`

// HoldByID loads one hold row.
func (r *Repository) HoldByID(ctx context.Context, q Querier, id string) (*SeatHold, error) {
	return scanHold(q.QueryRow(ctx, `SELECT `+holdCols+` FROM bus_seat_hold WHERE id=$1`, id))
}

// HoldForUpdate locks one hold row inside a transaction.
func (r *Repository) HoldForUpdate(ctx context.Context, tx pgx.Tx, id string) (*SeatHold, error) {
	return scanHold(tx.QueryRow(ctx, `SELECT `+holdCols+` FROM bus_seat_hold WHERE id=$1 FOR UPDATE`, id))
}

// HoldsByKey returns every hold row written under an idempotency key for a
// departure — the replay probe for HoldSeats.
func (r *Repository) HoldsByKey(ctx context.Context, q Querier, departureID, key string) ([]SeatHold, error) {
	rows, err := q.Query(ctx, `SELECT `+holdCols+` FROM bus_seat_hold
		WHERE departure_id=$1 AND idempotency_key=$2 ORDER BY created_at`, departureID, key)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return collectHolds(rows)
}

// HoldsForBooking returns every hold row created by CreateBooking for a
// booking (idempotency_key prefix "bk:<bookingID>:").
func (r *Repository) HoldsForBooking(ctx context.Context, q Querier, bookingID string) ([]SeatHold, error) {
	rows, err := q.Query(ctx, `SELECT `+holdCols+` FROM bus_seat_hold
		WHERE idempotency_key LIKE 'bk:'||$1||':%' ORDER BY created_at`, bookingID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return collectHolds(rows)
}

// HoldsForBookingForUpdate is HoldsForBooking with row locks — the
// claim-and-consume path inside ConfirmPayment.
func (r *Repository) HoldsForBookingForUpdate(ctx context.Context, tx pgx.Tx, bookingID string) ([]SeatHold, error) {
	rows, err := tx.Query(ctx, `SELECT `+holdCols+` FROM bus_seat_hold
		WHERE idempotency_key LIKE 'bk:'||$1||':%' ORDER BY created_at FOR UPDATE`, bookingID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return collectHolds(rows)
}

// HoldsForSeats returns every hold row for the given seats on a departure,
// any state — callers filter state/liveness themselves.
func (r *Repository) HoldsForSeats(ctx context.Context, q Querier, departureID string, seatKeys []string) ([]SeatHold, error) {
	rows, err := q.Query(ctx, `SELECT `+holdCols+` FROM bus_seat_hold
		WHERE departure_id=$1 AND seat_key = ANY($2)`, departureID, seatKeys)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return collectHolds(rows)
}

func collectHolds(rows pgx.Rows) ([]SeatHold, error) {
	var out []SeatHold
	for rows.Next() {
		h, err := scanHold(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *h)
	}
	return out, rows.Err()
}

func scanOccupancy(row pgx.Row) (*Occupancy, error) {
	var o Occupancy
	err := row.Scan(&o.ID, &o.DepartureID, &o.SeatKey, &o.FromSeq, &o.ToSeq,
		&o.BookingID, &o.TicketID, &o.State, &o.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &o, nil
}

const occupancyCols = `id, departure_id, seat_key, from_seq, to_seq, booking_id,
	ticket_id, state, created_at`

// OccupancyForSeats returns every occupancy row (any state) for the seats.
func (r *Repository) OccupancyForSeats(ctx context.Context, q Querier, departureID string, seatKeys []string) ([]Occupancy, error) {
	rows, err := q.Query(ctx, `SELECT `+occupancyCols+` FROM bus_seat_occupancy
		WHERE departure_id=$1 AND seat_key = ANY($2)`, departureID, seatKeys)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Occupancy
	for rows.Next() {
		o, err := scanOccupancy(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *o)
	}
	return out, rows.Err()
}

// ─── Hold / occupancy writes ────────────────────────────────────────────────

// InsertHold writes one hold row.
func (r *Repository) InsertHold(ctx context.Context, q Querier, h *SeatHold) error {
	return q.QueryRow(ctx, `
		INSERT INTO bus_seat_hold
			(departure_id, seat_key, from_seq, to_seq, owner_user_id,
			 idempotency_key, expires_at, state)
		VALUES ($1,$2,$3,$4,$5,$6,$7,'held')
		RETURNING id, created_at`,
		h.DepartureID, h.SeatKey, h.FromSeq, h.ToSeq, h.OwnerUserID,
		h.IdempotencyKey, h.ExpiresAt).
		Scan(&h.ID, &h.CreatedAt)
}

// SetHoldState moves a hold to a terminal state with a compare-and-swap on
// state='held' — the only source state an actor may legally leave. Returns
// false when the row was already moved (consumed/released/expired).
func (r *Repository) SetHoldState(ctx context.Context, q Querier, id, to string) (bool, error) {
	tag, err := q.Exec(ctx,
		`UPDATE bus_seat_hold SET state=$2 WHERE id=$1 AND state='held'`, id, to)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}

// ClaimHold atomically marks a hold consumed ONLY while it is still live
// (state='held' and unexpired at commit-time clock). This is the deterministic
// resolution of payment-success-vs-hold-expiry: whichever transaction's
// predicate first sees the row wins; the other sees the final state.
func (r *Repository) ClaimHold(ctx context.Context, q Querier, id string) (bool, error) {
	tag, err := q.Exec(ctx, `
		UPDATE bus_seat_hold SET state='consumed'
		WHERE id=$1 AND state='held' AND expires_at > now()`, id)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}

// ExpireDueHolds flips every live hold past its TTL to 'expired'. Idempotent:
// a re-run matches zero rows already moved, and a concurrent ClaimHold either
// commits first (predicate then sees 'consumed', no match) or blocks on the
// row lock and re-evaluates (same result).
func (r *Repository) ExpireDueHolds(ctx context.Context, now time.Time) (int64, error) {
	tag, err := r.pool.Exec(ctx, `
		UPDATE bus_seat_hold SET state='expired'
		WHERE state='held' AND expires_at < $1`, now)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// ReleaseHoldsForBooking releases every still-live hold owned by a booking
// (cancel before payment). Returns rows affected.
func (r *Repository) ReleaseHoldsForBooking(ctx context.Context, q Querier, bookingID string) (int64, error) {
	tag, err := q.Exec(ctx, `
		UPDATE bus_seat_hold SET state='released'
		WHERE idempotency_key LIKE 'bk:'||$1||':%' AND state='held'`, bookingID)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// InsertOccupancy writes one occupied segment row.
func (r *Repository) InsertOccupancy(ctx context.Context, q Querier, o *Occupancy) error {
	return q.QueryRow(ctx, `
		INSERT INTO bus_seat_occupancy
			(departure_id, seat_key, from_seq, to_seq, booking_id, ticket_id, state)
		VALUES ($1,$2,$3,$4,$5,NULL,'occupied')
		RETURNING id, state, created_at`,
		o.DepartureID, o.SeatKey, o.FromSeq, o.ToSeq, o.BookingID).
		Scan(&o.ID, &o.State, &o.CreatedAt)
}

// OccupancyForBooking returns the occupied rows of a booking.
func (r *Repository) OccupancyForBooking(ctx context.Context, q Querier, bookingID string) ([]Occupancy, error) {
	rows, err := q.Query(ctx, `SELECT `+occupancyCols+` FROM bus_seat_occupancy
		WHERE booking_id=$1 ORDER BY created_at`, bookingID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Occupancy
	for rows.Next() {
		o, err := scanOccupancy(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *o)
	}
	return out, rows.Err()
}

// LinkOccupancyTicket stamps a ticket id onto the occupancy row of the same
// booking/seat/segment (best-effort manifest link).
func (r *Repository) LinkOccupancyTicket(ctx context.Context, q Querier, bookingID, departureID, seatKey string, fromSeq, toSeq int, ticketID string) error {
	_, err := q.Exec(ctx, `
		UPDATE bus_seat_occupancy SET ticket_id=$6
		WHERE booking_id=$1 AND departure_id=$2 AND seat_key=$3
		  AND from_seq=$4 AND to_seq=$5 AND ticket_id IS NULL`,
		bookingID, departureID, seatKey, fromSeq, toSeq, ticketID)
	return err
}

// ─── Booking reads ──────────────────────────────────────────────────────────

const bookingCols = `id, ref, purchaser_id, provider_id, idempotency_key, state,
	total_kobo, currency, fare_snapshot, policy_version, created_at, updated_at`

func scanBooking(row pgx.Row) (*Booking, error) {
	var b Booking
	err := row.Scan(&b.ID, &b.Ref, &b.PurchaserID, &b.ProviderID, &b.IdempotencyKey,
		&b.State, &b.TotalKobo, &b.Currency, &b.FareSnapshot, &b.PolicyVersion,
		&b.CreatedAt, &b.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &b, nil
}

// BookingByKey finds the booking for an idempotency key (nil, nil when absent).
func (r *Repository) BookingByKey(ctx context.Context, q Querier, key string) (*Booking, error) {
	b, err := scanBooking(q.QueryRow(ctx,
		`SELECT `+bookingCols+` FROM bus_booking WHERE idempotency_key=$1`, key))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return b, err
}

// BookingByID loads a booking by primary key.
func (r *Repository) BookingByID(ctx context.Context, q Querier, id string) (*Booking, error) {
	return scanBooking(q.QueryRow(ctx, `SELECT `+bookingCols+` FROM bus_booking WHERE id=$1`, id))
}

// BookingByRef loads a booking by its public reference.
func (r *Repository) BookingByRef(ctx context.Context, q Querier, ref string) (*Booking, error) {
	return scanBooking(q.QueryRow(ctx, `SELECT `+bookingCols+` FROM bus_booking WHERE ref=$1`, ref))
}

// BookingByRefForUpdate locks a booking row (by ref) inside a transaction.
func (r *Repository) BookingByRefForUpdate(ctx context.Context, tx pgx.Tx, ref string) (*Booking, error) {
	return scanBooking(tx.QueryRow(ctx, `SELECT `+bookingCols+` FROM bus_booking WHERE ref=$1 FOR UPDATE`, ref))
}

// BookingByIDForUpdate locks a booking row (by id) inside a transaction.
func (r *Repository) BookingByIDForUpdate(ctx context.Context, tx pgx.Tx, id string) (*Booking, error) {
	return scanBooking(tx.QueryRow(ctx, `SELECT `+bookingCols+` FROM bus_booking WHERE id=$1 FOR UPDATE`, id))
}

// ─── Booking writes ─────────────────────────────────────────────────────────

// InsertBooking writes the group row.
func (r *Repository) InsertBooking(ctx context.Context, q Querier, b *Booking) error {
	return q.QueryRow(ctx, `
		INSERT INTO bus_booking
			(id, ref, purchaser_id, provider_id, idempotency_key, state,
			 total_kobo, currency, fare_snapshot)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		RETURNING created_at, updated_at`,
		b.ID, b.Ref, b.PurchaserID, b.ProviderID, b.IdempotencyKey, b.State,
		b.TotalKobo, b.Currency, b.FareSnapshot).
		Scan(&b.CreatedAt, &b.UpdatedAt)
}

// InsertBookingLeg writes one leg row.
func (r *Repository) InsertBookingLeg(ctx context.Context, q Querier, l *BookingLeg) error {
	return q.QueryRow(ctx, `
		INSERT INTO bus_booking_leg (booking_id, departure_id, from_seq, to_seq, fare_kobo, state)
		VALUES ($1,$2,$3,$4,$5,'payment_pending')
		RETURNING id`, l.BookingID, l.DepartureID, l.FromSeq, l.ToSeq, l.FareKobo).
		Scan(&l.ID)
}

// InsertPassenger writes one passenger row.
func (r *Repository) InsertPassenger(ctx context.Context, q Querier, p *BookingPassenger) error {
	return q.QueryRow(ctx, `
		INSERT INTO bus_booking_passenger (booking_leg_id, full_name, phone, email, seat_key, deliver_to)
		VALUES ($1,$2,$3,$4,$5,$6)
		RETURNING id`, p.BookingLegID, p.FullName, p.Phone, p.Email, p.SeatKey, p.DeliverTo).
		Scan(&p.ID)
}

// TransitionBooking is the compare-and-swap state move: it applies only when
// the current state is one of allowedFrom, so a raced transition loses
// deterministically instead of silently winning. Returns false when the row
// was not in an allowed source state.
func (r *Repository) TransitionBooking(ctx context.Context, q Querier, id string, to string, allowedFrom ...string) (bool, error) {
	tag, err := q.Exec(ctx, `
		UPDATE bus_booking SET state=$2, updated_at=now()
		WHERE id=$1 AND state = ANY($3::text[])`, id, to, allowedFrom)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}

// SetPaymentRef merges the verified payment reference into the fare_snapshot
// JSONB (additive — the snapshot itself is never rewritten in place).
func (r *Repository) SetPaymentRef(ctx context.Context, q Querier, bookingID, paymentRef string) error {
	_, err := q.Exec(ctx, `
		UPDATE bus_booking
		SET fare_snapshot = fare_snapshot || jsonb_build_object('payment_ref', $2::text),
		    updated_at = now()
		WHERE id=$1`, bookingID, paymentRef)
	return err
}

// PaymentRef reads payment_ref back out of the snapshot ("" when unset).
func (r *Repository) PaymentRef(ctx context.Context, q Querier, bookingID string) (string, error) {
	var ref *string
	err := q.QueryRow(ctx,
		`SELECT fare_snapshot->>'payment_ref' FROM bus_booking WHERE id=$1`, bookingID).Scan(&ref)
	if err != nil {
		return "", err
	}
	if ref == nil {
		return "", nil
	}
	return *ref, nil
}

// ─── Booking composition reads ──────────────────────────────────────────────

// LegsForBooking returns a booking's legs in creation order.
func (r *Repository) LegsForBooking(ctx context.Context, q Querier, bookingID string) ([]BookingLeg, error) {
	rows, err := q.Query(ctx, `
		SELECT id, booking_id, departure_id, from_seq, to_seq, fare_kobo, state
		FROM bus_booking_leg WHERE booking_id=$1 ORDER BY id`, bookingID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []BookingLeg
	for rows.Next() {
		var l BookingLeg
		if err := rows.Scan(&l.ID, &l.BookingID, &l.DepartureID, &l.FromSeq, &l.ToSeq, &l.FareKobo, &l.State); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

// PassengersForLegs returns passengers for a set of leg ids.
func (r *Repository) PassengersForLegs(ctx context.Context, q Querier, legIDs []string) ([]BookingPassenger, error) {
	rows, err := q.Query(ctx, `
		SELECT id, booking_leg_id, full_name, phone, email, seat_key, deliver_to, ticket_id
		FROM bus_booking_passenger WHERE booking_leg_id = ANY($1) ORDER BY id`, legIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []BookingPassenger
	for rows.Next() {
		var p BookingPassenger
		if err := rows.Scan(&p.ID, &p.BookingLegID, &p.FullName, &p.Phone, &p.Email, &p.SeatKey, &p.DeliverTo, &p.TicketID); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// PassengersForBooking returns all passengers of a booking (join through legs).
func (r *Repository) PassengersForBooking(ctx context.Context, q Querier, bookingID string) ([]BookingPassenger, error) {
	rows, err := q.Query(ctx, `
		SELECT p.id, p.booking_leg_id, p.full_name, p.phone, p.email, p.seat_key, p.deliver_to, p.ticket_id
		FROM bus_booking_passenger p
		JOIN bus_booking_leg l ON l.id = p.booking_leg_id
		WHERE l.booking_id=$1 ORDER BY p.id`, bookingID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []BookingPassenger
	for rows.Next() {
		var p BookingPassenger
		if err := rows.Scan(&p.ID, &p.BookingLegID, &p.FullName, &p.Phone, &p.Email, &p.SeatKey, &p.DeliverTo, &p.TicketID); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// SetLegState moves a leg to a new state.
func (r *Repository) SetLegState(ctx context.Context, q Querier, legID, state string) error {
	_, err := q.Exec(ctx, `UPDATE bus_booking_leg SET state=$2 WHERE id=$1`, legID, state)
	return err
}

// ─── Tickets ────────────────────────────────────────────────────────────────

// InsertTicket writes one issued ticket.
func (r *Repository) InsertTicket(ctx context.Context, q Querier, t *Ticket) error {
	return q.QueryRow(ctx, `
		INSERT INTO bus_ticket_v2 (token, passenger_id, booking_leg_id, status)
		VALUES ($1,$2,$3,'issued')
		RETURNING id, issued_at`, t.Token, t.PassengerID, t.BookingLegID).
		Scan(&t.ID, &t.IssuedAt)
}

// AttachTicketToPassenger records the issued ticket on its passenger row.
func (r *Repository) AttachTicketToPassenger(ctx context.Context, q Querier, passengerID, ticketID string) error {
	_, err := q.Exec(ctx,
		`UPDATE bus_booking_passenger SET ticket_id=$2 WHERE id=$1`, passengerID, ticketID)
	return err
}

// TicketsForBooking returns all tickets of a booking.
func (r *Repository) TicketsForBooking(ctx context.Context, q Querier, bookingID string) ([]Ticket, error) {
	rows, err := q.Query(ctx, `
		SELECT t.id, t.token, t.passenger_id, t.booking_leg_id, t.status, t.issued_at
		FROM bus_ticket_v2 t
		JOIN bus_booking_leg l ON l.id = t.booking_leg_id
		WHERE l.booking_id=$1 ORDER BY t.issued_at, t.id`, bookingID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Ticket
	for rows.Next() {
		var t Ticket
		if err := rows.Scan(&t.ID, &t.Token, &t.PassengerID, &t.BookingLegID, &t.Status, &t.IssuedAt); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// TicketByToken resolves a ticket plus its owning purchaser id for authz.
func (r *Repository) TicketByToken(ctx context.Context, q Querier, token string) (*Ticket, string, error) {
	var t Ticket
	var purchaserID string
	err := q.QueryRow(ctx, `
		SELECT t.id, t.token, t.passenger_id, t.booking_leg_id, t.status, t.issued_at, b.purchaser_id
		FROM bus_ticket_v2 t
		JOIN bus_booking_leg l ON l.id = t.booking_leg_id
		JOIN bus_booking b ON b.id = l.booking_id
		WHERE t.token=$1`, token).
		Scan(&t.ID, &t.Token, &t.PassengerID, &t.BookingLegID, &t.Status, &t.IssuedAt, &purchaserID)
	if err != nil {
		return nil, "", err
	}
	return &t, purchaserID, nil
}

// ─── Audit ──────────────────────────────────────────────────────────────────

// WriteAudit appends an immutable row to transport_audit_log — the shared
// transport audit sink (admin_id carries the acting user / system actor).
// Mutations call this INSIDE their own transaction so the audit record is
// all-or-nothing with the state change it describes.
func (r *Repository) WriteAudit(ctx context.Context, q Querier, actorID, action, entityType, entityID string, oldVal, newVal any, reason string) error {
	var oldJSON, newJSON []byte
	if oldVal != nil {
		oldJSON = jsonx.Marshal(oldVal)
	}
	if newVal != nil {
		newJSON = jsonx.Marshal(newVal)
	}
	_, err := q.Exec(ctx, `
		INSERT INTO transport_audit_log (admin_id, action, entity_type, entity_id, old_value, new_value, reason)
		VALUES ($1,$2,$3,$4,$5,$6,NULLIF($7,''))`,
		actorID, action, entityType, dbutil.NullStr(entityID), oldJSON, newJSON, reason)
	return err
}
