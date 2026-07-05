package extranet

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

// Handler exposes the hotelier extranet routes. RBAC stays.hotelier.* is applied at
// the route by the aggregator; this handler adds the object-level property scope
// check (delegated to the service guard).
type Handler struct {
	svc *Service
}

// NewHandler constructs the extranet handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func uid(c *gin.Context) string { return c.GetString("user_id") }

func mapErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrForbidden):
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
	case errors.Is(err, ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
	}
}

// Register wires the extranet's own routes onto the (RBAC-gated) extranet group.
// ARI + reviews extranet routes are wired by the aggregator alongside these.
func (h *Handler) Register(g *gin.RouterGroup) {
	// Extranet landing — the set of properties the hotelier may act on.
	g.GET("/me/properties", h.MyProperties)

	// Property content.
	g.GET("/properties/:propertyId", h.GetProperty)
	g.PATCH("/properties/:propertyId", h.UpdateContent)
	// Room types + rate plans.
	g.GET("/properties/:propertyId/room-types", h.ListRoomTypes)
	g.POST("/properties/:propertyId/room-types", h.CreateRoomType)
	g.GET("/properties/:propertyId/rate-plans", h.ListRatePlans)
	g.POST("/properties/:propertyId/rate-plans", h.CreateRatePlan)

	// Reservations dashboard.
	g.GET("/properties/:propertyId/reservations", h.ListReservations)
	g.GET("/properties/:propertyId/arrivals", h.Arrivals)
	g.GET("/properties/:propertyId/departures", h.Departures)
	g.GET("/properties/:propertyId/in-house", h.InHouse)
	g.GET("/properties/:propertyId/reservations/:reservationId", h.ReservationDetail)
	g.POST("/properties/:propertyId/reservations/:reservationId/no-show", h.MarkNoShow)
	g.POST("/properties/:propertyId/reservations/:reservationId/cancel", h.CancelByHotel)

	// Messaging stub (guest <-> hotel thread; persistence is a later block).
	g.POST("/properties/:propertyId/reservations/:reservationId/messages", h.SendMessage)
	g.GET("/properties/:propertyId/reservations/:reservationId/messages", h.ListMessages)

	// Finance reads.
	g.GET("/properties/:propertyId/payouts", h.Payouts)
	g.GET("/properties/:propertyId/commission", h.Commission)

	// Analytics.
	g.GET("/properties/:propertyId/analytics", h.Analytics)

	// Account / staff.
	g.GET("/properties/:propertyId/staff", h.ListStaff)
	g.POST("/properties/:propertyId/staff", h.UpsertStaff)
}

// MyProperties: GET /me/properties
func (h *Handler) MyProperties(c *gin.Context) {
	out, err := h.svc.MyProperties(c.Request.Context(), uid(c))
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// GetProperty: GET /properties/:propertyId
func (h *Handler) GetProperty(c *gin.Context) {
	p, err := h.svc.GetProperty(c.Request.Context(), uid(c), c.Param("propertyId"))
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": p})
}

// UpdateContent: PATCH /properties/:propertyId
func (h *Handler) UpdateContent(c *gin.Context) {
	var b struct {
		Name         string `json:"name"`
		Description  string `json:"description"`
		Address      string `json:"address"`
		City         string `json:"city"`
		StarRating   int    `json:"star_rating"`
		PropertyType string `json:"property_type"`
	}
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.UpdateContent(c.Request.Context(), uid(c), c.Param("propertyId"),
		b.Name, b.Description, b.Address, b.City, b.StarRating, b.PropertyType); err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"ok": true}})
}

// ListRoomTypes: GET /properties/:propertyId/room-types
func (h *Handler) ListRoomTypes(c *gin.Context) {
	out, err := h.svc.ListRoomTypes(c.Request.Context(), uid(c), c.Param("propertyId"))
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// CreateRoomType: POST /properties/:propertyId/room-types
func (h *Handler) CreateRoomType(c *gin.Context) {
	var b struct {
		Name      string `json:"name" binding:"required"`
		Occupancy int    `json:"occupancy"`
		Bedding   string `json:"bedding"`
	}
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if b.Occupancy <= 0 {
		b.Occupancy = 2
	}
	id, err := h.svc.CreateRoomType(c.Request.Context(), uid(c), c.Param("propertyId"), b.Name, b.Occupancy, b.Bedding)
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"id": id}})
}

// ListRatePlans: GET /properties/:propertyId/rate-plans
func (h *Handler) ListRatePlans(c *gin.Context) {
	out, err := h.svc.ListRatePlans(c.Request.Context(), uid(c), c.Param("propertyId"))
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// CreateRatePlan: POST /properties/:propertyId/rate-plans
func (h *Handler) CreateRatePlan(c *gin.Context) {
	var b struct {
		RoomTypeID       string `json:"room_type_id" binding:"required"`
		RatePlanType     string `json:"rate_plan_type"`
		Board            string `json:"board"`
		Refundable       bool   `json:"refundable"`
		BaseSellRateKobo int64  `json:"base_sell_rate_kobo"`
		Currency         string `json:"currency"`
	}
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	id, err := h.svc.CreateRatePlan(c.Request.Context(), uid(c), c.Param("propertyId"),
		b.RoomTypeID, b.RatePlanType, b.Board, b.Refundable, b.BaseSellRateKobo, b.Currency)
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"id": id}})
}

// ListReservations: GET /properties/:propertyId/reservations?state&limit&offset
func (h *Handler) ListReservations(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	out, err := h.svc.ListReservations(c.Request.Context(), uid(c), c.Param("propertyId"), c.Query("state"), limit, offset)
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// Arrivals: GET /properties/:propertyId/arrivals?date
func (h *Handler) Arrivals(c *gin.Context) {
	out, err := h.svc.Arrivals(c.Request.Context(), uid(c), c.Param("propertyId"), c.Query("date"))
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// Departures: GET /properties/:propertyId/departures?date
func (h *Handler) Departures(c *gin.Context) {
	out, err := h.svc.Departures(c.Request.Context(), uid(c), c.Param("propertyId"), c.Query("date"))
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// InHouse: GET /properties/:propertyId/in-house?date
func (h *Handler) InHouse(c *gin.Context) {
	out, err := h.svc.InHouse(c.Request.Context(), uid(c), c.Param("propertyId"), c.Query("date"))
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// ReservationDetail: GET /properties/:propertyId/reservations/:reservationId
func (h *Handler) ReservationDetail(c *gin.Context) {
	d, err := h.svc.ReservationDetail(c.Request.Context(), uid(c), c.Param("propertyId"), c.Param("reservationId"))
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": d})
}

// MarkNoShow: POST /properties/:propertyId/reservations/:reservationId/no-show
func (h *Handler) MarkNoShow(c *gin.Context) {
	if err := h.svc.MarkNoShow(c.Request.Context(), uid(c), c.Param("propertyId"), c.Param("reservationId")); err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"ok": true}})
}

// CancelByHotel: POST /properties/:propertyId/reservations/:reservationId/cancel
func (h *Handler) CancelByHotel(c *gin.Context) {
	var b struct {
		Reason string `json:"reason"`
	}
	_ = c.ShouldBindJSON(&b)
	if err := h.svc.CancelByHotel(c.Request.Context(), uid(c), c.Param("propertyId"), c.Param("reservationId"), b.Reason); err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"ok": true}})
}

// SendMessage: POST .../messages — messaging stub (guest<->hotel). Persistence is a
// later block; this acknowledges and object-scopes the request.
func (h *Handler) SendMessage(c *gin.Context) {
	if _, err := h.svc.ReservationDetail(c.Request.Context(), uid(c), c.Param("propertyId"), c.Param("reservationId")); err != nil {
		mapErr(c, err)
		return
	}
	var b struct {
		Body string `json:"body"`
	}
	_ = c.ShouldBindJSON(&b)
	c.JSON(http.StatusAccepted, gin.H{"data": gin.H{"queued": true, "note": "messaging stub"}})
}

// ListMessages: GET .../messages — messaging stub.
func (h *Handler) ListMessages(c *gin.Context) {
	if _, err := h.svc.ReservationDetail(c.Request.Context(), uid(c), c.Param("propertyId"), c.Param("reservationId")); err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": []any{}})
}

// Payouts: GET /properties/:propertyId/payouts
func (h *Handler) Payouts(c *gin.Context) {
	out, err := h.svc.Payouts(c.Request.Context(), uid(c), c.Param("propertyId"))
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// Commission: GET /properties/:propertyId/commission
func (h *Handler) Commission(c *gin.Context) {
	out, err := h.svc.Commission(c.Request.Context(), uid(c), c.Param("propertyId"))
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// Analytics: GET /properties/:propertyId/analytics?from&to
func (h *Handler) Analytics(c *gin.Context) {
	a, err := h.svc.Analytics(c.Request.Context(), uid(c), c.Param("propertyId"), c.Query("from"), c.Query("to"))
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": a})
}

// ListStaff: GET /properties/:propertyId/staff
func (h *Handler) ListStaff(c *gin.Context) {
	out, err := h.svc.ListStaff(c.Request.Context(), uid(c), c.Param("propertyId"))
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// UpsertStaff: POST /properties/:propertyId/staff {user_id, role, status}
func (h *Handler) UpsertStaff(c *gin.Context) {
	var b struct {
		UserID string `json:"user_id" binding:"required"`
		Role   string `json:"role"`
		Status string `json:"status"`
	}
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.UpsertStaff(c.Request.Context(), uid(c), c.Param("propertyId"), b.UserID, b.Role, b.Status); err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"ok": true}})
}
