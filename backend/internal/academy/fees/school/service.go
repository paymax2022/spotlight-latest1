package feesschool

import (
	"context"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Service is the EdTech School onboarding + verification-tier domain. It owns:
//   - draft-school CRUD (create sets owner_user_id = caller),
//   - the GUARDED verification-tier state machine (admin-only Verify),
//   - the SF-10 verified-school roster/fees export read.
//
// It moves NO money. Every mutation is audit-logged (module 'academy.fees'). The store
// is an interface so the guard/verification logic is unit-testable with an in-memory fake.
type Service struct {
	store Store
}

// NewService builds the service over the pgx-backed Repository.
func NewService(db *pgxpool.Pool) *Service {
	return &Service{store: NewRepository(db)}
}

// NewServiceWithStore injects a custom Store (used by tests with an in-memory fake).
func NewServiceWithStore(store Store) *Service {
	return &Service{store: store}
}

// Create onboards a draft school owned by the caller. ownerUserID is the authenticated
// user_id (c.GetString("user_id")) — NEVER trusted from the request body. The new school
// starts at verification_tier 'unverified' and status 'active'.
func (s *Service) Create(ctx context.Context, ownerUserID string, req CreateSchoolRequest) (*School, error) {
	if ownerUserID == "" {
		return nil, ErrUnauthenticated
	}
	if strings.TrimSpace(req.Name) == "" {
		return nil, ErrMissingName
	}
	sch, err := s.store.Insert(ctx, School{
		Name:              req.Name,
		Code:              ptrOrNil(req.Code),
		Level:             ptrOrNil(req.Level),
		VirtualAccountRef: ptrOrNil(req.VirtualAccountRef),
		Contact:           ptrOrNil(req.Contact),
		OwnerUserID:       ptrOrNil(ownerUserID),
	})
	if err != nil {
		return nil, err
	}
	_ = s.store.WriteAudit(ctx, ownerUserID, "school_created", sch.ID, "", string(TierUnverified),
		map[string]any{"name": req.Name, "level": req.Level})
	return sch, nil
}

// Get returns a school by id.
func (s *Service) Get(ctx context.Context, id string) (*School, error) {
	return s.store.Get(ctx, id)
}

// ListMine returns the caller's owned schools.
func (s *Service) ListMine(ctx context.Context, ownerUserID string) ([]School, error) {
	if ownerUserID == "" {
		return nil, ErrUnauthenticated
	}
	return s.store.List(ctx, ownerUserID)
}

// ListAll returns every active school (platform/admin directory — SU-01).
func (s *Service) ListAll(ctx context.Context) ([]School, error) {
	return s.store.List(ctx, "")
}

// Update edits descriptive fields on a school the caller owns. Verification tier and
// status are not editable here. Ownership is enforced fail-closed.
func (s *Service) Update(ctx context.Context, callerID, id string, req UpdateSchoolRequest) (*School, error) {
	if callerID == "" {
		return nil, ErrUnauthenticated
	}
	cur, err := s.store.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	if deref(cur.OwnerUserID) != callerID {
		return nil, ErrForbidden
	}
	out, err := s.store.Update(ctx, id, req)
	if err != nil {
		return nil, err
	}
	_ = s.store.WriteAudit(ctx, callerID, "school_updated", id, "", "", map[string]any{})
	return out, nil
}

// Verify is the ADMIN action that advances a school's verification tier through the
// guarded tier state machine (unverified→pending→verified→premium, with admin
// demotions/re-review allowed). The caller is expected to already be RBAC-gated as a
// platform admin at the router; this method additionally validates the MOVE is legal and
// records the transition to the immutable audit log.
//
// It never skips a forward step (e.g. unverified→verified is rejected with
// ErrIllegalTierMove) and rejects unknown tiers with ErrInvalidTier.
func (s *Service) Verify(ctx context.Context, adminID, schoolID string, tier VerificationTier) (*School, error) {
	if adminID == "" {
		return nil, ErrUnauthenticated
	}
	cur, err := s.store.Get(ctx, schoolID)
	if err != nil {
		return nil, err
	}
	to, err := VerifyTransition(cur.VerificationTier, tier)
	if err != nil {
		_ = s.store.WriteAudit(ctx, adminID, "school_verify_rejected", schoolID,
			string(cur.VerificationTier), string(tier), map[string]any{"reason": err.Error()})
		return nil, err
	}
	out, err := s.store.SetVerificationTier(ctx, schoolID, cur.VerificationTier, to)
	if err != nil {
		return nil, err
	}
	_ = s.store.WriteAudit(ctx, adminID, "school_verified", schoolID,
		string(cur.VerificationTier), string(to), map[string]any{})
	return out, nil
}

// Export returns the SF-10 roster + fees export for a school. Full data export is
// available to any VERIFIED school on request — so a school below the `verified` tier is
// refused with ErrSchoolNotVerified (the export capability is part of the School
// entity's Definition of Done). The government/regulator ComplianceExport (SF-11) is a
// SEPARATE, immutable per-category audited export owned by E8
// (backend/internal/academy/fees/export/) and is intentionally NOT implemented here.
func (s *Service) Export(ctx context.Context, callerID, schoolID string) (*SchoolExport, error) {
	if callerID == "" {
		return nil, ErrUnauthenticated
	}
	sch, err := s.store.Get(ctx, schoolID)
	if err != nil {
		return nil, err
	}
	// Fail-closed: only the owning school (or a platform admin at a higher layer) may
	// pull the export, and only once the school is verified (SF-10).
	if deref(sch.OwnerUserID) != callerID {
		return nil, ErrForbidden
	}
	if !sch.IsVerified() {
		return nil, ErrSchoolNotVerified
	}
	roster, err := s.store.ExportRoster(ctx, schoolID)
	if err != nil {
		return nil, err
	}
	fees, err := s.store.ExportFees(ctx, schoolID)
	if err != nil {
		return nil, err
	}
	_ = s.store.WriteAudit(ctx, callerID, "school_export_generated", schoolID, "", "",
		map[string]any{"rosterCount": len(roster), "feeScheduleCount": len(fees)})
	return &SchoolExport{
		SchoolID:     sch.ID,
		SchoolName:   sch.Name,
		Tier:         sch.VerificationTier,
		GeneratedAt:  time.Now(),
		Roster:       roster,
		FeeSchedules: fees,
	}, nil
}
