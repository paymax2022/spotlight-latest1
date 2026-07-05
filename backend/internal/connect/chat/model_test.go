package connectchat_test

import (
	"errors"
	"testing"

	connectchat "spotlight/backend/internal/connect/chat"
)

// TestValidMessageKind: only the three allowed kinds pass; anything else is rejected.
func TestValidMessageKind(t *testing.T) {
	for _, k := range []string{"text", "voice", "icebreaker"} {
		if !connectchat.ValidMessageKind(k) {
			t.Errorf("expected %q to be a valid message kind", k)
		}
	}
	for _, k := range []string{"", "image", "video", "money"} {
		if connectchat.ValidMessageKind(k) {
			t.Errorf("expected %q to be rejected", k)
		}
	}
}

// TestChatErrorsAreDistinct: the gate errors are distinguishable so the handler
// can map "no match"/"blocked" to 403 and "closed" to 409 (deny-by-default).
func TestChatErrorsAreDistinct(t *testing.T) {
	if errors.Is(connectchat.ErrNoMatch, connectchat.ErrBlocked) {
		t.Error("ErrNoMatch and ErrBlocked must be distinct sentinels")
	}
	if errors.Is(connectchat.ErrConversationClosed, connectchat.ErrNoMatch) {
		t.Error("ErrConversationClosed must be distinct from ErrNoMatch")
	}
	// The mutual-match gate sentinel must carry a clear message.
	if connectchat.ErrNoMatch.Error() == "" {
		t.Error("ErrNoMatch must have a message")
	}
}
