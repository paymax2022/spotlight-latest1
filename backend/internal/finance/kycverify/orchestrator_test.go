package kycverify

import (
	"context"
	"testing"

	"spotlight/backend/internal/provider"
)

// fakeElevator records tier-elevation calls so a test can assert a tier is
// raised ONLY when the full required set passed.
type fakeElevator struct {
	called  bool
	userID  string
	newTier int
}

func (f *fakeElevator) ElevateTier(_ context.Context, userID string, newTier int, _ *string) error {
	f.called = true
	f.userID = userID
	f.newTier = newTier
	return nil
}

// shouldElevate mirrors the orchestrator's single elevation guard: elevate iff
// the resolved session status is exactly TIER_VERIFIED. Kept pure so the
// invariant "tier never elevates without a full pass" is directly testable.
func shouldElevate(resolved SessionStatus) bool { return resolved == SessTierVerified }

// Tier elevates ONLY when every required group passes (tier 2: ID_NUMBER + one
// of facial/liveness). Partial / review / fail must NOT elevate.
func TestElevation_OnlyOnFullPass(t *testing.T) {
	cases := []struct {
		name     string
		tier     int
		byType   map[provider.KycCheckType]provider.KycCheckStatus
		elevate  bool
		resolved SessionStatus
	}{
		{
			name:     "tier2 full pass",
			tier:     2,
			byType:   map[provider.KycCheckType]provider.KycCheckStatus{provider.KycIDNumber: provider.KycPassed, provider.KycLiveness: provider.KycPassed},
			elevate:  true,
			resolved: SessTierVerified,
		},
		{
			name:     "tier2 id only (facial pending) → pending, no elevate",
			tier:     2,
			byType:   map[provider.KycCheckType]provider.KycCheckStatus{provider.KycIDNumber: provider.KycPassed},
			elevate:  false,
			resolved: SessTierPending,
		},
		{
			name:     "tier2 facial in review → needs review, no elevate",
			tier:     2,
			byType:   map[provider.KycCheckType]provider.KycCheckStatus{provider.KycIDNumber: provider.KycPassed, provider.KycIDFacial: provider.KycReview},
			elevate:  false,
			resolved: SessNeedsReview,
		},
		{
			name:     "tier2 id failed → tier failed, no elevate",
			tier:     2,
			byType:   map[provider.KycCheckType]provider.KycCheckStatus{provider.KycIDNumber: provider.KycFailed, provider.KycLiveness: provider.KycPassed},
			elevate:  false,
			resolved: SessTierFailed,
		},
		{
			name:     "tier3 needs document+aml, only id+liveness → pending",
			tier:     3,
			byType:   map[provider.KycCheckType]provider.KycCheckStatus{provider.KycIDNumber: provider.KycPassed, provider.KycLiveness: provider.KycPassed},
			elevate:  false,
			resolved: SessTierPending,
		},
		{
			name:     "tier3 full pass",
			tier:     3,
			byType:   map[provider.KycCheckType]provider.KycCheckStatus{provider.KycIDNumber: provider.KycPassed, provider.KycLiveness: provider.KycPassed, provider.KycDocument: provider.KycPassed, provider.KycAML: provider.KycPassed},
			elevate:  true,
			resolved: SessTierVerified,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := ResolveSessionStatus(tc.tier, tc.byType)
			if got != tc.resolved {
				t.Fatalf("ResolveSessionStatus = %q, want %q", got, tc.resolved)
			}
			if shouldElevate(got) != tc.elevate {
				t.Errorf("shouldElevate(%q) = %v, want %v", got, shouldElevate(got), tc.elevate)
			}
		})
	}
}

// elevate() must be a no-op guard when the elevator is nil (degraded config), and
// must call through when set.
func TestOrchestrator_ElevateGuard(t *testing.T) {
	// nil elevator → no panic, no call.
	o := NewOrchestrator(nil, nil, nil)
	if err := o.elevate(context.Background(), "u1", 2, nil); err != nil {
		t.Errorf("nil elevator elevate must be a no-op, got %v", err)
	}

	fe := &fakeElevator{}
	o2 := NewOrchestrator(nil, nil, fe)
	if err := o2.elevate(context.Background(), "u2", 3, nil); err != nil {
		t.Fatalf("elevate error: %v", err)
	}
	if !fe.called || fe.userID != "u2" || fe.newTier != 3 {
		t.Errorf("elevator not called correctly: %+v", fe)
	}
}

// Guarded session transitions: only legal edges are permitted; a tier can never
// be marked verified straight from UNVERIFIED (must pass through TIER_PENDING).
func TestSessionTransitionGuards(t *testing.T) {
	if CanTransitionSession(SessUnverified, SessTierVerified) {
		t.Error("UNVERIFIED→TIER_VERIFIED must be illegal (no skipping the pending state)")
	}
	if !CanTransitionSession(SessUnverified, SessTierPending) {
		t.Error("UNVERIFIED→TIER_PENDING must be legal")
	}
	if !CanTransitionSession(SessTierPending, SessTierVerified) {
		t.Error("TIER_PENDING→TIER_VERIFIED must be legal")
	}
	if !CanTransitionSession(SessNeedsReview, SessTierVerified) {
		t.Error("NEEDS_REVIEW→TIER_VERIFIED must be legal (admin approve)")
	}
	if CanTransitionSession(SessTierVerified, SessTierPending) {
		t.Error("TIER_VERIFIED is terminal for the target tier")
	}
}
