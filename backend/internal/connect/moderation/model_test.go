package connectmoderation_test

import (
	"testing"

	connectmoderation "spotlight/backend/internal/connect/moderation"
)

// TestValidDecision: only the allowed moderation decisions pass (must match the
// connect_moderation_decisions.decision CHECK).
func TestValidDecision(t *testing.T) {
	for _, d := range []string{"flagged", "warned", "cleared", "restricted", "escalated", "removed"} {
		if !connectmoderation.ValidDecision(d) {
			t.Errorf("expected %q to be a valid decision", d)
		}
	}
	for _, d := range []string{"", "ban", "approve"} {
		if connectmoderation.ValidDecision(d) {
			t.Errorf("expected %q to be rejected", d)
		}
	}
}

// TestValidTargetType: target types must match the CHECK constraint.
func TestValidTargetType(t *testing.T) {
	for _, ty := range []string{"message", "conversation", "profile", "media", "user"} {
		if !connectmoderation.ValidTargetType(ty) {
			t.Errorf("expected %q to be a valid target type", ty)
		}
	}
	if connectmoderation.ValidTargetType("comment") {
		t.Error("unknown target type must be rejected")
	}
}
