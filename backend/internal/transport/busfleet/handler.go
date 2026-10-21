package busfleet

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	"spotlight/backend/go-common/timeutil"
)

// Handler exposes the fleet + departure ops over gin. The service is invoked
// with the admin/provider actor id from context; provider-scoping of those
// calls is enforced at route-wiring time alongside the feature flag — the
// router is deliberately NOT wired here.
type Handler struct {
	svc *Service
}

// NewHandler builds the handler around a fleet service.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// respondErr maps a service error to its HTTP status + machine code; anything
// else is a sanitized 500 (never leak internals — AUD-REL-006).
func respondErr(c *gin.Context, err error) {
	var ce *Error
	if errors.As(err, &ce) {
		c.JSON(ce.Status, ce.Body())
		return
	}
	c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
}

func actorOf(c *gin.Context) string { return ginutil.AdminID(c) }

// ─── layouts ────────────────────────────────────────────────────────────────

// CreateLayout — POST /layouts. Creates version 1 of a named seat layout.
func (h *Handler) CreateLayout(c *gin.Context) {
	var req CreateLayoutRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err), "code": CodeValidation})
		return
	}
	l, err := h.svc.CreateLayout(c.Request.Context(), req, actorOf(c))
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, l)
}

// GetLayout — GET /layouts/:id.
func (h *Handler) GetLayout(c *gin.Context) {
	l, err := h.svc.GetLayout(c.Request.Context(), c.Param("id"))
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, l)
}

// ListLayouts — GET /layouts?provider_id=.
func (h *Handler) ListLayouts(c *gin.Context) {
	providerID := c.Query("provider_id")
	if providerID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "provider_id is required", "code": CodeValidation})
		return
	}
	out, err := h.svc.ListLayouts(c.Request.Context(), providerID)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"layouts": out})
}

// NewLayoutVersion — POST /layouts/:id/versions. Body: {"seats": [...] | null}.
// null seats clones the source version's seats verbatim.
func (h *Handler) NewLayoutVersion(c *gin.Context) {
	var body struct {
		Seats []SeatInput `json:"seats"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err), "code": CodeValidation})
		return
	}
	l, err := h.svc.NewLayoutVersion(c.Request.Context(), c.Param("id"), body.Seats, actorOf(c))
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, l)
}

// ─── vehicles ───────────────────────────────────────────────────────────────

// RegisterVehicle — POST /vehicles.
func (h *Handler) RegisterVehicle(c *gin.Context) {
	var req VehicleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err), "code": CodeValidation})
		return
	}
	v, err := h.svc.RegisterVehicle(c.Request.Context(), req, actorOf(c))
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, v)
}

// GetVehicle — GET /vehicles/:id.
func (h *Handler) GetVehicle(c *gin.Context) {
	v, err := h.svc.GetVehicle(c.Request.Context(), c.Param("id"))
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, v)
}

// ListVehicles — GET /vehicles?provider_id=.
func (h *Handler) ListVehicles(c *gin.Context) {
	providerID := c.Query("provider_id")
	if providerID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "provider_id is required", "code": CodeValidation})
		return
	}
	out, err := h.svc.ListVehicles(c.Request.Context(), providerID)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"vehicles": out})
}

// AssignVehicleLayout — PUT /vehicles/:id/layout. Booked-seat guard runs against
// the live occupancy count.
func (h *Handler) AssignVehicleLayout(c *gin.Context) {
	var body struct {
		LayoutID string `json:"layout_id" binding:"required"`
		Reason   string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err), "code": CodeValidation})
		return
	}
	v, err := h.svc.AssignVehicleLayout(c.Request.Context(), c.Param("id"), body.LayoutID,
		h.svc.VehicleBookedSeats, actorOf(c), body.Reason)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, v)
}

// SetVehicleStatus — PATCH /vehicles/:id/status {status, reason}.
func (h *Handler) SetVehicleStatus(c *gin.Context) {
	var body struct {
		Status string `json:"status" binding:"required"`
		Reason string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err), "code": CodeValidation})
		return
	}
	v, err := h.svc.SetVehicleStatus(c.Request.Context(), c.Param("id"), VehicleStatus(body.Status), actorOf(c), body.Reason)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, v)
}

// CanAssignVehicle — POST /vehicles/:id/can-assign {depart_at, arrive_at, turnaround_minutes}.
func (h *Handler) CanAssignVehicle(c *gin.Context) {
	var body struct {
		DepartAt       string `json:"depart_at" binding:"required"`
		ArriveAt       string `json:"arrive_at"`
		TurnaroundMins int    `json:"turnaround_minutes"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err), "code": CodeValidation})
		return
	}
	dep, err := timeutil.ParseTime(body.DepartAt)
	if err != nil || dep.IsZero() {
		c.JSON(http.StatusBadRequest, gin.H{"error": "depart_at must be a timestamp", "code": CodeValidation})
		return
	}
	arr, _ := timeutil.ParseTime(body.ArriveAt)
	ok, conflicts, err := h.svc.CanAssign(c.Request.Context(), c.Param("id"),
		AssignmentWindow{DepartAt: dep, ArriveAt: arr}, body.TurnaroundMins)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"assignable": ok, "conflicts": conflicts})
}

// ─── departures ─────────────────────────────────────────────────────────────

// GenerateDepartures — POST /departures/generate. Idempotent per slot on the
// (route_id, travel_date, depart_at) natural key; replays return created=false.
func (h *Handler) GenerateDepartures(c *gin.Context) {
	var req GenerateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err), "code": CodeValidation})
		return
	}
	out, err := h.svc.GenerateDepartures(c.Request.Context(), req, actorOf(c))
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"departures": out})
}

// GetDeparture — GET /departures/:id.
func (h *Handler) GetDeparture(c *gin.Context) {
	d, err := h.svc.GetDeparture(c.Request.Context(), c.Param("id"))
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, d)
}

// ListDepartures — GET /departures?provider_id=&route_id=&status=&travel_date=&limit=&offset=.
func (h *Handler) ListDepartures(c *gin.Context) {
	limit, offset := ginutil.PageParams(c, 50, 500)
	f := DepartureFilter{
		ProviderID: c.Query("provider_id"),
		RouteID:    c.Query("route_id"),
		Status:     DepartureStatus(c.Query("status")),
		TravelDate: timeutil.ParseDatePtr(c.Query("travel_date")),
		Limit:      limit,
		Offset:     offset,
	}
	out, err := h.svc.ListDepartures(c.Request.Context(), f)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"departures": out})
}

// TransitionDeparture — PATCH /departures/:id/status {status, reason}.
func (h *Handler) TransitionDeparture(c *gin.Context) {
	var body struct {
		Status string `json:"status" binding:"required"`
		Reason string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err), "code": CodeValidation})
		return
	}
	d, err := h.svc.TransitionDeparture(c.Request.Context(), c.Param("id"), DepartureStatus(body.Status), actorOf(c), body.Reason)
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, d)
}

// SwapVehicle — POST /departures/:id/swap-vehicle {new_vehicle_id, seat_remap, reason}.
func (h *Handler) SwapVehicle(c *gin.Context) {
	var req SwapRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err), "code": CodeValidation})
		return
	}
	req.DepartureID = c.Param("id")
	d, err := h.svc.SwapVehicle(c.Request.Context(), req, actorOf(c))
	if err != nil {
		respondErr(c, err)
		return
	}
	c.JSON(http.StatusOK, d)
}
