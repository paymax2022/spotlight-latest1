package feesschool

// ── Verification-tier state machine (build-spec §2 School.verification_tier) ─────
//
// The verification tier is the school's trust level. It is advanced ONLY by an admin
// action (Verify); a school owner can never move their own tier. The guard below is
// PURE (no DB, unit-testable in school_test.go), mirroring the shared feesstatemachine
// package's per-machine `CanTransition` style — kept in-package because the shared
// statemachine package (T0.3) does not define a verification-tier machine and MUST NOT
// be modified by this task.
//
//	unverified → pending      (school submits docs / admin starts review)
//	pending    → verified     (admin approves CAC / reference checks)
//	verified   → premium      (admin promotes to premium tier)
//	premium    → verified     (admin demotes)
//	verified   → pending      (admin re-opens review, e.g. dispute)
//	pending    → unverified   (admin rejects, back to start)
//
// No transition may SKIP a step forward (e.g. unverified→verified is illegal): review
// must pass through `pending` first. Backward/demotion moves are allowed for admins so
// a disputed school can be re-reviewed or demoted.

// tierTransitions is the legal adjacency for the verification-tier SM.
var tierTransitions = map[VerificationTier]map[VerificationTier]bool{
	TierUnverified: {TierPending: true},
	TierPending:    {TierVerified: true, TierUnverified: true},
	TierVerified:   {TierPremium: true, TierPending: true},
	TierPremium:    {TierVerified: true},
}

// validTier reports whether t is a known verification tier (matches the DB CHECK).
func validTier(t VerificationTier) bool {
	switch t {
	case TierUnverified, TierPending, TierVerified, TierPremium:
		return true
	default:
		return false
	}
}

// CanVerifyTransition reports whether from→to is a legal verification-tier move. Pure.
func CanVerifyTransition(from, to VerificationTier) bool {
	targets, ok := tierTransitions[from]
	if !ok {
		return false
	}
	return targets[to]
}

// VerifyTransition validates from→to and returns the target tier or a typed error.
// An unknown target tier yields ErrInvalidTier; a known-but-illegal move yields
// ErrIllegalTierMove. Never mutates anything — the guarded UPDATE lives in the repo.
func VerifyTransition(from, to VerificationTier) (VerificationTier, error) {
	if !validTier(to) {
		return from, ErrInvalidTier
	}
	if !validTier(from) {
		return from, ErrIllegalTierMove
	}
	if CanVerifyTransition(from, to) {
		return to, nil
	}
	return from, ErrIllegalTierMove
}
