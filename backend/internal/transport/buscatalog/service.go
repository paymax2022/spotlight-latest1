package buscatalog

// service.go — the catalog service. Pure validators (validateStops,
// validateODPair, resolveFare, canTransitionTerminal) are package-level
// functions with no DB dependency so unit tests exercise them without a pool;
// the Service wraps them around pgx transactions for the DB-backed operations.
//
// Conventions mirrored from backend/internal/transport:
//   - *pgxpool.Pool on the service, pgx.Tx for multi-statement writes
//   - transport.CodedError ({error, code} envelope) for client-visible failures
//   - dbutil SQLSTATE helpers translating constraint violations to 4xx

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/go-common/dbutil"
	"spotlight/backend/internal/transport"
)

// Service owns the bus-transport-v2 catalog tables. It is deliberately thin:
// validation in pure functions, SQL in repo.go, transactions at this layer.
type Service struct {
	db *pgxpool.Pool
}

// NewService wires the catalog service. There is no money movement in this
// module (fares are catalog data, not ledger postings) so it needs only the
// pool — no settlement/tiers seams.
func NewService(db *pgxpool.Pool) *Service {
	return &Service{db: db}
}

func codedErr(status int, code, msg string) *transport.CodedError {
	return &transport.CodedError{Status: status, Code: code, Message: msg}
}

func badReq(msg string) *transport.CodedError {
	return codedErr(http.StatusBadRequest, CodeValidation, msg)
}

func notFound(msg string) *transport.CodedError {
	return codedErr(http.StatusNotFound, CodeNotFound, msg)
}

func conflict(msg string) *transport.CodedError {
	return codedErr(http.StatusConflict, CodeInvalidState, msg)
}

// ---------------------------------------------------------------------------
// Pure validators (unit-tested without a DB)
// ---------------------------------------------------------------------------

// validateStops enforces the itinerary invariants the fare matrix and the
// occupancy model rely on. The caller supplies stops in ANY order; they are
// checked against their seq values, not slice position:
//   - at least 2 stops
//   - seqs are contiguous 1..n, unique
//   - depart_offset_min is non-decreasing along the itinerary
//   - seq 1 carries no arrive_offset (nothing arrives at the origin)
//   - a set arrive_offset never exceeds its depart_offset
//   - seq 1 must allow boarding; the last seq must allow alighting
//     (otherwise no sellable OD pair exists through that endpoint)
func validateStops(stops []StopInput) error {
	if len(stops) < 2 {
		return badReq("a route needs at least an origin and a destination stop")
	}
	bySeq := make(map[int16]StopInput, len(stops))
	for _, s := range stops {
		if s.Seq < 1 {
			return badReq(fmt.Sprintf("stop seq %d is invalid (must be >= 1)", s.Seq))
		}
		if s.TerminalID == "" {
			return badReq(fmt.Sprintf("stop seq %d has no terminal_id", s.Seq))
		}
		if _, dup := bySeq[s.Seq]; dup {
			return badReq(fmt.Sprintf("duplicate stop seq %d", s.Seq))
		}
		if s.ArriveOffsetMin != nil && *s.ArriveOffsetMin > s.DepartOffsetMin {
			return badReq(fmt.Sprintf(
				"stop seq %d arrives (%d min) after it departs (%d min)",
				s.Seq, *s.ArriveOffsetMin, s.DepartOffsetMin))
		}
		if s.DepartOffsetMin < 0 ||
			(s.ArriveOffsetMin != nil && *s.ArriveOffsetMin < 0) {
			return badReq(fmt.Sprintf("stop seq %d has a negative offset", s.Seq))
		}
		bySeq[s.Seq] = s
	}
	if int16(len(stops)) != int16(len(bySeq)) || bySeq[1].TerminalID == "" {
		return badReq("stop seqs must start at 1")
	}
	prevDepart := int32(-1)
	for i := int16(1); i <= int16(len(bySeq)); i++ {
		s, ok := bySeq[i]
		if !ok {
			return badReq(fmt.Sprintf(
				"stop seqs must be contiguous 1..n — seq %d is missing", i))
		}
		if i == 1 && s.ArriveOffsetMin != nil {
			return badReq("the origin stop (seq 1) must not carry an arrive_offset_min")
		}
		if s.DepartOffsetMin < prevDepart {
			return badReq(fmt.Sprintf(
				"depart_offset_min must be non-decreasing along the route — seq %d (%d) precedes a shorter value after seq %d (%d)",
				i, s.DepartOffsetMin, i-1, prevDepart))
		}
		prevDepart = s.DepartOffsetMin
	}
	if !bySeq[1].BoardAllowed {
		return badReq("the origin stop (seq 1) must allow boarding")
	}
	if !bySeq[int16(len(bySeq))].AlightAllowed {
		return badReq("the last stop must allow alighting")
	}
	return nil
}

// validateODPair checks that (fromSeq, toSeq) is a sellable slice of the given
// ordered stop list: strictly forward, both stops exist, the boarding stop
// allows boarding and the alighting stop allows alighting.
func validateODPair(stops []RouteStop, fromSeq, toSeq int16) error {
	if fromSeq >= toSeq {
		return badReq(fmt.Sprintf(
			"invalid OD pair: from_seq %d must be < to_seq %d", fromSeq, toSeq))
	}
	var from, to *RouteStop
	for i := range stops {
		if stops[i].Seq == fromSeq {
			from = &stops[i]
		}
		if stops[i].Seq == toSeq {
			to = &stops[i]
		}
	}
	if from == nil {
		return notFound(fmt.Sprintf("route has no stop at seq %d", fromSeq))
	}
	if to == nil {
		return notFound(fmt.Sprintf("route has no stop at seq %d", toSeq))
	}
	if !from.BoardAllowed {
		return badReq(fmt.Sprintf("stop seq %d does not allow boarding", fromSeq))
	}
	if !to.AlightAllowed {
		return badReq(fmt.Sprintf("stop seq %d does not allow alighting", toSeq))
	}
	return nil
}

// resolveFare picks the single governing fare for an OD pair on a travel date
// from a candidate list (already filtered to that OD pair):
//   - status must be 'active'
//   - effective_from <= travelDate
//   - effective_to is NULL or >= travelDate
//   - among surviving rows the LATEST effective_from wins (a narrower,
//     more recent window supersedes the open-ended base fare)
func resolveFare(fares []RouteFare, fromSeq, toSeq int16, travelDate time.Time) (*RouteFare, error) {
	day := travelDate.Truncate(24 * time.Hour)
	var best *RouteFare
	for i := range fares {
		f := &fares[i]
		if f.Status != FareActive {
			continue
		}
		if f.EffectiveFrom.After(day) {
			continue
		}
		if f.EffectiveTo != nil && f.EffectiveTo.Before(day) {
			continue
		}
		if best == nil || f.EffectiveFrom.After(best.EffectiveFrom) {
			best = f
		}
	}
	if best == nil {
		return nil, codedErr(http.StatusNotFound, CodeFareUnavailable,
			fmt.Sprintf("no active fare for seq %d→%d on %s",
				fromSeq, toSeq, day.Format("2006-01-02")))
	}
	return best, nil
}

// canTransitionTerminal reports whether a terminal may move from->to.
// Setting the status it already has is a no-op (allowed, idempotent).
func canTransitionTerminal(from, to string) bool {
	if from == to {
		return true
	}
	return terminalTransitions[from][to]
}

// ---------------------------------------------------------------------------
// Geography
// ---------------------------------------------------------------------------

// ListStates returns every geo state row (seeded 36 states + FCT), ordered by
// name. Inactive rows are included so admin tooling can reactivate them.
func (s *Service) ListStates(ctx context.Context) ([]GeoState, error) {
	return listStates(ctx, s.db)
}

// ListCities returns cities; stateID 0 returns all cities.
func (s *Service) ListCities(ctx context.Context, stateID int16) ([]GeoCity, error) {
	return listCities(ctx, s.db, stateID)
}

// ---------------------------------------------------------------------------
// Terminals
// ---------------------------------------------------------------------------

// CreateTerminal inserts a terminal in 'pending' approval state — new
// terminals are never born active; they go through the approval lifecycle.
func (s *Service) CreateTerminal(ctx context.Context, req TerminalCreateRequest) (*Terminal, error) {
	t := &Terminal{
		CityID:     req.CityID,
		Name:       req.Name,
		Address:    req.Address,
		Latitude:   req.Latitude,
		Longitude:  req.Longitude,
		OperatorID: req.OperatorID,
	}
	out, err := insertTerminal(ctx, s.db, t)
	if err != nil {
		if dbutil.IsForeignKeyViolation(err) {
			return nil, notFound("city not found")
		}
		return nil, err
	}
	return out, nil
}

func (s *Service) GetTerminal(ctx context.Context, id string) (*Terminal, error) {
	t, err := getTerminal(ctx, s.db, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, notFound("terminal not found")
	}
	return t, err
}

func (s *Service) ListTerminals(ctx context.Context, f TerminalFilter) ([]Terminal, error) {
	return listTerminals(ctx, s.db, f)
}

// PatchTerminal edits location/name/address. Status is intentionally NOT
// patchable here — it goes through SetTerminalStatus's transition guard.
func (s *Service) PatchTerminal(ctx context.Context, id string, p TerminalPatchRequest) (*Terminal, error) {
	if p.CityID == nil && p.Name == nil && p.Address == nil &&
		p.Latitude == nil && p.Longitude == nil {
		return nil, badReq("empty patch")
	}
	t, err := updateTerminal(ctx, s.db, id, p)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, notFound("terminal not found")
		}
		if dbutil.IsForeignKeyViolation(err) {
			return nil, notFound("city not found")
		}
		return nil, err
	}
	return t, nil
}

// SetTerminalStatus moves a terminal through the approval lifecycle. 'merged'
// requires merged_into pointing at a DIFFERENT surviving terminal.
func (s *Service) SetTerminalStatus(ctx context.Context, id, status string, mergedInto *string) error {
	if _, ok := terminalTransitions[status]; !ok {
		return badReq("unknown terminal status: " + status)
	}
	if status == TerminalMerged {
		if mergedInto == nil || *mergedInto == "" {
			return badReq("merged_into is required when merging a terminal")
		}
		if *mergedInto == id {
			return badReq("a terminal cannot be merged into itself")
		}
	} else {
		mergedInto = nil
	}
	cur, err := s.GetTerminal(ctx, id)
	if err != nil {
		return err
	}
	if !canTransitionTerminal(cur.Status, status) {
		return conflict(fmt.Sprintf(
			"terminal cannot move from %s to %s", cur.Status, status))
	}
	if status == TerminalMerged {
		if _, err := s.GetTerminal(ctx, *mergedInto); err != nil {
			return err // surfaces the 404 for the target
		}
	}
	updated, err := setTerminalStatus(ctx, s.db, id, status, mergedInto)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return notFound("terminal not found")
		}
		if dbutil.IsCheckViolation(err) || dbutil.IsForeignKeyViolation(err) {
			return badReq("status transition violates terminal constraints")
		}
		return err
	}
	_ = updated
	return nil
}

// ---------------------------------------------------------------------------
// Route templates
// ---------------------------------------------------------------------------

// usableTerminalStatuses are the approval states a stop may reference. Pending
// is allowed so a provider can draft a route while its terminals await review;
// merged/inactive terminals are tombstones/disabled and reject the write.
var usableTerminalStatuses = map[string]bool{
	TerminalPending:  true,
	TerminalApproved: true,
	TerminalActive:   true,
}

func (s *Service) checkStopTerminals(ctx context.Context, q querier, stops []StopInput) error {
	seen := map[string]bool{}
	ids := make([]string, 0, len(stops))
	for _, st := range stops {
		if !seen[st.TerminalID] {
			seen[st.TerminalID] = true
			ids = append(ids, st.TerminalID)
		}
	}
	statuses, err := terminalStatuses(ctx, q, ids)
	if err != nil {
		return err
	}
	for _, id := range ids {
		status, ok := statuses[id]
		if !ok {
			return notFound("terminal not found: " + id)
		}
		if !usableTerminalStatuses[status] {
			return conflict(fmt.Sprintf(
				"terminal %s is %s and cannot anchor a route stop", id, status))
		}
	}
	return nil
}

// CreateRouteTemplate creates a version-1 directional route with its ordered
// stops in one transaction. The return leg is a SEPARATE template created the
// same way and paired afterwards via LinkReturnRoute.
func (s *Service) CreateRouteTemplate(ctx context.Context, req RouteCreateRequest) (*RouteTemplate, error) {
	if err := validateStops(req.Stops); err != nil {
		return nil, err
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // rollback-after-commit is a no-op

	if err := s.checkStopTerminals(ctx, tx, req.Stops); err != nil {
		return nil, err
	}
	rt := &RouteTemplate{
		ProviderID: req.ProviderID,
		Code:       req.Code,
		Name:       req.Name,
		Version:    1,
		OneWayOnly: req.OneWayOnly,
	}
	created, err := insertRoute(ctx, tx, rt)
	if err != nil {
		if dbutil.IsUniqueViolation(err) {
			return nil, conflict(fmt.Sprintf(
				"route code %q already exists at version 1 for this provider", req.Code))
		}
		return nil, err
	}
	if err := insertStops(ctx, tx, created.ID, req.Stops); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	created.Stops, err = listStops(ctx, s.db, created.ID)
	return created, err
}

// GetRouteTemplate returns one template with its ordered stops.
func (s *Service) GetRouteTemplate(ctx context.Context, id string) (*RouteTemplate, error) {
	rt, err := getRoute(ctx, s.db, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, notFound("route template not found")
	}
	if err != nil {
		return nil, err
	}
	rt.Stops, err = listStops(ctx, s.db, rt.ID)
	return rt, err
}

// ListRouteTemplates lists a provider's templates. latestOnly collapses each
// route code to its highest version — the rows a provider actually edits.
func (s *Service) ListRouteTemplates(ctx context.Context, providerID string, latestOnly bool) ([]RouteTemplate, error) {
	if providerID == "" {
		return nil, badReq("provider_id is required")
	}
	return listRoutes(ctx, s.db, providerID, latestOnly)
}

// ReviseRoute edits name/code/one_way_only and — when Stops is supplied —
// replaces the itinerary. Immutability rule: once any bus_departure pins this
// template row (its itinerary/fare snapshots were frozen from this version),
// the row is NEVER mutated — ReviseRoute instead inserts a new template row at
// version+1 with the revised content, leaving the pinned version intact for
// audit/replay. Before the first departure, in-place edits are fine.
func (s *Service) ReviseRoute(ctx context.Context, routeID string, req RouteReviseRequest) (*RouteTemplate, error) {
	cur, err := s.GetRouteTemplate(ctx, routeID)
	if err != nil {
		return nil, err
	}
	newStops := cur.Stops
	stopsChanged := req.Stops != nil
	if stopsChanged {
		if err := validateStops(req.Stops); err != nil {
			return nil, err
		}
	}
	code, name, oneWay := cur.Code, cur.Name, cur.OneWayOnly
	if req.Code != nil {
		code = *req.Code
	}
	if req.Name != nil {
		name = *req.Name
	}
	if req.OneWayOnly != nil {
		oneWay = *req.OneWayOnly
	}

	inUse, err := s.departureReferencesRoute(ctx, routeID)
	if err != nil {
		return nil, err
	}
	if !inUse {
		// Unreferenced: cheap in-place update, stops swapped inside the tx.
		tx, err := s.db.Begin(ctx)
		if err != nil {
			return nil, err
		}
		defer tx.Rollback(ctx) //nolint:errcheck
		if stopsChanged {
			if err := s.checkStopTerminals(ctx, tx, req.Stops); err != nil {
				return nil, err
			}
			if err := deleteStops(ctx, tx, routeID); err != nil {
				return nil, err
			}
			if err := insertStops(ctx, tx, routeID, req.Stops); err != nil {
				return nil, err
			}
		}
		updated, err := updateRouteMeta(ctx, tx, routeID, code, name, oneWay, cur.ReturnRouteID)
		if err != nil {
			if dbutil.IsUniqueViolation(err) {
				return nil, conflict(fmt.Sprintf(
					"route code %q already exists at version %d for this provider", code, cur.Version))
			}
			return nil, err
		}
		if err := tx.Commit(ctx); err != nil {
			return nil, err
		}
		updated.Stops, err = listStops(ctx, s.db, routeID)
		return updated, err
	}

	// Referenced by departures: bump the version instead of mutating.
	version, err := nextRouteVersion(ctx, s.db, cur.ProviderID, code)
	if err != nil {
		return nil, err
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	inputs := make([]StopInput, len(newStops))
	for i, st := range newStops {
		inputs[i] = StopInput{
			Seq:             st.Seq,
			TerminalID:      st.TerminalID,
			ArriveOffsetMin: st.ArriveOffsetMin,
			DepartOffsetMin: st.DepartOffsetMin,
			BoardAllowed:    st.BoardAllowed,
			AlightAllowed:   st.AlightAllowed,
		}
	}
	if stopsChanged {
		inputs = req.Stops
	}
	if err := s.checkStopTerminals(ctx, tx, inputs); err != nil {
		return nil, err
	}
	created, err := insertRoute(ctx, tx, &RouteTemplate{
		ProviderID: cur.ProviderID,
		Code:       code,
		Name:       name,
		Version:    version,
		OneWayOnly: oneWay,
	})
	if err != nil {
		if dbutil.IsUniqueViolation(err) {
			return nil, conflict("a concurrent revision already bumped this route — reload and retry")
		}
		return nil, err
	}
	if err := insertStops(ctx, tx, created.ID, inputs); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	created.Stops, err = listStops(ctx, s.db, created.ID)
	return created, err
}

// SetRouteActive toggles bookability. This is ALWAYS an in-place update even
// for pinned versions: departures snapshot the itinerary, not the active flag,
// and retiring a route must not require a version bump.
func (s *Service) SetRouteActive(ctx context.Context, routeID string, active bool) (*RouteTemplate, error) {
	rt, err := setRouteActive(ctx, s.db, routeID, active)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, notFound("route template not found")
	}
	return rt, err
}

// LinkReturnRoute pairs two directional templates both ways (to-and-fro).
// Both routes must belong to the same provider, must differ, and a route
// flagged one_way_only refuses pairing until revised — the flag is the
// provider's own declaration that no return exists.
func (s *Service) LinkReturnRoute(ctx context.Context, routeID, returnRouteID string) error {
	if routeID == returnRouteID {
		return badReq("a route cannot be its own return")
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	a, err := getRoute(ctx, tx, routeID)
	if errors.Is(err, pgx.ErrNoRows) {
		return notFound("route template not found")
	}
	if err != nil {
		return err
	}
	b, err := getRoute(ctx, tx, returnRouteID)
	if errors.Is(err, pgx.ErrNoRows) {
		return notFound("return route template not found")
	}
	if err != nil {
		return err
	}
	if a.ProviderID != b.ProviderID {
		return codedErr(http.StatusForbidden, CodeForbidden,
			"cannot pair routes of different providers")
	}
	if a.OneWayOnly || b.OneWayOnly {
		return conflict("a one_way_only route cannot be paired — revise the flag first")
	}
	if a.ReturnRouteID != nil && *a.ReturnRouteID != returnRouteID {
		return conflict("route already paired with a different return")
	}
	if b.ReturnRouteID != nil && *b.ReturnRouteID != routeID {
		return conflict("return route already paired with a different route")
	}
	if _, err := updateRouteMeta(ctx, tx, a.ID, a.Code, a.Name, a.OneWayOnly, &b.ID); err != nil {
		return err
	}
	if _, err := updateRouteMeta(ctx, tx, b.ID, b.Code, b.Name, b.OneWayOnly, &a.ID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ---------------------------------------------------------------------------
// Fare matrix
// ---------------------------------------------------------------------------

// UpsertFare creates or refreshes the fare for one OD pair. Validation runs
// against the route's CURRENT stop list — a fare may only cover sellable
// slices (from < to, boarding allowed at origin, alighting at destination).
// Money rule: amount_kobo is integer minor units, strictly positive.
func (s *Service) UpsertFare(ctx context.Context, routeID string, req FareUpsertRequest) (*RouteFare, error) {
	rt, err := s.GetRouteTemplate(ctx, routeID)
	if err != nil {
		return nil, err
	}
	if req.AmountKobo <= 0 {
		return nil, badReq("amount_kobo must be > 0 (integer kobo, never float)")
	}
	if err := validateODPair(rt.Stops, req.FromSeq, req.ToSeq); err != nil {
		return nil, err
	}
	currency := req.Currency
	if currency == "" {
		currency = "NGN"
	}
	status := req.Status
	if status == "" {
		status = FareActive
	}
	if status != FareDraft && status != FareActive && status != FareRetired {
		return nil, badReq("invalid fare status: " + status)
	}
	from := time.Now().Truncate(24 * time.Hour)
	if req.EffectiveFrom != nil {
		from = req.EffectiveFrom.Truncate(24 * time.Hour)
	}
	if req.EffectiveTo != nil && req.EffectiveTo.Before(from) {
		return nil, badReq("effective_to must not precede effective_from")
	}
	fare, err := upsertFare(ctx, s.db, &RouteFare{
		RouteID:       routeID,
		FromSeq:       req.FromSeq,
		ToSeq:         req.ToSeq,
		AmountKobo:    req.AmountKobo,
		Currency:      currency,
		EffectiveFrom: from,
		EffectiveTo:   req.EffectiveTo,
		Status:        status,
		CreatedBy:     req.CreatedBy,
	})
	if err != nil {
		if dbutil.IsCheckViolation(err) {
			return nil, badReq("fare violates route constraints")
		}
		return nil, err
	}
	return fare, nil
}

// ListFares returns the full fare matrix for a route (all statuses — the
// admin editor needs drafts and history, not just the live rows).
func (s *Service) ListFares(ctx context.Context, routeID string) ([]RouteFare, error) {
	if _, err := s.GetRouteTemplate(ctx, routeID); err != nil {
		return nil, err
	}
	return listFares(ctx, s.db, routeID)
}

// QuoteFare resolves the fare for OD pair + travel date entirely server-side —
// the client never picks a fare row. Invalid OD pairs (from >= to, unsellable
// endpoints) are 400; a missing/expired/non-active fare is 404
// FARE_UNAVAILABLE so the caller can distinguish "can't sell this slice" from
// "no price published".
func (s *Service) QuoteFare(ctx context.Context, routeID string, fromSeq, toSeq int16, travelDate time.Time) (*FareQuote, error) {
	if travelDate.IsZero() {
		return nil, badReq("travel date is required")
	}
	rt, err := s.GetRouteTemplate(ctx, routeID)
	if err != nil {
		return nil, err
	}
	if err := validateODPair(rt.Stops, fromSeq, toSeq); err != nil {
		return nil, err
	}
	candidates, err := loadRouteFaresForQuote(ctx, s.db, routeID, fromSeq, toSeq)
	if err != nil {
		return nil, err
	}
	fare, err := resolveFare(candidates, fromSeq, toSeq, travelDate)
	if err != nil {
		return nil, err
	}
	return &FareQuote{
		RouteID:    routeID,
		FromSeq:    fromSeq,
		ToSeq:      toSeq,
		AmountKobo: fare.AmountKobo,
		Currency:   fare.Currency,
		TravelDate: travelDate.Truncate(24 * time.Hour),
		FareID:     fare.ID,
		ValidFrom:  fare.EffectiveFrom,
		ValidTo:    fare.EffectiveTo,
	}, nil
}

// ---------------------------------------------------------------------------
// Customer departure search
// ---------------------------------------------------------------------------

// SearchDepartures is the customer-facing OD+date read model: which departures
// on a travel date carry a passenger from (state, city) to (state, city).
// Read-only over bus_departure — businventory will consume the same shape when
// it materialises occupancy.
func (s *Service) SearchDepartures(ctx context.Context, req DepartureSearchRequest) ([]DepartureSearchResult, error) {
	if req.OriginState == "" || req.DestState == "" {
		return nil, badReq("origin and destination state codes are required")
	}
	if req.TravelDate.IsZero() {
		return nil, badReq("travel date is required")
	}
	return searchDepartures(ctx, s.db, req)
}
