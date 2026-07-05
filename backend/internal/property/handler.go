package property

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// Handler exposes the Property Management suite HTTP endpoints. The caller's user
// id is read from the gin context key "user_id" (set by the auth wrapper applied
// in the route registration — same convention as the estate/realtor modules).
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// GetContext → GET /api/finance/property/context
// Returns the caller's role assignments across estates / properties / agencies and
// their persisted active context.
func (h *Handler) GetContext(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	resp, err := h.svc.GetContext(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, resp)
}

// SwitchContext → POST /api/finance/property/context/switch
// Persists the caller's active context after a fail-closed membership check.
func (h *Handler) SwitchContext(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	var req struct {
		ContextType string `json:"contextType" binding:"required"`
		ContextID   string `json:"contextId" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	ref, err := h.svc.SwitchContext(c.Request.Context(), userID, req.ContextType, req.ContextID)
	if err != nil {
		// Membership / validation failures are 403/400-shaped; surface as 403 since
		// the common case is "no role in that context" (fail-closed).
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"activeContext": ref})
}

// GetMyRentPassport → GET /api/finance/property/rent-passport/me
// Returns the caller's own portable rent/dues trust profile.
func (h *Handler) GetMyRentPassport(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	rp, err := h.svc.GetRentPassport(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, rp)
}

// LookupRentPassport → GET /api/finance/property/rent-passport/lookup/:userId
// Landlord/agency screening view of another user's passport. RBAC-gated upstream
// by RequirePermission(rbac, "property.manage").
func (h *Handler) LookupRentPassport(c *gin.Context) {
	target := c.Param("userId")
	if target == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "userId required"})
		return
	}
	rp, err := h.svc.GetRentPassport(c.Request.Context(), target)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, rp)
}
