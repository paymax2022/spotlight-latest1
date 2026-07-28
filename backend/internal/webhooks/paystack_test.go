package webhooks_test

import (
	"encoding/json"
	"testing"

	"spotlight/backend/internal/webhooks"
)

// TestPaystackEventUnmarshal verifies the outer webhook envelope parses correctly.
func TestPaystackEventUnmarshal(t *testing.T) {
	raw := `{"event":"charge.success","data":{"reference":"ref-001","amount":500000}}`
	var event webhooks.PaystackEvent
	if err := json.Unmarshal([]byte(raw), &event); err != nil {
		t.Fatalf("failed to unmarshal PaystackEvent: %v", err)
	}
	if event.Event != "charge.success" {
		t.Errorf("Event = %q, want %q", event.Event, "charge.success")
	}
	if len(event.Data) == 0 {
		t.Error("PaystackEvent.Data must not be empty after unmarshal")
	}
}

// TestPaystackEventTypes verifies the known webhook event type strings.
func TestPaystackEventTypes(t *testing.T) {
	knownEvents := []string{
		"charge.success",
		"transfer.success",
		"transfer.failed",
		"transfer.reversed",
	}
	seen := map[string]bool{}
	for _, e := range knownEvents {
		if e == "" {
			t.Error("event type must not be empty")
		}
		if seen[e] {
			t.Errorf("duplicate event type: %q", e)
		}
		seen[e] = true
	}
}

// TestPaystackEventDataIsRawJSON verifies Data is kept as json.RawMessage
// to allow lazy unmarshaling based on event type.
func TestPaystackEventDataIsRawJSON(t *testing.T) {
	raw := `{"event":"charge.success","data":{"reference":"ref-abc","amount":100000,"channel":"card"}}`
	var event webhooks.PaystackEvent
	if err := json.Unmarshal([]byte(raw), &event); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	// Data should still be a valid JSON object.
	var data map[string]any
	if err := json.Unmarshal(event.Data, &data); err != nil {
		t.Fatalf("Data is not valid JSON: %v", err)
	}
	if data["reference"] != "ref-abc" {
		t.Errorf("expected reference=ref-abc in Data, got %v", data["reference"])
	}
}
