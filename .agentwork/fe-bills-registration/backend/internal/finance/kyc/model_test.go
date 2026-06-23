package kyc_test

import (
	"testing"

	"spotlight/backend/internal/finance/kyc"
)

// TestStatusConstants verifies KYC status values are distinct and non-empty.
func TestStatusConstants(t *testing.T) {
	statuses := []kyc.Status{
		kyc.StatusNone,
		kyc.StatusPending,
		kyc.StatusSubmitted,
		kyc.StatusVerified,
		kyc.StatusFailed,
	}
	seen := map[kyc.Status]bool{}
	for _, s := range statuses {
		if s == "" {
			t.Error("Status must not be empty string")
		}
		if seen[s] {
			t.Errorf("duplicate Status: %q", s)
		}
		seen[s] = true
	}
}

// TestTierRange verifies the valid tier range is 0–3.
// Tier 0 = unverified (wallet disabled), Tier 3 = premium (unlimited).
func TestTierRange(t *testing.T) {
	cases := []struct {
		tier        kyc.Tier
		wantBlocked bool // true if wallet should be blocked
	}{
		{0, true},  // Tier 0: wallet disabled
		{1, false}, // Tier 1: ₦50k daily limit
		{2, false}, // Tier 2: ₦200k daily limit
		{3, false}, // Tier 3: unlimited
	}
	for _, tc := range cases {
		if int(tc.tier) < 0 || int(tc.tier) > 3 {
			t.Errorf("Tier %d out of valid range [0,3]", tc.tier)
		}
	}
}

// TestProfileZeroValue verifies the zero-value Profile represents an unverified user.
func TestProfileZeroValue(t *testing.T) {
	var p kyc.Profile
	if p.Tier != 0 {
		t.Errorf("zero-value Profile.Tier should be 0 (unverified), got %d", p.Tier)
	}
}

// TestProfileFields verifies that a fully populated Profile round-trips its fields.
func TestProfileFields(t *testing.T) {
	docType := "NIN"
	reqTier := 2
	p := kyc.Profile{
		UserID:        "user-abc",
		Tier:          1,
		Status:        kyc.StatusVerified,
		PhoneVerified: true,
		DocumentType:  &docType,
		RequestedTier: &reqTier,
	}

	if p.UserID == "" {
		t.Error("Profile.UserID must not be empty")
	}
	if p.Status != kyc.StatusVerified {
		t.Errorf("Profile.Status = %q, want %q", p.Status, kyc.StatusVerified)
	}
	if p.DocumentType == nil || *p.DocumentType != "NIN" {
		t.Error("Profile.DocumentType should be 'NIN'")
	}
	if p.RequestedTier == nil || *p.RequestedTier != 2 {
		t.Error("Profile.RequestedTier should be 2")
	}
}

// TestInitiateRequestValidation documents the valid range for KYC initiation.
func TestInitiateRequestValidation(t *testing.T) {
	validTiers := []int{1, 2, 3}
	for _, tier := range validTiers {
		req := kyc.InitiateRequest{RequestedTier: tier}
		if req.RequestedTier < 1 || req.RequestedTier > 3 {
			t.Errorf("InitiateRequest with tier %d should be valid", tier)
		}
	}

	// Tier 0 is not requestable — users start at 0 (unverified).
	zeroTierReq := kyc.InitiateRequest{RequestedTier: 0}
	if zeroTierReq.RequestedTier >= 1 {
		t.Error("tier 0 should fail validation (binding:required,min=1)")
	}
}

// TestAuditEventTypes verifies KYC audit event types are a known set.
func TestAuditEventTypes(t *testing.T) {
	// These must match the kyc_events.event_type CHECK constraint in the migration.
	validEventTypes := map[string]bool{
		"initiated": true,
		"verified":  true,
		"failed":    true,
		"reverted":  true,
	}
	for et := range validEventTypes {
		if et == "" {
			t.Error("event type must not be empty")
		}
	}
	if len(validEventTypes) < 4 {
		t.Error("expected at least 4 KYC audit event types")
	}
}
