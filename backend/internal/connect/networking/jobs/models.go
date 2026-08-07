// Package connectjobs implements Paymax Connect Phase 6A + 6D (professional
// network): the Jobs marketplace, Company Pages (claim flow tied to existing
// business verification), and single-level Referral Bounties.
//
// This package is self-contained: it owns ONLY its own tables + one migration and
// exposes a single Register(...) entry point. It NEVER mutates a balance — the paid
// job-posting fee is a wallet debit and the referral bounty payout is a ledger
// credit, both delegated to the finance ledger/wallet (balanced double-entry,
// idempotent, tier-checked). Money is integer kobo throughout.
//
// Invariants honoured (see PRD §2):
//   - PN-2  referral bounties are SINGLE-LEVEL — no parent/chain field exists;
//   - PN-6  a paid job posting is blocked server-side unless the company page is verified;
//   - PN-9  Recruiter / CompanyPageAdmin are per-row, independently revocable grants;
//   - PN-10 the bounty payout is ledger-derived and idempotent by referral_bounty_id.
//
// State machines are guarded (deny-by-default validTransition helpers) so illegal
// states are unreachable in the service, mirrored by CHECK constraints in the DB.
package connectjobs

import "time"

// ── Company Page claim FSM ──────────────────────────────────────────────────
// CLAIM_SUBMITTED → UNDER_REVIEW ⇄ NEEDS_MORE_INFO → VERIFIED | REJECTED

type ClaimState string

const (
	ClaimSubmitted     ClaimState = "claim_submitted"
	ClaimUnderReview   ClaimState = "under_review"
	ClaimNeedsMoreInfo ClaimState = "needs_more_info"
	ClaimVerified      ClaimState = "verified"
	ClaimRejected      ClaimState = "rejected"
)

// validClaimTransition guards the CompanyPageClaim state machine (deny-by-default).
func validClaimTransition(from, to ClaimState) bool {
	switch from {
	case ClaimSubmitted:
		return to == ClaimUnderReview
	case ClaimUnderReview:
		return to == ClaimNeedsMoreInfo || to == ClaimVerified || to == ClaimRejected
	case ClaimNeedsMoreInfo:
		return to == ClaimUnderReview
	}
	// verified / rejected are terminal.
	return false
}

// ── Job posting FSM ─────────────────────────────────────────────────────────
// draft → pending_review → active → closed ; any non-terminal → rejected (moderation)

type JobStatus string

const (
	JobDraft         JobStatus = "draft"
	JobPendingReview JobStatus = "pending_review"
	JobActive        JobStatus = "active"
	JobClosed        JobStatus = "closed"
	JobRejected      JobStatus = "rejected"
)

func validJobTransition(from, to JobStatus) bool {
	switch from {
	case JobDraft:
		return to == JobPendingReview || to == JobActive || to == JobRejected
	case JobPendingReview:
		return to == JobActive || to == JobRejected
	case JobActive:
		return to == JobClosed || to == JobRejected
	}
	// closed / rejected are terminal.
	return false
}

// ── Job application FSM (§4) ─────────────────────────────────────────────────
// DRAFT → SUBMITTED → UNDER_REVIEW ⇄ NEEDS_INFO
// UNDER_REVIEW → SHORTLISTED → INTERVIEW → OFFERED → HIRED
// UNDER_REVIEW|SHORTLISTED|INTERVIEW → REJECTED
// SUBMITTED|UNDER_REVIEW|SHORTLISTED|INTERVIEW → WITHDRAWN (applicant-initiated)

type AppState string

const (
	AppDraft       AppState = "draft"
	AppSubmitted   AppState = "submitted"
	AppUnderReview AppState = "under_review"
	AppNeedsInfo   AppState = "needs_info"
	AppShortlisted AppState = "shortlisted"
	AppInterview   AppState = "interview"
	AppOffered     AppState = "offered"
	AppHired       AppState = "hired"
	AppRejected    AppState = "rejected"
	AppWithdrawn   AppState = "withdrawn"
)

// validAppTransition guards the JobApplication state machine (deny-by-default). It
// is the single source of truth for legal transitions; the DB CHECK enumerates the
// same target set and the service rejects everything else fail-closed.
func validAppTransition(from, to AppState) bool {
	switch from {
	case AppDraft:
		return to == AppSubmitted || to == AppWithdrawn
	case AppSubmitted:
		return to == AppUnderReview || to == AppWithdrawn
	case AppUnderReview:
		return to == AppNeedsInfo || to == AppShortlisted || to == AppRejected || to == AppWithdrawn
	case AppNeedsInfo:
		return to == AppUnderReview || to == AppWithdrawn
	case AppShortlisted:
		return to == AppInterview || to == AppRejected || to == AppWithdrawn
	case AppInterview:
		return to == AppOffered || to == AppRejected || to == AppWithdrawn
	case AppOffered:
		return to == AppHired || to == AppRejected || to == AppWithdrawn
	}
	// hired / rejected / withdrawn are terminal.
	return false
}

// ── Referral bounty FSM ─────────────────────────────────────────────────────
// REFERRED → APPLICATION_LINKED → HIRE_CONFIRMED → BOUNTY_PAYABLE → PAID
// any pre-HIRE_CONFIRMED state → EXPIRED
// BOUNTY_PAYABLE → PAID is the ledger-writing transition (idempotency key = bounty id, PN-10).

type BountyState string

const (
	BountyReferred      BountyState = "referred"
	BountyAppLinked     BountyState = "application_linked"
	BountyHireConfirmed BountyState = "hire_confirmed"
	BountyPayable       BountyState = "bounty_payable"
	BountyPaid          BountyState = "paid"
	BountyExpired       BountyState = "expired"
)

func validBountyTransition(from, to BountyState) bool {
	switch from {
	case BountyReferred:
		return to == BountyAppLinked || to == BountyExpired
	case BountyAppLinked:
		return to == BountyHireConfirmed || to == BountyExpired
	case BountyHireConfirmed:
		return to == BountyPayable // (expiry no longer allowed once a hire is confirmed)
	case BountyPayable:
		return to == BountyPaid
	}
	// paid / expired are terminal.
	return false
}

// ── Entities (camelCase json tags — mobile-facing) ──────────────────────────

type CompanyPage struct {
	ID                 string    `json:"id"`
	VerifiedBusinessID string    `json:"verifiedBusinessId,omitempty"`
	Name               string    `json:"name"`
	About              string    `json:"about,omitempty"`
	ClaimState         string    `json:"claimState"`
	FollowerCount      int64     `json:"followerCount"` // DERIVED, never stored raw
	CreatedAt          time.Time `json:"createdAt"`
	UpdatedAt          time.Time `json:"updatedAt"`
}

type CompanyAdmin struct {
	ID            string    `json:"id"`
	CompanyPageID string    `json:"companyPageId"`
	UserID        string    `json:"userId"`
	Role          string    `json:"role"` // company_page_admin | recruiter
	CreatedAt     time.Time `json:"createdAt"`
}

type Job struct {
	ID              string    `json:"id"`
	CompanyPageID   string    `json:"companyPageId"`
	PosterID        string    `json:"posterId"`
	Title           string    `json:"title"`
	Description     string    `json:"description,omitempty"`
	Requirements    string    `json:"requirements,omitempty"`
	Location        string    `json:"location,omitempty"`
	EmploymentType  string    `json:"employmentType,omitempty"`
	SalaryMinKobo   *int64    `json:"salaryMinKobo,omitempty"`
	SalaryMaxKobo   *int64    `json:"salaryMaxKobo,omitempty"`
	PositionsOpen   int       `json:"positionsOpen"`
	PositionsFilled int       `json:"positionsFilled"`
	FeeKobo         int64     `json:"feeKobo"`
	Status          string    `json:"status"`
	CreatedAt       time.Time `json:"createdAt"`
	UpdatedAt       time.Time `json:"updatedAt"`
}

type JobApplication struct {
	ID              string    `json:"id"`
	JobID           string    `json:"jobId"`
	ApplicantUserID string    `json:"applicantUserId"`
	ResumeRef       string    `json:"resumeRef,omitempty"`
	CoverNote       string    `json:"coverNote,omitempty"`
	State           string    `json:"state"`
	CreatedAt       time.Time `json:"createdAt"`
	UpdatedAt       time.Time `json:"updatedAt"`
}

type ReferralBounty struct {
	ID               string    `json:"id"`
	ReferrerUserID   string    `json:"referrerUserId"`
	JobApplicationID string    `json:"jobApplicationId,omitempty"`
	AmountKobo       int64     `json:"amountKobo"`
	State            string    `json:"state"`
	LedgerEntryRef   string    `json:"ledgerEntryRef,omitempty"`
	CreatedAt        time.Time `json:"createdAt"`
	UpdatedAt        time.Time `json:"updatedAt"`
	// NOTE (PN-2): there is intentionally NO parent-bounty / referral-chain field.
	// A referral-of-referral is not representable in this type or its table.
}

// ── Request DTOs ────────────────────────────────────────────────────────────

type ClaimCompanyInput struct {
	Name               string `json:"name" binding:"required"`
	About              string `json:"about"`
	VerifiedBusinessID string `json:"verifiedBusinessId"`
}

type GrantAdminInput struct {
	UserID string `json:"userId" binding:"required"`
	Role   string `json:"role" binding:"required"` // company_page_admin | recruiter
}

type CreateJobInput struct {
	Title          string `json:"title" binding:"required"`
	Description    string `json:"description"`
	Requirements   string `json:"requirements"`
	Location       string `json:"location"`
	EmploymentType string `json:"employmentType"`
	SalaryMinKobo  *int64 `json:"salaryMinKobo"`
	SalaryMaxKobo  *int64 `json:"salaryMaxKobo"`
	PositionsOpen  int    `json:"positionsOpen"`
	FeeKobo        int64  `json:"feeKobo"`
}

type ApplyInput struct {
	ResumeRef string `json:"resumeRef"`
	CoverNote string `json:"coverNote"`
}

type TransitionAppInput struct {
	State string `json:"state" binding:"required"`
}

type ReferInput struct {
	AmountKobo int64 `json:"amountKobo" binding:"required"`
}

type OpenToWorkInput struct {
	Open     bool   `json:"open"`
	Headline string `json:"headline"`
}
