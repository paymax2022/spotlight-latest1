package connectchat

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

// Handler exposes the member chat endpoints.
type Handler struct{ svc *Service }

// NewHandler wires the chat handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// statusFor maps the chat domain errors to HTTP codes. Match/authorization
// failures are 403 (deny-by-default), not 404, since the caller is authenticated.
func statusFor(err error) int {
	switch {
	case errors.Is(err, ErrNoMatch), errors.Is(err, ErrBlocked), errors.Is(err, ErrRestricted):
		return http.StatusForbidden
	case errors.Is(err, ErrConversationClosed):
		return http.StatusConflict
	case errors.Is(err, ErrSafetyUnavailable):
		return http.StatusServiceUnavailable
	default:
		return http.StatusInternalServerError
	}
}

// OpenConversation — POST /api/v1/connect/matches/:matchId/conversation
// Returns (creating if needed) the conversation for a mutual match. 403 if the
// caller is not a participant of an active match.
func (h *Handler) OpenConversation(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	convID, state, err := h.svc.OpenConversation(c.Request.Context(), c.Param("matchId"), userID)
	if err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"conversation_id": convID, "safety_state": state}})
}

// ListMessages — GET /api/v1/connect/conversations/:id/messages (participant-only)
func (h *Handler) ListMessages(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	limit := 0
	if v := c.Query("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			limit = n
		}
	}
	msgs, err := h.svc.ListMessages(c.Request.Context(), c.Param("id"), userID, limit)
	if err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": msgs})
}

// SendMessage — POST /api/v1/connect/conversations/:id/messages
// Blocked unless matched + open + no block; runs the inline AI safety hook.
func (h *Handler) SendMessage(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	var req SendMessageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	res, err := h.svc.SendMessage(c.Request.Context(), c.Param("id"), userID, req)
	if err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": res})
}
