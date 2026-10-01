package connectvoting

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// SupportService handles voting support ticket operations
type SupportService struct {
	pool *pgxpool.Pool
}

// NewSupportService creates a new support service
func NewSupportService(pool *pgxpool.Pool) *SupportService {
	return &SupportService{pool: pool}
}

// CreateSupportTicket creates a new support ticket
func (s *SupportService) CreateSupportTicket(ctx context.Context, ticket SupportTicket) (*SupportTicket, error) {
	id := uuid.New().String()
	now := time.Now()

	query := `
		INSERT INTO voting_support_tickets
		(id, user_id, contest_id, category, status, subject, description, priority, source, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		RETURNING id, user_id, contest_id, category, status, subject, description, priority, source,
		          assigned_to, resolution_notes, created_at, updated_at, resolved_at
	`

	result := &SupportTicket{}
	err := s.pool.QueryRow(ctx, query,
		id, ticket.UserID, ticket.ContestID, ticket.Category, "open",
		ticket.Subject, ticket.Description, ticket.Priority, ticket.Source,
		now, now,
	).Scan(
		&result.ID, &result.UserID, &result.ContestID, &result.Category, &result.Status,
		&result.Subject, &result.Description, &result.Priority, &result.Source,
		&result.AssignedTo, &result.ResolutionNotes, &result.CreatedAt, &result.UpdatedAt, &result.ResolvedAt,
	)

	return result, err
}

// ListSupportTickets lists user's support tickets
func (s *SupportService) ListSupportTickets(ctx context.Context, userID, status string, limit, offset int) ([]SupportTicket, error) {
	query := `
		SELECT id, user_id, contest_id, category, status, subject, description, priority, source,
		       assigned_to, resolution_notes, created_at, updated_at, resolved_at
		FROM voting_support_tickets
		WHERE user_id = $1
	`
	args := []interface{}{userID}
	argIndex := 2

	if status != "" {
		query += fmt.Sprintf(" AND status = $%d", argIndex)
		args = append(args, status)
		argIndex++
	}

	query += fmt.Sprintf(" ORDER BY created_at DESC LIMIT $%d OFFSET $%d", argIndex, argIndex+1)
	args = append(args, limit, offset)

	rows, err := s.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tickets []SupportTicket
	for rows.Next() {
		var t SupportTicket
		if err := rows.Scan(&t.ID, &t.UserID, &t.ContestID, &t.Category, &t.Status,
			&t.Subject, &t.Description, &t.Priority, &t.Source,
			&t.AssignedTo, &t.ResolutionNotes, &t.CreatedAt, &t.UpdatedAt, &t.ResolvedAt); err != nil {
			return nil, err
		}
		tickets = append(tickets, t)
	}

	return tickets, rows.Err()
}

// GetSupportTicket retrieves a single support ticket (owner-scoped)
func (s *SupportService) GetSupportTicket(ctx context.Context, userID, ticketID string) (*SupportTicket, error) {
	query := `
		SELECT id, user_id, contest_id, category, status, subject, description, priority, source,
		       assigned_to, resolution_notes, created_at, updated_at, resolved_at
		FROM voting_support_tickets
		WHERE id = $1 AND user_id = $2
	`

	ticket := &SupportTicket{}
	err := s.pool.QueryRow(ctx, query, ticketID, userID).Scan(
		&ticket.ID, &ticket.UserID, &ticket.ContestID, &ticket.Category, &ticket.Status,
		&ticket.Subject, &ticket.Description, &ticket.Priority, &ticket.Source,
		&ticket.AssignedTo, &ticket.ResolutionNotes, &ticket.CreatedAt, &ticket.UpdatedAt, &ticket.ResolvedAt,
	)

	return ticket, err
}

// UpdateSupportTicket updates a support ticket (limited fields for users)
func (s *SupportService) UpdateSupportTicket(ctx context.Context, userID, ticketID, status, priority, description string) (*SupportTicket, error) {
	now := time.Now()

	query := `
		UPDATE voting_support_tickets
		SET status = COALESCE(NULLIF($3, ''), status),
		    priority = COALESCE(NULLIF($4, ''), priority),
		    description = COALESCE(NULLIF($5, ''), description),
		    updated_at = $6,
		    resolved_at = CASE WHEN $3 = 'closed' THEN now() ELSE resolved_at END
		WHERE id = $1 AND user_id = $2
		RETURNING id, user_id, contest_id, category, status, subject, description, priority, source,
		          assigned_to, resolution_notes, created_at, updated_at, resolved_at
	`

	ticket := &SupportTicket{}
	err := s.pool.QueryRow(ctx, query, ticketID, userID, status, priority, description, now).Scan(
		&ticket.ID, &ticket.UserID, &ticket.ContestID, &ticket.Category, &ticket.Status,
		&ticket.Subject, &ticket.Description, &ticket.Priority, &ticket.Source,
		&ticket.AssignedTo, &ticket.ResolutionNotes, &ticket.CreatedAt, &ticket.UpdatedAt, &ticket.ResolvedAt,
	)

	return ticket, err
}

// AddTicketMessage adds a message to a support ticket
func (s *SupportService) AddTicketMessage(ctx context.Context, userID, ticketID, message string, attachments []string) (*TicketMessage, error) {
	// Verify ticket exists and belongs to user
	var exists bool
	err := s.pool.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM voting_support_tickets WHERE id = $1 AND user_id = $2)", ticketID, userID).Scan(&exists)
	if err != nil || !exists {
		return nil, fmt.Errorf("ticket not found")
	}

	msgID := uuid.New().String()
	now := time.Now()

	query := `
		INSERT INTO voting_ticket_messages (id, ticket_id, author_id, message, attachments, created_at)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, ticket_id, author_id, is_internal, message, attachments, created_at
	`

	msg := &TicketMessage{}
	err = s.pool.QueryRow(ctx, query, msgID, ticketID, userID, message, attachments, now).Scan(
		&msg.ID, &msg.TicketID, &msg.AuthorID, &msg.IsInternal, &msg.Message, &msg.Attachments, &msg.CreatedAt,
	)

	// Update ticket's updated_at
	if err == nil {
		_, _ = s.pool.Exec(ctx, "UPDATE voting_support_tickets SET updated_at = $1 WHERE id = $2", now, ticketID)
	}

	return msg, err
}

// ListTicketMessages lists all messages in a ticket (owner-scoped)
func (s *SupportService) ListTicketMessages(ctx context.Context, userID, ticketID string) ([]TicketMessage, error) {
	// Verify ticket exists and belongs to user
	var exists bool
	err := s.pool.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM voting_support_tickets WHERE id = $1 AND user_id = $2)", ticketID, userID).Scan(&exists)
	if err != nil || !exists {
		return nil, fmt.Errorf("ticket not found")
	}

	query := `
		SELECT id, ticket_id, author_id, is_internal, message, attachments, created_at
		FROM voting_ticket_messages
		WHERE ticket_id = $1
		ORDER BY created_at ASC
	`

	rows, err := s.pool.Query(ctx, query, ticketID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var messages []TicketMessage
	for rows.Next() {
		var msg TicketMessage
		if err := rows.Scan(&msg.ID, &msg.TicketID, &msg.AuthorID, &msg.IsInternal, &msg.Message, &msg.Attachments, &msg.CreatedAt); err != nil {
			return nil, err
		}
		messages = append(messages, msg)
	}

	return messages, rows.Err()
}

// SupportTicket represents a user support request
type SupportTicket struct {
	ID              string     `json:"id"`
	UserID          string     `json:"user_id"`
	ContestID       string     `json:"contest_id,omitempty"`
	Category        string     `json:"category"` // 'account_issue','voting_problem',etc
	Status          string     `json:"status"`   // 'open','in_progress','waiting','resolved','closed'
	Subject         string     `json:"subject"`
	Description     string     `json:"description"`
	Priority        string     `json:"priority"` // 'low','normal','high','urgent'
	Source          string     `json:"source"`   // 'web','mobile','marketplace'
	AssignedTo      string     `json:"assigned_to,omitempty"`
	ResolutionNotes string     `json:"resolution_notes,omitempty"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
	ResolvedAt      *time.Time `json:"resolved_at,omitempty"`
}

// TicketMessage represents a message in a support ticket
type TicketMessage struct {
	ID          string    `json:"id"`
	TicketID    string    `json:"ticket_id"`
	AuthorID    string    `json:"author_id"`
	IsInternal  bool      `json:"is_internal"`
	Message     string    `json:"message"`
	Attachments []string  `json:"attachments,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
}

// Note: Notification type is defined in repo.go (voting notifications from connectvoting module)

// support_handler.go — Support/Help ticket endpoints for voting module
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
		Priority    string `json:"priority"`   // 'low','normal','high','urgent'
		ContestID   string `json:"contest_id"` // optional
		Source      string `json:"source"`     // 'web','mobile','marketplace'
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

	status := c.Query("status") // filter by status
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
		Status      string `json:"status"`   // only 'waiting' or 'closed' allowed for users
		Priority    string `json:"priority"` // 'low','normal','high','urgent'
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
