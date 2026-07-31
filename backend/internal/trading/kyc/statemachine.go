// Package kyc implements the trading module's "Trading Access Verification" —
// a KYC state machine that is DELIBERATELY DECOUPLED from the super-app identity
// Tiers 0–3 (§16B.1). A user may be Tier 3 in the app and still Not-Verified for
// trading, and clearing this never writes back to the app tier. The trading
// module gates access on THIS status alone.
//
// This file is the pure, unit-tested core — no DB, no network. Illegal
// transitions are structurally blocked; bypass (granting access without
// verification) is a controlled two-person, time-boxed exception, never a
// same-person shortcut.
package kyc

import "time"

// Status is the trading-access verification state (§16B.1). Stored on a dedicated
// trading_kyc record, never derived from the Tier 0–3 machine.
type Status string

const (
	StatusNotStarted  Status = "NOT_STARTED"
	StatusSubmitted   Status = "SUBMITTED"
	StatusUnderReview Status = "UNDER_REVIEW"
	StatusApproved    Status = "APPROVED"
	StatusRejected    Status = "REJECTED"
	StatusBypassed    Status = "BYPASSED"
	StatusExpired     Status = "EXPIRED"
)

// transitions is the allowed status graph. Bypass is reachable from any
// pre-approval state (admin two-person action, enforced in the service), but not
// from APPROVED (already has access) — and every state can EXPIRE.
//
//	NOT_STARTED  → SUBMITTED | BYPASSED
//	SUBMITTED    → UNDER_REVIEW | REJECTED | BYPASSED
//	UNDER_REVIEW → APPROVED | REJECTED | BYPASSED
//	APPROVED     → EXPIRED
//	REJECTED     → SUBMITTED (resubmit) | BYPASSED | EXPIRED
//	BYPASSED     → EXPIRED | UNDER_REVIEW (start real review before/after expiry)
//	EXPIRED      → SUBMITTED (re-verify) | BYPASSED
var transitions = map[Status]map[Status]bool{
	StatusNotStarted:  {StatusSubmitted: true, StatusBypassed: true},
	StatusSubmitted:   {StatusUnderReview: true, StatusRejected: true, StatusBypassed: true},
	StatusUnderReview: {StatusApproved: true, StatusRejected: true, StatusBypassed: true},
	StatusApproved:    {StatusExpired: true},
	StatusRejected:    {StatusSubmitted: true, StatusBypassed: true, StatusExpired: true},
	StatusBypassed:    {StatusExpired: true, StatusUnderReview: true},
	StatusExpired:     {StatusSubmitted: true, StatusBypassed: true},
}

// CanTransition reports whether the record may move from → to. Re-writing the
// same status is idempotent (allowed).
func CanTransition(from, to Status) bool {
	if from == to {
		return true
	}
	return transitions[from][to]
}

// IsValidStatus reports whether s is a known status (rejects malformed input).
func IsValidStatus(s Status) bool {
	_, ok := transitions[s]
	return ok
}

// MaxBypassTTL is the hard ceiling on how long a bypass may grant access before
// full KYC must be completed (§16B.1 recommends ≤ 30 days).
const MaxBypassTTL = 30 * 24 * time.Hour

// BypassError enumerates why a bypass request is rejected.
type BypassError string

func (e BypassError) Error() string { return string(e) }

const (
	ErrBypassSameApprover BypassError = "bypass requires two different admins (maker ≠ checker)"
	ErrBypassNoMaker      BypassError = "bypass requires a maker admin id"
	ErrBypassNoChecker    BypassError = "bypass requires a checker admin id"
	ErrBypassNoReason     BypassError = "bypass requires a written justification"
	ErrBypassBadTTL       BypassError = "bypass ttl must be positive"
	ErrBypassTTLTooLong   BypassError = "bypass ttl exceeds the maximum allowed"
)

// ValidateBypass enforces the controlled-exception policy on a bypass grant
// BEFORE it is persisted: two distinct admins (maker ≠ checker), a written
// reason, and a positive, bounded time-box. Pure — the service supplies ids/ttl.
func ValidateBypass(makerID, checkerID, reason string, ttl time.Duration) error {
	if makerID == "" {
		return ErrBypassNoMaker
	}
	if checkerID == "" {
		return ErrBypassNoChecker
	}
	if makerID == checkerID {
		return ErrBypassSameApprover
	}
	if reason == "" {
		return ErrBypassNoReason
	}
	if ttl <= 0 {
		return ErrBypassBadTTL
	}
	if ttl > MaxBypassTTL {
		return ErrBypassTTLTooLong
	}
	return nil
}

// HasTradingAccess is the single access gate the trading module consults. Access
// is granted IFF the record is APPROVED, or BYPASSED and not past its expiry.
// A nil bypass expiry on a BYPASSED record is treated as expired (fail-closed) —
// a bypass must always carry a time-box.
func HasTradingAccess(status Status, bypassExpiresAt *time.Time, now time.Time) bool {
	switch status {
	case StatusApproved:
		return true
	case StatusBypassed:
		return bypassExpiresAt != nil && now.Before(*bypassExpiresAt)
	default:
		return false
	}
}

// BypassExpired reports whether a BYPASSED record has passed its time-box and
// should be swept to EXPIRED.
func BypassExpired(status Status, bypassExpiresAt *time.Time, now time.Time) bool {
	if status != StatusBypassed {
		return false
	}
	return bypassExpiresAt == nil || !now.Before(*bypassExpiresAt)
}
