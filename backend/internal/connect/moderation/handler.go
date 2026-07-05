package connectmoderation

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

// Handler exposes the admin moderation endpoints (RBAC enforced at route layer).
type Handler struct{ svc *Service }

// NewHandler wires the moderation handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func parseLimit(c *gin.Context) int {
	if v := c.Query("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return 0
}

// ListFlaggedConversations — GET /api/connect/admin/moderation/conversations
func (h *Handler) ListFlaggedConversations(c *gin.Context) {
	list, err := h.svc.ListFlaggedConversations(c.Request.Context(), parseLimit(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": list})
}

// ListFlaggedMessages — GET /api/connect/admin/moderation/messages?conversation_id=
func (h *Handler) ListFlaggedMessages(c *gin.Context) {
	list, err := h.svc.ListFlaggedMessages(c.Request.Context(), c.Query("conversation_id"), parseLimit(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": list})
}

// RecordDecision — POST /api/connect/admin/moderation/decisions
func (h *Handler) RecordDecision(c *gin.Context) {
	adminID := c.GetString("user_id")
	var req DecisionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	d, err := h.svc.RecordDecision(c.Request.Context(), adminID, req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": d})
}

// ListDecisions — GET /api/connect/admin/moderation/decisions
func (h *Handler) ListDecisions(c *gin.Context) {
	list, err := h.svc.ListDecisions(c.Request.Context(), parseLimit(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": list})
}

// SetConversationState — PATCH /api/connect/admin/moderation/conversations/:id
func (h *Handler) SetConversationState(c *gin.Context) {
	adminID := c.GetString("user_id")
	var req ConvActionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.SetConversationState(c.Request.Context(), adminID, c.Param("id"), req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"id": c.Param("id"), "safety_state": req.SafetyState}})
}
