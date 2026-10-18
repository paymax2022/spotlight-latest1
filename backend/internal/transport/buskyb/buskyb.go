// Package buskyb implements the bus-operator onboarding verification gate
// (Bus Transport PRD §5). A self-registered bus_providers row cannot publish
// into the public interstate catalog until its KYB application reaches
// state=approved with the required checks passed:
//
//	draft → submitted → cac_verification_pending → kyc_verification_pending
//	      → under_review → approved   (maker-checker: reviewer ≠ submitter)
//
// The package WRAPS the existing provider flow — it never edits
// transport/bus_provider.go. Approval flips bus_providers.verification_status
// to 'verified', which is what the existing SearchBusTrips gate already
// requires; CanPublish is the export buscatalog/busfleet call before allowing
// an operator to publish routes/schedules.
//
// Fail-closed rules honoured here:
//   - no CAC outcome ever auto-approves — a match only advances the
//     application to the KYC gate; anything else routes to a human
//     (under_review) or back to the operator (needs_information);
//   - a registry outage is an 'error' check and the application STAYS in
//     cac_verification_pending for retry — an inconclusive answer never
//     advances the gate;
//   - owner KYC must be ≥ Tier-2 (tiers.Tier2, "ID verified"; the CBN tier
//     model kycverify sessions target);
//   - every state move is legal-move enforced in Go AND in Postgres
//     (bus_operator_kyb_guard trigger), and is written to
//     bus_operator_transition + transport_audit_log.
package buskyb

import (
	"errors"

	"spotlight/backend/go-common/fsm"
)

// State is the bus_operator_application lifecycle (matches the DB CHECK).
type State string

const (
	StateDraft       State = "draft"
	StateSubmitted   State = "submitted"
	StateCACPending  State = "cac_verification_pending"
	StateKYCPending  State = "kyc_verification_pending"
	StateNeedsInfo   State = "needs_information"
	StateUnderReview State = "under_review"
	StateApproved    State = "approved"
	StateRejected    State = "rejected"
	StateSuspended   State = "suspended"
	StateExpired     State = "expired"
)

// transitions is the application's legal-move table. It MUST stay in sync with
// bus_operator_kyb_can_transition() in the migration — the Go table fails fast
// with a typed error, the DB trigger is the backstop no client can bypass.
//
// Owner-driven: draft/needs_information/rejected/expired → submitted (submit /
// resubmit). System-driven: submitted → cac_verification_pending →
// kyc_verification_pending → under_review. Reviewer-driven: under_review →
// approved | rejected | needs_information; approved → suspended | expired;
// suspended → approved (reinstate) | expired.
var transitions = fsm.Table[State]{
	StateDraft:       fsm.Set(StateSubmitted),
	StateSubmitted:   fsm.Set(StateCACPending, StateNeedsInfo),
	StateCACPending:  fsm.Set(StateKYCPending, StateUnderReview, StateNeedsInfo),
	StateKYCPending:  fsm.Set(StateUnderReview, StateNeedsInfo),
	StateNeedsInfo:   fsm.Set(StateSubmitted),
	StateUnderReview: fsm.Set(StateApproved, StateRejected, StateNeedsInfo),
	StateApproved:    fsm.Set(StateSuspended, StateExpired),
	StateRejected:    fsm.Set(StateSubmitted),
	StateSuspended:   fsm.Set(StateApproved, StateExpired),
	StateExpired:     fsm.Set(StateSubmitted),
}

// CheckType is the kind of verification recorded on an application.
type CheckType string

const (
	CheckCAC      CheckType = "cac"
	CheckKYC      CheckType = "kyc"
	CheckPayout   CheckType = "payout"
	CheckDocument CheckType = "document"
)

// CheckStatus is the outcome of one verification attempt.
type CheckStatus string

const (
	CheckPending CheckStatus = "pending"
	CheckPassed  CheckStatus = "passed"
	CheckFailed  CheckStatus = "failed"
	CheckError   CheckStatus = "error" // inconclusive — retryable
)

// CACResultCode is the normalized outcome of a company-registry verification.
// The mapping to a check status + next application state lives in cacDecision —
// deliberately: NO outcome auto-approves, and provider_unavailable leaves the
// application parked for retry instead of advancing on an inconclusive answer.
type CACResultCode string

const (
	CACMatch               CACResultCode = "match"
	CACProviderUnavailable CACResultCode = "provider_unavailable"
	CACCompanyNotFound     CACResultCode = "company_not_found"
	CACMismatch            CACResultCode = "mismatch"
	CACInvalidRegistration CACResultCode = "invalid_registration"
	CACPolicyRejected      CACResultCode = "policy_rejected"
)

// ReviewAction is a platform reviewer's decision on an application.
type ReviewAction string

const (
	ReviewApprove     ReviewAction = "approve"             // under_review → approved
	ReviewReject      ReviewAction = "reject"              // under_review → rejected
	ReviewRequestInfo ReviewAction = "request_information" // under_review → needs_information
	ReviewSuspend     ReviewAction = "suspend"             // approved → suspended
	ReviewReinstate   ReviewAction = "reinstate"           // suspended → approved
	ReviewExpire      ReviewAction = "expire"              // approved/suspended → expired
)

// reviewTargets maps an action onto its target state.
var reviewTargets = map[ReviewAction]State{
	ReviewApprove:     StateApproved,
	ReviewReject:      StateRejected,
	ReviewRequestInfo: StateNeedsInfo,
	ReviewSuspend:     StateSuspended,
	ReviewReinstate:   StateApproved,
	ReviewExpire:      StateExpired,
}

// reasonRequired marks actions a reviewer may not take silently.
var reasonRequired = map[ReviewAction]bool{
	ReviewReject:      true,
	ReviewRequestInfo: true,
	ReviewSuspend:     true,
	ReviewExpire:      true,
}

// RequiredOperatorTier is the minimum KYC tier an operator's owner must hold —
// Tier-2 ("ID verified" in internal/finance/tiers; the CBN tier model that
// kycverify sessions elevate toward).
const RequiredOperatorTier = 2

// Domain errors. The handler maps them to HTTP codes (handler.go).
var (
	ErrNotFound            = errors.New("buskyb: application not found")
	ErrProviderNotFound    = errors.New("buskyb: not a registered bus provider")
	ErrForbidden           = errors.New("buskyb: not authorized for this resource")
	ErrMakerChecker        = errors.New("buskyb: reviewer cannot decide their own application")
	ErrIllegalTransition   = errors.New("buskyb: illegal state transition")
	ErrInvalidState        = errors.New("buskyb: application is not in a state that accepts this call")
	ErrInvalidAction       = errors.New("buskyb: invalid review action")
	ErrInvalidRequest      = errors.New("buskyb: invalid request")
	ErrTermsRequired       = errors.New("buskyb: operator terms must be accepted to submit")
	ErrRegistryUnavailable = errors.New("buskyb: company registry verifier not configured")
)
