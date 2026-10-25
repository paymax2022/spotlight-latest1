package estate

import (
	"testing"
	"time"
)

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

// TestNotifPrefColumnMapping pins the preference-toggle mapping (EST-UAT-0357):
// every mutable category resolves to a real estate_member_settings column, and
// the safety/legal-exempt types resolve to "" (always delivered).
func TestNotifPrefColumnMapping(t *testing.T) {
	cases := map[string]string{
		NotifPaymentDue:               "notify_payments",
		NotifPaymentOverdue:           "notify_payments",
		NotifRestrictionApplied:       "notify_payments",
		NotifMeetingReminder:          "notify_meetings",
		NotifElectionReminder:         "notify_elections",
		NotifElectionResult:           "notify_elections",
		NotifVisitorArrived:           "notify_security",
		NotifVisitorDenied:            "notify_security",
		NotifRepairUpdate:             "notify_maintenance",
		NotifVendorAssigned:           "notify_maintenance",
		NotifFacilityBookingConfirmed: "notify_maintenance",
		NotifAnnouncement:             "notify_announcements",
		// Safety/legal notices are never user-mutable.
		NotifEmergencyAlert:        "",
		NotifAdminApprovalRequired: "",
		// Uncategorized types default to always-deliver.
		NotifTaskAssigned: "",
		"totally_unknown": "",
	}
	for ty, want := range cases {
		if got := notifPrefColumn(ty); got != want {
			t.Errorf("notifPrefColumn(%q) = %q, want %q", ty, got, want)
		}
	}
	// Whatever the function returns must be a real settings column (the SQL is
	// interpolated, so a wrong literal would 500 at runtime).
	validCols := map[string]bool{
		"notify_payments": true, "notify_meetings": true, "notify_elections": true,
		"notify_security": true, "notify_maintenance": true, "notify_announcements": true,
		"": true,
	}
	for _, ty := range EstateNotificationTypes {
		if col := notifPrefColumn(ty); !validCols[col] {
			t.Errorf("notifPrefColumn(%q) = %q — not an estate_member_settings column", ty, col)
		}
	}
}

// TestNotifDedupeWindowBound pins the replay-dedupe contract (EST-UAT-0355):
// positive and short enough that legitimate periodic re-sends still deliver.
func TestNotifDedupeWindowBound(t *testing.T) {
	if notifDedupeWindow <= 0 {
		t.Error("dedupe window must be positive")
	}
	if notifDedupeWindow > time.Hour {
		t.Errorf("dedupe window %v too long — would collapse legitimate reminders", notifDedupeWindow)
	}
}
