package connecttrust

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

// Handler exposes the member AI assistant + the moderator scam-shield feed.
type Handler struct {
	coach  *AICoach
	shield *ShieldStore
}

// NewHandler wires the trust handlers.
func NewHandler(coach *AICoach, shield *ShieldStore) *Handler {
	return &Handler{coach: coach, shield: shield}
}

// AIGenerate — POST /api/v1/connect/ai/assist (authenticated member).
// Guardrailed: unsafe input/output is blocked (200 with blocked=true, never a leak).
func (h *Handler) AIGenerate(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	var req AIRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	res, err := h.coach.Generate(c.Request.Context(), userID, req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	// A blocked response is a normal, successful outcome (the guardrail worked).
	c.JSON(http.StatusOK, gin.H{"data": res})
}

// ListShieldFlags — GET /api/connect/admin/scam-shield?limit= (connect.moderation.view)
// Surfaces scam-shield flags + reason codes to moderators (invariant 10).
func (h *Handler) ListShieldFlags(c *gin.Context) {
	limit := 0
	if v := c.Query("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			limit = n
		}
	}
	flags, err := h.shield.ListFlags(c.Request.Context(), limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": flags})
}
