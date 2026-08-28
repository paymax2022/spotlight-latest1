package engage

import (
	"errors"
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

// RecordCampaignEvent — POST /campaigns/:id/events.
//
// Records a VIEW or SHARE for a campaign. Fire-and-forget from the client's
// point of view: analytics must never block or fail a user action, so a bad
// payload is a 400 but a storage failure is still reported honestly rather than
// silently swallowed.
func (h *Handler) RecordCampaignEvent(c *gin.Context) {
	campaignID := c.Param("id")

	var body struct {
		Type        string `json:"type"`
		Source      string `json:"source"`
		AnonymousID string `json:"anonymousId"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}

	// user_id is set by auth middleware when present; campaign pages are public,
	// so an absent user is an anonymous view rather than an error.
	userID := c.GetString("user_id")

	if err := h.svc.RecordCampaignEvent(c.Request.Context(), campaignID, body.Type, body.Source, userID, body.AnonymousID); err != nil {
		if errors.Is(err, ErrInvalidEvent) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "type must be VIEW or SHARE"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
