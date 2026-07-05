package service

import (
	"context"
	"strings"

	"spotlight/backend/internal/arena"
)

// CredentialService issues, verifies and revokes verifiable credentials (NDC-7).
// Credentials are issued only from Merit-derived state (crown) or engagement-
// derived state (Play-Along threshold), are verifiable by a public deterministic
// hash (arena.VerifiableHash), and are independently revocable without touching a
// user's unrelated Paymax capabilities.
type CredentialService struct {
	repo  CredentialRepo
	audit AuditRepo
}

// NewCredentialService builds the credential service.
func NewCredentialService(repo CredentialRepo, audit AuditRepo) *CredentialService {
	return &CredentialService{repo: repo, audit: audit}
}

// Issue mints a credential from the stated issuing facts and returns its public
// verifiable hash. The hash is deterministic over (user, competition, type,
// merit-ref) so anyone can recompute it (arena.VerifiableHash). Idempotent: a
// re-issue of the same facts yields the same hash and is a DB no-op.
func (s *CredentialService) Issue(ctx context.Context, actorID, userID, competitionID, credType, issuedFromMeritRef string) (string, error) {
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(credType) == "" {
		return "", ErrInvalidInput
	}
	hash := arena.VerifiableHash(userID, competitionID, arena.CredentialType(credType), issuedFromMeritRef)
	if err := s.repo.Issue(ctx, Credential{
		UserID:         userID,
		CompetitionID:  competitionID,
		Type:           credType,
		Status:         "ACTIVE",
		VerifiableHash: hash,
	}); err != nil {
		return "", err
	}
	_ = s.audit.Log(ctx, AuditRecord{
		CompetitionID: competitionID, ActorID: actorID, EntityType: "credential", EntityID: userID,
		Action: "CREDENTIAL_ISSUE", After: map[string]any{"type": credType, "hash": hash},
	})
	return hash, nil
}

// VerifyByHash resolves a credential by its public hash (verify-by-hash is public,
// no auth). The caller can independently recompute the hash from the returned
// public fields to confirm authenticity.
func (s *CredentialService) VerifyByHash(ctx context.Context, hash string) (*Credential, error) {
	if strings.TrimSpace(hash) == "" {
		return nil, ErrInvalidInput
	}
	return s.repo.GetByHash(ctx, hash)
}

// Revoke flips a credential to REVOKED independently and audits the reason. It
// does not affect any other Paymax capability the user holds.
func (s *CredentialService) Revoke(ctx context.Context, actorID, hash, reason string) error {
	if strings.TrimSpace(hash) == "" {
		return ErrInvalidInput
	}
	if err := s.repo.Revoke(ctx, hash, reason); err != nil {
		return err
	}
	return s.audit.Log(ctx, AuditRecord{
		ActorID: actorID, EntityType: "credential", EntityID: hash,
		Action: "CREDENTIAL_REVOKE", Reason: reason,
	})
}
