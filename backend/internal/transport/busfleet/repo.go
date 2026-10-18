package busfleet

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"spotlight/backend/go-common/dbutil"
	"spotlight/backend/go-common/jsonx"
)

// Querier is satisfied by *pgxpool.Pool and pgx.Tx alike so every repo function
// can run inside or outside a transaction (the same auditExecer convention as
// the parent transport package).
type Querier interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

func isUnique(err error) bool { return dbutil.IsUniqueViolation(err) }

func notFound(what string) *Error {
	return codedErr(http.StatusNotFound, CodeNotFound, what+" not found")
}

// lockSuffix appends FOR UPDATE when the row is being mutated inside a tx.
func lockSuffix(lock bool) string {
	if lock {
		return ` FOR UPDATE`
	}
	return ""
}

// ─── layouts ────────────────────────────────────────────────────────────────

const layoutCols = `id, provider_id, name, version, decks, rows_count, cols_count, capacity, active, created_at`

func scanLayout(row pgx.Row) (*SeatLayout, error) {
	l := &SeatLayout{}
	err := row.Scan(&l.ID, &l.ProviderID, &l.Name, &l.Version, &l.Decks, &l.Rows, &l.Cols, &l.Capacity, &l.Active, &l.CreatedAt)
	return l, err
}

func insertLayout(ctx context.Context, q Querier, l *SeatLayout) error {
	_, err := q.Exec(ctx, `
		INSERT INTO bus_seat_layout (id, provider_id, name, version, decks, rows_count, cols_count, capacity, active)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
		l.ID, l.ProviderID, l.Name, l.Version, l.Decks, l.Rows, l.Cols, l.Capacity, l.Active)
	return err
}

func insertSeats(ctx context.Context, q Querier, layoutID string, seats []Seat) error {
	for _, st := range seats {
		_, err := q.Exec(ctx, `
			INSERT INTO bus_seat_layout_seat (id, layout_id, seat_key, label, deck, row_no, col_no, seat_type, bookable)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
			st.ID, layoutID, st.SeatKey, st.Label, st.Deck, st.Row, st.Col, string(st.Type), st.Bookable)
		if err != nil {
			if isUnique(err) {
				return codedErrf(http.StatusConflict, CodeConflict, "seat %q collides inside the layout", st.SeatKey)
			}
			return err
		}
	}
	return nil
}

func loadLayout(ctx context.Context, q Querier, layoutID string, lock bool) (*SeatLayout, error) {
	l, err := scanLayout(q.QueryRow(ctx, `SELECT `+layoutCols+` FROM bus_seat_layout WHERE id=$1`+lockSuffix(lock), layoutID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, notFound("seat layout")
	}
	return l, err
}

func loadSeats(ctx context.Context, q Querier, layoutID string) ([]Seat, error) {
	rows, err := q.Query(ctx, `
		SELECT id, layout_id, seat_key, label, deck, row_no, col_no, seat_type, bookable
		FROM bus_seat_layout_seat WHERE layout_id=$1 ORDER BY deck, row_no, col_no`, layoutID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Seat
	for rows.Next() {
		var st Seat
		var typ string
		if err := rows.Scan(&st.ID, &st.LayoutID, &st.SeatKey, &st.Label, &st.Deck, &st.Row, &st.Col, &typ, &st.Bookable); err != nil {
			return nil, err
		}
		st.Type = SeatType(typ)
		out = append(out, st)
	}
	return out, rows.Err()
}

func listLayouts(ctx context.Context, q Querier, providerID string) ([]SeatLayout, error) {
	rows, err := q.Query(ctx, `SELECT `+layoutCols+` FROM bus_seat_layout WHERE provider_id=$1 ORDER BY name, version DESC`, providerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []SeatLayout
	for rows.Next() {
		l, err := scanLayout(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *l)
	}
	return out, rows.Err()
}

// layoutInUse reports whether any departure pins this layout version.
func layoutInUse(ctx context.Context, q Querier, layoutID string) (bool, error) {
	var exists bool
	err := q.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM bus_departure WHERE layout_id=$1)`, layoutID).Scan(&exists)
	return exists, err
}

// nextLayoutVersion is called inside the versioning tx with the source row held
// FOR UPDATE, so two concurrent version requests serialize instead of colliding
// on UNIQUE(provider_id, name, version).
func nextLayoutVersion(ctx context.Context, q Querier, providerID, name string) (int, error) {
	var v int
	err := q.QueryRow(ctx,
		`SELECT COALESCE(MAX(version),0)+1 FROM bus_seat_layout WHERE provider_id=$1 AND name=$2`,
		providerID, name).Scan(&v)
	return v, err
}

// ─── vehicles ───────────────────────────────────────────────────────────────

const vehicleCols = `id, provider_id, plate_number, fleet_code, make_model, capacity, layout_id, status, created_at, updated_at`

func scanVehicle(row pgx.Row) (*Vehicle, error) {
	v := &Vehicle{}
	var fleetCode, makeModel *string
	var status string
	err := row.Scan(&v.ID, &v.ProviderID, &v.PlateNumber, &fleetCode, &makeModel, &v.Capacity, &v.LayoutID, &status, &v.CreatedAt, &v.UpdatedAt)
	v.FleetCode = dbutil.DerefString(fleetCode)
	v.MakeModel = dbutil.DerefString(makeModel)
	v.Status = VehicleStatus(status)
	return v, err
}

func insertVehicle(ctx context.Context, q Querier, v *Vehicle) error {
	_, err := q.Exec(ctx, `
		INSERT INTO bus_vehicle (id, provider_id, plate_number, fleet_code, make_model, capacity, layout_id, status)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
		v.ID, v.ProviderID, v.PlateNumber, dbutil.NullStr(v.FleetCode), dbutil.NullStr(v.MakeModel),
		v.Capacity, v.LayoutID, string(v.Status))
	return err
}

func loadVehicle(ctx context.Context, q Querier, vehicleID string, lock bool) (*Vehicle, error) {
	v, err := scanVehicle(q.QueryRow(ctx, `SELECT `+vehicleCols+` FROM bus_vehicle WHERE id=$1`+lockSuffix(lock), vehicleID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, notFound("vehicle")
	}
	return v, err
}

func listVehicles(ctx context.Context, q Querier, providerID string) ([]Vehicle, error) {
	rows, err := q.Query(ctx, `SELECT `+vehicleCols+` FROM bus_vehicle WHERE provider_id=$1 ORDER BY created_at DESC`, providerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Vehicle
	for rows.Next() {
		v, err := scanVehicle(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *v)
	}
	return out, rows.Err()
}

// ─── routes (read-only; owned by the route-template module) ─────────────────

type routeRow struct {
	ID         string
	ProviderID string
	Version    int
	Active     bool
}

func loadRoute(ctx context.Context, q Querier, routeID string) (*routeRow, error) {
	r := &routeRow{}
	err := q.QueryRow(ctx,
		`SELECT id, provider_id, version, active FROM bus_route_template WHERE id=$1`, routeID).
		Scan(&r.ID, &r.ProviderID, &r.Version, &r.Active)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, notFound("route template")
	}
	return r, err
}

type routeStopRow struct {
	Seq             int
	TerminalID      string
	TerminalName    string
	CityName        string
	ArriveOffsetMin *int
	DepartOffsetMin int
	BoardAllowed    bool
	AlightAllowed   bool
}

func loadRouteStops(ctx context.Context, q Querier, routeID string) ([]routeStopRow, error) {
	rows, err := q.Query(ctx, `
		SELECT s.seq, s.terminal_id, t.name, c.name, s.arrive_offset_min, s.depart_offset_min,
		       s.board_allowed, s.alight_allowed
		FROM bus_route_stop s
		JOIN bus_terminal t ON t.id = s.terminal_id
		LEFT JOIN bus_geo_city c ON c.id = t.city_id
		WHERE s.route_id=$1 ORDER BY s.seq`, routeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []routeStopRow
	for rows.Next() {
		var st routeStopRow
		var city *string
		if err := rows.Scan(&st.Seq, &st.TerminalID, &st.TerminalName, &city,
			&st.ArriveOffsetMin, &st.DepartOffsetMin, &st.BoardAllowed, &st.AlightAllowed); err != nil {
			return nil, err
		}
		st.CityName = dbutil.DerefString(city)
		out = append(out, st)
	}
	return out, rows.Err()
}

// loadRouteFares returns the OD fare matrix effective on travelDate — the set
// frozen into bus_departure.fare_snapshot.
func loadRouteFares(ctx context.Context, q Querier, routeID string, travelDate time.Time) ([]FareEntry, error) {
	rows, err := q.Query(ctx, `
		SELECT from_seq, to_seq, amount_kobo, currency
		FROM bus_route_fare
		WHERE route_id=$1 AND status='active'
		  AND effective_from <= $2::date
		  AND (effective_to IS NULL OR effective_to >= $2::date)
		ORDER BY from_seq, to_seq`, routeID, travelDate)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []FareEntry{}
	for rows.Next() {
		var f FareEntry
		if err := rows.Scan(&f.FromSeq, &f.ToSeq, &f.AmountKobo, &f.Currency); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

// ─── departures ─────────────────────────────────────────────────────────────

const departureCols = `id, provider_id, route_id, route_version, travel_date, depart_at,
	vehicle_id, layout_id, layout_version, capacity, status,
	booking_cutoff_minutes, cancel_cutoff_minutes, itinerary_snapshot, fare_snapshot,
	created_at, updated_at`

func scanDeparture(row pgx.Row) (*Departure, error) {
	d := &Departure{}
	var vehicleID, layoutID *string
	var layoutVersion *int
	var status string
	var itinRaw, fareRaw []byte
	err := row.Scan(&d.ID, &d.ProviderID, &d.RouteID, &d.RouteVersion, &d.TravelDate, &d.DepartAt,
		&vehicleID, &layoutID, &layoutVersion, &d.Capacity, &status,
		&d.BookingCutoffMin, &d.CancelCutoffMin, &itinRaw, &fareRaw,
		&d.CreatedAt, &d.UpdatedAt)
	if err != nil {
		return nil, err
	}
	d.VehicleID, d.LayoutID, d.LayoutVersion = vehicleID, layoutID, layoutVersion
	d.Status = DepartureStatus(status)
	d.Itinerary = jsonx.UnmarshalOr(itinRaw, []SnapshotStop{})
	d.Fares = jsonx.UnmarshalOr(fareRaw, []FareEntry{})
	return d, nil
}

// insertDeparture writes one departure. Returns (false, nil) when the natural
// key UNIQUE(route_id, travel_date, depart_at) already exists — the caller then
// reloads the existing row for an idempotent replay response.
func insertDeparture(ctx context.Context, q Querier, d *Departure) (bool, error) {
	itin, err := jsonx.MarshalArray(d.Itinerary)
	if err != nil {
		return false, fmt.Errorf("busfleet: itinerary snapshot: %w", err)
	}
	fares, err := jsonx.MarshalArray(d.Fares)
	if err != nil {
		return false, fmt.Errorf("busfleet: fare snapshot: %w", err)
	}
	var id string
	err = q.QueryRow(ctx, `
		INSERT INTO bus_departure (id, provider_id, route_id, route_version, travel_date, depart_at,
			vehicle_id, layout_id, layout_version, capacity, status,
			booking_cutoff_minutes, cancel_cutoff_minutes, itinerary_snapshot, fare_snapshot)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
		        COALESCE(NULLIF($12,0),60), COALESCE(NULLIF($13,0),120), $14, $15)
		ON CONFLICT (route_id, travel_date, depart_at) DO NOTHING
		RETURNING id`,
		d.ID, d.ProviderID, d.RouteID, d.RouteVersion, d.TravelDate, d.DepartAt,
		nullUUIDPtr(d.VehicleID), nullUUIDPtr(d.LayoutID),
		nullIntPtr(d.LayoutVersion), d.Capacity, string(d.Status),
		d.BookingCutoffMin, d.CancelCutoffMin, itin, fares).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	d.ID = id
	return true, nil
}

// nullUUIDPtr maps a *string uuid column value to nil for NULL storage.
func nullUUIDPtr(s *string) any {
	if s == nil {
		return nil
	}
	return dbutil.NullUUID(*s)
}

// nullIntPtr maps a *int column value to nil for NULL storage.
func nullIntPtr(v *int) any {
	if v == nil {
		return nil
	}
	return *v
}

func loadDeparture(ctx context.Context, q Querier, departureID string, lock bool) (*Departure, error) {
	d, err := scanDeparture(q.QueryRow(ctx, `SELECT `+departureCols+` FROM bus_departure WHERE id=$1`+lockSuffix(lock), departureID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, notFound("departure")
	}
	return d, err
}

func loadDepartureByKey(ctx context.Context, q Querier, routeID string, travelDate, departAt time.Time) (*Departure, error) {
	d, err := scanDeparture(q.QueryRow(ctx,
		`SELECT `+departureCols+` FROM bus_departure WHERE route_id=$1 AND travel_date=$2 AND depart_at=$3`,
		routeID, travelDate, departAt))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, notFound("departure")
	}
	return d, err
}

func listDepartures(ctx context.Context, q Querier, f DepartureFilter) ([]*Departure, error) {
	var sb strings.Builder
	sb.WriteString(`SELECT ` + departureCols + ` FROM bus_departure WHERE TRUE`)
	args := []any{}
	add := func(cond string, v any) {
		args = append(args, v)
		fmt.Fprintf(&sb, ` AND %s=$%d`, cond, len(args))
	}
	if f.ProviderID != "" {
		add("provider_id", f.ProviderID)
	}
	if f.RouteID != "" {
		add("route_id", f.RouteID)
	}
	if f.Status != "" {
		add("status", string(f.Status))
	}
	if f.TravelDate != nil {
		add("travel_date", *f.TravelDate)
	}
	sb.WriteString(` ORDER BY depart_at`)
	limit := f.Limit
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	args = append(args, limit)
	fmt.Fprintf(&sb, ` LIMIT $%d`, len(args))
	if f.Offset > 0 {
		args = append(args, f.Offset)
		fmt.Fprintf(&sb, ` OFFSET $%d`, len(args))
	}
	rows, err := q.Query(ctx, sb.String(), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Departure
	for rows.Next() {
		d, err := scanDeparture(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// occupiedWindows returns the busy intervals of the vehicle's live departures —
// the input to conflictsFor. Terminal states (cancelled/completed/arrived/
// no_show) free the vehicle; 'departed' still occupies it.
func occupiedWindows(ctx context.Context, q Querier, vehicleID string) ([]OccupiedWindow, error) {
	rows, err := q.Query(ctx, `
		SELECT id, depart_at, itinerary_snapshot
		FROM bus_departure
		WHERE vehicle_id=$1 AND status NOT IN ('arrived','completed','cancelled','no_show')`, vehicleID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []OccupiedWindow
	for rows.Next() {
		var w OccupiedWindow
		var itinRaw []byte
		if err := rows.Scan(&w.DepartureID, &w.DepartAt, &itinRaw); err != nil {
			return nil, err
		}
		w.ArriveAt = itineraryEnd(jsonx.UnmarshalOr(itinRaw, []SnapshotStop{}), w.DepartAt)
		out = append(out, w)
	}
	return out, rows.Err()
}

// occupiedSeatKeys lists the distinct confirmed seat_keys on a departure — the
// seats a vehicle swap must accommodate.
func occupiedSeatKeys(ctx context.Context, q Querier, departureID string) ([]string, error) {
	rows, err := q.Query(ctx,
		`SELECT DISTINCT seat_key FROM bus_seat_occupancy WHERE departure_id=$1 AND state='occupied' ORDER BY seat_key`, departureID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var k string
		if err := rows.Scan(&k); err != nil {
			return nil, err
		}
		out = append(out, k)
	}
	return out, rows.Err()
}

// ─── audit ──────────────────────────────────────────────────────────────────

// writeAudit inserts one immutable row into transport_audit_log — the same audit
// sink the parent transport package uses (actor, action, entity, old/new JSONB,
// reason). Keeping the row in the same tx as the mutation makes them
// all-or-nothing, matching the audited-mutation contract.
func writeAudit(ctx context.Context, q Querier, actorID, action, entityType, entityID string, oldVal, newVal any, reason string) error {
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
		auditActor(actorID), action, entityType, entityID, oldJSON, newJSON, reason)
	return err
}

// auditActor maps the caller id onto transport_audit_log.admin_id (UUID NOT
// NULL). A missing/unparseable actor — e.g. a system-triggered generation —
// lands on the all-zero "system" uuid rather than failing the mutation.
func auditActor(actorID string) uuid.UUID {
	if u, err := uuid.Parse(strings.TrimSpace(actorID)); err == nil {
		return u
	}
	return uuid.Nil
}
