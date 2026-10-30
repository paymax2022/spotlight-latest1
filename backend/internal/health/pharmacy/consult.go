package healthpharmacy

// Patient ↔ pharmacist consult thread. One thread per patient; messages are
// append-only. Only the patient side is exposed here — there is no pharmacist
// reply surface yet, so from_pharmacist rows are written out-of-band.

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"
)

// MaxConsultMessageLen bounds a single consult message (runes).
const MaxConsultMessageLen = 2000

// ErrConsultBody is returned for an empty or over-long message.
var ErrConsultBody = errors.New("pharmacy: message must be 1-2000 characters")

// ConsultMessage is one message on the patient's pharmacist consult thread.
type ConsultMessage struct {
	ID             string    `json:"id"`
	FromPharmacist bool      `json:"from_pharmacist"`
	AuthorName     string    `json:"author_name"`
	Body           string    `json:"body"`
	CreatedAt      time.Time `json:"created_at"`
}

func normaliseConsultBody(body string) (string, error) {
	b := strings.TrimSpace(body)
	if b == "" || utf8.RuneCountInString(b) > MaxConsultMessageLen {
		return "", ErrConsultBody
	}
	return b, nil
}

// ConsultThread returns the caller's thread, oldest first (latest 200).
func (s *Service) ConsultThread(ctx context.Context, patientID string) ([]ConsultMessage, error) {
	const q = `
		SELECT id, from_pharmacist, author_name, body, created_at FROM (
			SELECT m.id, m.from_pharmacist, COALESCE(up.full_name, '') AS author_name, m.body, m.created_at
			FROM pharmacy_consult_messages m
			LEFT JOIN user_profiles up ON up.id = m.author_id
			WHERE m.patient_id = $1
			ORDER BY m.created_at DESC
			LIMIT 200) t
		ORDER BY created_at ASC`
	rows, err := s.db.Query(ctx, q, patientID)
	if err != nil {
		return nil, fmt.Errorf("pharmacy: consult thread: %w", err)
	}
	defer rows.Close()
	out := []ConsultMessage{}
	for rows.Next() {
		var m ConsultMessage
		if err := rows.Scan(&m.ID, &m.FromPharmacist, &m.AuthorName, &m.Body, &m.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// SendConsultMessage appends a patient message to the caller's own thread.
func (s *Service) SendConsultMessage(ctx context.Context, patientID, body string) (*ConsultMessage, error) {
	b, err := normaliseConsultBody(body)
	if err != nil {
		return nil, err
	}
	m := ConsultMessage{Body: b}
	const q = `
		INSERT INTO pharmacy_consult_messages (patient_id, author_id, from_pharmacist, body)
		VALUES ($1, $1, false, $2)
		RETURNING id, created_at`
	if err := s.db.QueryRow(ctx, q, patientID, b).Scan(&m.ID, &m.CreatedAt); err != nil {
		return nil, fmt.Errorf("pharmacy: send consult message: %w", err)
	}
	return &m, nil
}
