package repo

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/arena/service"
)

// CredentialRepo persists issued credentials and the public verify-by-hash read
// (NDC-7). Credentials are independently revocable.
type CredentialRepo struct{ pool *pgxpool.Pool }

// NewCredentialRepo builds the credential repo.
func NewCredentialRepo(pool *pgxpool.Pool) *CredentialRepo { return &CredentialRepo{pool: pool} }

var _ service.CredentialRepo = (*CredentialRepo)(nil)

// Issue persists a credential. Enlists in an outer tx when present (CROWNED path).
// A duplicate verifiable_hash is a safe no-op (idempotent grant).
func (r *CredentialRepo) Issue(ctx context.Context, c service.Credential) error {
	_, err := q(ctx, r.pool).Exec(ctx, `
		INSERT INTO arena_credential
			(user_id, competition_id, type, status, verifiable_hash, issued_at)
		VALUES ($1, NULLIF($2,'')::uuid, $3, 'ACTIVE', $4, now())
		ON CONFLICT (verifiable_hash) DO NOTHING`,
		c.UserID, c.CompetitionID, c.Type, c.VerifiableHash)
	return err
}

// GetByHash resolves a credential by its public verifiable hash.
func (r *CredentialRepo) GetByHash(ctx context.Context, hash string) (*service.Credential, error) {
	var (
		c         service.Credential
		compID    *string
		revokedAt *time.Time
		reason    *string
	)
	err := r.pool.QueryRow(ctx, `
		SELECT id, user_id, competition_id, type, status, verifiable_hash,
		       issued_at, revoked_at, revoke_reason
		  FROM arena_credential WHERE verifiable_hash = $1`, hash).
		Scan(&c.ID, &c.UserID, &compID, &c.Type, &c.Status, &c.VerifiableHash,
			&c.IssuedAt, &revokedAt, &reason)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, service.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if compID != nil {
		c.CompetitionID = *compID
	}
	c.RevokedAt = revokedAt
	if reason != nil {
		c.RevokeReason = *reason
	}
	return &c, nil
}

// Revoke flips a credential to REVOKED (independent of any other Paymax
// capability). Idempotent: re-revoking is a no-op.
func (r *CredentialRepo) Revoke(ctx context.Context, hash, reason string) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE arena_credential
		   SET status = 'REVOKED', revoked_at = now(), revoke_reason = $2
		 WHERE verifiable_hash = $1 AND status = 'ACTIVE'`, hash, reason)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		// Either unknown hash or already revoked; treat unknown as not-found.
		var exists bool
		if e := r.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM arena_credential WHERE verifiable_hash = $1)`, hash).Scan(&exists); e == nil && !exists {
			return service.ErrNotFound
		}
	}
	return nil
}
