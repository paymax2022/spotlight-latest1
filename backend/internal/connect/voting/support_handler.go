package connectvoting

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

// support_handler.go — Support/Help ticket endpoints for voting module
//
// Endpoints:
//   POST   /support/tickets          — create a new support ticket
//   GET    /support/tickets          — list user's tickets
//   GET    /support/tickets/:id      — get ticket detail
//   PATCH  /support/tickets/:id      — update ticket status (user-limited actions)
//   POST   /support/tickets/:id/messages — add message to ticket
//   GET    /support/tickets/:id/messages — get ticket messages

// CreateSupportTicket POST /support/tickets
func (h *Handler) CreateSupportTicket(c *gin.Context) {
	uid, ok := getUserID(c)
	if !ok {
		return
	}
	var in struct {
		Category    string `json:"category" binding:"required"` // 'account_issue','voting_problem',etc
		Subject     string `json:"subject" binding:"required"`
		Description string `json:"description" binding:"required"`
		Priority    string `json:"priority"`                    // 'low','normal','high','urgent'
		ContestID   string `json:"contest_id"`                  // optional
		Source      string `json:"source"`                      // 'web','mobile','marketplace'
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		respondErr(c, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
		return
	}

	ticket := SupportTicket{
		UserID:      uid,
		Category:    in.Category,
		Subject:     in.Subject,
		Description: in.Description,
		Priority:    in.Priority,
		ContestID:   in.ContestID,
		Source:      in.Source,
		Status:      "open",
	}

	created, err := h.svc.createSupportTicket(c.Request.Context(), ticket)
	if err != nil {
		respondErr(c, http.StatusInternalServerError, "TICKET_CREATE_FAILED", err.Error())
		return
	}

	c.JSON(http.StatusCreated, created)
}

// ListSupportTickets GET /support/tickets?status=&limit=&offset=
func (h *Handler) ListSupportTickets(c *gin.Context) {
	uid, ok := getUserID(c)
	if !ok {
		return
	}

	status := c.Query("status")       // filter by status
	limit := 20
	offset := 0

	if l := c.Query("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 && n <= 100 {
			limit = n
		}
	}
	if o := c.Query("offset"); o != "" {
		if n, err := strconv.Atoi(o); err == nil && n >= 0 {
			offset = n
		}
	}

	tickets, err := h.svc.listSupportTickets(c.Request.Context(), uid, status, limit, offset)
	if err != nil {
		respondErr(c, http.StatusInternalServerError, "TICKETS_LIST_FAILED", err.Error())
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"tickets": tickets,
		"limit":   limit,
		"offset":  offset,
	})
}

// GetSupportTicket GET /support/tickets/:id
func (h *Handler) GetSupportTicket(c *gin.Context) {
	uid, ok := getUserID(c)
	if !ok {
		return
	}

	ticket, err := h.svc.getSupportTicket(c.Request.Context(), uid, c.Param("id"))
	if err != nil {
		respondErr(c, http.StatusNotFound, "TICKET_NOT_FOUND", err.Error())
		return
	}

	c.JSON(http.StatusOK, ticket)
}

// UpdateSupportTicket PATCH /support/tickets/:id
// Users can only update: status (to 'waiting' or 'closed'), priority, description
func (h *Handler) UpdateSupportTicket(c *gin.Context) {
	uid, ok := getUserID(c)
	if !ok {
		return
	}

	var in struct {
		Status      string `json:"status"`      // only 'waiting' or 'closed' allowed for users
		Priority    string `json:"priority"`    // 'low','normal','high','urgent'
		Description string `json:"description"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		respondErr(c, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
		return
	}

	ticket, err := h.svc.updateSupportTicket(c.Request.Context(), uid, c.Param("id"), in.Status, in.Priority, in.Description)
	if err != nil {
		respondErr(c, http.StatusInternalServerError, "TICKET_UPDATE_FAILED", err.Error())
		return
	}

	c.JSON(http.StatusOK, ticket)
}

// AddTicketMessage POST /support/tickets/:id/messages
func (h *Handler) AddTicketMessage(c *gin.Context) {
	uid, ok := getUserID(c)
	if !ok {
		return
	}

	var in struct {
		Message string   `json:"message" binding:"required"`
		Files   []string `json:"attachments"` // optional URLs
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		respondErr(c, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
		return
	}

	msg, err := h.svc.addTicketMessage(c.Request.Context(), uid, c.Param("id"), in.Message, in.Files)
	if err != nil {
		respondErr(c, http.StatusInternalServerError, "MESSAGE_ADD_FAILED", err.Error())
		return
	}

	c.JSON(http.StatusCreated, msg)
}

// ListTicketMessages GET /support/tickets/:id/messages
func (h *Handler) ListTicketMessages(c *gin.Context) {
	uid, ok := getUserID(c)
	if !ok {
		return
	}

	messages, err := h.svc.listTicketMessages(c.Request.Context(), uid, c.Param("id"))
	if err != nil {
		respondErr(c, http.StatusInternalServerError, "MESSAGES_LIST_FAILED", err.Error())
		return
	}

	c.JSON(http.StatusOK, gin.H{"messages": messages})
}

// helper functions
func getUserID(c *gin.Context) (string, bool) {
	uid, exists := c.Get("user_id")
	if !exists {
		respondErr(c, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return "", false
	}
	uidStr, ok := uid.(string)
	if !ok || uidStr == "" {
		respondErr(c, http.StatusUnauthorized, "UNAUTHORIZED", "invalid user context")
		return "", false
	}
	return uidStr, true
}

func respondErr(c *gin.Context, code int, errCode, msg string) {
	c.JSON(code, gin.H{
		"error": gin.H{
			"code":    errCode,
			"message": msg,
		},
	})
}
