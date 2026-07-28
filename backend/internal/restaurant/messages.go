package restaurant

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// OrderMessage is one chat message between an order's three participants
// (customer, restaurant owner, assigned rider). SenderRole is derived from the
// sender's relation to the order.
type OrderMessage struct {
	ID            string    `json:"id"`
	OrderID       string    `json:"order_id"`
	SenderID      string    `json:"sender_id"`
	SenderRole    string    `json:"sender_role"`
	Body          string    `json:"body"`
	AttachmentURL *string   `json:"attachment_url,omitempty"`
	CreatedAt     time.Time `json:"created_at"`
}

// SendMessageRequest is the body for POST .../messages.
type SendMessageRequest struct {
	Body          string  `json:"body" binding:"required,min=1,max=4000"`
	AttachmentURL *string `json:"attachment_url,omitempty"`
}

// ListMessages returns an order's chat thread, oldest first. Caller must be a
// participant (customer, owner, or assigned rider).
func (s *Service) ListMessages(ctx context.Context, orderID, userID string) ([]OrderMessage, error) {
	ok, _, err := s.isParticipant(ctx, orderID, userID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, fmt.Errorf("restaurant: not a participant of this order")
	}
	const q = `SELECT id, order_id, sender_id, sender_role, body, attachment_url, created_at
	           FROM restaurant_order_messages WHERE order_id=$1 ORDER BY created_at`
	rows, err := s.db.Query(ctx, q, orderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []OrderMessage
	for rows.Next() {
		var m OrderMessage
		if err := rows.Scan(&m.ID, &m.OrderID, &m.SenderID, &m.SenderRole, &m.Body, &m.AttachmentURL, &m.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// SendMessage posts a chat message scoped to the order's three participants.
// The sender role is derived from the user's relation to the order; the two
// counterparties are notified and the message is broadcast over the order WS.
func (s *Service) SendMessage(ctx context.Context, orderID, senderID string, req SendMessageRequest) (*OrderMessage, error) {
	customer, owner, rider, err := s.orderParties(ctx, orderID)
	if err != nil {
		return nil, err
	}
	var role string
	switch senderID {
	case customer:
		role = "customer"
	case owner:
		role = "restaurant"
	case rider:
		if rider == "" {
			return nil, fmt.Errorf("restaurant: not a participant of this order")
		}
		role = "rider"
	default:
		return nil, fmt.Errorf("restaurant: not a participant of this order")
	}

	m := &OrderMessage{
		ID:            uuid.New().String(),
		OrderID:       orderID,
		SenderID:      senderID,
		SenderRole:    role,
		Body:          req.Body,
		AttachmentURL: req.AttachmentURL,
		CreatedAt:     time.Now(),
	}
	const ins = `INSERT INTO restaurant_order_messages (id, order_id, sender_id, sender_role, body, attachment_url)
	             VALUES ($1,$2,$3,$4,$5,$6)`
	if _, err := s.db.Exec(ctx, ins, m.ID, m.OrderID, m.SenderID, m.SenderRole, m.Body, m.AttachmentURL); err != nil {
		return nil, err
	}

	// Notify the two counterparties (skip the sender + any unassigned rider).
	for _, uid := range []string{customer, owner, rider} {
		if uid == "" || uid == senderID {
			continue
		}
		s.notify(ctx, Notification{
			UserID: uid,
			Event:  EventNewMessage,
			Title:  "New message",
			Body:   m.Body,
			Data:   map[string]any{"order_id": orderID, "sender_role": role},
		})
	}
	s.broadcastMessage(orderID, m)
	return m, nil
}
