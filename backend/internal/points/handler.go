package points

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

// Handler exposes read-only points endpoints to members. Earn is never a public
// endpoint — points accrue only as a side effect of live module actions wired in
// the loyalty layer, so a client can never self-award points.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// Register mounts member points routes. Earn-rule + catalog administration is
// mounted by the loyalty admin group (RBAC points.*).
func (h *Handler) Register(member *gin.RouterGroup) {
	member.GET("/points/balance", h.Balance)
	member.GET("/points/history", h.History)
	member.GET("/points/catalog", h.Catalog)
	member.POST("/points/redeem", h.Redeem)
}

func (h *Handler) History(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	limit, _ := strconv.Atoi(c.Query("limit"))
	entries, err := h.svc.History(c.Request.Context(), userID, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "history": entries})
}

func (h *Handler) Balance(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	bal, err := h.svc.Balance(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "balance_points": bal})
}

func (h *Handler) Catalog(c *gin.Context) {
	items, err := h.svc.ListCatalog(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "items": items})
}

type redeemRequest struct {
	SKU string `json:"sku" binding:"required"`
}

func (h *Handler) Redeem(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	var req redeemRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	red, item, err := h.svc.Redeem(c.Request.Context(), userID, req.SKU)
	if err != nil {
		switch err {
		case ErrInsufficientPoints:
			c.JSON(http.StatusPaymentRequired, gin.H{"error": err.Error()})
		case ErrCashRedemptionForbidden:
			c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		default:
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		}
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "redemption": red, "item": item})
}
