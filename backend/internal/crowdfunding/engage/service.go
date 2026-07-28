package engage

import (
	"context"
	"errors"
	"fmt"
	"math/rand"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Service is the crowdfunding engagement service (support, help, notifications,
// settings). It reads/writes through a pgx pool and returns DTOs matching the
// mobile TypeScript contract.
type Service struct {
	db *pgxpool.Pool
}

// NewService constructs an engagement service.
func NewService(db *pgxpool.Pool) *Service { return &Service{db: db} }

func rfc3339(t time.Time) string { return t.UTC().Format(time.RFC3339) }

// GetHelp returns the seeded help-center articles ordered for display.
func (s *Service) GetHelp(ctx context.Context) ([]HelpArticle, error) {
	const q = `SELECT id, topic, question, answer FROM cf_help_articles ORDER BY sort_order ASC, question ASC`
	rows, err := s.db.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []HelpArticle{}
	for rows.Next() {
		var a HelpArticle
		if err := rows.Scan(&a.ID, &a.Topic, &a.Question, &a.Answer); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// ListTickets returns the caller's tickets (newest first) with their messages.
func (s *Service) ListTickets(ctx context.Context, userID string) ([]SupportTicket, error) {
	const q = `
		SELECT id, reference, subject, category, status, created_at, updated_at
		FROM cf_support_tickets
		WHERE user_id = $1
		ORDER BY updated_at DESC`
	rows, err := s.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SupportTicket{}
	ids := []string{}
	for rows.Next() {
		var t SupportTicket
		var created, updated time.Time
		if err := rows.Scan(&t.ID, &t.Reference, &t.Subject, &t.Category, &t.Status, &created, &updated); err != nil {
			return nil, err
		}
		t.CreatedAt = rfc3339(created)
		t.UpdatedAt = rfc3339(updated)
		t.Messages = []TicketMessage{}
		out = append(out, t)
		ids = append(ids, t.ID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	// Attach messages for each ticket.
	for i := range out {
		msgs, err := s.ticketMessages(ctx, out[i].ID)
		if err != nil {
			return nil, err
		}
		out[i].Messages = msgs
	}
	return out, nil
}

// GetTicket returns a single ticket (with messages) by id.
func (s *Service) GetTicket(ctx context.Context, id string) (*SupportTicket, error) {
	const q = `
		SELECT id, reference, subject, category, status, created_at, updated_at
		FROM cf_support_tickets
		WHERE id = $1`
	var t SupportTicket
	var created, updated time.Time
	err := s.db.QueryRow(ctx, q, id).Scan(
		&t.ID, &t.Reference, &t.Subject, &t.Category, &t.Status, &created, &updated,
	)
	if err != nil {
		return nil, err
	}
	t.CreatedAt = rfc3339(created)
	t.UpdatedAt = rfc3339(updated)
	msgs, err := s.ticketMessages(ctx, t.ID)
	if err != nil {
		return nil, err
	}
	t.Messages = msgs
	return &t, nil
}

func (s *Service) ticketMessages(ctx context.Context, ticketID string) ([]TicketMessage, error) {
	const q = `
		SELECT id, from_role, body, created_at
		FROM cf_ticket_messages
		WHERE ticket_id = $1
		ORDER BY created_at ASC`
	rows, err := s.db.Query(ctx, q, ticketID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []TicketMessage{}
	for rows.Next() {
		var m TicketMessage
		var created time.Time
		if err := rows.Scan(&m.ID, &m.From, &m.Body, &created); err != nil {
			return nil, err
		}
		m.CreatedAt = rfc3339(created)
		out = append(out, m)
	}
	return out, rows.Err()
}

// CreateTicket opens a new ticket with the first user message, transactionally.
// A human-readable reference SPL-TK-#### is generated.
func (s *Service) CreateTicket(ctx context.Context, userID string, in CreateTicketInput) (*SupportTicket, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	ticketID := uuid.New().String()
	reference := newTicketReference()
	now := time.Now()

	const insTicket = `
		INSERT INTO cf_support_tickets (id, user_id, reference, subject, category, status, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, 'OPEN', $6, $6)`
	if _, err := tx.Exec(ctx, insTicket, ticketID, userID, reference, in.Subject, in.Category, now); err != nil {
		return nil, err
	}

	const insMsg = `
		INSERT INTO cf_ticket_messages (id, ticket_id, from_role, body, created_at)
		VALUES ($1, $2, 'user', $3, $4)`
	if _, err := tx.Exec(ctx, insMsg, uuid.New().String(), ticketID, in.Body, now); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.GetTicket(ctx, ticketID)
}

// ReplyTicket appends a user message, sets the ticket to PENDING and bumps
// updated_at — all in a single transaction.
func (s *Service) ReplyTicket(ctx context.Context, ticketID, body string) (*SupportTicket, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	now := time.Now()
	const insMsg = `
		INSERT INTO cf_ticket_messages (id, ticket_id, from_role, body, created_at)
		VALUES ($1, $2, 'user', $3, $4)`
	if _, err := tx.Exec(ctx, insMsg, uuid.New().String(), ticketID, body, now); err != nil {
		return nil, err
	}

	const updTicket = `UPDATE cf_support_tickets SET status = 'PENDING', updated_at = $2 WHERE id = $1`
	tag, err := tx.Exec(ctx, updTicket, ticketID, now)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, errors.New("ticket not found")
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.GetTicket(ctx, ticketID)
}

// GetNotifications returns the caller's notifications, newest first.
func (s *Service) GetNotifications(ctx context.Context, userID string) ([]AppNotification, error) {
	const q = `
		SELECT id, type, title, body, read, campaign_id, created_at
		FROM cf_notifications
		WHERE user_id = $1
		ORDER BY created_at DESC
		LIMIT 100`
	rows, err := s.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AppNotification{}
	for rows.Next() {
		var n AppNotification
		var campaignID *string
		var created time.Time
		if err := rows.Scan(&n.ID, &n.Type, &n.Title, &n.Body, &n.Read, &campaignID, &created); err != nil {
			return nil, err
		}
		n.CampaignID = campaignID
		n.CreatedAt = rfc3339(created)
		out = append(out, n)
	}
	return out, rows.Err()
}

// MarkNotificationsRead flags all of the caller's unread notifications as read.
func (s *Service) MarkNotificationsRead(ctx context.Context, userID string) error {
	const q = `UPDATE cf_notifications SET read = TRUE WHERE user_id = $1 AND read = FALSE`
	_, err := s.db.Exec(ctx, q, userID)
	return err
}

// defaultPrefs is the sensible default returned when no row exists yet.
func defaultPrefs() NotificationPrefs {
	return NotificationPrefs{
		Push:               true,
		Email:              true,
		SMS:                false,
		ContributionAlerts: true,
		CampaignUpdates:    true,
		Marketing:          false,
	}
}

// GetNotificationPrefs returns the caller's preferences, or sensible defaults
// when no row has been persisted yet.
func (s *Service) GetNotificationPrefs(ctx context.Context, userID string) (NotificationPrefs, error) {
	const q = `
		SELECT push, email, sms, contribution_alerts, campaign_updates, marketing
		FROM cf_notification_prefs
		WHERE user_id = $1`
	var p NotificationPrefs
	err := s.db.QueryRow(ctx, q, userID).Scan(
		&p.Push, &p.Email, &p.SMS, &p.ContributionAlerts, &p.CampaignUpdates, &p.Marketing,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return defaultPrefs(), nil
	}
	if err != nil {
		return NotificationPrefs{}, err
	}
	return p, nil
}

// UpdateNotificationPrefs upserts the caller's preferences and returns them.
func (s *Service) UpdateNotificationPrefs(ctx context.Context, userID string, p NotificationPrefs) (NotificationPrefs, error) {
	const q = `
		INSERT INTO cf_notification_prefs
			(user_id, push, email, sms, contribution_alerts, campaign_updates, marketing, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
		ON CONFLICT (user_id) DO UPDATE SET
			push = EXCLUDED.push,
			email = EXCLUDED.email,
			sms = EXCLUDED.sms,
			contribution_alerts = EXCLUDED.contribution_alerts,
			campaign_updates = EXCLUDED.campaign_updates,
			marketing = EXCLUDED.marketing,
			updated_at = NOW()`
	if _, err := s.db.Exec(ctx, q,
		userID, p.Push, p.Email, p.SMS, p.ContributionAlerts, p.CampaignUpdates, p.Marketing,
	); err != nil {
		return NotificationPrefs{}, err
	}
	return p, nil
}

// newTicketReference returns a human-readable reference of the form SPL-TK-####.
func newTicketReference() string {
	return fmt.Sprintf("SPL-TK-%04d", rand.Intn(10000))
}
