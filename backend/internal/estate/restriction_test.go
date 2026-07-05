package estate

import "testing"

// TestRestrictionMatrix exhaustively pins the Block 30 soft/hard dues-restriction
// policy: which gated actions each restriction level blocks.
//
//	level \ action | visitor | vote  | facility
//	---------------+---------+-------+---------
//	"" (none)      | allow   | allow | allow
//	soft           | allow   | BLOCK | BLOCK
//	hard           | BLOCK   | BLOCK | BLOCK
func TestRestrictionMatrix(t *testing.T) {
	cases := []struct {
		level   string
		action  string
		blocked bool
	}{
		// No active restriction blocks nothing.
		{"", ActionVisitor, false},
		{"", ActionVote, false},
		{"", ActionFacility, false},
		// Soft: visitor codes still work; voting + facility blocked.
		{"soft", ActionVisitor, false},
		{"soft", ActionVote, true},
		{"soft", ActionFacility, true},
		// Hard: everything blocked.
		{"hard", ActionVisitor, true},
		{"hard", ActionVote, true},
		{"hard", ActionFacility, true},
	}
	for _, c := range cases {
		if got := restrictionBlocks(c.level, c.action); got != c.blocked {
			t.Errorf("restrictionBlocks(%q, %q) = %v, want %v", c.level, c.action, got, c.blocked)
		}
	}
}

// TestRestrictionUnknownLevelFailsOpenToAllowOnly verifies that an unrecognised
// level is treated as "no restriction" (blocks nothing) — restriction levels are
// admin-controlled and constrained by a DB CHECK to soft|hard, so an unknown
// value can only arise from data corruption and must not silently hard-ban.
func TestRestrictionUnknownLevelDoesNotBlock(t *testing.T) {
	for _, action := range []string{ActionVisitor, ActionVote, ActionFacility} {
		if restrictionBlocks("bogus", action) {
			t.Errorf("unknown level must not block action %q", action)
		}
	}
}

// TestRestrictionActionConstants guards against typos drifting the action
// identifiers used at the call sites (CastVote, BookFacility, CreateAccessCode).
func TestRestrictionActionConstants(t *testing.T) {
	if ActionVisitor != "visitor" || ActionVote != "vote" || ActionFacility != "facility" {
		t.Fatalf("action constants drifted: %q %q %q", ActionVisitor, ActionVote, ActionFacility)
	}
}
