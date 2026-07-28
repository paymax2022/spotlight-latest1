package connectonboarding

import (
	"context"
	"errors"
	"fmt"
	"sort"

	"github.com/jackc/pgx/v5"

	connectsafety "spotlight/backend/internal/connect/safety"
)

// recomputeStatus flips status to 'complete' once all three gate steps are done,
// stamping completed_at on the first completion.
const recomputeStatus = `UPDATE connect_onboarding
	SET status = CASE WHEN age_verified AND phone_verified AND consents_accepted THEN 'complete' ELSE 'pending' END,
	    completed_at = CASE WHEN age_verified AND phone_verified AND consents_accepted AND completed_at IS NULL
	                        THEN now() ELSE completed_at END
	WHERE user_id = $1`

// markAgeVerified records a passed 18+ gate and recomputes onboarding status.
func (s *Service) markAgeVerified(ctx context.Context, userID string) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx,
		`INSERT INTO connect_onboarding (user_id, age_verified) VALUES ($1, true)
		 ON CONFLICT (user_id) DO UPDATE SET age_verified = true`, userID); err != nil {
		return fmt.Errorf("connect: mark age_verified: %w", err)
	}
	if _, err := tx.Exec(ctx, recomputeStatus, userID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// RecordConsent stores an acceptance, recomputes whether all required consents
// are in, updates onboarding status, and audits — all transactionally.
func (s *Service) RecordConsent(ctx context.Context, userID, kind, version, ip string) (OnboardingStatus, error) {
	if !ValidConsentKind(kind) {
		return OnboardingStatus{}, fmt.Errorf("connect: invalid consent kind %q", kind)
	}
	if version == "" {
		version = RequiredConsents[kind]
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return OnboardingStatus{}, err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx,
		`INSERT INTO connect_consents (user_id, consent_kind, version, accepted, accepted_at)
		 VALUES ($1, $2, $3, true, now())
		 ON CONFLICT (user_id, consent_kind, version)
		 DO UPDATE SET accepted = true, accepted_at = now()`,
		userID, kind, version); err != nil {
		return OnboardingStatus{}, fmt.Errorf("connect: record consent: %w", err)
	}

	allIn, err := allRequiredConsents(ctx, tx, userID)
	if err != nil {
		return OnboardingStatus{}, err
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO connect_onboarding (user_id, consents_accepted) VALUES ($1, $2)
		 ON CONFLICT (user_id) DO UPDATE SET consents_accepted = EXCLUDED.consents_accepted`,
		userID, allIn); err != nil {
		return OnboardingStatus{}, err
	}
	if _, err := tx.Exec(ctx, recomputeStatus, userID); err != nil {
		return OnboardingStatus{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return OnboardingStatus{}, err
	}

	_ = s.safety.WriteAudit(ctx, connectsafety.AuditInput{
		ActorID:    userID,
		Action:     "connect.consent.accepted",
		EntityType: "connect_consent",
		EntityID:   userID,
		IP:         ip,
		NewValue:   map[string]any{"kind": kind, "version": version},
	})

	return s.GetStatus(ctx, userID)
}

// GetStatus returns the combined onboarding gate state, defaulting to pending
// when no row exists yet.
func (s *Service) GetStatus(ctx context.Context, userID string) (OnboardingStatus, error) {
	st := OnboardingStatus{Status: "pending"}
	const q = `SELECT age_verified, phone_verified, consents_accepted, status
	           FROM connect_onboarding WHERE user_id = $1`
	err := s.db.QueryRow(ctx, q, userID).Scan(&st.AgeVerified, &st.PhoneVerified, &st.ConsentsAccepted, &st.Status)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return OnboardingStatus{}, fmt.Errorf("connect: read onboarding: %w", err)
	}

	missing, err := missingConsents(ctx, s.db, userID)
	if err != nil {
		return OnboardingStatus{}, err
	}
	st.MissingConsents = missing
	return st, nil
}

// querier is satisfied by both *pgxpool.Pool and pgx.Tx.
type querier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

const acceptedRequiredQuery = `SELECT consent_kind FROM connect_consents
	WHERE user_id = $1 AND accepted = true
	  AND ((consent_kind = 'terms' AND version = $2)
	    OR (consent_kind = 'privacy' AND version = $3)
	    OR (consent_kind = 'community_guidelines' AND version = $4))`

func allRequiredConsents(ctx context.Context, q querier, userID string) (bool, error) {
	accepted, err := acceptedSet(ctx, q, userID)
	if err != nil {
		return false, err
	}
	return len(accepted) == len(RequiredConsents), nil
}

func missingConsents(ctx context.Context, q querier, userID string) ([]string, error) {
	accepted, err := acceptedSet(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	var missing []string
	for kind := range RequiredConsents {
		if !accepted[kind] {
			missing = append(missing, kind)
		}
	}
	sort.Strings(missing)
	return missing, nil
}

func acceptedSet(ctx context.Context, q querier, userID string) (map[string]bool, error) {
	rows, err := q.Query(ctx, acceptedRequiredQuery, userID,
		RequiredConsents["terms"], RequiredConsents["privacy"], RequiredConsents["community_guidelines"])
	if err != nil {
		return nil, fmt.Errorf("connect: read consents: %w", err)
	}
	defer rows.Close()
	set := make(map[string]bool)
	for rows.Next() {
		var kind string
		if err := rows.Scan(&kind); err != nil {
			return nil, err
		}
		set[kind] = true
	}
	return set, rows.Err()
}
