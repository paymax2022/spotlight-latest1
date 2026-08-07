package estate

import (
	"reflect"
	"sort"
	"testing"
)

// TestEvaluateEligibility exhaustively covers the Block 31 voter gating policy.
func TestEvaluateEligibility(t *testing.T) {
	tests := []struct {
		name        string
		rules       EligibilityRules
		kycVerified bool
		kycAvail    bool
		dues        bool
		voterType   string
		eligible    bool
		reasons     []string
	}{
		{
			name:     "no rules → eligible",
			rules:    EligibilityRules{},
			eligible: true,
		},
		{
			name:        "kyc required + verified → eligible",
			rules:       EligibilityRules{RequireKYC: true},
			kycVerified: true, kycAvail: true,
			eligible: true,
		},
		{
			name:     "kyc required + unverified → blocked",
			rules:    EligibilityRules{RequireKYC: true},
			kycAvail: true,
			eligible: false, reasons: []string{ReasonKYCRequired},
		},
		{
			name:     "kyc required but verifier unavailable → fail closed",
			rules:    EligibilityRules{RequireKYC: true},
			kycAvail: false,
			eligible: false, reasons: []string{ReasonKYCUnavailable},
		},
		{
			name:     "payment required + outstanding dues → blocked",
			rules:    EligibilityRules{RequirePayment: true},
			dues:     true,
			eligible: false, reasons: []string{ReasonOutstandingDues},
		},
		{
			name:     "payment required + cleared → eligible",
			rules:    EligibilityRules{RequirePayment: true},
			dues:     false,
			eligible: true,
		},
		{
			name:      "resident type match → eligible",
			rules:     EligibilityRules{ResidentTypes: []string{"homeowner", "landlord"}},
			voterType: "homeowner",
			eligible:  true,
		},
		{
			name:      "resident type mismatch → blocked",
			rules:     EligibilityRules{ResidentTypes: []string{"homeowner"}},
			voterType: "tenant",
			eligible:  false, reasons: []string{ReasonResidentTypeError},
		},
		{
			name:     "multiple failures accumulate",
			rules:    EligibilityRules{RequireKYC: true, RequirePayment: true, ResidentTypes: []string{"homeowner"}},
			kycAvail: true, kycVerified: false, dues: true, voterType: "tenant",
			eligible: false,
			reasons:  []string{ReasonKYCRequired, ReasonOutstandingDues, ReasonResidentTypeError},
		},
		{
			name:     "all requirements satisfied",
			rules:    EligibilityRules{RequireKYC: true, RequirePayment: true, ResidentTypes: []string{"homeowner"}},
			kycAvail: true, kycVerified: true, dues: false, voterType: "homeowner",
			eligible: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := evaluateEligibility(tt.rules, tt.kycVerified, tt.kycAvail, tt.dues, tt.voterType)
			if got.Eligible != tt.eligible {
				t.Fatalf("Eligible = %v, want %v (reasons=%v)", got.Eligible, tt.eligible, got.Reasons)
			}
			gr, wr := append([]string{}, got.Reasons...), append([]string{}, tt.reasons...)
			sort.Strings(gr)
			sort.Strings(wr)
			if len(gr) != 0 || len(wr) != 0 {
				if !reflect.DeepEqual(gr, wr) {
					t.Errorf("reasons = %v, want %v", got.Reasons, tt.reasons)
				}
			}
		})
	}
}

func TestContainsString(t *testing.T) {
	xs := []string{"a", "b", "c"}
	if !containsString(xs, "b") {
		t.Error("expected to find b")
	}
	if containsString(xs, "z") {
		t.Error("did not expect to find z")
	}
	if containsString(nil, "a") {
		t.Error("empty slice contains nothing")
	}
}
