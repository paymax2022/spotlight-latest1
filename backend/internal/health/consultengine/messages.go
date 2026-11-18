package consultengine

import (
	"context"
	"fmt"
	"strings"
	"time"
)

const maxMessageLen = 4000

// PostMessage appends one message to a session's thread. Posting opens with the
// join window and closes at ends_at; the thread stays readable to participants
// before and after.
func (s *Service) PostMessage(ctx context.Context, sessionID, callerID, body string) (Message, error) {
	sess, _, err := s.loadForCaller(ctx, sessionID, callerID)
	if err != nil {
		return Message{}, err
	}
	now := s.now()
	if sess.State == StateEnded || sess.State == StateCancelled || !now.Before(sess.EndsAt) {
		return Message{}, ErrState
	}
	// Chat is a timed paid session: its thread opens on the same window Join
	// fences media to, not at booking time.
	if sess.State == StateScheduled && now.Before(sess.BookedStart.Add(-EarlyJoinWindow)) {
		return Message{}, ErrState
	}
	body = strings.TrimSpace(body)
	if body == "" || len(body) > maxMessageLen {
		return Message{}, ErrInvalid
	}
	const q = `INSERT INTO consult_session_messages (session_id, sender_id, body)
	           VALUES ($1,$2,$3) RETURNING id, session_id, sender_id, body, created_at`
	var m Message
	if err := s.db.QueryRow(ctx, q, sessionID, callerID, body).Scan(
		&m.ID, &m.SessionID, &m.SenderID, &m.Body, &m.CreatedAt); err != nil {
		return Message{}, fmt.Errorf("consult: post message: %w", err)
	}
	return m, nil
}

// ListMessages returns the thread in order, optionally after one timestamp.
func (s *Service) ListMessages(ctx context.Context, sessionID, callerID string, after time.Time) ([]Message, error) {
	if _, _, err := s.loadForCaller(ctx, sessionID, callerID); err != nil {
		return nil, err
	}
	const q = `SELECT id, session_id, sender_id, body, created_at
	           FROM consult_session_messages
	           WHERE session_id=$1 AND created_at > $2
	           ORDER BY created_at ASC, id ASC`
	rows, err := s.db.Query(ctx, q, sessionID, after)
	if err != nil {
		return nil, fmt.Errorf("consult: list messages: %w", err)
	}
	defer rows.Close()
	var out []Message
	for rows.Next() {
		var m Message
		if err := rows.Scan(&m.ID, &m.SessionID, &m.SenderID, &m.Body, &m.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}
