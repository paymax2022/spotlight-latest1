package ari

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
)

// PropertyAuthorizer is the object-level authZ hook the extranet supplies: it
// returns true when the calling user (uid) holds an ACTIVE hotelier grant on the
// property. ARI handlers resolve the property from the rate-plan / room-type / promo
// then call this — object-level checks live in the service layer (PRD §21), not just
// the RBAC route guard.
type PropertyAuthorizer func(c *gin.Context, propertyID string) bool

// Handler exposes the calendar/ARI/promotions/restrictions/derived-rate routes used
// by the hotelier extranet. Every write resolves the owning property and runs the
// object-level authorizer before mutating.
type Handler struct {
	svc  *Service
	authz PropertyAuthorizer
}

// NewHandler constructs the ARI handler. authz must be non-nil in production; a nil
// authorizer denies all writes (fail-closed).
func NewHandler(svc *Service, authz PropertyAuthorizer) *Handler {
	return &Handler{svc: svc, authz: authz}
}

func (h *Handler) allow(c *gin.Context, propertyID string) bool {
	if h.authz == nil || propertyID == "" {
		return false
	}
	return h.authz(c, propertyID)
}

func ariErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrOversellBlocked):
		c.JSON(http.StatusConflict, gin.H{"error": err.Error(), "code": "OVERSELL_BLOCKED"})
	case errors.Is(err, ErrBadRange):
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
	}
}

// RegisterExtranet wires the ARI routes onto the (already RBAC-gated) extranet group.
// The extranet aggregator applies stays.hotelier.* RBAC at the route; these handlers
// add the object-level property scope check.
func (h *Handler) RegisterExtranet(g *gin.RouterGroup) {
	// Calendar reads.
	g.GET("/rate-plans/:ratePlanId/calendar", h.GetRateCalendar)
	g.GET("/room-types/:roomTypeId/availability", h.GetAvailabilityCalendar)
	// Single-cell writes.
	g.PUT("/rate-plans/:ratePlanId/calendar", h.SetRateDay)
	g.PUT("/room-types/:roomTypeId/availability", h.SetAvailabilityDay)
	// Bulk date-range edits.
	g.POST("/rate-plans/:ratePlanId/calendar/bulk", h.BulkEditRates)
	g.POST("/room-types/:roomTypeId/availability/bulk", h.BulkEditAvailability)
	// Restrictions (min/max LOS, CTA/CTD, stop-sell over a range).
	g.POST("/rate-plans/:ratePlanId/restrictions", h.SetRestrictions)
	// Derived / linked rates (rule-driven cascade).
	g.POST("/rate-plans/:ratePlanId/derive", h.ApplyDerivedRate)
	// Promotions.
	g.GET("/properties/:propertyId/promotions", h.ListPromotions)
	g.POST("/properties/:propertyId/promotions", h.CreatePromotion)
	g.POST("/properties/:propertyId/promotions/:promoId/active", h.SetPromotionActive)
}

// GetRateCalendar: GET /rate-plans/:ratePlanId/calendar?from&to
func (h *Handler) GetRateCalendar(c *gin.Context) {
	rp := c.Param("ratePlanId")
	pid, err := h.svc.PropertyOfRatePlan(c.Request.Context(), rp)
	if err != nil || !h.allow(c, pid) {
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
		return
	}
	days, err := h.svc.RateCalendar(c.Request.Context(), rp, c.Query("from"), c.Query("to"))
	if err != nil {
		ariErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": days})
}

// GetAvailabilityCalendar: GET /room-types/:roomTypeId/availability?from&to
func (h *Handler) GetAvailabilityCalendar(c *gin.Context) {
	rt := c.Param("roomTypeId")
	pid, err := h.svc.PropertyOfRoomType(c.Request.Context(), rt)
	if err != nil || !h.allow(c, pid) {
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
		return
	}
	days, err := h.svc.AvailabilityCalendar(c.Request.Context(), rt, c.Query("from"), c.Query("to"))
	if err != nil {
		ariErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": days})
}

// SetRateDay: PUT /rate-plans/:ratePlanId/calendar {date, price_kobo, ...}
func (h *Handler) SetRateDay(c *gin.Context) {
	rp := c.Param("ratePlanId")
	pid, err := h.svc.PropertyOfRatePlan(c.Request.Context(), rp)
	if err != nil || !h.allow(c, pid) {
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
		return
	}
	var d RateDay
	if err := c.ShouldBindJSON(&d); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	d.RatePlanID = rp
	if err := h.svc.SetRateDay(c.Request.Context(), d); err != nil {
		ariErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"ok": true}})
}

// SetAvailabilityDay: PUT /room-types/:roomTypeId/availability {date, allotment, stop_sell}
func (h *Handler) SetAvailabilityDay(c *gin.Context) {
	rt := c.Param("roomTypeId")
	pid, err := h.svc.PropertyOfRoomType(c.Request.Context(), rt)
	if err != nil || !h.allow(c, pid) {
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
		return
	}
	var d AvailabilityDay
	if err := c.ShouldBindJSON(&d); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	d.RoomTypeID = rt
	if err := h.svc.SetAvailabilityDay(c.Request.Context(), d); err != nil {
		ariErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"ok": true}})
}

// BulkEditRates: POST /rate-plans/:ratePlanId/calendar/bulk {date_from, date_to, ...}
func (h *Handler) BulkEditRates(c *gin.Context) {
	rp := c.Param("ratePlanId")
	pid, err := h.svc.PropertyOfRatePlan(c.Request.Context(), rp)
	if err != nil || !h.allow(c, pid) {
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
		return
	}
	var e BulkEdit
	if err := c.ShouldBindJSON(&e); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	n, err := h.svc.BulkEditRates(c.Request.Context(), rp, e)
	if err != nil {
		ariErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"updated": n}})
}

// BulkEditAvailability: POST /room-types/:roomTypeId/availability/bulk
func (h *Handler) BulkEditAvailability(c *gin.Context) {
	rt := c.Param("roomTypeId")
	pid, err := h.svc.PropertyOfRoomType(c.Request.Context(), rt)
	if err != nil || !h.allow(c, pid) {
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
		return
	}
	var e BulkEdit
	if err := c.ShouldBindJSON(&e); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	n, err := h.svc.BulkEditAvailability(c.Request.Context(), rt, e)
	if err != nil {
		ariErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"updated": n}})
}

// SetRestrictions: POST /rate-plans/:ratePlanId/restrictions {date_from,date_to,min_los,...}
func (h *Handler) SetRestrictions(c *gin.Context) {
	rp := c.Param("ratePlanId")
	pid, err := h.svc.PropertyOfRatePlan(c.Request.Context(), rp)
	if err != nil || !h.allow(c, pid) {
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
		return
	}
	var e BulkEdit
	if err := c.ShouldBindJSON(&e); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	n, err := h.svc.SetRestrictions(c.Request.Context(), rp, e)
	if err != nil {
		ariErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"updated": n}})
}

// ApplyDerivedRate: POST /rate-plans/:ratePlanId/derive
//   {child_rate_plan_id, adjust_bps, fixed_kobo, floor_kobo, from, to}
// The :ratePlanId in the path is the PARENT plan.
func (h *Handler) ApplyDerivedRate(c *gin.Context) {
	parent := c.Param("ratePlanId")
	pid, err := h.svc.PropertyOfRatePlan(c.Request.Context(), parent)
	if err != nil || !h.allow(c, pid) {
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
		return
	}
	var body struct {
		ChildRatePlanID string `json:"child_rate_plan_id" binding:"required"`
		AdjustBps       int    `json:"adjust_bps"`
		FixedKobo       int64  `json:"fixed_kobo"`
		FloorKobo       int64  `json:"floor_kobo"`
		From            string `json:"from" binding:"required"`
		To              string `json:"to" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	// The child plan must belong to the same property (object scope).
	childPid, cerr := h.svc.PropertyOfRatePlan(c.Request.Context(), body.ChildRatePlanID)
	if cerr != nil || childPid != pid {
		c.JSON(http.StatusForbidden, gin.H{"error": "child rate plan not in property"})
		return
	}
	n, err := h.svc.ApplyDerivedRate(c.Request.Context(), DerivedRateRule{
		ParentRatePlanID: parent,
		ChildRatePlanID:  body.ChildRatePlanID,
		AdjustBps:        body.AdjustBps,
		FixedKobo:        body.FixedKobo,
		FloorKobo:        body.FloorKobo,
	}, body.From, body.To)
	if err != nil {
		ariErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"derived": n}})
}

// ListPromotions: GET /properties/:propertyId/promotions
func (h *Handler) ListPromotions(c *gin.Context) {
	pid := c.Param("propertyId")
	if !h.allow(c, pid) {
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
		return
	}
	out, err := h.svc.ListPromotions(c.Request.Context(), pid)
	if err != nil {
		ariErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// CreatePromotion: POST /properties/:propertyId/promotions
func (h *Handler) CreatePromotion(c *gin.Context) {
	pid := c.Param("propertyId")
	if !h.allow(c, pid) {
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
		return
	}
	var p Promotion
	if err := c.ShouldBindJSON(&p); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	p.PropertyID = pid
	id, err := h.svc.CreatePromotion(c.Request.Context(), p)
	if err != nil {
		ariErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"id": id}})
}

// SetPromotionActive: POST /properties/:propertyId/promotions/:promoId/active {active}
func (h *Handler) SetPromotionActive(c *gin.Context) {
	pid := c.Param("propertyId")
	if !h.allow(c, pid) {
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
		return
	}
	var body struct {
		Active bool `json:"active"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.SetPromotionActive(c.Request.Context(), c.Param("promoId"), pid, body.Active); err != nil {
		ariErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"ok": true}})
}
