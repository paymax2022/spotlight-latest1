package connectevents

import (
	"encoding/json"
	"testing"
)

// Opt-in privacy: an attendee only exposes the fields their visibility mask
// allows. This is the core safety guarantee of attendee discovery.
func TestApplyMask(t *testing.T) {
	name, headline, company := "Acme Co", "Founder", "Acme Co"

	full := applyMask(Attendee{UserID: "u1"},
		json.RawMessage(`{"name":true,"headline":true,"company":true}`), name, headline, company)
	if full.Name != name || full.Headline != headline || full.Company != company {
		t.Fatalf("full mask should reveal all fields: %+v", full)
	}

	nameOnly := applyMask(Attendee{UserID: "u2"},
		json.RawMessage(`{"name":true,"headline":false,"company":false}`), name, headline, company)
	if nameOnly.Name != name {
		t.Fatalf("name should be revealed, got %q", nameOnly.Name)
	}
	if nameOnly.Headline != "" || nameOnly.Company != "" {
		t.Fatalf("headline/company must stay hidden: %+v", nameOnly)
	}

	hidden := applyMask(Attendee{UserID: "u3"}, json.RawMessage(`{}`), name, headline, company)
	if hidden.Name != "" || hidden.Headline != "" || hidden.Company != "" {
		t.Fatalf("empty mask must hide everything: %+v", hidden)
	}
}
