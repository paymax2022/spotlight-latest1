package connectvoting

import (
	"context"
	"fmt"
	"time"

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
