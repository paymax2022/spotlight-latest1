package connectonboarding_test

import (
	"testing"

	connectonboarding "spotlight/backend/internal/connect/onboarding"
)

func TestValidConsentKind(t *testing.T) {
	for _, k := range []string{"terms", "privacy", "community_guidelines"} {
		if !connectonboarding.ValidConsentKind(k) {
			t.Errorf("expected %q to be a valid consent kind", k)
		}
	}
	if connectonboarding.ValidConsentKind("marketing") {
		t.Error("unknown consent kind must be rejected")
	}
	if connectonboarding.ValidConsentKind("") {
		t.Error("empty consent kind must be rejected")
	}
}

func TestRequiredConsentsComplete(t *testing.T) {
	// All three consents are required for onboarding completion.
	if len(connectonboarding.RequiredConsents) != 3 {
		t.Errorf("expected 3 required consents, got %d", len(connectonboarding.RequiredConsents))
	}
	for _, k := range []string{"terms", "privacy", "community_guidelines"} {
		if connectonboarding.RequiredConsents[k] == "" {
			t.Errorf("required consent %q must carry a current version", k)
		}
	}
}
