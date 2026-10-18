package buscatalog

// repo.go — the SQL layer for the buscatalog package. Everything here is a
// thin scan-and-return function taking `q querier` so the same code runs on the
// pool for reads and inside pgx transactions for multi-statement writes
// (route create/revise, return linking). No business rules live here — the
// service validates before calling.

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// querier is satisfied by both *pgxpool.Pool and pgx.Tx so every query helper
// can run standalone or inside a transaction.
type querier interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// ---------------------------------------------------------------------------
// Geography
// ---------------------------------------------------------------------------

func listStates(ctx context.Context, q querier) ([]GeoState, error) {
	rows, err := q.Query(ctx,
		`SELECT id, code, name, active FROM public.bus_geo_state ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []GeoState
	for rows.Next() {
		var s GeoState
		if err := rows.Scan(&s.ID, &s.Code, &s.Name, &s.Active); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func listCities(ctx context.Context, q querier, stateID int16) ([]GeoCity, error) {
	// stateID = 0 lists every city (used by admin tooling); otherwise scoped.
	const qAll = `SELECT id, state_id, name, active FROM public.bus_geo_city ORDER BY name`
	const qByState = `SELECT id, state_id, name, active FROM public.bus_geo_city WHERE state_id=$1 ORDER BY name`
	var rows pgx.Rows
	var err error
	if stateID == 0 {
		rows, err = q.Query(ctx, qAll)
	} else {
		rows, err = q.Query(ctx, qByState, stateID)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []GeoCity
	for rows.Next() {
		var c GeoCity
		if err := rows.Scan(&c.ID, &c.StateID, &c.Name, &c.Active); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// ---------------------------------------------------------------------------
// Terminals
// ---------------------------------------------------------------------------

const terminalCols = `id, city_id, name, address, latitude, longitude, operator_id,
	status, merged_into, created_at, updated_at`

func scanTerminal(r pgx.Row) (*Terminal, error) {
	var t Terminal
	err := r.Scan(&t.ID, &t.CityID, &t.Name, &t.Address, &t.Latitude, &t.Longitude,
		&t.OperatorID, &t.Status, &t.MergedInto, &t.CreatedAt, &t.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &t, nil
}

func getTerminal(ctx context.Context, q querier, id string) (*Terminal, error) {
	return scanTerminal(q.QueryRow(ctx,
		`SELECT `+terminalCols+` FROM public.bus_terminal WHERE id=$1`, id))
}

func insertTerminal(ctx context.Context, q querier, t *Terminal) (*Terminal, error) {
	return scanTerminal(q.QueryRow(ctx, `
		INSERT INTO public.bus_terminal (city_id, name, address, latitude, longitude, operator_id)
		VALUES ($1,$2,$3,$4,$5,$6)
		RETURNING `+terminalCols,
		t.CityID, t.Name, t.Address, t.Latitude, t.Longitude, t.OperatorID))
}

func listTerminals(ctx context.Context, q querier, f TerminalFilter) ([]Terminal, error) {
	// City/State filters join through bus_geo_city so a state-level filter works
	// without a denormalised column on the terminal row.
	sql := `SELECT t.` + terminalCols + `
		FROM public.bus_terminal t
		JOIN public.bus_geo_city c ON c.id = t.city_id
		WHERE ($1::uuid IS NULL OR t.city_id = $1)
		  AND ($2::smallint = 0 OR c.state_id = $2)
		  AND ($3::text = '' OR t.status = $3)
		ORDER BY t.name
		LIMIT $4 OFFSET $5`
	limit := f.Limit
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	var cityArg any
	if f.CityID != "" {
		cityArg = f.CityID
	}
	rows, err := q.Query(ctx, sql, cityArg, f.StateID, f.Status, limit, f.Offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Terminal{}
	for rows.Next() {
		var t Terminal
		if err := rows.Scan(&t.ID, &t.CityID, &t.Name, &t.Address, &t.Latitude,
			&t.Longitude, &t.OperatorID, &t.Status, &t.MergedInto,
			&t.CreatedAt, &t.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func updateTerminal(ctx context.Context, q querier, id string, p TerminalPatchRequest) (*Terminal, error) {
	// COALESCE keeps a column when the patch field is nil. Explicitly setting a
	// column to NULL is not expressible through this patch (clearing an address
	// is a full-row admin op, not a customer PATCH concern).
	return scanTerminal(q.QueryRow(ctx, `
		UPDATE public.bus_terminal SET
			city_id    = COALESCE($2::uuid, city_id),
			name       = COALESCE($3, name),
			address    = COALESCE($4, address),
			latitude   = COALESCE($5, latitude),
			longitude  = COALESCE($6, longitude),
			updated_at = now()
		WHERE id = $1
		RETURNING `+terminalCols,
		id, p.CityID, p.Name, p.Address, p.Latitude, p.Longitude))
}

func setTerminalStatus(ctx context.Context, q querier, id, status string, mergedInto *string) (*Terminal, error) {
	return scanTerminal(q.QueryRow(ctx, `
		UPDATE public.bus_terminal SET status=$2, merged_into=$3, updated_at=now()
		WHERE id=$1
		RETURNING `+terminalCols, id, status, mergedInto))
}

// terminalStatuses returns the status of each supplied terminal id — used to
// validate that every stop terminal exists and is usable (not merged/inactive).
func terminalStatuses(ctx context.Context, q querier, ids []string) (map[string]string, error) {
	rows, err := q.Query(ctx,
		`SELECT id::text, status FROM public.bus_terminal WHERE id = ANY($1::uuid[])`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var id, status string
		if err := rows.Scan(&id, &status); err != nil {
			return nil, err
		}
		out[id] = status
	}
	return out, rows.Err()
}

// ---------------------------------------------------------------------------
// Route templates + stops
// ---------------------------------------------------------------------------

const routeCols = `id, provider_id, code, name, version, active, one_way_only,
	return_route_id, created_at, updated_at`

func scanRoute(r pgx.Row) (*RouteTemplate, error) {
	var rt RouteTemplate
	err := r.Scan(&rt.ID, &rt.ProviderID, &rt.Code, &rt.Name, &rt.Version,
		&rt.Active, &rt.OneWayOnly, &rt.ReturnRouteID, &rt.CreatedAt, &rt.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &rt, nil
}

func getRoute(ctx context.Context, q querier, id string) (*RouteTemplate, error) {
	return scanRoute(q.QueryRow(ctx,
		`SELECT `+routeCols+` FROM public.bus_route_template WHERE id=$1`, id))
}

func listRoutes(ctx context.Context, q querier, providerID string, latestOnly bool) ([]RouteTemplate, error) {
	// latestOnly collapses (provider_id, code) groups to their highest version —
	// the "current" template. Full history remains queryable with latestOnly=false.
	sql := `SELECT ` + routeCols + ` FROM public.bus_route_template
		WHERE provider_id = $1`
	if latestOnly {
		sql += ` AND (code, version) IN (
			SELECT code, max(version) FROM public.bus_route_template
			WHERE provider_id = $1 GROUP BY code)`
	}
	sql += ` ORDER BY code, version DESC`
	rows, err := q.Query(ctx, sql, providerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []RouteTemplate{}
	for rows.Next() {
		var rt RouteTemplate
		if err := rows.Scan(&rt.ID, &rt.ProviderID, &rt.Code, &rt.Name, &rt.Version,
			&rt.Active, &rt.OneWayOnly, &rt.ReturnRouteID, &rt.CreatedAt, &rt.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, rt)
	}
	return out, rows.Err()
}

func insertRoute(ctx context.Context, q querier, rt *RouteTemplate) (*RouteTemplate, error) {
	return scanRoute(q.QueryRow(ctx, `
		INSERT INTO public.bus_route_template
			(provider_id, code, name, version, one_way_only)
		VALUES ($1,$2,$3,$4,$5)
		RETURNING `+routeCols,
		rt.ProviderID, rt.Code, rt.Name, rt.Version, rt.OneWayOnly))
}

func insertStops(ctx context.Context, q querier, routeID string, stops []StopInput) error {
	for _, st := range stops {
		if _, err := q.Exec(ctx, `
			INSERT INTO public.bus_route_stop
				(route_id, seq, terminal_id, arrive_offset_min, depart_offset_min,
				 board_allowed, alight_allowed)
			VALUES ($1,$2,$3,$4,$5,$6,$7)`,
			routeID, st.Seq, st.TerminalID, st.ArriveOffsetMin,
			st.DepartOffsetMin, st.BoardAllowed, st.AlightAllowed); err != nil {
			return err
		}
	}
	return nil
}

func listStops(ctx context.Context, q querier, routeID string) ([]RouteStop, error) {
	rows, err := q.Query(ctx, `
		SELECT id, route_id, seq, terminal_id, arrive_offset_min, depart_offset_min,
		       board_allowed, alight_allowed
		FROM public.bus_route_stop WHERE route_id=$1 ORDER BY seq`, routeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []RouteStop{}
	for rows.Next() {
		var s RouteStop
		if err := rows.Scan(&s.ID, &s.RouteID, &s.Seq, &s.TerminalID,
			&s.ArriveOffsetMin, &s.DepartOffsetMin, &s.BoardAllowed, &s.AlightAllowed); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func deleteStops(ctx context.Context, q querier, routeID string) error {
	_, err := q.Exec(ctx, `DELETE FROM public.bus_route_stop WHERE route_id=$1`, routeID)
	return err
}

// updateRouteMeta patches the mutable-in-place columns. Stops and version are
// NEVER touched here — itinerary changes go through ReviseRoute's version bump
// once any departure pins this row.
func updateRouteMeta(ctx context.Context, q querier, id, code, name string, oneWayOnly bool, returnRouteID *string) (*RouteTemplate, error) {
	return scanRoute(q.QueryRow(ctx, `
		UPDATE public.bus_route_template SET
			code = $2, name = $3, one_way_only = $4, return_route_id = $5,
			updated_at = now()
		WHERE id = $1
		RETURNING `+routeCols, id, code, name, oneWayOnly, returnRouteID))
}

func setRouteActive(ctx context.Context, q querier, id string, active bool) (*RouteTemplate, error) {
	return scanRoute(q.QueryRow(ctx, `
		UPDATE public.bus_route_template SET active=$2, updated_at=now()
		WHERE id=$1 RETURNING `+routeCols, id, active))
}

// nextRouteVersion returns max(version)+1 for a (provider_id, code) pair.
func nextRouteVersion(ctx context.Context, q querier, providerID, code string) (int32, error) {
	var v int32
	err := q.QueryRow(ctx, `
		SELECT COALESCE(max(version), 0) + 1 FROM public.bus_route_template
		WHERE provider_id=$1 AND code=$2`, providerID, code).Scan(&v)
	return v, err
}

// departureReferencesRoute reports whether any bus_departure row pins this
// template row (route_id + its version). This is the check that decides
// "mutate in place" vs "bump the version": once a dated departure exists its
// itinerary_snapshot/fare_snapshot were frozen from THIS version, so the row
// must stay immutable for audit/replay.
//
// STUB NOTE for the businventory follow-up: today this is a simple EXISTS on
// bus_departure.route_id. When businventory lands and departures can pin a
// superseded template of the same code at an older version, extend this to
// discriminate by route_version so a brand-new version isn't frozen by the
// previous generation's departures.
func (s *Service) departureReferencesRoute(ctx context.Context, routeID string) (bool, error) {
	var exists bool
	err := s.db.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM public.bus_departure WHERE route_id=$1)`, routeID).Scan(&exists)
	return exists, err
}

// ---------------------------------------------------------------------------
// Fares
// ---------------------------------------------------------------------------

const fareCols = `id, route_id, from_seq, to_seq, amount_kobo, currency,
	effective_from, effective_to, status, created_by, created_at`

func scanFare(r pgx.Row) (*RouteFare, error) {
	var f RouteFare
	err := r.Scan(&f.ID, &f.RouteID, &f.FromSeq, &f.ToSeq, &f.AmountKobo,
		&f.Currency, &f.EffectiveFrom, &f.EffectiveTo, &f.Status, &f.CreatedBy, &f.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &f, nil
}

func upsertFare(ctx context.Context, q querier, f *RouteFare) (*RouteFare, error) {
	// Natural key (route_id, from_seq, to_seq, effective_from): re-posting the
	// same effective window updates price/status in place — that is the "upsert"
	// semantics the admin console wants. A DIFFERENT effective_from inserts a
	// new row, preserving the rate history.
	return scanFare(q.QueryRow(ctx, `
		INSERT INTO public.bus_route_fare
			(route_id, from_seq, to_seq, amount_kobo, currency,
			 effective_from, effective_to, status, created_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		ON CONFLICT (route_id, from_seq, to_seq, effective_from)
		DO UPDATE SET amount_kobo = EXCLUDED.amount_kobo,
		              currency    = EXCLUDED.currency,
		              effective_to = EXCLUDED.effective_to,
		              status      = EXCLUDED.status
		RETURNING `+fareCols,
		f.RouteID, f.FromSeq, f.ToSeq, f.AmountKobo, f.Currency,
		f.EffectiveFrom, f.EffectiveTo, f.Status, f.CreatedBy))
}

func listFares(ctx context.Context, q querier, routeID string) ([]RouteFare, error) {
	rows, err := q.Query(ctx, `
		SELECT `+fareCols+` FROM public.bus_route_fare
		WHERE route_id=$1 ORDER BY from_seq, to_seq, effective_from DESC`, routeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []RouteFare{}
	for rows.Next() {
		var f RouteFare
		if err := rows.Scan(&f.ID, &f.RouteID, &f.FromSeq, &f.ToSeq, &f.AmountKobo,
			&f.Currency, &f.EffectiveFrom, &f.EffectiveTo, &f.Status, &f.CreatedBy, &f.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

func loadRouteFaresForQuote(ctx context.Context, q querier, routeID string, fromSeq, toSeq int16) ([]RouteFare, error) {
	rows, err := q.Query(ctx, `
		SELECT `+fareCols+` FROM public.bus_route_fare
		WHERE route_id=$1 AND from_seq=$2 AND to_seq=$3
		ORDER BY effective_from DESC`, routeID, fromSeq, toSeq)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []RouteFare{}
	for rows.Next() {
		var f RouteFare
		if err := rows.Scan(&f.ID, &f.RouteID, &f.FromSeq, &f.ToSeq, &f.AmountKobo,
			&f.Currency, &f.EffectiveFrom, &f.EffectiveTo, &f.Status, &f.CreatedBy, &f.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

// ---------------------------------------------------------------------------
// Customer departure search (read model — businventory owns writes)
// ---------------------------------------------------------------------------

func searchDepartures(ctx context.Context, q querier, req DepartureSearchRequest) ([]DepartureSearchResult, error) {
	limit := req.Limit
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	// A departure serves O→D when the route has a boardable stop in the origin
	// city/state followed (higher seq) by an alightable stop in the destination
	// city/state. City filters are optional — empty matches any city in state.
	rows, err := q.Query(ctx, `
		SELECT d.id, d.provider_id, d.route_id, rt.code, rt.name, rt.version,
		       d.travel_date, d.depart_at, d.capacity, d.status,
		       os.seq, ds.seq,
		       ot.name, dt.name, oc.name, dc.name, ostate.code, dstate.code
		FROM public.bus_departure d
		JOIN public.bus_route_template rt ON rt.id = d.route_id
		JOIN public.bus_route_stop os
		  ON os.route_id = rt.id AND os.board_allowed
		JOIN public.bus_terminal ot ON ot.id = os.terminal_id
		JOIN public.bus_geo_city  oc ON oc.id = ot.city_id
		JOIN public.bus_geo_state ostate ON ostate.id = oc.state_id
		JOIN public.bus_route_stop ds
		  ON ds.route_id = rt.id AND ds.alight_allowed AND ds.seq > os.seq
		JOIN public.bus_terminal dt ON dt.id = ds.terminal_id
		JOIN public.bus_geo_city  dc ON dc.id = dt.city_id
		JOIN public.bus_geo_state dstate ON dstate.id = dc.state_id
		WHERE d.travel_date = $1::date
		  AND d.status = ANY($2::text[])
		  AND upper(ostate.code) = upper($3)
		  AND ($4::text = '' OR oc.name ILIKE $4)
		  AND upper(dstate.code) = upper($5)
		  AND ($6::text = '' OR dc.name ILIKE $6)
		  AND ($7::uuid IS NULL OR d.provider_id = $7)
		  AND ot.status = 'active' AND dt.status = 'active'
		ORDER BY d.depart_at, os.seq
		LIMIT $8 OFFSET $9`,
		req.TravelDate.Format("2006-01-02"), searchableDepartureStatuses,
		req.OriginState, req.OriginCity, req.DestState, req.DestCity,
		nullStr(req.ProviderID), limit, req.Offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []DepartureSearchResult{}
	for rows.Next() {
		var r DepartureSearchResult
		var travelDate time.Time
		if err := rows.Scan(&r.DepartureID, &r.ProviderID, &r.RouteID,
			&r.RouteCode, &r.RouteName, &r.RouteVersion,
			&travelDate, &r.DepartAt, &r.Capacity, &r.Status,
			&r.FromSeq, &r.ToSeq,
			&r.OriginTerminal, &r.DestTerminal, &r.OriginCity, &r.DestCity,
			&r.OriginStateCode, &r.DestStateCode); err != nil {
			return nil, err
		}
		r.TravelDate = travelDate
		out = append(out, r)
	}
	return out, rows.Err()
}

// nullStr maps "" to nil so optional text params compare as SQL NULL.
func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}
