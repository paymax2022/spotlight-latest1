package transport

import (
	"context"
	"net/http"

	"github.com/google/uuid"
)

// CreateIncident records a safety case. SOS-type incidents from a rider/driver
// also flag the trip's safety_status and move it to safety_hold when active.
func (s *Service) CreateIncident(ctx context.Context, userID string, incType string, tripID *string, lat, lng *float64, description, severity string) (*SafetyIncident, error) {
	if severity == "" {
		severity = "high"
	}
	inc := &SafetyIncident{
		ID:       uuid.New().String(),
		UserID:   userID,
		TripID:   tripID,
		Type:     incType,
		Severity: severity,
		Lat:      lat,
		Lng:      lng,
		Status:   "open",
	}
	const q = `
		INSERT INTO safety_incidents (id, user_id, trip_id, type, severity, lat, lng, description, status)
		VALUES ($1,$2,$3,$4,$5,$6,$7,NULLIF($8,''),'open')
		RETURNING created_at`
	if err := s.db.QueryRow(ctx, q, inc.ID, userID, tripID, incType, severity, lat, lng, description).Scan(&inc.CreatedAt); err != nil {
		return nil, err
	}
	if description != "" {
		inc.Description = &description
	}

	// For an active trip, raise the trip's safety_status and hold it.
	if tripID != nil && incType == "sos" {
		var t tripRow
		if err := s.loadTrip(ctx, *tripID, &t); err == nil {
			s.db.Exec(ctx, `UPDATE trips SET safety_status='sos' WHERE id=$1`, *tripID)
			if canTransition(t.Phase, PhaseSafetyHold) {
				s.db.Exec(ctx, `UPDATE trips SET phase='safety_hold', updated_at=NOW() WHERE id=$1`, *tripID)
				s.recordEvent(ctx, *tripID, "safety_hold", userID, t.Phase, PhaseSafetyHold, map[string]any{"incident_id": inc.ID})
			}
		}
	}
	return inc, nil
}

// ShareToken issues a live-share token for a trip (object-authz: rider only).
func (s *Service) ShareToken(ctx context.Context, tripID, riderID string) (string, error) {
	var owner string
	if err := s.db.QueryRow(ctx, `SELECT rider_id FROM trips WHERE id=$1`, tripID).Scan(&owner); err != nil {
		return "", codedErr(http.StatusNotFound, CodeNotFound, "trip not found")
	}
	if owner != riderID {
		return "", codedErr(http.StatusForbidden, CodeForbidden, "not your trip")
	}
	return "share_" + uuid.New().String(), nil
}

// ─── Trusted contacts ─────────────────────────────────────────────────────────

func (s *Service) ListTrustedContacts(ctx context.Context, userID string) ([]TrustedContact, error) {
	rows, err := s.db.Query(ctx, `SELECT id, user_id, name, phone, created_at FROM trusted_contacts WHERE user_id=$1 ORDER BY created_at`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []TrustedContact
	for rows.Next() {
		var c TrustedContact
		if err := rows.Scan(&c.ID, &c.UserID, &c.Name, &c.Phone, &c.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, nil
}

func (s *Service) AddTrustedContact(ctx context.Context, userID, name, phone string) (*TrustedContact, error) {
	c := &TrustedContact{ID: uuid.New().String(), UserID: userID, Name: name, Phone: phone}
	if err := s.db.QueryRow(ctx,
		`INSERT INTO trusted_contacts (id, user_id, name, phone) VALUES ($1,$2,$3,$4) RETURNING created_at`,
		c.ID, userID, name, phone).Scan(&c.CreatedAt); err != nil {
		return nil, err
	}
	return c, nil
}

func (s *Service) DeleteTrustedContact(ctx context.Context, userID, id string) error {
	tag, err := s.db.Exec(ctx, `DELETE FROM trusted_contacts WHERE id=$1 AND user_id=$2`, id, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return codedErr(http.StatusNotFound, CodeNotFound, "contact not found")
	}
	return nil
}
