package buscatalog

// handler.go — gin handler surface for the bus catalog. These methods are NOT
// wired into the main router yet (integration happens with the businventory
// follow-up); they are exposed so the route table can be assembled in one
// place, mirroring transport.Handler's shape (svc field, respondErr mapping,
// ginutil/httperr conventions).

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	"spotlight/backend/go-common/timeutil"
	"spotlight/backend/internal/transport"
)

// Handler exposes the catalog endpoints.
type Handler struct {
	svc *Service
}

// NewHandler wires the handler over the catalog service.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// respondErr maps a service error to the right HTTP status + machine code —
// the same convention as transport.respondErr: a transport.CodedError carries
// its status/code verbatim, anything else is a sanitised 500.
func respondErr(c *gin.Context, err error) {
	var ce *transport.CodedError
	if errors.As(err, &ce) {
		c.JSON(ce.Status, ce.Body())
		return
	}
	c.JSON(http.StatusInternalServerError,
		gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
}

func badBind(c *gin.Context, err error) {
	c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
}

func intParam(c *gin.Context, name string, def int) int {
	v, err := strconv.Atoi(c.Query(name))
	if err != nil {
		return def
	}
	return v
}

func int16Param(c *gin.Context, name string) int16 {
	v, _ := strconv.ParseInt(c.Query(name), 10, 16)
	return int16(v)
}

// ---------------------------------------------------------------------------
// Geography
// ---------------------------------------------------------------------------

// ListGeoStates serves GET .../geo/states.
func (h *Handler) ListGeoStates(c *gin.Context) {
	states, err := h.svc.ListStates(c.Request.Context())
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"states": states})
}

// ListGeoCities serves GET .../geo/cities?state_id=.
func (h *Handler) ListGeoCities(c *gin.Context) {
	cities, err := h.svc.ListCities(c.Request.Context(), int16Param(c, "state_id"))
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"cities": cities})
}

// ---------------------------------------------------------------------------
// Terminals
// ---------------------------------------------------------------------------

// CreateTerminal serves POST .../terminals.
func (h *Handler) CreateTerminal(c *gin.Context) {
	var req TerminalCreateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		badBind(c, err)
		return
	}
	t, err := h.svc.CreateTerminal(c.Request.Context(), req)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"terminal": t})
}

// ListTerminals serves GET .../terminals?city_id=&state_id=&status=.
func (h *Handler) ListTerminals(c *gin.Context) {
	ts, err := h.svc.ListTerminals(c.Request.Context(), TerminalFilter{
		CityID:  c.Query("city_id"),
		StateID: int16Param(c, "state_id"),
		Status:  c.Query("status"),
		Limit:   intParam(c, "limit", 200),
		Offset:  intParam(c, "offset", 0),
	})
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"terminals": ts})
}

// GetTerminal serves GET .../terminals/:id.
func (h *Handler) GetTerminal(c *gin.Context) {
	t, err := h.svc.GetTerminal(c.Request.Context(), c.Param("id"))
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"terminal": t})
}

// PatchTerminal serves PATCH .../terminals/:id.
func (h *Handler) PatchTerminal(c *gin.Context) {
	var req TerminalPatchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		badBind(c, err)
		return
	}
	t, err := h.svc.PatchTerminal(c.Request.Context(), c.Param("id"), req)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"terminal": t})
}

// SetTerminalStatus serves POST .../terminals/:id/status
// {status, merged_into?} — the approval lifecycle move.
func (h *Handler) SetTerminalStatus(c *gin.Context) {
	var req TerminalStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		badBind(c, err)
		return
	}
	if err := h.svc.SetTerminalStatus(c.Request.Context(),
		c.Param("id"), req.Status, req.MergedInto); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "status": req.Status})
}

// ---------------------------------------------------------------------------
// Route templates
// ---------------------------------------------------------------------------

// CreateRoute serves POST .../routes. provider_id rides in the body for now;
// the router-wiring step will resolve it from the authenticated provider
// session instead.
func (h *Handler) CreateRoute(c *gin.Context) {
	var req RouteCreateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		badBind(c, err)
		return
	}
	rt, err := h.svc.CreateRouteTemplate(c.Request.Context(), req)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"route": rt})
}

// GetRoute serves GET .../routes/:id (with ordered stops).
func (h *Handler) GetRoute(c *gin.Context) {
	rt, err := h.svc.GetRouteTemplate(c.Request.Context(), c.Param("id"))
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"route": rt})
}

// ListRoutes serves GET .../routes?provider_id=&latest=.
func (h *Handler) ListRoutes(c *gin.Context) {
	latest := strings.EqualFold(c.Query("latest"), "true") || c.Query("latest") == "1"
	rts, err := h.svc.ListRouteTemplates(c.Request.Context(), c.Query("provider_id"), latest)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"routes": rts})
}

// ReviseRoute serves POST .../routes/:id/revise — in-place edit before the
// first departure pins the version; an automatic version bump afterwards.
func (h *Handler) ReviseRoute(c *gin.Context) {
	var req RouteReviseRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		badBind(c, err)
		return
	}
	rt, err := h.svc.ReviseRoute(c.Request.Context(), c.Param("id"), req)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"route": rt})
}

// SetRouteActive serves POST .../routes/:id/active {active}.
func (h *Handler) SetRouteActive(c *gin.Context) {
	var req RouteActiveRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		badBind(c, err)
		return
	}
	rt, err := h.svc.SetRouteActive(c.Request.Context(), c.Param("id"), req.Active)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"route": rt})
}

// LinkReturnRoute serves POST .../routes/:id/return {return_route_id} —
// pairs two directional templates both ways.
func (h *Handler) LinkReturnRoute(c *gin.Context) {
	var req LinkReturnRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		badBind(c, err)
		return
	}
	if err := h.svc.LinkReturnRoute(c.Request.Context(),
		c.Param("id"), req.ReturnRouteID); err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "return_route_id": req.ReturnRouteID})
}

// ---------------------------------------------------------------------------
// Fares
// ---------------------------------------------------------------------------

// UpsertFare serves PUT .../routes/:id/fares.
func (h *Handler) UpsertFare(c *gin.Context) {
	var req FareUpsertRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		badBind(c, err)
		return
	}
	// The admin user id doubles as created_by when wired through auth; the
	// request field remains an explicit override for service-account callers.
	if req.CreatedBy == nil {
		if uid := ginutil.UserID(c); uid != "" {
			req.CreatedBy = &uid
		}
	}
	f, err := h.svc.UpsertFare(c.Request.Context(), c.Param("id"), req)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"fare": f})
}

// ListFares serves GET .../routes/:id/fares.
func (h *Handler) ListFares(c *gin.Context) {
	fs, err := h.svc.ListFares(c.Request.Context(), c.Param("id"))
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"fares": fs})
}

// QuoteFare serves GET .../routes/:id/quote?from_seq=&to_seq=&date= —
// the server-side fare resolution a booking flow calls before any money move.
func (h *Handler) QuoteFare(c *gin.Context) {
	date, err := timeutil.ParseDate(c.Query("date"))
	if err != nil || date.IsZero() {
		c.JSON(http.StatusBadRequest, gin.H{"error": "date (YYYY-MM-DD) is required"})
		return
	}
	q, err := h.svc.QuoteFare(c.Request.Context(), c.Param("id"),
		int16Param(c, "from_seq"), int16Param(c, "to_seq"), date)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"quote": q})
}

// ---------------------------------------------------------------------------
// Customer search
// ---------------------------------------------------------------------------

// SearchDepartures serves GET .../search?origin_state=&origin_city=
// &dest_state=&dest_city=&date=&provider_id=.
func (h *Handler) SearchDepartures(c *gin.Context) {
	date, err := timeutil.ParseDate(c.Query("date"))
	if err != nil || date.IsZero() {
		c.JSON(http.StatusBadRequest, gin.H{"error": "date (YYYY-MM-DD) is required"})
		return
	}
	results, err := h.svc.SearchDepartures(c.Request.Context(), DepartureSearchRequest{
		OriginState: c.Query("origin_state"),
		OriginCity:  c.Query("origin_city"),
		DestState:   c.Query("dest_state"),
		DestCity:    c.Query("dest_city"),
		TravelDate:  date,
		ProviderID:  c.Query("provider_id"),
		Limit:       intParam(c, "limit", 50),
		Offset:      intParam(c, "offset", 0),
	})
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"departures": results})
}
