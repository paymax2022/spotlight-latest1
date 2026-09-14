package transport

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"
)

// TripMessage is one chat message between a trip's two participants (the
// rider and the assigned driver). SenderRole is derived from the sender's
// relation to the trip. This is separate from the trip PIN: the PIN is an
// at-the-door identity check the driver enters; chat is free-form pre-arrival
// logistics ("I'm outside", "which gate", "is this the right address").
type TripMessage struct {
	ID            string    `json:"id"`
	TripID        string    `json:"trip_id"`
	SenderID      string    `json:"sender_id"`
	SenderRole    string    `json:"sender_role"`
	Body          string    `json:"body"`
	AttachmentURL *string   `json:"attachment_url,omitempty"`
	CreatedAt     time.Time `json:"created_at"`
}

// SendTripMessageRequest is the body for POST .../messages.
type SendTripMessageRequest struct {
	Body          string  `json:"body" binding:"required,min=1,max=4000"`
	AttachmentURL *string `json:"attachment_url,omitempty"`
}

// tripParties resolves a trip's rider and (if assigned) driver user id, for
// object-level authz — the sole gate for who may read or post to trip chat.
func (s *Service) tripParties(ctx context.Context, tripID string) (riderID, driverUserID string, err error) {
	var driverRowID *string
	if err := s.db.QueryRow(ctx, `SELECT rider_id, driver_id FROM trips WHERE id=$1`, tripID).Scan(&riderID, &driverRowID); err != nil {
		return "", "", codedErr(http.StatusNotFound, CodeNotFound, "trip not found")
	}
	if driverRowID != nil {
		s.db.QueryRow(ctx, `SELECT user_id FROM drivers WHERE id=$1`, *driverRowID).Scan(&driverUserID)
	}
	return riderID, driverUserID, nil
}

// ListMessages returns a trip's chat thread, oldest first. Caller must be the
// rider or the assigned driver.
func (s *Service) ListMessages(ctx context.Context, tripID, userID string) ([]TripMessage, error) {
	riderID, driverUserID, err := s.tripParties(ctx, tripID)
	if err != nil {
		return nil, err
	}
	if userID != riderID && (driverUserID == "" || userID != driverUserID) {
		return nil, codedErr(http.StatusForbidden, CodeForbidden, "not a participant of this trip")
	}
	const q = `SELECT id, trip_id, sender_id, sender_role, body, attachment_url, created_at
	           FROM trip_messages WHERE trip_id=$1 ORDER BY created_at`
	rows, err := s.db.Query(ctx, q, tripID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []TripMessage
	for rows.Next() {
		var m TripMessage
		if err := rows.Scan(&m.ID, &m.TripID, &m.SenderID, &m.SenderRole, &m.Body, &m.AttachmentURL, &m.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// SendMessage posts a chat message scoped to the trip's two participants. The
// sender role is derived from the user's relation to the trip; the message is
// returned so the HTTP layer can broadcast it over the trip WS and notify the
// counterparty (transport.Service has no WS dependency of its own — see
// Handler.SendMessage, which owns the realtime hub).
func (s *Service) SendMessage(ctx context.Context, tripID, senderID string, req SendTripMessageRequest) (*TripMessage, error) {
	riderID, driverUserID, err := s.tripParties(ctx, tripID)
	if err != nil {
		return nil, err
	}
	var role string
	switch senderID {
	case riderID:
		role = "rider"
	case driverUserID:
		if driverUserID == "" {
			return nil, codedErr(http.StatusForbidden, CodeForbidden, "not a participant of this trip")
		}
		role = "driver"
	default:
		return nil, codedErr(http.StatusForbidden, CodeForbidden, "not a participant of this trip")
	}

	m := &TripMessage{
		ID:            uuid.New().String(),
		TripID:        tripID,
		SenderID:      senderID,
		SenderRole:    role,
		Body:          req.Body,
		AttachmentURL: req.AttachmentURL,
		CreatedAt:     time.Now(),
	}
	const ins = `INSERT INTO trip_messages (id, trip_id, sender_id, sender_role, body, attachment_url)
	             VALUES ($1,$2,$3,$4,$5,$6)`
	if _, err := s.db.Exec(ctx, ins, m.ID, m.TripID, m.SenderID, m.SenderRole, m.Body, m.AttachmentURL); err != nil {
		return nil, fmt.Errorf("transport: insert trip message: %w", err)
	}
	return m, nil
}
