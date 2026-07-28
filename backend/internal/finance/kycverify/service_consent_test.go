package kycverify

import (
	"errors"
	"testing"
)

// The consent gate is fail-closed: without recorded consent a check is refused
// (ErrConsentRequired); with consent it proceeds. This is the invariant enforced
// by RunCheck before any provider is ever contacted.
func TestConsentGate_FailClosed(t *testing.T) {
	if err := consentGate(false); !errors.Is(err, ErrConsentRequired) {
		t.Errorf("no consent must return ErrConsentRequired, got %v", err)
	}
	if err := consentGate(true); err != nil {
		t.Errorf("with consent the gate must pass, got %v", err)
	}
}

// StartSession rejects out-of-range target tiers before any DB work.
func TestStartSession_TierValidation(t *testing.T) {
	s := &Service{} // no deps needed: validation happens before repo use
	for _, bad := range []int{0, 4, -1, 99} {
		if _, err := s.StartSession(nil, "user-1", bad); !errors.Is(err, ErrInvalidTier) {
			t.Errorf("tier %d must be rejected with ErrInvalidTier, got %v", bad, err)
		}
	}
	// Empty user id is forbidden.
	if _, err := s.StartSession(nil, "", 1); !errors.Is(err, ErrForbidden) {
		t.Errorf("empty user must be ErrForbidden, got %v", err)
	}
}
