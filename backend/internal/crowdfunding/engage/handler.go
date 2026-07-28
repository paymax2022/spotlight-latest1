package engage

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// Handler exposes the engagement endpoints over gin.
type Handler struct{ svc *Service }

// NewHandler constructs an engagement handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// GetHelp — GET /help.
func (h *Handler) GetHelp(c *gin.Context) {
	articles, err := h.svc.GetHelp(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": articles})
}

// ListTickets — GET /support/tickets.
func (h *Handler) ListTickets(c *gin.Context) {
	userID := c.GetString("user_id")
	tickets, err := h.svc.ListTickets(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": tickets})
}

// GetTicket — GET /support/tickets/:id.
func (h *Handler) GetTicket(c *gin.Context) {
	ticket, err := h.svc.GetTicket(c.Request.Context(), c.Param("id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "ticket not found"})
		return
	}
	c.JSON(http.StatusOK, ticket)
}

// CreateTicket — POST /support/tickets.
func (h *Handler) CreateTicket(c *gin.Context) {
	userID := c.GetString("user_id")
	var in CreateTicketInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	ticket, err := h.svc.CreateTicket(c.Request.Context(), userID, in)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, ticket)
}

// ReplyTicket — POST /support/tickets/:id/reply.
func (h *Handler) ReplyTicket(c *gin.Context) {
	var in ReplyTicketInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	ticket, err := h.svc.ReplyTicket(c.Request.Context(), c.Param("id"), in.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, ticket)
}

// GetNotifications — GET /notifications.
func (h *Handler) GetNotifications(c *gin.Context) {
	userID := c.GetString("user_id")
	items, err := h.svc.GetNotifications(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": items})
}

// MarkNotificationsRead — POST /notifications/read.
func (h *Handler) MarkNotificationsRead(c *gin.Context) {
	userID := c.GetString("user_id")
	if err := h.svc.MarkNotificationsRead(c.Request.Context(), userID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// GetNotificationPrefs — GET /settings/notifications.
func (h *Handler) GetNotificationPrefs(c *gin.Context) {
	userID := c.GetString("user_id")
	prefs, err := h.svc.GetNotificationPrefs(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, prefs)
}

// UpdateNotificationPrefs — PUT /settings/notifications.
func (h *Handler) UpdateNotificationPrefs(c *gin.Context) {
	userID := c.GetString("user_id")
	var prefs NotificationPrefs
	if err := c.ShouldBindJSON(&prefs); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	saved, err := h.svc.UpdateNotificationPrefs(c.Request.Context(), userID, prefs)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, saved)
}
