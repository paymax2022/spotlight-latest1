package restaurant

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// ── Reads ─────────────────────────────────────────────────────────────────────

// ListRestaurants → GET /restaurant (discovery list of open restaurants).
func (h *Handler) ListRestaurants(c *gin.Context) {
	list, err := h.svc.ListOpenRestaurants(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"restaurants": list})
}

// GetRestaurant → GET /restaurant/:id (restaurant detail + menu).
func (h *Handler) GetRestaurant(c *gin.Context) {
	detail, err := h.svc.GetRestaurantDetail(c.Request.Context(), c.Param("id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, detail)
}

// GetOrder → GET /restaurant/orders/:orderId (participant-scoped).
func (h *Handler) GetOrder(c *gin.Context) {
	userID := c.GetString("user_id")
	o, err := h.svc.GetOrder(c.Request.Context(), c.Param("orderId"), userID)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, o)
}

// ListOrders → GET /restaurant/orders?role=customer|restaurant|rider.
func (h *Handler) ListOrders(c *gin.Context) {
	userID := c.GetString("user_id")
	role := c.DefaultQuery("role", "customer")
	orders, err := h.svc.ListOrders(c.Request.Context(), userID, role)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"orders": orders})
}

// ── Menu management (owner only) ──────────────────────────────────────────────

// CreateCategory → POST /restaurant/:id/menu/categories.
func (h *Handler) CreateCategory(c *gin.Context) {
	userID := c.GetString("user_id")
	var body struct {
		Name string `json:"name" binding:"required,min=1,max=200"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	cat, err := h.svc.CreateCategory(c.Request.Context(), c.Param("id"), userID, body.Name)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, cat)
}

// CreateItem → POST /restaurant/:id/menu/items.
func (h *Handler) CreateItem(c *gin.Context) {
	userID := c.GetString("user_id")
	var req CreateItemRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	it, err := h.svc.CreateItem(c.Request.Context(), c.Param("id"), userID, req)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, it)
}

// UpdateItem → PATCH /restaurant/:id/menu/items/:itemId (price/availability).
func (h *Handler) UpdateItem(c *gin.Context) {
	userID := c.GetString("user_id")
	var req UpdateItemRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	it, err := h.svc.UpdateItem(c.Request.Context(), c.Param("id"), userID, c.Param("itemId"), req)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, it)
}

// ── Menu-item modifiers ───────────────────────────────────────────────────────

// ListItemModifierGroups → GET /restaurant/:id/menu/items/:itemId/modifier-groups.
// Public read for clients rendering an item's options.
func (h *Handler) ListItemModifierGroups(c *gin.Context) {
	groups, err := h.svc.ListItemModifierGroups(c.Request.Context(), c.Param("itemId"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"groups": groups})
}

// CreateModifierGroup → POST /restaurant/:id/menu/items/:itemId/modifier-groups (owner).
func (h *Handler) CreateModifierGroup(c *gin.Context) {
	userID := c.GetString("user_id")
	var req CreateModifierGroupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	g, err := h.svc.CreateModifierGroup(c.Request.Context(), c.Param("id"), userID, c.Param("itemId"), req)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, g)
}

// AddModifier → POST /restaurant/:id/menu/modifier-groups/:groupId/modifiers (owner).
func (h *Handler) AddModifier(c *gin.Context) {
	userID := c.GetString("user_id")
	var req AddModifierRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	m, err := h.svc.AddModifier(c.Request.Context(), c.Param("id"), userID, c.Param("groupId"), req)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, m)
}

// ── Promos ────────────────────────────────────────────────────────────────────

// CreatePromo → POST /restaurant/:id/promos (owner). Creates a restaurant-funded promo.
func (h *Handler) CreatePromo(c *gin.Context) {
	userID := c.GetString("user_id")
	var req CreatePromoRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	p, err := h.svc.CreatePromo(c.Request.Context(), c.Param("id"), userID, req)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, p)
}

// ── Business hours ────────────────────────────────────────────────────────────

// GetBusinessHours → GET /restaurant/:id/hours. Public: weekly schedule + open-now.
func (h *Handler) GetBusinessHours(c *gin.Context) {
	st, err := h.svc.GetBusinessHours(c.Request.Context(), c.Param("id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, st)
}

// SetBusinessHours → PUT /restaurant/:id/hours (owner). Replaces the whole schedule.
func (h *Handler) SetBusinessHours(c *gin.Context) {
	userID := c.GetString("user_id")
	var body struct {
		Windows []BusinessHourInput `json:"windows"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	hours, err := h.svc.SetBusinessHours(c.Request.Context(), c.Param("id"), userID, body.Windows)
	if err != nil {
		// Owner-check failures are 403; validation failures are 400.
		code := http.StatusBadRequest
		if err.Error() == "restaurant: only the owner may manage the menu" || err.Error() == "restaurant: not found" {
			code = http.StatusForbidden
		}
		c.JSON(code, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"windows": hours})
}

// ── Rider / delivery lifecycle ────────────────────────────────────────────────

// AssignRider → POST /restaurant/orders/:orderId/assign (owner offers a rider).
func (h *Handler) AssignRider(c *gin.Context) {
	actorID := c.GetString("user_id")
	var body struct {
		RiderID string `json:"rider_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.AssignRider(c.Request.Context(), c.Param("orderId"), actorID, body.RiderID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// AcceptDelivery → POST /restaurant/orders/:orderId/accept (rider accepts).
func (h *Handler) AcceptDelivery(c *gin.Context) {
	riderID := c.GetString("user_id")
	if err := h.svc.AcceptDelivery(c.Request.Context(), c.Param("orderId"), riderID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ConfirmPickup → POST /restaurant/orders/:orderId/pickup (assigned rider picks up).
func (h *Handler) ConfirmPickup(c *gin.Context) {
	riderID := c.GetString("user_id")
	if err := h.svc.ConfirmPickup(c.Request.Context(), c.Param("orderId"), riderID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ConfirmHandoff → POST /restaurant/orders/:orderId/handoff {code} (rider hands
// off at the destination; the customer's delivery code proves the handoff and
// settles the order).
func (h *Handler) ConfirmHandoff(c *gin.Context) {
	riderID := c.GetString("user_id")
	var body struct {
		Code string `json:"code" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.ConfirmHandoff(c.Request.Context(), c.Param("orderId"), riderID, body.Code); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// Redispatch → POST /restaurant/orders/:orderId/dispatch (owner re-runs rider
// sourcing for a ready order that hasn't been claimed yet).
func (h *Handler) Redispatch(c *gin.Context) {
	actorID := c.GetString("user_id")
	_, owner, _, err := h.svc.OrderParties(c.Request.Context(), c.Param("orderId"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	if actorID != owner {
		c.JSON(http.StatusForbidden, gin.H{"error": "only the restaurant may re-dispatch"})
		return
	}
	if err := h.svc.DispatchOrder(c.Request.Context(), c.Param("orderId")); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// PostLocation → POST /restaurant/orders/:orderId/location (rider posts {lat,lng}).
func (h *Handler) PostLocation(c *gin.Context) {
	riderID := c.GetString("user_id")
	var body struct {
		Lat float64 `json:"lat" binding:"required"`
		Lng float64 `json:"lng" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.PostLocation(c.Request.Context(), c.Param("orderId"), riderID, body.Lat, body.Lng); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusAccepted, gin.H{"ok": true})
}

// RiderOffers → GET /restaurant/rider/offers.
func (h *Handler) RiderOffers(c *gin.Context) {
	riderID := c.GetString("user_id")
	offers, err := h.svc.RiderOffers(c.Request.Context(), riderID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"offers": offers})
}

// RiderActive → GET /restaurant/rider/active.
func (h *Handler) RiderActive(c *gin.Context) {
	riderID := c.GetString("user_id")
	active, err := h.svc.RiderActive(c.Request.Context(), riderID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"deliveries": active})
}

// ── Chat ──────────────────────────────────────────────────────────────────────

// ListMessages → GET /restaurant/orders/:orderId/messages.
func (h *Handler) ListMessages(c *gin.Context) {
	userID := c.GetString("user_id")
	msgs, err := h.svc.ListMessages(c.Request.Context(), c.Param("orderId"), userID)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"messages": msgs})
}

// SendMessage → POST /restaurant/orders/:orderId/messages.
func (h *Handler) SendMessage(c *gin.Context) {
	userID := c.GetString("user_id")
	var req SendMessageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	m, err := h.svc.SendMessage(c.Request.Context(), c.Param("orderId"), userID, req)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, m)
}

// ── Ratings ───────────────────────────────────────────────────────────────────

// RateOrder → POST /restaurant/orders/:orderId/rate.
func (h *Handler) RateOrder(c *gin.Context) {
	userID := c.GetString("user_id")
	var req RateOrderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	r, err := h.svc.RateOrder(c.Request.Context(), c.Param("orderId"), userID, req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, r)
}

// ── Realtime ──────────────────────────────────────────────────────────────────

// ServeOrderWS → GET /restaurant/orders/:orderId/ws. Upgrades to a WebSocket on
// the authenticated user's channel. The user must be a participant of the order;
// the server pushes "order.status", "order.location", and "order.message"
// events for orders the user participates in (delivery is per-user, so no
// per-order subscription is needed).
func (h *Handler) ServeOrderWS(c *gin.Context) {
	uid := c.GetString("user_id")
	if uid == "" {
		// No Bearer (WS clients can't set Authorization across the proxy): fall back
		// to the short-lived HMAC ticket minted by frontend-web for THIS order.
		if sub, ok := validateWSTicket(c.Query("ticket"), c.Param("orderId")); ok {
			uid = sub
		}
	}
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	if h.hub == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "realtime not configured"})
		return
	}
	ok, _, err := h.svc.isParticipant(c.Request.Context(), c.Param("orderId"), uid)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	if !ok {
		c.JSON(http.StatusForbidden, gin.H{"error": "not a participant of this order"})
		return
	}
	_ = h.hub.ServeHTTP(c.Writer, c.Request, uid)
}
