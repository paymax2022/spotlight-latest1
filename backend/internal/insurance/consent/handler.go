package consent

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// Handler exposes member consent routes.
type Handler struct{ svc *Service }

// NewHandler constructs the consent handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// Grant (member): POST /consent {product_code, scope?}
// Records NDPA consent for the current version before any provider data-share.
func (h *Handler) Grant(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	var body struct {
		ProductCode string `json:"product_code" binding:"required"`
		Scope       string `json:"scope"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	rec, err := h.svc.Grant(c.Request.Context(), userID, body.ProductCode, body.Scope)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": rec})
}

// Status (member): GET /consent?product_code=&scope=
// Reports whether the caller has granted consent for the current NDPA version.
func (h *Handler) Status(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	productCode := c.Query("product_code")
	scope := c.Query("scope")
	ok, err := h.svc.HasCurrent(c.Request.Context(), userID, productCode, scope)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"product_code": productCode,
		"version":      CurrentNDPAVersion,
		"granted":      ok,
	}})
}
