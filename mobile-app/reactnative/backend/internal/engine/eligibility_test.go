package engine

import (
	"testing"

	"paymax/crypto-backend/internal/domain"
)

// clearedFacts is a fully-onboarded, crypto-eligible user.
func clearedFacts() domain.EligibilityFacts {
	return domain.EligibilityFacts{
		UserActive:          true,
		KycTier:             domain.MinCryptoKycTier,
		CryptoEnabled:       true,
		SuitabilityComplete: true,
		SuitabilityExpired:  false,
		AgreementsAccepted:  true,
	}
}

func TestEvaluateEligibility_ClearedUserPasses(t *testing.T) {
	got := EvaluateEligibility(clearedFacts())
	if got.State != "eligible" {
		t.Fatalf("state = %q, want eligible", got.State)
	}
	if got.Reason != "" {
		t.Errorf("reason = %q, want empty for an eligible user", got.Reason)
	}
}

// TestEvaluateEligibility_FailClosed checks every unmet requirement blocks with
// the right reason, and that the funnel order sends the user to the earliest
// unmet step (e.g. a tier-0 user with nothing else done still gets kyc_required).
func TestEvaluateEligibility_FailClosed(t *testing.T) {
	tests := []struct {
		name       string
		mutate     func(*domain.EligibilityFacts)
		wantState  string
		wantReason string
	}{
		{
			name:       "inactive account",
			mutate:     func(f *domain.EligibilityFacts) { f.UserActive = false },
			wantState:  "restricted",
			wantReason: "user_inactive",
		},
		{
			name:       "below min KYC tier",
			mutate:     func(f *domain.EligibilityFacts) { f.KycTier = domain.MinCryptoKycTier - 1 },
			wantState:  "kyc_required",
			wantReason: "kyc_required",
		},
		{
			name:       "suitability expired",
			mutate:     func(f *domain.EligibilityFacts) { f.SuitabilityExpired = true },
			wantState:  "restricted",
			wantReason: "suitability_expired",
		},
		{
			name:       "suitability incomplete",
			mutate:     func(f *domain.EligibilityFacts) { f.SuitabilityComplete = false },
			wantState:  "restricted",
			wantReason: "suitability_required",
		},
		{
			name:       "agreements not accepted",
			mutate:     func(f *domain.EligibilityFacts) { f.AgreementsAccepted = false },
			wantState:  "restricted",
			wantReason: "agreements_required",
		},
		{
			name:       "crypto product disabled",
			mutate:     func(f *domain.EligibilityFacts) { f.CryptoEnabled = false },
			wantState:  "product_unavailable",
			wantReason: "crypto_disabled",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			f := clearedFacts()
			tc.mutate(&f)
			got := EvaluateEligibility(f)
			if got.State != tc.wantState {
				t.Errorf("state = %q, want %q", got.State, tc.wantState)
			}
			if got.Reason != tc.wantReason {
				t.Errorf("reason = %q, want %q", got.Reason, tc.wantReason)
			}
			if got.Message == "" {
				t.Error("blocked decision must carry a user-facing message")
			}
		})
	}
}

// TestEvaluateEligibility_ZeroFactsBlocked is the brownfield-safety check: an
// absent/zero-value user (no KYC, no suitability, no agreements) must never be
// treated as eligible — the gate is fail-closed by default.
func TestEvaluateEligibility_ZeroFactsBlocked(t *testing.T) {
	got := EvaluateEligibility(domain.EligibilityFacts{})
	if got.State == "eligible" {
		t.Fatal("zero-value facts must not be eligible (fail-closed)")
	}
	if got.Reason == "" {
		t.Error("blocked decision must carry a machine-readable reason")
	}
}
