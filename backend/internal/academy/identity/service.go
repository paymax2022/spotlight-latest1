package identity

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/kyc"
)

// Stable snake_case error codes surfaced to clients / used by the capability gate.
var (
	// ErrIllegalTransition is returned when a guarded state-machine transition is
	// rejected (e.g. consent on a non-pending link, revoke of a non-active link).
	ErrIllegalTransition = errors.New("illegal_transition")
	// ErrInvalidRole is returned for an unknown academy role.
	ErrInvalidRole = errors.New("invalid_role")
)

// kycReader is the slice of the KYC rail this package depends on. Reusing the
// existing rail (backend/internal/finance/kyc) — never a parallel KYC store.
type kycReader interface {
	GetProfile(ctx context.Context, userID string) (*kyc.Profile, error)
}

// Service is the academy identity-bridge domain service.
type Service struct {
	repo *Repository
	kyc  kycReader
}

// NewService wires the repository and reuses the finance KYC rail for tier gating.
func NewService(pool *pgxpool.Pool) *Service {
	return &Service{repo: NewRepository(pool), kyc: kyc.NewService(pool)}
}

// NewServiceWith allows injecting a KYC reader (used by tests).
func NewServiceWith(repo *Repository, k kycReader) *Service {
	return &Service{repo: repo, kyc: k}
}

// GrantRole adds an additive academy role to a single Paymax identity. Idempotent
// (ON CONFLICT DO NOTHING) and audited.
func (s *Service) GrantRole(ctx context.Context, userID string, role Role) error {
	if !ValidRole(role) {
		return ErrInvalidRole
	}
	if err := s.repo.GrantRole(ctx, userID, role); err != nil {
		return err
	}
	return s.repo.InsertAudit(ctx, userID, userID, "academy.role.granted", "academy_role", userID,
		map[string]any{"role": role})
}

// UpsertProfile writes the per-role academy profile.
func (s *Service) UpsertProfile(ctx context.Context, userID string, req UpsertProfileRequest) (*Profile, error) {
	if !ValidRole(req.Role) {
		return nil, ErrInvalidRole
	}
	p, err := s.repo.UpsertProfile(ctx, userID, req)
	if err != nil {
		return nil, err
	}
	if err := s.repo.InsertAudit(ctx, userID, userID, "academy.profile.upserted", "academy_profile", p.ID,
		map[string]any{"role": req.Role, "class_id": req.ClassID, "entry_year": req.EntryYear}); err != nil {
		return nil, err
	}
	return p, nil
}

// LinkGuardian creates a PENDING guardian link (guardian → minor). Audited.
func (s *Service) LinkGuardian(ctx context.Context, guardianID, minorID string) (*GuardianLink, error) {
	gl, err := s.repo.CreateGuardianLink(ctx, guardianID, minorID)
	if err != nil {
		return nil, err
	}
	if err := s.repo.InsertAudit(ctx, guardianID, minorID, "academy.guardian.linked", "academy_guardian_link", gl.ID,
		map[string]any{"status": gl.Status}); err != nil {
		return nil, err
	}
	return gl, nil
}

// RecordConsent posts an immutable ConsentRecord and performs the guarded
// pending → active transition on the guardian link, atomically. Returns the
// consent id. The transition is audited; an illegal transition is rejected and
// surfaces ErrIllegalTransition.
func (s *Service) RecordConsent(ctx context.Context, guardianID, minorID string, scope map[string]any, actorID string) (string, error) {
	consentID, err := s.repo.RecordConsentAndActivate(ctx, guardianID, minorID, scope, actorID)
	if err != nil {
		if errors.Is(err, ErrIllegalTransition) {
			// Audit the rejected transition for traceability.
			_ = s.repo.InsertAudit(ctx, actorID, minorID, "academy.guardian.consent_rejected",
				"academy_guardian_link", "", map[string]any{"reason": "no_pending_link"})
		}
		return "", err
	}
	if err := s.repo.InsertAudit(ctx, actorID, minorID, "academy.guardian.consent_recorded",
		"academy_consent_record", consentID, map[string]any{"scope": scope, "guardian_user_id": guardianID}); err != nil {
		return "", err
	}
	return consentID, nil
}

// RevokeGuardianLink performs the guarded active → revoked transition. Audited.
func (s *Service) RevokeGuardianLink(ctx context.Context, linkID, actorID string) (*GuardianLink, error) {
	gl, err := s.repo.RevokeGuardianLink(ctx, linkID)
	if err != nil {
		return nil, err
	}
	if err := s.repo.InsertAudit(ctx, actorID, gl.MinorUserID, "academy.guardian.revoked",
		"academy_guardian_link", gl.ID, map[string]any{"status": gl.Status}); err != nil {
		return nil, err
	}
	return gl, nil
}

// canUnlock is the PURE capability-gate decision, factored out of
// CanUnlockCapability so the golden-rule logic is unit-testable without a DB.
// It enforces, fail-closed, two rules:
//  1. KYC tier — kycTier must be at least minTier for the capability.
//  2. Minor consent — if isMinor, an ACTIVE guardian link with an immutable
//     consent record granting the scope (hasActiveConsent) must exist.
//
// Returns (ok, reason). reason is a stable snake_case code when ok is false.
// Tier is checked first so a tier failure is reported before consent.
func canUnlock(isMinor bool, hasActiveConsent bool, kycTier int, minTier int) (bool, string) {
	if kycTier < minTier {
		return false, "kyc_tier_too_low"
	}
	if isMinor && !hasActiveConsent {
		return false, "guardian_consent_required"
	}
	return true, ""
}

// CanUnlockCapability is the gate used by commerce/community surfaces. It enforces,
// fail-closed, two golden rules:
//  1. KYC tier — the user must hold at least the minimum tier for the capability
//     (read via the reused finance KYC rail).
//  2. Minor consent — if the user is a minor (has any guardian link), an ACTIVE
//     guardian link with an immutable consent record granting the capability scope
//     must exist.
//
// Returns (ok, reason). reason is a stable snake_case code when ok is false.
func (s *Service) CanUnlockCapability(ctx context.Context, userID, capability string) (bool, string) {
	// 1) KYC tier gate (fail-closed: any error denies).
	prof, err := s.kyc.GetProfile(ctx, userID)
	if err != nil {
		return false, "kyc_unavailable"
	}

	// 2) Minor consent gate inputs.
	isMinor, err := s.repo.IsMinor(ctx, userID)
	if err != nil {
		return false, "consent_check_failed"
	}
	hasConsent := false
	if isMinor {
		hasConsent, err = s.repo.HasActiveConsent(ctx, userID, capability)
		if err != nil {
			return false, "consent_check_failed"
		}
	}

	return canUnlock(isMinor, hasConsent, int(prof.Tier), minTierForCapability(capability))
}

// GetMe aggregates roles, profiles, and guardian links (both directions).
func (s *Service) GetMe(ctx context.Context, userID string) (*Me, error) {
	roles, err := s.repo.ListRoles(ctx, userID)
	if err != nil {
		return nil, err
	}
	profiles, err := s.repo.ListProfiles(ctx, userID)
	if err != nil {
		return nil, err
	}
	asGuardian, err := s.repo.ListGuardianLinksAsGuardian(ctx, userID)
	if err != nil {
		return nil, err
	}
	asMinor, err := s.repo.ListGuardianLinksAsMinor(ctx, userID)
	if err != nil {
		return nil, err
	}
	return &Me{
		UserID:        userID,
		Roles:         roles,
		Profiles:      profiles,
		GuardianLinks: asGuardian,
		GuardedBy:     asMinor,
	}, nil
}

// AdminLookup returns a user's full identity surface for admin support tooling.
func (s *Service) AdminLookup(ctx context.Context, userID string) (*Me, error) {
	return s.GetMe(ctx, userID)
}
