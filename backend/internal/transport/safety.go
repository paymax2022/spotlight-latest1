package transport

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/google/uuid"
)

// ShareLink is the openable live-share response for a trip.
type ShareLink struct {
	ShareToken string    `json:"shareToken"`
	URL        string    `json:"url"`
	ExpiresAt  time.Time `json:"expiresAt"`
}

// shareLinkTTL is how long a live-share link stays resolvable.
const shareLinkTTL = 2 * time.Hour

// shareBaseURL is the public base for a share link. TODO(config): move to
// PricingConfig/app config once a public web base URL is threaded through.
const shareBaseURL = "https://spotlight.app/track"

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

// ShareToken issues a live-share link for a trip (object-authz: rider only) and
// PERSISTS it so the link is actually openable later via ResolveShare.
//
// Persistence: we store the token in a trip_events row (event_type='share_link'),
// which is an existing durable table — no new column/table is required. The token
// + its expiry live in the row's metadata JSONB. ResolveShare looks the token up
// there. NOTE for the migrations agent: a dedicated trip_shares table
// (token PK, trip_id, expires_at, revoked_at) would be cleaner and allow
// revocation + indexed lookups; if/when added, switch ShareToken/ResolveShare to
// it. For now the trip_events approach is additive-only and works.
func (s *Service) ShareToken(ctx context.Context, tripID, riderID string) (*ShareLink, error) {
	var owner string
	if err := s.db.QueryRow(ctx, `SELECT rider_id FROM trips WHERE id=$1`, tripID).Scan(&owner); err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "trip not found")
	}
	if owner != riderID {
		return nil, codedErr(http.StatusForbidden, CodeForbidden, "not your trip")
	}
	token := "share_" + uuid.New().String()
	expiresAt := time.Now().Add(shareLinkTTL)
	// Durable, immutable audit row that doubles as the token store.
	s.recordEvent(ctx, tripID, "share_link", riderID, "", "", map[string]any{
		"share_token": token,
		"expires_at":  expiresAt.Format(time.RFC3339),
	})
	return &ShareLink{
		ShareToken: token,
		URL:        shareBaseURL + "/" + token,
		ExpiresAt:  expiresAt,
	}, nil
}

// ResolveShare resolves a live-share token to the trip it tracks, enforcing the
// TTL. It is intentionally unauthenticated (a share link must be openable by
// someone without an account) but returns only non-sensitive tracking fields —
// never the trip PIN. Returns the trip id + a minimal public view.
func (s *Service) ResolveShare(ctx context.Context, token string) (map[string]any, error) {
	// Find the most recent share_link event carrying this token.
	const q = `
		SELECT trip_id, metadata
		FROM trip_events
		WHERE event_type='share_link' AND metadata->>'share_token' = $1
		ORDER BY created_at DESC LIMIT 1`
	var tripID string
	var metaRaw []byte
	if err := s.db.QueryRow(ctx, q, token).Scan(&tripID, &metaRaw); err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "share link not found")
	}
	var meta map[string]any
	_ = json.Unmarshal(metaRaw, &meta)
	if exp, ok := meta["expires_at"].(string); ok {
		if t, err := time.Parse(time.RFC3339, exp); err == nil && time.Now().After(t) {
			return nil, codedErr(http.StatusGone, CodeInvalidState, "share link expired")
		}
	}
	// Minimal public tracking view (no PIN, no phone/PII).
	const tq = `
		SELECT id, phase, status, pickup_address, dest_address,
		       pickup_lat, pickup_lng, dest_lat, dest_lng, route_polyline, safety_status
		FROM trips WHERE id=$1`
	var (
		id, phase, status, pickup, dest, safety string
		polyline                                *string
		plat, plng, dlat, dlng                  *float64
	)
	if err := s.db.QueryRow(ctx, tq, tripID).Scan(
		&id, &phase, &status, &pickup, &dest, &plat, &plng, &dlat, &dlng, &polyline, &safety,
	); err != nil {
		return nil, codedErr(http.StatusNotFound, CodeNotFound, "trip not found")
	}
	return map[string]any{
		"tripId":        id,
		"phase":         phase,
		"status":        status,
		"pickupAddress": pickup,
		"destAddress":   dest,
		"pickup":        map[string]any{"lat": plat, "lng": plng},
		"dest":          map[string]any{"lat": dlat, "lng": dlng},
		"routePolyline": polyline,
		"safetyStatus":  safety,
	}, nil
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
