package kycverify

import (
	"testing"

	"spotlight/backend/internal/provider"
)

func TestCanTransitionCheck_Guards(t *testing.T) {
	ok := CanTransitionCheck(provider.KycInitiated, provider.KycPending) &&
		CanTransitionCheck(provider.KycPending, provider.KycPassed) &&
		CanTransitionCheck(provider.KycReview, provider.KycFailed)
	if !ok {
		t.Fatal("legal transitions must be allowed")
	}
	// Illegal: terminal PASSED cannot flip to FAILED; PENDING cannot go back to INITIATED.
	if CanTransitionCheck(provider.KycPassed, provider.KycFailed) {
		t.Fatal("PASSED is terminal")
	}
	if CanTransitionCheck(provider.KycPending, provider.KycInitiated) {
		t.Fatal("cannot revert PENDING → INITIATED")
	}
}

func TestResolveSession_Tier2Verified(t *testing.T) {
	st := map[provider.KycCheckType]provider.KycCheckStatus{
		provider.KycIDNumber: provider.KycPassed,
		provider.KycLiveness: provider.KycPassed, // satisfies the (facial OR liveness) group
	}
	if got := ResolveSessionStatus(2, st); got != SessTierVerified {
		t.Fatalf("tier2 with ID + liveness passed = %s, want TIER_VERIFIED", got)
	}
}

func TestResolveSession_PendingWhenIncomplete(t *testing.T) {
	st := map[provider.KycCheckType]provider.KycCheckStatus{
		provider.KycIDNumber: provider.KycPassed, // facial/liveness not yet done
	}
	if got := ResolveSessionStatus(2, st); got != SessTierPending {
		t.Fatalf("incomplete tier2 = %s, want TIER_PENDING", got)
	}
}

func TestResolveSession_ReviewWins(t *testing.T) {
	st := map[provider.KycCheckType]provider.KycCheckStatus{
		provider.KycIDNumber: provider.KycPassed,
		provider.KycIDFacial: provider.KycReview,
	}
	if got := ResolveSessionStatus(2, st); got != SessNeedsReview {
		t.Fatalf("a REVIEW must force NEEDS_REVIEW, got %s", got)
	}
}

func TestResolveSession_FailedWhenGroupImpossible(t *testing.T) {
	// Both options of the biometric group failed → tier is impossible → FAILED.
	st := map[provider.KycCheckType]provider.KycCheckStatus{
		provider.KycIDNumber: provider.KycPassed,
		provider.KycIDFacial: provider.KycFailed,
		provider.KycLiveness: provider.KycFailed,
	}
	if got := ResolveSessionStatus(2, st); got != SessTierFailed {
		t.Fatalf("both biometric options failed = %s, want TIER_FAILED", got)
	}
}

func TestResolveSession_NeverElevatesWithoutIDNumber(t *testing.T) {
	// Tier never elevates without the full required set: ID_NUMBER missing.
	st := map[provider.KycCheckType]provider.KycCheckStatus{
		provider.KycLiveness: provider.KycPassed,
	}
	if got := ResolveSessionStatus(2, st); got == SessTierVerified {
		t.Fatal("must not verify tier2 without ID_NUMBER passing")
	}
}

func TestGateFacial(t *testing.T) {
	if GateFacial(true, 85, 70) != provider.KycPassed {
		t.Fatal("high-confidence match must PASS")
	}
	if GateFacial(true, 55, 70) != provider.KycReview {
		t.Fatal("below-threshold positive must go to REVIEW, not fail")
	}
	if GateFacial(false, 0, 70) != provider.KycFailed {
		t.Fatal("no signal must FAIL")
	}
}
