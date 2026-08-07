package kycverify

import "spotlight/backend/internal/provider"

// Guarded state machines (pure logic — no DB/network, unit-tested). Illegal
// transitions are structurally blocked; a tier never elevates without its full
// required check set passing.

// checkTransitions is the allowed per-check status graph.
//
//	INITIATED → PENDING → PASSED | FAILED | REVIEW  (terminal)
var checkTransitions = map[provider.KycCheckStatus]map[provider.KycCheckStatus]bool{
	provider.KycInitiated: {provider.KycPending: true, provider.KycPassed: true, provider.KycFailed: true, provider.KycReview: true},
	provider.KycPending:   {provider.KycPassed: true, provider.KycFailed: true, provider.KycReview: true},
	provider.KycPassed:    {},                                                   // terminal
	provider.KycFailed:    {},                                                   // terminal
	provider.KycReview:    {provider.KycPassed: true, provider.KycFailed: true}, // admin resolves a review
}

// CanTransitionCheck reports whether a check may move from → to.
func CanTransitionCheck(from, to provider.KycCheckStatus) bool {
	if from == to {
		return true // idempotent re-write of the same terminal status
	}
	return checkTransitions[from][to]
}

// sessionTransitions is the allowed session status graph.
var sessionTransitions = map[SessionStatus]map[SessionStatus]bool{
	SessUnverified:   {SessTierPending: true},
	SessTierPending:  {SessTierVerified: true, SessTierFailed: true, SessNeedsReview: true},
	SessNeedsReview:  {SessApproved: true, SessRejected: true, SessTierVerified: true, SessTierFailed: true},
	SessTierFailed:   {SessTierPending: true}, // retry
	SessRejected:     {SessTierPending: true}, // retry after rejection
	SessTierVerified: {},                      // terminal (for this target tier)
	SessApproved:     {},
}

// CanTransitionSession reports whether a session may move from → to.
func CanTransitionSession(from, to SessionStatus) bool {
	if from == to {
		return true
	}
	return sessionTransitions[from][to]
}

// RequiredChecks returns the check groups a target tier needs. Each inner group
// is an OR-set: at least one check in the group must PASS. All groups must be
// satisfied for the tier (§3 CBN model).
//
//	Tier 1: ID_NUMBER
//	Tier 2: Tier 1 + (ID_FACIAL OR LIVENESS)
//	Tier 3: Tier 2 + DOCUMENT + AML
func RequiredChecks(targetTier int) [][]provider.KycCheckType {
	switch targetTier {
	case 1:
		return [][]provider.KycCheckType{{provider.KycIDNumber}}
	case 2:
		return [][]provider.KycCheckType{
			{provider.KycIDNumber},
			{provider.KycIDFacial, provider.KycLiveness},
		}
	case 3:
		return [][]provider.KycCheckType{
			{provider.KycIDNumber},
			{provider.KycIDFacial, provider.KycLiveness},
			{provider.KycDocument},
			{provider.KycAML},
		}
	default:
		return nil
	}
}

// ResolveSessionStatus computes the session status from the current check
// statuses for a target tier. Precedence:
//   - any relevant check in REVIEW → NEEDS_REVIEW (human decides)
//   - every required group has a PASSED check → TIER_VERIFIED
//   - a required group is impossible (all its checks FAILED, none pending/review)
//     → TIER_FAILED
//   - otherwise → TIER_PENDING
//
// statusByType is the best-known status per check type in the session.
func ResolveSessionStatus(targetTier int, statusByType map[provider.KycCheckType]provider.KycCheckStatus) SessionStatus {
	groups := RequiredChecks(targetTier)
	if len(groups) == 0 {
		return SessUnverified
	}

	// Any review among relevant checks halts to human review.
	for _, g := range groups {
		for _, ct := range g {
			if statusByType[ct] == provider.KycReview {
				return SessNeedsReview
			}
		}
	}

	allGroupsPassed := true
	anyGroupImpossible := false
	for _, g := range groups {
		groupPassed := false
		groupCanStillPass := false
		for _, ct := range g {
			switch statusByType[ct] {
			case provider.KycPassed:
				groupPassed = true
			case provider.KycInitiated, provider.KycPending, "":
				groupCanStillPass = true
			}
		}
		if !groupPassed {
			allGroupsPassed = false
			if !groupCanStillPass {
				anyGroupImpossible = true // every option in the group failed
			}
		}
	}

	switch {
	case allGroupsPassed:
		return SessTierVerified
	case anyGroupImpossible:
		return SessTierFailed
	default:
		return SessTierPending
	}
}

// GateFacial applies the confidence threshold to a facial/document result:
// at/above threshold with a match → PASSED; a positive-but-low score → REVIEW
// (never a silent fail); an explicit non-match → FAILED.
func GateFacial(match bool, confidence float64, threshold int) provider.KycCheckStatus {
	if match && confidence >= float64(threshold) {
		return provider.KycPassed
	}
	if confidence > 0 {
		return provider.KycReview
	}
	return provider.KycFailed
}
