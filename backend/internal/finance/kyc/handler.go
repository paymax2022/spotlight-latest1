package kyc

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// Handler exposes KYC endpoints.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// GetMe handles GET /finance/kyc/me
func (h *Handler) GetMe(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	profile, err := h.svc.GetProfile(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, profile)
}

// Initiate handles POST /finance/kyc/initiate
func (h *Handler) Initiate(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	var req InitiateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	profile, err := h.svc.Initiate(c.Request.Context(), userID, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, profile)
}

// Approve handles POST /finance/admin/kyc/users/:user_id/approve (admin only)
func (h *Handler) Approve(c *gin.Context) {
	targetUserID := c.Param("user_id")
	var body struct {
		NewTier int `json:"new_tier" binding:"required,min=1,max=3"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	actorID := c.GetString("user_id")
	profile, err := h.svc.Approve(c.Request.Context(), targetUserID, body.NewTier, &actorID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, profile)
}

// Reject handles POST /finance/admin/kyc/users/:user_id/reject (admin only)
func (h *Handler) Reject(c *gin.Context) {
	targetUserID := c.Param("user_id")
	actorID := c.GetString("user_id")
	if err := h.svc.Fail(c.Request.Context(), targetUserID, &actorID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"rejected": true, "user_id": targetUserID})
}

// ListPending handles GET /finance/admin/kyc/pending (admin only)
func (h *Handler) ListPending(c *gin.Context) {
	limit := 50
	offset := 0
	profiles, err := h.svc.ListPending(c.Request.Context(), limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"profiles": profiles, "count": len(profiles)})
}
