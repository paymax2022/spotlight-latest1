package identity

import "testing"

// TestCanUnlock_MinorConsentGate covers the consent capability gate as a pure
// decision (no DB): a minor without active consent is denied; once the guardian
// consent flips pending → active (modelled here as hasActiveConsent = true) the
// same minor is unlocked. Non-minors bypass the consent rule entirely. The gate
// is fail-closed and tier-first.
func TestCanUnlock_MinorConsentGate(t *testing.T) {
	const minTier = 1 // e.g. CapabilityPurchases

	cases := []struct {
		name             string
		isMinor          bool
		hasActiveConsent bool
		kycTier          int
		wantOK           bool
		wantReason       string
	}{
		{
			name:    "minor without active consent is denied",
			isMinor: true, hasActiveConsent: false, kycTier: minTier,
			wantOK: false, wantReason: "guardian_consent_required",
		},
		{
			name:    "minor after pending->active consent is unlocked",
			isMinor: true, hasActiveConsent: true, kycTier: minTier,
			wantOK: true, wantReason: "",
		},
		{
			name:    "adult (non-minor) unlocks without any consent",
			isMinor: false, hasActiveConsent: false, kycTier: minTier,
			wantOK: true, wantReason: "",
		},
		{
			name:    "tier too low is reported before consent",
			isMinor: true, hasActiveConsent: false, kycTier: 0,
			wantOK: false, wantReason: "kyc_tier_too_low",
		},
		{
			name:    "adult with insufficient tier is denied",
			isMinor: false, hasActiveConsent: false, kycTier: 0,
			wantOK: false, wantReason: "kyc_tier_too_low",
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			ok, reason := canUnlock(c.isMinor, c.hasActiveConsent, c.kycTier, minTier)
			if ok != c.wantOK || reason != c.wantReason {
				t.Fatalf("canUnlock(minor=%v, consent=%v, tier=%d, min=%d) = (%v,%q); want (%v,%q)",
					c.isMinor, c.hasActiveConsent, c.kycTier, minTier, ok, reason, c.wantOK, c.wantReason)
			}
		})
	}
}

// TestCanUnlock_OpenCapability confirms that a tier-0 capability (e.g. learning
// content) is open to everyone, including adults at tier 0, while a minor still
// needs consent for any capability they are gated on.
func TestCanUnlock_OpenCapability(t *testing.T) {
	const openMinTier = 0
	if ok, reason := canUnlock(false, false, 0, openMinTier); !ok || reason != "" {
		t.Fatalf("open capability for adult: got (%v,%q), want (true,\"\")", ok, reason)
	}
	// A minor on an open-tier capability is still consent-gated.
	if ok, reason := canUnlock(true, false, 0, openMinTier); ok || reason != "guardian_consent_required" {
		t.Fatalf("open capability for minor w/o consent: got (%v,%q), want (false,guardian_consent_required)", ok, reason)
	}
}

// TestMinTierForCapability pins the capability → minimum-tier policy the gate
// reads. Curriculum/learning is open (tier 0); value-bearing or social
// capabilities require tier 1.
func TestMinTierForCapability(t *testing.T) {
	cases := map[string]int{
		CapabilityPurchases:   1,
		CapabilityCommunity:   1,
		CapabilityDataSharing: 1,
		"unknown_open":        0,
	}
	for cap, want := range cases {
		if got := minTierForCapability(cap); got != want {
			t.Errorf("minTierForCapability(%q) = %d; want %d", cap, got, want)
		}
	}
}

// TestValidRole_GrantGuard exercises the pure role guard GrantRole applies before
// the idempotent (ON CONFLICT DO NOTHING) insert. Invalid roles are rejected;
// valid roles pass. (DB-level insert idempotency is asserted at the repo layer.)
func TestValidRole_GrantGuard(t *testing.T) {
	valid := []Role{RoleLearner, RoleParent, RoleTutor, RoleStaff}
	for _, r := range valid {
		if !ValidRole(r) {
			t.Errorf("ValidRole(%q) = false; want true", r)
		}
	}
	invalid := []Role{"", "admin", "Learner", "guardian"}
	for _, r := range invalid {
		if ValidRole(r) {
			t.Errorf("ValidRole(%q) = true; want false", r)
		}
	}
}
