// Package buscatalog implements the Bus Transport v2 catalog domain:
// shared geography (states/cities/terminals), directional route templates with
// ordered multi-stop itineraries and to-and-fro pairing, and the OD-pair fare
// matrix — plus the customer-facing departure search read model.
//
// It owns ONLY the catalog tables added by migration
// 20271050000000_bus_transport_v2.sql: bus_geo_state, bus_geo_city,
// bus_terminal, bus_route_template, bus_route_stop, bus_route_fare. It also
// READS bus_departure for version-pinning checks and customer search, but never
// mutates it — dated-departure lifecycle lives in the (later) businventory
// module. The legacy bus_* tables remain untouched.
//
// Money rule: all fares are integer kobo (minor units), never floats.
package buscatalog

import (
	"time"
)

// Error codes returned to clients (same {error, code} envelope convention as
// the parent transport package — transport.CodedError is reused verbatim so a
// single respondErr can serve both modules once this is wired in).
const (
	CodeNotFound        = "NOT_FOUND"
	CodeForbidden       = "FORBIDDEN"
	CodeInvalidState    = "INVALID_STATE"
	CodeValidation      = "VALIDATION_FAILED"
	CodeConflict        = "CONFLICT"
	CodeFareUnavailable = "FARE_UNAVAILABLE"
)

// Terminal approval lifecycle (bus_terminal.status CHECK constraint).
const (
	TerminalPending  = "pending"
	TerminalApproved = "approved"
	TerminalActive   = "active"
	TerminalInactive = "inactive"
	TerminalMerged   = "merged"
)

// Fare lifecycle (bus_route_fare.status CHECK constraint).
const (
	FareDraft   = "draft"
	FareActive  = "active"
	FareRetired = "retired"
)

// Departure statuses a customer search may surface (bus_departure.status).
var searchableDepartureStatuses = []string{"scheduled", "published"}

// terminalTransitions is the legal approval-state graph. 'merged' is terminal:
// a merged terminal is a tombstone pointing at merged_into and must never come
// back. Any state may merge (a duplicate can be discovered at any point).
var terminalTransitions = map[string]map[string]bool{
	TerminalPending:  {TerminalApproved: true, TerminalInactive: true, TerminalMerged: true},
	TerminalApproved: {TerminalActive: true, TerminalInactive: true, TerminalMerged: true},
	TerminalActive:   {TerminalInactive: true, TerminalMerged: true},
	TerminalInactive: {TerminalActive: true, TerminalMerged: true},
	TerminalMerged:   {},
}

// GeoState is a row of bus_geo_state (Nigerian states + FCT).
type GeoState struct {
	ID     int16  `json:"id"`
	Code   string `json:"code"` // 'LA','FC','AN', ...
	Name   string `json:"name"`
	Active bool   `json:"active"`
}

// GeoCity is a row of bus_geo_city.
type GeoCity struct {
	ID      string `json:"id"`
	StateID int16  `json:"stateId"`
	Name    string `json:"name"`
	Active  bool   `json:"active"`
}

// Terminal is a bus_terminal row.
type Terminal struct {
	ID         string    `json:"id"`
	CityID     string    `json:"cityId"`
	Name       string    `json:"name"`
	Address    *string   `json:"address,omitempty"`
	Latitude   *float64  `json:"latitude,omitempty"`
	Longitude  *float64  `json:"longitude,omitempty"`
	OperatorID *string   `json:"operatorId,omitempty"` // NULL = platform-owned
	Status     string    `json:"status"`
	MergedInto *string   `json:"mergedInto,omitempty"`
	CreatedAt  time.Time `json:"createdAt"`
	UpdatedAt  time.Time `json:"updatedAt"`
}

// TerminalCreateRequest is POST /terminals.
type TerminalCreateRequest struct {
	CityID     string   `json:"city_id" binding:"required"`
	Name       string   `json:"name" binding:"required,min=2,max=200"`
	Address    *string  `json:"address,omitempty"`
	Latitude   *float64 `json:"latitude,omitempty" binding:"omitempty,min=-90,max=90"`
	Longitude  *float64 `json:"longitude,omitempty" binding:"omitempty,min=-180,max=180"`
	OperatorID *string  `json:"operator_id,omitempty"`
}

// TerminalPatchRequest is PATCH /terminals/:id — nil fields are untouched.
type TerminalPatchRequest struct {
	CityID    *string  `json:"city_id,omitempty"`
	Name      *string  `json:"name,omitempty"`
	Address   *string  `json:"address,omitempty"`
	Latitude  *float64 `json:"latitude,omitempty" binding:"omitempty,min=-90,max=90"`
	Longitude *float64 `json:"longitude,omitempty" binding:"omitempty,min=-180,max=180"`
}

// TerminalStatusRequest is POST /terminals/:id/status.
type TerminalStatusRequest struct {
	Status     string  `json:"status" binding:"required,oneof=pending approved active inactive merged"`
	MergedInto *string `json:"merged_into,omitempty"` // required when status='merged'
}

// TerminalFilter narrows ListTerminals.
type TerminalFilter struct {
	CityID  string // optional
	StateID int16  // optional (via city join); 0 = any
	Status  string // optional; "" = any
	Limit   int
	Offset  int
}

// StopInput is one leg anchor in a route-template create/revise request.
type StopInput struct {
	Seq             int16  `json:"seq" binding:"required,min=1"`
	TerminalID      string `json:"terminal_id" binding:"required"`
	ArriveOffsetMin *int32 `json:"arrive_offset_min,omitempty"`
	DepartOffsetMin int32  `json:"depart_offset_min" binding:"min=0"`
	BoardAllowed    bool   `json:"board_allowed"`
	AlightAllowed   bool   `json:"alight_allowed"`
}

// RouteStop is a bus_route_stop row.
type RouteStop struct {
	ID              string `json:"id"`
	RouteID         string `json:"routeId"`
	Seq             int16  `json:"seq"`
	TerminalID      string `json:"terminalId"`
	ArriveOffsetMin *int32 `json:"arriveOffsetMin,omitempty"`
	DepartOffsetMin int32  `json:"departOffsetMin"`
	BoardAllowed    bool   `json:"boardAllowed"`
	AlightAllowed   bool   `json:"alightAllowed"`
}

// RouteTemplate is a bus_route_template row (one row = one version of one
// directional route; the return leg is a separate row linked both ways).
type RouteTemplate struct {
	ID            string      `json:"id"`
	ProviderID    string      `json:"providerId"`
	Code          string      `json:"code"`
	Name          string      `json:"name"`
	Version       int32       `json:"version"`
	Active        bool        `json:"active"`
	OneWayOnly    bool        `json:"oneWayOnly"`
	ReturnRouteID *string     `json:"returnRouteId,omitempty"`
	Stops         []RouteStop `json:"stops,omitempty"`
	CreatedAt     time.Time   `json:"createdAt"`
	UpdatedAt     time.Time   `json:"updatedAt"`
}

// RouteCreateRequest is POST /routes.
type RouteCreateRequest struct {
	ProviderID string      `json:"provider_id" binding:"required"`
	Code       string      `json:"code" binding:"required,min=2,max=40"`
	Name       string      `json:"name" binding:"required,min=2,max=200"`
	OneWayOnly bool        `json:"one_way_only"`
	Stops      []StopInput `json:"stops" binding:"required,min=2"`
}

// RouteReviseRequest is POST /routes/:id/revise. Stops may be omitted (nil) to
// keep the current itinerary; when supplied they REPLACE the whole stop list.
type RouteReviseRequest struct {
	Code       *string     `json:"code,omitempty" binding:"omitempty,min=2,max=40"`
	Name       *string     `json:"name,omitempty" binding:"omitempty,min=2,max=200"`
	OneWayOnly *bool       `json:"one_way_only,omitempty"`
	Stops      []StopInput `json:"stops,omitempty"`
}

// RouteActiveRequest is POST /routes/:id/active.
type RouteActiveRequest struct {
	Active bool `json:"active"`
}

// LinkReturnRequest is POST /routes/:id/return.
type LinkReturnRequest struct {
	ReturnRouteID string `json:"return_route_id" binding:"required"`
}

// RouteFare is a bus_route_fare row — the price of one OD pair for an
// effective-date range.
type RouteFare struct {
	ID            string     `json:"id"`
	RouteID       string     `json:"routeId"`
	FromSeq       int16      `json:"fromSeq"`
	ToSeq         int16      `json:"toSeq"`
	AmountKobo    int64      `json:"amountKobo"`
	Currency      string     `json:"currency"`
	EffectiveFrom time.Time  `json:"effectiveFrom"`
	EffectiveTo   *time.Time `json:"effectiveTo,omitempty"`
	Status        string     `json:"status"`
	CreatedBy     *string    `json:"createdBy,omitempty"`
	CreatedAt     time.Time  `json:"createdAt"`
}

// FareUpsertRequest is PUT /routes/:id/fares. The natural key
// (route_id, from_seq, to_seq, effective_from) decides insert-vs-update.
type FareUpsertRequest struct {
	FromSeq       int16      `json:"from_seq" binding:"required,min=1"`
	ToSeq         int16      `json:"to_seq" binding:"required,min=1"`
	AmountKobo    int64      `json:"amount_kobo" binding:"required,min=1"`
	Currency      string     `json:"currency,omitempty" binding:"omitempty,len=3"`
	EffectiveFrom *time.Time `json:"effective_from,omitempty"` // nil = today
	EffectiveTo   *time.Time `json:"effective_to,omitempty"`
	Status        string     `json:"status,omitempty" binding:"omitempty,oneof=draft active retired"`
	CreatedBy     *string    `json:"created_by,omitempty"`
}

// FareQuote is the server-side answer to "how much is O→D on this route for
// this travel date" — the resolved active fare plus the resolved OD context.
type FareQuote struct {
	RouteID    string     `json:"routeId"`
	FromSeq    int16      `json:"fromSeq"`
	ToSeq      int16      `json:"toSeq"`
	AmountKobo int64      `json:"amountKobo"`
	Currency   string     `json:"currency"`
	TravelDate time.Time  `json:"travelDate"`
	FareID     string     `json:"fareId"`
	ValidFrom  time.Time  `json:"validFrom"`
	ValidTo    *time.Time `json:"validTo,omitempty"`
}

// DepartureSearchRequest is GET /search — customer-facing OD+date search.
// City names are optional: empty matches any city inside the state.
type DepartureSearchRequest struct {
	OriginState string    // state code, e.g. 'LA' (required)
	OriginCity  string    // city name (optional)
	DestState   string    // required
	DestCity    string    // optional
	TravelDate  time.Time // required
	ProviderID  string    // optional
	Limit       int
	Offset      int
}

// DepartureSearchResult is one sellable OD slice of one departure: a departure
// appears once per matching (origin stop, dest stop) pair.
type DepartureSearchResult struct {
	DepartureID     string    `json:"departureId"`
	ProviderID      string    `json:"providerId"`
	RouteID         string    `json:"routeId"`
	RouteCode       string    `json:"routeCode"`
	RouteName       string    `json:"routeName"`
	RouteVersion    int32     `json:"routeVersion"`
	TravelDate      time.Time `json:"travelDate"`
	DepartAt        time.Time `json:"departAt"`
	Capacity        int16     `json:"capacity"`
	Status          string    `json:"status"`
	FromSeq         int16     `json:"fromSeq"`
	ToSeq           int16     `json:"toSeq"`
	OriginTerminal  string    `json:"originTerminal"`
	DestTerminal    string    `json:"destTerminal"`
	OriginCity      string    `json:"originCity"`
	DestCity        string    `json:"destCity"`
	OriginStateCode string    `json:"originStateCode"`
	DestStateCode   string    `json:"destStateCode"`
}
