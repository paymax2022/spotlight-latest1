package estate

import "testing"

// TestAlertSeverity pins the emergency-alert kind → dashboard severity mapping
// used by the resident home dashboard (Block 26).
func TestAlertSeverity(t *testing.T) {
	cases := map[string]string{
		"fire":     "critical",
		"medical":  "critical",
		"panic":    "critical",
		"security": "high",
		"theft":    "high",
		"domestic": "high",
		"noise":    "medium",
		"other":    "medium",
		"":         "medium", // unknown defaults to medium, never empty
	}
	for kind, want := range cases {
		if got := alertSeverity(kind); got != want {
			t.Errorf("alertSeverity(%q) = %q, want %q", kind, got, want)
		}
	}
}
