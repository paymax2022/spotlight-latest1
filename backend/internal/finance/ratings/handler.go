package ratings

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// Create handles POST /api/finance/ratings
func (h *Handler) Create(c *gin.Context) {
	raterID := c.GetString("user_id")
	var req CreateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	r, created, err := h.svc.Create(c.Request.Context(), raterID, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if !created {
		// Already rated this transaction — 200, not 201, and the body is the
		// rating that actually exists in the table (never a fabricated echo of
		// this request's own score/comment), so a client that only checks the
		// status code still never sees invented data.
		c.JSON(http.StatusOK, r)
		return
	}
	c.JSON(http.StatusCreated, r)
}

// GetSummary handles GET /api/finance/ratings/:entity_id?type=doctor
func (h *Handler) GetSummary(c *gin.Context) {
	entityID := c.Param("entity_id")
	entityType := EntityType(c.Query("type"))
	if entityType == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "type query param required"})
		return
	}
	sum, err := h.svc.GetSummary(c.Request.Context(), entityID, entityType)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, sum)
}
