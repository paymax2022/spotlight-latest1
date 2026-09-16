package restaurant

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// CreateGroupOrder → POST /restaurant/:id/group (host). Body {per_contributor_cap_kobo?}.
func (h *Handler) CreateGroupOrder(c *gin.Context) {
	host := c.GetString("user_id")
	var body struct {
		PerContributorCapKobo int64 `json:"per_contributor_cap_kobo"`
	}
	_ = c.ShouldBindJSON(&body)
	g, err := h.svc.CreateGroupOrder(c.Request.Context(), host, c.Param("id"), body.PerContributorCapKobo)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, g)
}

// AddGroupItem → POST /restaurant/group/:groupId/items (contributor). Body {item_id, quantity}.
func (h *Handler) AddGroupItem(c *gin.Context) {
	contributor := c.GetString("user_id")
	var body struct {
		ItemID   string `json:"item_id" binding:"required"`
		Quantity int    `json:"quantity" binding:"required,min=1"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	it, err := h.svc.AddGroupItem(c.Request.Context(), c.Param("groupId"), contributor, body.ItemID, body.Quantity)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, it)
}

// GetGroupOrder → GET /restaurant/group/:groupId.
func (h *Handler) GetGroupOrder(c *gin.Context) {
	g, err := h.svc.GetGroupOrder(c.Request.Context(), c.Param("groupId"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, g)
}

// FinalizeGroupOrder → POST /restaurant/group/:groupId/finalize (host). Body is a
// PlaceOrderRequest (delivery address/coords/tip/promo…); the items are taken from the group.
func (h *Handler) FinalizeGroupOrder(c *gin.Context) {
	host := c.GetString("user_id")
	var req PlaceOrderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if hk := c.GetHeader("Idempotency-Key"); hk != "" {
		req.IdempotencyKey = hk
	}
	if req.IdempotencyKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Idempotency-Key is required"})
		return
	}
	order, err := h.svc.FinalizeGroupOrder(c.Request.Context(), c.Param("groupId"), host, req)
	if err != nil {
		// Finalize escrows through PlaceOrder, so it inherits that path's money-side
		// refusals (tier gate, insufficient funds) — map them the same way here.
		if code, ok := escrowErrStatus(err); ok {
			c.JSON(code, gin.H{"error": err.Error()})
			return
		}
		c.JSON(statusCodeFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, order)
}

// AdminActivateScheduled → POST /api/restaurant/admin/activate-scheduled (ops). Releases
// due scheduled orders / auto-cancels those whose restaurant is closed at the slot.
func (h *Handler) AdminActivateScheduled(c *gin.Context) {
	released, cancelled, err := h.svc.ActivateScheduledOrders(c.Request.Context(), time.Now())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"released": released, "cancelled": cancelled})
}
