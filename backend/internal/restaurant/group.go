package restaurant

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
)

const keyIdempotencyKeyIsRequired = "Idempotency-Key is required"

// GroupOrder is a shared cart multiple people contribute to; the host finalizes it into
// one order (SG-003/004). Payment is host-paid on finalize — a single escrow. (Per-
// contributor payment SPLIT is a separate multi-payer escrow design, tracked as a
// follow-up; per-contributor spend LIMITS are enforced here.)
type GroupOrder struct {
	ID                    string           `json:"id"`
	HostID                string           `json:"host_id"`
	RestaurantID          string           `json:"restaurant_id"`
	Status                string           `json:"status"`
	PerContributorCapKobo int64            `json:"per_contributor_cap_kobo"`
	OrderID               *string          `json:"order_id,omitempty"`
	Items                 []GroupOrderItem `json:"items,omitempty"`
}

// GroupOrderItem is one contributor's line in the shared cart.
type GroupOrderItem struct {
	ID            string `json:"id"`
	ContributorID string `json:"contributor_id"`
	MenuItemID    string `json:"menu_item_id"`
	Name          string `json:"name"`
	PriceKobo     int64  `json:"price_kobo"`
	Quantity      int    `json:"quantity"`
}

// CreateGroupOrder opens a shared cart for a restaurant (any user is the host). capKobo
// (0 = no cap) is the per-contributor spend limit (SG-004).
func (s *Service) CreateGroupOrder(ctx context.Context, hostID, restaurantID string, capKobo int64) (*GroupOrder, error) {
	if capKobo < 0 {
		return nil, fmt.Errorf("restaurant: per_contributor_cap_kobo must be >= 0")
	}
	var exists bool
	if err := s.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM restaurants WHERE id=$1)`, restaurantID).Scan(&exists); err != nil || !exists {
		return nil, fmt.Errorf("restaurant: not found")
	}
	g := &GroupOrder{ID: uuid.New().String(), HostID: hostID, RestaurantID: restaurantID, Status: "open", PerContributorCapKobo: capKobo}
	if _, err := s.db.Exec(ctx,
		`INSERT INTO group_orders (id, host_id, restaurant_id, status, per_contributor_cap_kobo)
		 VALUES ($1,$2,$3,'open',$4)`, g.ID, hostID, restaurantID, capKobo); err != nil {
		return nil, err
	}
	return g, nil
}

// AddGroupItem lets a contributor add an item to an open group (SG-003). Enforces the
// group is open, the item belongs to the group's restaurant + is available, and the
// contributor's running total stays within the per-contributor cap (SG-004).
func (s *Service) AddGroupItem(ctx context.Context, groupID, contributorID, menuItemID string, quantity int) (*GroupOrderItem, error) {
	if quantity < 1 {
		return nil, fmt.Errorf("restaurant: quantity must be >= 1")
	}
	var restaurantID, status string
	var cap int64
	if err := s.db.QueryRow(ctx, `SELECT restaurant_id, status, per_contributor_cap_kobo FROM group_orders WHERE id=$1`, groupID).Scan(&restaurantID, &status, &cap); err != nil {
		return nil, fmt.Errorf("restaurant: group not found")
	}
	if status != "open" {
		return nil, fmt.Errorf("restaurant: group is %s (not accepting items)", status)
	}
	var name string
	var price int64
	var available bool
	if err := s.db.QueryRow(ctx, `SELECT name, price_kobo, is_available FROM menu_items WHERE id=$1 AND restaurant_id=$2`, menuItemID, restaurantID).Scan(&name, &price, &available); err != nil {
		return nil, fmt.Errorf("restaurant: item not on this restaurant's menu")
	}
	if !available {
		return nil, fmt.Errorf("restaurant: item '%s' is not available", name)
	}
	if cap > 0 {
		var spent int64
		_ = s.db.QueryRow(ctx, `SELECT COALESCE(SUM(price_kobo*quantity),0) FROM group_order_items WHERE group_id=$1 AND contributor_id=$2`, groupID, contributorID).Scan(&spent)
		if spent+price*int64(quantity) > cap {
			return nil, fmt.Errorf("restaurant: this addition exceeds your per-person cap of %d kobo", cap)
		}
	}
	it := &GroupOrderItem{ID: uuid.New().String(), ContributorID: contributorID, MenuItemID: menuItemID, Name: name, PriceKobo: price, Quantity: quantity}
	if _, err := s.db.Exec(ctx,
		`INSERT INTO group_order_items (id, group_id, contributor_id, menu_item_id, name, price_kobo, quantity)
		 VALUES ($1,$2,$3,$4,$5,$6,$7)`, it.ID, groupID, contributorID, menuItemID, name, price, quantity); err != nil {
		return nil, err
	}
	return it, nil
}

// GetGroupOrder returns a group + its items.
func (s *Service) GetGroupOrder(ctx context.Context, groupID string) (*GroupOrder, error) {
	var g GroupOrder
	if err := s.db.QueryRow(ctx,
		`SELECT id, host_id, restaurant_id, status, per_contributor_cap_kobo, order_id FROM group_orders WHERE id=$1`, groupID).
		Scan(&g.ID, &g.HostID, &g.RestaurantID, &g.Status, &g.PerContributorCapKobo, &g.OrderID); err != nil {
		return nil, fmt.Errorf("restaurant: group not found")
	}
	rows, err := s.db.Query(ctx, `SELECT id, contributor_id, menu_item_id, name, price_kobo, quantity FROM group_order_items WHERE group_id=$1 ORDER BY created_at`, groupID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var it GroupOrderItem
		if err := rows.Scan(&it.ID, &it.ContributorID, &it.MenuItemID, &it.Name, &it.PriceKobo, &it.Quantity); err != nil {
			return nil, err
		}
		g.Items = append(g.Items, it)
	}
	return &g, rows.Err()
}

// FinalizeGroupOrder — the HOST closes the group and places ONE order for all items,
// paying/escrowing as the customer (SG-003). The group must be open and non-empty. The
// aggregated items flow through the normal PlaceOrder pricing/escrow/tier/zone gates.
func (s *Service) FinalizeGroupOrder(ctx context.Context, groupID, hostID string, req PlaceOrderRequest) (*Order, error) {
	g, err := s.GetGroupOrder(ctx, groupID)
	if err != nil {
		return nil, err
	}
	if g.HostID != hostID {
		return nil, ErrForbidden
	}
	if g.Status != "open" {
		return nil, fmt.Errorf("restaurant: group is already %s", g.Status)
	}
	if len(g.Items) == 0 {
		return nil, fmt.Errorf("restaurant: the group cart is empty")
	}
	// Lock the group so no more items land while we place the order.
	if _, err := s.db.Exec(ctx, `UPDATE group_orders SET status='locked', updated_at=now() WHERE id=$1 AND status='open'`, groupID); err != nil {
		return nil, err
	}
	// Build the single order request from the aggregated group items.
	req.Items = req.Items[:0]
	for _, it := range g.Items {
		req.Items = append(req.Items, OrderItemInput{MenuItemID: it.MenuItemID, Quantity: it.Quantity})
	}
	order, perr := s.PlaceOrder(ctx, g.RestaurantID, hostID, req)
	if perr != nil {
		// Re-open on failure so the group isn't wedged.
		_, _ = s.db.Exec(ctx, `UPDATE group_orders SET status='open', updated_at=now() WHERE id=$1`, groupID)
		return nil, perr
	}
	_, _ = s.db.Exec(ctx, `UPDATE group_orders SET status='placed', order_id=$2, updated_at=now() WHERE id=$1`, groupID, order.ID)
	return order, nil
}

// CreateGroupOrder → POST /restaurant/:id/group (host). Body {per_contributor_cap_kobo?}.
func (h *Handler) CreateGroupOrder(c *gin.Context) {
	host := ginutil.UserID(c)
	var body struct {
		PerContributorCapKobo int64 `json:"per_contributor_cap_kobo"`
	}
	_ = c.ShouldBindJSON(&body)
	g, err := h.svc.CreateGroupOrder(c.Request.Context(), host, c.Param("id"), body.PerContributorCapKobo)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	c.JSON(http.StatusCreated, g)
}

// AddGroupItem → POST /restaurant/group/:groupId/items (contributor). Body {item_id, quantity}.
func (h *Handler) AddGroupItem(c *gin.Context) {
	contributor := ginutil.UserID(c)
	var body struct {
		ItemID   string `json:"item_id" binding:"required"`
		Quantity int    `json:"quantity" binding:"required,min=1"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	it, err := h.svc.AddGroupItem(c.Request.Context(), c.Param("groupId"), contributor, body.ItemID, body.Quantity)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	c.JSON(http.StatusCreated, it)
}

// GetGroupOrder → GET /restaurant/group/:groupId.
func (h *Handler) GetGroupOrder(c *gin.Context) {
	g, err := h.svc.GetGroupOrder(c.Request.Context(), c.Param("groupId"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{keyError: httperr.Msg(c, http.StatusNotFound, err)})
		return
	}
	c.JSON(http.StatusOK, g)
}

// FinalizeGroupOrder → POST /restaurant/group/:groupId/finalize (host). Body is a
// PlaceOrderRequest (delivery address/coords/tip/promo…); the items are taken from the group.
func (h *Handler) FinalizeGroupOrder(c *gin.Context) {
	host := ginutil.UserID(c)
	var req PlaceOrderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	if hk := ginutil.IdempotencyKey(c); hk != "" {
		req.IdempotencyKey = hk
	}
	if req.IdempotencyKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{keyError: keyIdempotencyKeyIsRequired})
		return
	}
	order, err := h.svc.FinalizeGroupOrder(c.Request.Context(), c.Param("groupId"), host, req)
	if err != nil {
		// Finalize escrows through PlaceOrder, so it inherits that path's money-side
		// refusals (tier gate, insufficient funds) — map them the same way here.
		if code, ok := escrowErrStatus(err); ok {
			c.JSON(code, gin.H{keyError: httperr.Msg(c, code, err)})
			return
		}
		c.JSON(statusCodeFor(err), gin.H{keyError: httperr.Msg(c, statusCodeFor(err), err)})
		return
	}
	c.JSON(http.StatusCreated, order)
}

// AdminActivateScheduled → POST /api/restaurant/admin/activate-scheduled (ops). Releases
// due scheduled orders / auto-cancels those whose restaurant is closed at the slot.
func (h *Handler) AdminActivateScheduled(c *gin.Context) {
	released, cancelled, err := h.svc.ActivateScheduledOrders(c.Request.Context(), time.Now())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"released": released, "cancelled": cancelled})
}
