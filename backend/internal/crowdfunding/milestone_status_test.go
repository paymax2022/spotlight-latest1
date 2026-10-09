package crowdfunding

import "testing"

// Pins creation-time milestone statuses: RELEASED/PENDING_REVIEW are earned
// states — a fresh milestone must never start there.
// This is internal-only (no HTTP route exercises a rejected value directly —
// the E2E submit path always sends valid input).
func TestSubmitMilestoneStatus(t *testing.T) {
	cases := []struct {
		raw   string
		index int
		want  string
		err   bool
	}{
		{"", 0, "ACTIVE", false}, // first milestone defaults to in-progress
		{"", 1, "LOCKED", false}, // later milestones default locked
		{"locked", 0, "LOCKED", false},
		{"ACTIVE", 2, "ACTIVE", false},
		{"RELEASED", 0, "", true},       // earned state — not creator-settable
		{"PENDING_REVIEW", 0, "", true}, // earned state — not creator-settable
		{"released", 1, "", true},       // case-insensitive rejection
		{"GARBAGE", 0, "", true},
	}
	for _, tc := range cases {
		got, err := submitMilestoneStatus(tc.raw, tc.index)
		if tc.err {
			if err == nil {
				t.Errorf("submitMilestoneStatus(%q,%d): expected error, got %q", tc.raw, tc.index, got)
			}
			continue
		}
		if err != nil || got != tc.want {
			t.Errorf("submitMilestoneStatus(%q,%d) = %q,%v; want %q,nil", tc.raw, tc.index, got, err, tc.want)
		}
	}
}
