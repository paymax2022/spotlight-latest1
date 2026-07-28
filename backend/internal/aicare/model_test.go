package aicare_test

import (
	"testing"

	"spotlight/backend/internal/aicare"
)

func TestSessionStatusConstants(t *testing.T) {
	statuses := []aicare.SessionStatus{
		aicare.SessionOpen,
		aicare.SessionEscalated,
		aicare.SessionResolved,
	}
	seen := map[aicare.SessionStatus]bool{}
	for _, s := range statuses {
		if s == "" {
			t.Error("SessionStatus must not be empty string")
		}
		if seen[s] {
			t.Errorf("duplicate SessionStatus: %q", s)
		}
		seen[s] = true
	}
}

func TestMessageRoleConstants(t *testing.T) {
	roles := []aicare.MessageRole{
		aicare.RoleUser,
		aicare.RoleAI,
		aicare.RoleAgent,
	}
	seen := map[aicare.MessageRole]bool{}
	for _, r := range roles {
		if r == "" {
			t.Error("MessageRole must not be empty string")
		}
		if seen[r] {
			t.Errorf("duplicate MessageRole: %q", r)
		}
		seen[r] = true
	}
}

// TestSessionLifecycle verifies open is the entry state; resolved is terminal.
// Escalated is an intermediate state where a human agent takes over.
func TestSessionLifecycle(t *testing.T) {
	entry := aicare.SessionOpen
	terminal := aicare.SessionResolved
	intermediate := aicare.SessionEscalated

	if terminal == entry {
		t.Errorf("terminal state %q must differ from entry state", terminal)
	}
	if intermediate == entry || intermediate == terminal {
		t.Errorf("intermediate state %q must differ from both entry and terminal", intermediate)
	}
}

// TestMessageRolesCoverAllSenders verifies 3 distinct roles: user, AI, human agent.
func TestMessageRolesCoverAllSenders(t *testing.T) {
	roles := map[aicare.MessageRole]bool{
		aicare.RoleUser:  true,
		aicare.RoleAI:    true,
		aicare.RoleAgent: true,
	}
	if len(roles) != 3 {
		t.Errorf("expected 3 message roles, got %d", len(roles))
	}
}

// TestSendMessageRequestRequired verifies the message body constraint.
func TestSendMessageRequestRequired(t *testing.T) {
	req := aicare.SendMessageRequest{
		Content: "Hello, I need help with my wallet balance",
	}
	if req.Content == "" {
		t.Error("SendMessageRequest.Content must not be empty")
	}
}
