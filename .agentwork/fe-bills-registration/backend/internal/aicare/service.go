package aicare

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// AIProvider is a minimal interface for the AI reply backend.
// In production, swap in an Anthropic or OpenAI client.
type AIProvider interface {
	Reply(ctx context.Context, history []Message, userMessage string) (string, error)
}

// Service manages AI customer care sessions and message routing.
type Service struct {
	db  *pgxpool.Pool
	ai  AIProvider
}

func NewService(db *pgxpool.Pool, ai AIProvider) *Service {
	return &Service{db: db, ai: ai}
}

// CreateSession opens a new support session for a user.
func (s *Service) CreateSession(ctx context.Context, userID string, req CreateSessionRequest) (*Session, error) {
	sess := &Session{
		ID:        uuid.New().String(),
		UserID:    userID,
		Status:    SessionOpen,
		Topic:     req.Topic,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	const q = `INSERT INTO support_sessions (id, user_id, status, topic) VALUES ($1,$2,'open',$3)`
	_, err := s.db.Exec(ctx, q, sess.ID, sess.UserID, sess.Topic)
	return sess, err
}

// SendMessage appends the user message, fetches history, calls the AI provider,
// and stores the AI reply. Returns both the user and AI messages.
func (s *Service) SendMessage(ctx context.Context, sessionID, userID string, req SendMessageRequest) (*Message, *Message, error) {
	// Verify session belongs to user and is open or escalated.
	var status string
	if err := s.db.QueryRow(ctx, `SELECT status FROM support_sessions WHERE id=$1 AND user_id=$2`, sessionID, userID).Scan(&status); err != nil {
		return nil, nil, fmt.Errorf("aicare: session not found")
	}
	if status == string(SessionResolved) {
		return nil, nil, fmt.Errorf("aicare: session is resolved — please open a new session")
	}

	// Store user message.
	userMsg := &Message{
		ID:        uuid.New().String(),
		SessionID: sessionID,
		Role:      RoleUser,
		Content:   req.Content,
		CreatedAt: time.Now(),
	}
	const insertMsg = `INSERT INTO support_messages (id, session_id, role, content) VALUES ($1,$2,$3,$4)`
	if _, err := s.db.Exec(ctx, insertMsg, userMsg.ID, userMsg.SessionID, string(userMsg.Role), userMsg.Content); err != nil {
		return nil, nil, fmt.Errorf("aicare: insert user message: %w", err)
	}

	// Only call AI when session is not escalated (escalated = human agent responds).
	var aiMsg *Message
	if status == string(SessionOpen) && s.ai != nil {
		history, _ := s.getHistory(ctx, sessionID, 10)
		aiReply, err := s.ai.Reply(ctx, history, req.Content)
		if err != nil {
			aiReply = "I'm having trouble processing your request right now. Our team will follow up shortly."
		}
		aiMsg = &Message{
			ID:        uuid.New().String(),
			SessionID: sessionID,
			Role:      RoleAI,
			Content:   aiReply,
			CreatedAt: time.Now(),
		}
		s.db.Exec(ctx, insertMsg, aiMsg.ID, aiMsg.SessionID, string(aiMsg.Role), aiMsg.Content)
	}

	return userMsg, aiMsg, nil
}

// Escalate marks a session for human follow-up.
func (s *Service) Escalate(ctx context.Context, sessionID, userID string, req EscalateRequest) error {
	const q = `UPDATE support_sessions SET status='escalated', updated_at=NOW() WHERE id=$1 AND user_id=$2 AND status='open'`
	tag, err := s.db.Exec(ctx, q, sessionID, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("aicare: session not found or already escalated/resolved")
	}
	if req.Reason != "" {
		s.db.Exec(ctx, `INSERT INTO support_messages (id, session_id, role, content) VALUES ($1,$2,'user',$3)`,
			uuid.New().String(), sessionID, "Escalation reason: "+req.Reason)
	}
	return nil
}

// Resolve closes a session.
func (s *Service) Resolve(ctx context.Context, sessionID, actorID string) error {
	const q = `UPDATE support_sessions SET status='resolved', updated_at=NOW() WHERE id=$1 AND status != 'resolved'`
	_, err := s.db.Exec(ctx, q, sessionID)
	return err
}

// GetHistory returns messages for a session.
func (s *Service) GetHistory(ctx context.Context, sessionID, userID string) ([]Message, error) {
	var count int
	if err := s.db.QueryRow(ctx, `SELECT COUNT(*) FROM support_sessions WHERE id=$1 AND user_id=$2`, sessionID, userID).Scan(&count); err != nil || count == 0 {
		return nil, fmt.Errorf("aicare: session not found")
	}
	return s.getHistory(ctx, sessionID, 100)
}

func (s *Service) getHistory(ctx context.Context, sessionID string, limit int) ([]Message, error) {
	const q = `SELECT id, session_id, role, content, created_at FROM support_messages WHERE session_id=$1 ORDER BY created_at ASC LIMIT $2`
	rows, err := s.db.Query(ctx, q, sessionID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Message
	for rows.Next() {
		var m Message
		if err := rows.Scan(&m.ID, &m.SessionID, &m.Role, &m.Content, &m.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}
