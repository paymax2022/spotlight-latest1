package disputes

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// Open handles POST /api/finance/disputes
func (h *Handler) Open(c *gin.Context) {
	userID := c.GetString("user_id")
	var req OpenRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	d, err := h.svc.Open(c.Request.Context(), userID, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, d)
}

// List handles GET /api/finance/disputes
func (h *Handler) List(c *gin.Context) {
	userID := c.GetString("user_id")
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	disputes, err := h.svc.List(c.Request.Context(), userID, limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": disputes, "count": len(disputes)})
}

// AdminResolve handles POST /api/finance/admin/disputes/:id/resolve
func (h *Handler) AdminResolve(c *gin.Context) {
	adminID := c.GetString("user_id")
	disputeID := c.Param("id")
	var body struct {
		Resolution string `json:"resolution" binding:"required"`
		AdminNote  string `json:"admin_note"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.Resolve(c.Request.Context(), disputeID, Resolution(body.Resolution), body.AdminNote, adminID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"resolved": true, "dispute_id": disputeID})
}
