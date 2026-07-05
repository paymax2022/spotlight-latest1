package ws_test

import (
	"encoding/json"
	"testing"

	"spotlight/backend/internal/platform/ws"
)

func TestNew_ReturnsNonNilHub(t *testing.T) {
	h := ws.New()
	if h == nil {
		t.Fatal("New() returned nil hub")
	}
}

func TestSendToUser_NoConnectedClients_DoesNotPanic(t *testing.T) {
	h := ws.New()
	msg := ws.Message{Type: "test.event", Payload: map[string]string{"key": "value"}}
	// No registered clients — must not panic.
	h.SendToUser("user-abc", msg)
}

func TestSendToUser_UnknownUser_DoesNotPanic(t *testing.T) {
	h := ws.New()
	h.SendToUser("nonexistent-user-id", ws.Message{Type: "ping", Payload: nil})
}

func TestMessage_MarshalRoundtrip(t *testing.T) {
	original := ws.Message{Type: "wallet.credit", Payload: map[string]any{"amount_kobo": float64(5000)}}
	b, err := json.Marshal(original)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var got ws.Message
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.Type != original.Type {
		t.Fatalf("Type mismatch: got %q, want %q", got.Type, original.Type)
	}
}
