package pharmacy

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// ListProducts GET /pharmacy/products
func (h *Handler) ListProducts(c *gin.Context) {
	var q ListProductsQuery
	q.Category = c.Query("category")
	q.Search = c.Query("search")
	if l, err := strconv.Atoi(c.DefaultQuery("limit", "20")); err == nil {
		q.Limit = l
	}
	if o, err := strconv.Atoi(c.DefaultQuery("offset", "0")); err == nil {
		q.Offset = o
	}
	products, err := h.svc.ListProducts(c.Request.Context(), q)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": products})
}

// GetCart GET /pharmacy/cart
func (h *Handler) GetCart(c *gin.Context) {
	userID := c.GetString("user_id")
	items, err := h.svc.GetCart(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": items})
}

// AddToCart POST /pharmacy/cart
func (h *Handler) AddToCart(c *gin.Context) {
	userID := c.GetString("user_id")
	var req AddToCartRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.IdempotencyKey == "" {
		req.IdempotencyKey = c.GetHeader("Idempotency-Key")
	}
	item, err := h.svc.AddToCart(c.Request.Context(), userID, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": item})
}

// UpdateCartItem PATCH /pharmacy/cart/:product_id
func (h *Handler) UpdateCartItem(c *gin.Context) {
	userID := c.GetString("user_id")
	productID := c.Param("product_id")
	var req UpdateCartItemRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	item, err := h.svc.UpdateCartItem(c.Request.Context(), userID, productID, req.Quantity)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": item})
}

// RemoveFromCart DELETE /pharmacy/cart/:product_id
func (h *Handler) RemoveFromCart(c *gin.Context) {
	userID := c.GetString("user_id")
	if err := h.svc.RemoveFromCart(c.Request.Context(), userID, c.Param("product_id")); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ClearCart DELETE /pharmacy/cart
func (h *Handler) ClearCart(c *gin.Context) {
	userID := c.GetString("user_id")
	if err := h.svc.ClearCart(c.Request.Context(), userID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
