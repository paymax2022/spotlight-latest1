package feesschool

import (
	"errors"
	"time"
)

// Package feesschool owns School onboarding + the verification-tier workflow for the
// EdTech School-Fees module. It EXTENDS the existing academy/edupay `academy_schools`
// table (per REUSE-MAP.md: verification_tier + level + owner_user_id added by migration
// 20260918000000_academy_fees_edtech.sql). Money is int64 minor units everywhere; this
// package moves NO money — it is onboarding + a guarded verification-tier state machine.
//
// Conventions mirror academy/edupay: pgx pool data-access, sentinel errors mapped to
// snake_case codes by the handler, guarded transitions (verification tier here) never
// set via a raw `UPDATE ... SET status=` outside the guarded repo method.

// VerificationTier is the school trust tier. It gates escrow custody, gov-reporting and
// competition eligibility (build-spec §2, §4 SF-10/SF-11). Matches the
// academy_schools.verification_tier CHECK constraint verbatim.
type VerificationTier string

const (
	TierUnverified VerificationTier = "unverified"
	TierPending    VerificationTier = "pending"
	TierVerified   VerificationTier = "verified"
	TierPremium    VerificationTier = "premium"
)

// School mirrors public.academy_schools (edupay spine + fees extension columns).
type School struct {
	ID                string           `json:"id"`
	Name              string           `json:"name"`
	Code              *string          `json:"code,omitempty"`
	Level             *string          `json:"level,omitempty"`
	VirtualAccountRef *string          `json:"virtualAccountRef,omitempty"`
	Contact           *string          `json:"contact,omitempty"`
	OwnerUserID       *string          `json:"ownerUserId,omitempty"`
	VerificationTier  VerificationTier `json:"verificationTier"`
	Status            string           `json:"status"`
	CreatedAt         time.Time        `json:"createdAt"`
}

// IsVerified reports whether the school is at a tier that unlocks full-data export
// (SF-10) and gov-reporting/competition eligibility: verified or premium.
func (s *School) IsVerified() bool {
	return s.VerificationTier == TierVerified || s.VerificationTier == TierPremium
}

// ── Request DTOs ────────────────────────────────────────────────────────────────

// CreateSchoolRequest onboards a draft school. owner_user_id is the CALLER (set by the
// service, never trusted from the body). The school starts at tier 'unverified'.
type CreateSchoolRequest struct {
	Name              string `json:"name" binding:"required"`
	Code              string `json:"code"`
	Level             string `json:"level"`
	VirtualAccountRef string `json:"virtualAccountRef"`
	Contact           string `json:"contact"`
}

// UpdateSchoolRequest edits mutable descriptive fields on a school the caller owns.
// Verification tier is NOT settable here — it moves only through Verify (admin action).
type UpdateSchoolRequest struct {
	Name              string `json:"name"`
	Code              string `json:"code"`
	Level             string `json:"level"`
	VirtualAccountRef string `json:"virtualAccountRef"`
	Contact           string `json:"contact"`
}

// VerifyRequest is the ADMIN action that advances (or moves) a school's verification
// tier. Only legal transitions in the tier state machine are accepted.
type VerifyRequest struct {
	Tier string `json:"tier" binding:"required"`
}

// ── Export (SF-10) ──────────────────────────────────────────────────────────────

// SchoolExport is the roster + fees read that any VERIFIED school may request (SF-10:
// "Full data export available to any verified school on request"). This is the
// School-entity-scoped Definition-of-Done export: roster (students) + fee schedules.
//
// NOTE: the full government/regulator ComplianceExport (SF-11, immutable per-category
// audit log) is owned by E8 (backend/internal/academy/fees/export/) and is NOT built
// here. This is the lightweight, verified-school self-service read only.
type SchoolExport struct {
	SchoolID     string          `json:"schoolId"`
	SchoolName   string          `json:"schoolName"`
	Tier         VerificationTier `json:"verificationTier"`
	GeneratedAt  time.Time       `json:"generatedAt"`
	Roster       []ExportStudent `json:"roster"`
	FeeSchedules []ExportFee     `json:"feeSchedules"`
}

// ExportStudent is a roster line in a school export (PII-minimal; admission number +
// class + status). Guardian identities are intentionally NOT expanded here.
type ExportStudent struct {
	StudentID       string  `json:"studentId"`
	AdmissionNumber *string `json:"admissionNumber,omitempty"`
	ClassID         *string `json:"classId,omitempty"`
	Status          string  `json:"status"`
	MinorFlag       bool    `json:"minorFlag"`
}

// ExportFee is a fee-schedule line in a school export.
type ExportFee struct {
	FeeScheduleID string `json:"feeScheduleId"`
	Name          string `json:"name"`
	AmountMinor   int64  `json:"amountMinor"`
	Currency      string `json:"currency"`
	Locked        bool   `json:"locked"`
}

// ── Sentinel errors (mapped to snake_case codes by the handler) ──────────────────

var (
	ErrNotFound            = errors.New("not_found")
	ErrForbidden           = errors.New("forbidden")
	ErrInvalidTier         = errors.New("invalid_verification_tier")
	ErrIllegalTierMove     = errors.New("illegal_verification_tier_transition")
	ErrSchoolNotVerified   = errors.New("school_not_verified")
	ErrMissingName         = errors.New("missing_name")
	ErrUnauthenticated     = errors.New("unauthenticated")
)
