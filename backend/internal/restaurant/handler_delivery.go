package restaurant

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

// ownerErrStatus maps a store-management service error to an HTTP status: a
// missing store/item/category is 404, everything else (wrong owner, validation)
// is 403/forbidden — mirroring the menu handlers' fail-closed default.
func ownerErrStatus(err error) int {
	if strings.Contains(err.Error(), "not found") {
		return http.StatusNotFound
	}
	return http.StatusForbidden
}

// ── Reads ─────────────────────────────────────────────────────────────────────

// ListRestaurants → GET /restaurant (discovery list of open restaurants).
//
// Paged: ?limit (default 20, max 50) & ?offset, with ?q and ?cuisine applied in
// SQL before the page is cut. It used to return every open row — 2,016 of them —
// and let the client filter in memory; see discovery_page.go for why both moved
// server-side together.
//
// The body still carries `restaurants`, so a client that only reads that key
// keeps working (it simply receives the first page).
func (h *Handler) ListRestaurants(c *gin.Context) {
	page, err := h.svc.ListOpenRestaurantsPage(c.Request.Context(), DiscoveryParams{
		Query:   c.Query("q"),
		Cuisine: c.Query("cuisine"),
		Sort:    c.Query("sort"),
		Limit:   queryInt(c, "limit"),
		Offset:  queryInt(c, "offset"),
		// ?promo=1 backs the "Offers" browse tile.
		PromoOnly: c.Query("promo") == "1" || c.Query("promo") == "true",
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, page)
}

// queryInt reads an optional non-negative integer query param. An absent or
// unparseable value yields 0, which every caller treats as "use the default" —
// a bad ?limit must not 400 a browse request.
func queryInt(c *gin.Context, key string) int {
	n, err := strconv.Atoi(c.Query(key))
	if err != nil || n < 0 {
		return 0
	}
	return n
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

// ── Store management (owner only) ─────────────────────────────────────────────

// Earnings → GET /restaurant/earnings (the caller's food-delivery earnings).
func (h *Handler) Earnings(c *gin.Context) {
	userID := c.GetString("user_id")
	e, err := h.svc.GetMerchantEarnings(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": e})
}

// ListStaff → GET /restaurant/:id/staff
func (h *Handler) ListStaff(c *gin.Context) {
	list, err := h.svc.ListStaff(c.Request.Context(), c.Param("id"), c.GetString("user_id"))
	if err != nil {
		c.JSON(ownerErrStatus(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"staff": list})
}

// InviteStaff → POST /restaurant/:id/staff {user_id, role}
//
// The response carries the invite token ONCE. It is not recoverable afterwards —
// only its hash is stored — so the client must hand it to the invitee there and
// then.
func (h *Handler) InviteStaff(c *gin.Context) {
	var body struct {
		UserID string `json:"user_id" binding:"required"`
		Role   string `json:"role" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	inv, err := h.svc.InviteStaff(c.Request.Context(), c.Param("id"), c.GetString("user_id"),
		body.UserID, StaffRole(body.Role))
	if err != nil {
		c.JSON(ownerErrStatus(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"invite": inv})
}

// SetStaffStatus → PATCH /restaurant/:id/staff/:userId {status}
func (h *Handler) SetStaffStatus(c *gin.Context) {
	var body struct {
		Status string `json:"status" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.SetStaffStatus(c.Request.Context(), c.Param("id"), c.GetString("user_id"),
		c.Param("userId"), StaffStatus(body.Status)); err != nil {
		c.JSON(ownerErrStatus(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// AcceptStaffInvite → POST /restaurant/staff/accept {token}
//
// Not scoped to a restaurant: the token identifies the outlet, and the invitee is
// by definition not yet staff there, so no outlet-level guard could pass.
func (h *Handler) AcceptStaffInvite(c *gin.Context) {
	var body struct {
		Token string `json:"token" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.AcceptStaffInvite(c.Request.Context(), body.Token, c.GetString("user_id")); err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// PayoutReadiness → GET /restaurant/payout-readiness
//
// The capability↔KYB bridge, per outlet: can this shop be paid, why not, and how
// much has already settled behind the gate. Scoped by ownership server-side.
func (h *Handler) PayoutReadiness(c *gin.Context) {
	userID := c.GetString("user_id")
	list, err := h.svc.PayoutReadinessForOwner(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"outlets": list})
}

// MyRestaurants → GET /restaurant/mine (the caller's own stores).
func (h *Handler) MyRestaurants(c *gin.Context) {
	userID := c.GetString("user_id")
	list, err := h.svc.ListMyRestaurants(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": list})
}

// UpdateRestaurant → PATCH /restaurant/:id (edit store profile).
func (h *Handler) UpdateRestaurant(c *gin.Context) {
	userID := c.GetString("user_id")
	var req UpdateRestaurantRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	r, err := h.svc.UpdateRestaurant(c.Request.Context(), c.Param("id"), userID, req)
	if err != nil {
		c.JSON(ownerErrStatus(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, r)
}

// SetAvailability → PATCH /restaurant/:id/availability (merchant open/close).
func (h *Handler) SetAvailability(c *gin.Context) {
	userID := c.GetString("user_id")
	var body struct {
		IsOpen *bool `json:"is_open" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.IsOpen == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "is_open is required"})
		return
	}
	r, err := h.svc.SetAvailability(c.Request.Context(), c.Param("id"), userID, *body.IsOpen)
	if err != nil {
		c.JSON(ownerErrStatus(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, r)
}

// DeleteItem → DELETE /restaurant/:id/menu/items/:itemId.
func (h *Handler) DeleteItem(c *gin.Context) {
	userID := c.GetString("user_id")
	if err := h.svc.DeleteItem(c.Request.Context(), c.Param("id"), userID, c.Param("itemId")); err != nil {
		c.JSON(ownerErrStatus(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"deleted": true})
}

// DeleteCategory → DELETE /restaurant/:id/menu/categories/:categoryId.
func (h *Handler) DeleteCategory(c *gin.Context) {
	userID := c.GetString("user_id")
	if err := h.svc.DeleteCategory(c.Request.Context(), c.Param("id"), userID, c.Param("categoryId")); err != nil {
		c.JSON(ownerErrStatus(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"deleted": true})
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
// ServeUserWS → GET /restaurant/ws — the caller's own realtime stream.
//
// See ADR-049 for the full decision record.
//
// WHY THIS EXISTS
// The hub is keyed by USER id: Realtime.publish resolves an order's participants
// and calls hub.SendToUser(uid, …). ServeOrderWS's :orderId is therefore only an
// authorization gate — once connected you already receive every frame addressed
// to you, for any order. That left the merchant queue unable to hear about a NEW
// order, because subscribing required an order id the merchant did not yet have;
// it polled every 6s instead.
//
// This endpoint drops the order gate and keeps the identity. It cannot widen
// what anyone sees: SendToUser only ever delivers frames already destined for
// this user, so the socket carries exactly the caller's own events — strictly
// narrower than what an order-scoped socket already hands them.
func (h *Handler) ServeUserWS(c *gin.Context) {
	uid := c.GetString("user_id")
	if uid == "" {
		// Same fallback as ServeOrderWS: WS clients cannot set Authorization
		// across the proxy hop, so accept the short-lived HMAC ticket — here one
		// minted for the USER scope rather than for a single order.
		if sub, ok := validateWSTicket(c.Query("ticket"), WSScopeUser); ok {
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
	_ = h.hub.ServeHTTP(c.Writer, c.Request, uid)
}

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
