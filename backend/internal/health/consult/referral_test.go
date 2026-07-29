package healthconsult

import (
	"errors"
	"testing"
)

// TS-5 TM-007 (referral to specialist / in-person generated). Pure validation of the
// referral record — deterministic, no I/O.

func TestValidateReferral(t *testing.T) {
	provider := "prov-1"

	// A well-formed in-person referral.
	if err := validateReferral(ReferralInput{Type: ReferralInPerson, Reason: "needs physical exam"}); err != nil {
		t.Fatalf("valid in-person referral must pass, got %v", err)
	}
	// A specialty referral naming a specialty.
	if err := validateReferral(ReferralInput{Type: ReferralSpecialty, Specialty: "Cardiology", Reason: "murmur"}); err != nil {
		t.Fatalf("valid specialty referral must pass, got %v", err)
	}
	// A specialty referral naming a specific provider (no free-text specialty) is fine.
	if err := validateReferral(ReferralInput{Type: ReferralSpecialty, TargetProviderID: &provider, Reason: "refer to Dr X"}); err != nil {
		t.Fatalf("specialty referral with a target provider must pass, got %v", err)
	}
}

func TestValidateReferral_Rejections(t *testing.T) {
	// Unknown type.
	if err := validateReferral(ReferralInput{Type: "MAGIC", Reason: "x"}); !errors.Is(err, ErrInvalidReferralType) {
		t.Fatalf("unknown referral type must be rejected, got %v", err)
	}
	// Missing reason.
	if err := validateReferral(ReferralInput{Type: ReferralInPerson, Reason: "  "}); !errors.Is(err, ErrReferralReasonRequired) {
		t.Fatalf("missing reason must be rejected, got %v", err)
	}
	// Specialty referral with neither a specialty nor a target provider — unroutable.
	if err := validateReferral(ReferralInput{Type: ReferralSpecialty, Reason: "refer somewhere"}); !errors.Is(err, ErrReferralTargetRequired) {
		t.Fatalf("unroutable specialty referral must be rejected, got %v", err)
	}
}
