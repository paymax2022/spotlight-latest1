package connectsafety_test

import (
	"testing"

	connectsafety "spotlight/backend/internal/connect/safety"
)

// TestValidCaseType verifies the case types match the DB CHECK constraint.
func TestValidCaseType(t *testing.T) {
	valid := []string{"harassment", "scam", "impersonation", "underage",
		"inappropriate_media", "off_platform", "safety", "other"}
	for _, v := range valid {
		if !connectsafety.ValidCaseType(v) {
			t.Errorf("expected %q to be a valid case type", v)
		}
	}
	if connectsafety.ValidCaseType("sextortion") {
		t.Error("unexpected case type should be rejected")
	}
	if connectsafety.ValidCaseType("") {
		t.Error("empty case type must be rejected")
	}
}

// TestValidCaseStatus verifies the case lifecycle states.
func TestValidCaseStatus(t *testing.T) {
	for _, v := range []string{"open", "investigating", "resolved", "closed"} {
		if !connectsafety.ValidCaseStatus(v) {
			t.Errorf("expected %q to be a valid status", v)
		}
	}
	if connectsafety.ValidCaseStatus("reopened") {
		t.Error("unknown status must be rejected")
	}
}

// TestValidCaseResolution verifies allowed resolutions.
func TestValidCaseResolution(t *testing.T) {
	for _, v := range []string{"no_action", "warned", "restricted", "suspended", "banned", "escalated"} {
		if !connectsafety.ValidCaseResolution(v) {
			t.Errorf("expected %q to be a valid resolution", v)
		}
	}
	if connectsafety.ValidCaseResolution("ignored") {
		t.Error("unknown resolution must be rejected")
	}
}

// TestReportRequestMapsToValidCaseType verifies that every report type a member
// can file is an allowed case type (invariant 7: a report must be able to open a
// connect_case). If a new report type is added without a matching case type, the
// handler would 400 it — this test guards that contract.
func TestReportRequestMapsToValidCaseType(t *testing.T) {
	reportTypes := []string{
		"harassment", "scam", "impersonation", "underage",
		"inappropriate_media", "off_platform", "safety", "other",
	}
	for _, rt := range reportTypes {
		req := connectsafety.ReportRequest{SubjectID: "u-2", Type: rt}
		if !connectsafety.ValidCaseType(req.Type) {
			t.Errorf("report type %q must map to a valid case type so it can open a case", rt)
		}
	}
	// A bogus report type must be rejected before any case is opened.
	if connectsafety.ValidCaseType("nonsense") {
		t.Error("unknown report type must be rejected")
	}
}

// TestValidCaseSeverity verifies severity bands.
func TestValidCaseSeverity(t *testing.T) {
	for _, v := range []string{"low", "normal", "high", "critical"} {
		if !connectsafety.ValidCaseSeverity(v) {
			t.Errorf("expected %q to be a valid severity", v)
		}
	}
	if connectsafety.ValidCaseSeverity("urgent") {
		t.Error("unknown severity must be rejected")
	}
}

// TestSeverityForReport pins the TS-003 intake severity routing: child-safety and
// potential-CSAM categories auto-escalate to critical, threat/safety reports to
// high, everything else stays normal, and unknown types fail safe to normal.
func TestSeverityForReport(t *testing.T) {
	cases := map[string]string{
		"underage":            "critical",
		"inappropriate_media": "critical",
		"safety":              "high",
		"harassment":          "normal",
		"scam":                "normal",
		"impersonation":       "normal",
		"off_platform":        "normal",
		"other":               "normal",
		"totally_unknown":     "normal", // fail-safe default
	}
	for typ, want := range cases {
		if got := connectsafety.SeverityForReport(typ); got != want {
			t.Errorf("SeverityForReport(%q) = %q, want %q", typ, got, want)
		}
		// Every derived severity must be a valid DB severity.
		if !connectsafety.ValidCaseSeverity(connectsafety.SeverityForReport(typ)) {
			t.Errorf("SeverityForReport(%q) produced an invalid severity", typ)
		}
	}
}
