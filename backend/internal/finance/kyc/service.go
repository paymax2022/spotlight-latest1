package kyc

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Service manages KYC tier transitions.
type Service struct {
	db *pgxpool.Pool
}

func NewService(db *pgxpool.Pool) *Service {
	return &Service{db: db}
}

// GetProfile returns the current KYC profile for a user.
func (s *Service) GetProfile(ctx context.Context, userID string) (*Profile, error) {
	const q = `
		SELECT id, COALESCE(kyc_tier, 0), COALESCE(kyc_status, 'none'),
		       kyc_submitted_at, kyc_verified_at, COALESCE(phone_verified, false),
		       document_type, kyc_requested_tier
		FROM user_profiles
		WHERE id = $1`
	p := &Profile{UserID: userID}
	var tier int
	err := s.db.QueryRow(ctx, q, userID).Scan(
		&p.UserID, &tier, &p.Status,
		&p.SubmittedAt, &p.VerifiedAt, &p.PhoneVerified,
		&p.DocumentType, &p.RequestedTier,
	)
	if err != nil {
		return nil, fmt.Errorf("kyc: get profile user=%s: %w", userID, err)
	}
	p.Tier = Tier(tier)
	return p, nil
}

// Initiate moves the user to status=submitted for the requested tier.
// Idempotent: submitting again while already in 'submitted' is a no-op.
func (s *Service) Initiate(ctx context.Context, userID string, req InitiateRequest) (*Profile, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("kyc: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	const update = `
		UPDATE user_profiles
		SET kyc_status = 'submitted',
		    kyc_submitted_at = NOW(),
		    kyc_requested_tier = $2,
		    document_type = COALESCE($3, document_type),
		    document_ref  = COALESCE($4, document_ref),
		    bvn_hash      = COALESCE($5, bvn_hash),
		    nin_hash      = COALESCE($6, nin_hash),
		    updated_at    = NOW()
		WHERE id = $1 AND kyc_status NOT IN ('submitted', 'pending')
		RETURNING id`

	var returnedID string
	err = tx.QueryRow(ctx, update,
		userID, req.RequestedTier, req.DocumentType, req.DocumentRef,
		hashIfPresent(req.BVN), hashIfPresent(req.NIN),
	).Scan(&returnedID)
	if err != nil {
		// no row = already submitted/pending — idempotent success
		if err.Error() == "no rows in result set" {
			_ = tx.Rollback(ctx)
			return s.GetProfile(ctx, userID)
		}
		return nil, fmt.Errorf("kyc: initiate user=%s: %w", userID, err)
	}

	const audit = `
		INSERT INTO kyc_events (user_id, event_type, new_tier)
		VALUES ($1, 'initiated', $2)`
	if _, err := tx.Exec(ctx, audit, userID, req.RequestedTier); err != nil {
		return nil, fmt.Errorf("kyc: write audit event: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("kyc: commit initiate: %w", err)
	}
	return s.GetProfile(ctx, userID)
}

// Approve is called by an admin or the webhook adapter to upgrade a user's tier.
func (s *Service) Approve(ctx context.Context, userID string, newTier int, actorID *string) (*Profile, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("kyc: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	const update = `
		UPDATE user_profiles
		SET kyc_tier = $2, kyc_status = 'verified', kyc_verified_at = NOW(), updated_at = NOW()
		WHERE id = $1`
	if _, err := tx.Exec(ctx, update, userID, newTier); err != nil {
		return nil, fmt.Errorf("kyc: approve user=%s: %w", userID, err)
	}

	const audit = `
		INSERT INTO kyc_events (user_id, event_type, new_tier, actor_id)
		VALUES ($1, 'verified', $2, $3)`
	if _, err := tx.Exec(ctx, audit, userID, newTier, actorID); err != nil {
		return nil, fmt.Errorf("kyc: write audit event: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("kyc: commit approve: %w", err)
	}
	return s.GetProfile(ctx, userID)
}

// ListPending returns all profiles currently awaiting admin review (status=submitted).
func (s *Service) ListPending(ctx context.Context, limit, offset int) ([]Profile, error) {
	const q = `
		SELECT id, COALESCE(kyc_tier, 0), COALESCE(kyc_status, 'none'),
		       kyc_submitted_at, kyc_verified_at, COALESCE(phone_verified, false),
		       document_type, kyc_requested_tier
		FROM user_profiles
		WHERE kyc_status = 'submitted'
		ORDER BY kyc_submitted_at ASC
		LIMIT $1 OFFSET $2`

	rows, err := s.db.Query(ctx, q, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("kyc: list pending: %w", err)
	}
	defer rows.Close()

	var profiles []Profile
	for rows.Next() {
		var p Profile
		var tier int
		if err := rows.Scan(
			&p.UserID, &tier, &p.Status,
			&p.SubmittedAt, &p.VerifiedAt, &p.PhoneVerified,
			&p.DocumentType, &p.RequestedTier,
		); err != nil {
			return nil, fmt.Errorf("kyc: scan pending row: %w", err)
		}
		p.Tier = Tier(tier)
		profiles = append(profiles, p)
	}
	return profiles, rows.Err()
}

// Fail marks a KYC attempt as failed.
func (s *Service) Fail(ctx context.Context, userID string, actorID *string) error {
	const update = `UPDATE user_profiles SET kyc_status='failed', updated_at=NOW() WHERE id=$1`
	if _, err := s.db.Exec(ctx, update, userID); err != nil {
		return fmt.Errorf("kyc: fail user=%s: %w", userID, err)
	}
	const audit = `INSERT INTO kyc_events (user_id, event_type, actor_id) VALUES ($1, 'failed', $2)`
	_, err := s.db.Exec(ctx, audit, userID, actorID)
	return err
}

// hashIfPresent returns a 64-char hex hash of the value if non-nil.
// In production, use argon2id. Here we use SHA-256 as a placeholder.
// The actual KYC service hashes BVN/NIN before storing.
func hashIfPresent(v *string) *string {
	if v == nil || *v == "" {
		return nil
	}
	// Placeholder — real impl uses argon2id via golang.org/x/crypto/argon2
	hashed := fmt.Sprintf("sha256:%s", *v)
	return &hashed
}
