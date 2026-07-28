package consent

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// NDPA consent for the Stays module. A consent gates ANY guest-PII share with a
// supplier/hotel (the Book leg forwards lead-guest name/email/phone to the rail) —
// no consent on the current version, no data-share (PRD §22, §21). Mirrors the
// insurance consent service.

// CurrentNDPAVersion is the active NDPA consent text version. Bumping this forces
// guests to re-consent before the next supplier data-share.
const CurrentNDPAVersion = "stays-ndpa-v1"

// DefaultScope is the consent scope the booking saga checks.
const DefaultScope = "supplier_data_share"

// Record is a versioned NDPA consent record.
type Record struct {
	ID        string    `json:"id"`
	UserID    string    `json:"user_id"`
	Scope     string    `json:"scope"`
	Version   string    `json:"version"`
	GrantedAt time.Time `json:"granted_at"`
}

// ErrConsentRequired is returned when the NDPA gate is not satisfied.
var ErrConsentRequired = fmt.Errorf("consent: NDPA consent required before supplier data-share")

// Service manages NDPA consent records. Parameterized queries throughout.
type Service struct {
	db *pgxpool.Pool
}

// NewService constructs the consent service.
func NewService(db *pgxpool.Pool) *Service { return &Service{db: db} }

// Grant records a consent for the current NDPA version. Idempotent: re-granting the
// same (user, scope, version) is a no-op.
func (s *Service) Grant(ctx context.Context, userID, scope string) (*Record, error) {
	if s.db == nil {
		return nil, fmt.Errorf("consent: nil pool")
	}
	if scope == "" {
		scope = DefaultScope
	}
	var r Record
	err := s.db.QueryRow(ctx, `
		INSERT INTO public.stays_consent (user_id, scope, version)
		VALUES ($1, $2, $3)
		ON CONFLICT (user_id, scope, version) DO UPDATE
		  SET granted_at = public.stays_consent.granted_at
		RETURNING id, user_id, scope, version, granted_at`,
		userID, scope, CurrentNDPAVersion,
	).Scan(&r.ID, &r.UserID, &r.Scope, &r.Version, &r.GrantedAt)
	if err != nil {
		return nil, fmt.Errorf("consent: grant: %w", err)
	}
	return &r, nil
}

// HasCurrent returns true if the user has granted consent for the CURRENT NDPA
// version + scope. This is the gate the booking saga calls BEFORE any supplier
// data-share.
func (s *Service) HasCurrent(ctx context.Context, userID, scope string) (bool, error) {
	if s.db == nil {
		return false, fmt.Errorf("consent: nil pool")
	}
	if scope == "" {
		scope = DefaultScope
	}
	var exists bool
	err := s.db.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM public.stays_consent
			WHERE user_id = $1 AND scope = $2 AND version = $3
		)`, userID, scope, CurrentNDPAVersion).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("consent: check: %w", err)
	}
	return exists, nil
}
