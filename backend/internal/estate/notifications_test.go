package estate

import "testing"

// TestEstateNotificationTaxonomy verifies the full Block 43 set of 18 types is
// defined and unique.
func TestEstateNotificationTaxonomy(t *testing.T) {
	if len(EstateNotificationTypes) != 18 {
		t.Fatalf("expected 18 estate notification types, got %d", len(EstateNotificationTypes))
	}
	seen := map[string]bool{}
	for _, ty := range EstateNotificationTypes {
		if ty == "" {
			t.Error("notification type must not be empty")
		}
		if seen[ty] {
			t.Errorf("duplicate notification type %q", ty)
		}
		seen[ty] = true
	}
}

// TestNotifCategoryWithinDomain verifies every type maps to a category permitted
// by the estate_notifications.category CHECK constraint.
func TestNotifCategoryWithinDomain(t *testing.T) {
	allowed := map[string]bool{
		"general": true, "payment": true, "meeting": true, "election": true,
		"security": true, "maintenance": true, "facility": true,
		"announcement": true, "system": true,
	}
	for _, ty := range EstateNotificationTypes {
		cat := notifCategory(ty)
		if !allowed[cat] {
			t.Errorf("type %q → category %q is outside the CHECK domain", ty, cat)
		}
	}
	// Unknown types fall back to a safe default.
	if notifCategory("totally_unknown") != "general" {
		t.Error("unknown notification type must map to 'general'")
	}
}

// TestNotifCategorySpotChecks pins a few representative mappings.
func TestNotifCategorySpotChecks(t *testing.T) {
	cases := map[string]string{
		NotifPaymentDue:               "payment",
		NotifRestrictionApplied:       "payment",
		NotifEmergencyAlert:           "security",
		NotifVisitorArrived:           "security",
		NotifRepairUpdate:             "maintenance",
		NotifFacilityBookingConfirmed: "facility",
		NotifAnnouncement:             "announcement",
		NotifElectionResult:           "election",
		NotifMeetingReminder:          "meeting",
		NotifTaskAssigned:             "general",
		NotifAdminApprovalRequired:    "system",
	}
	for ty, want := range cases {
		if got := notifCategory(ty); got != want {
			t.Errorf("notifCategory(%q) = %q, want %q", ty, got, want)
		}
	}
}

// TestNotifDeepLinkNonEmpty ensures every type yields a non-empty deep link.
func TestNotifDeepLinkNonEmpty(t *testing.T) {
	for _, ty := range EstateNotificationTypes {
		if notifDeepLink(ty) == "" {
			t.Errorf("type %q produced an empty deep link", ty)
		}
	}
}
