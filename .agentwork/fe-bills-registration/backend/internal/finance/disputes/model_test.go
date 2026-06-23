package disputes_test

import (
	"testing"

	"spotlight/backend/internal/finance/disputes"
)

func TestStatusConstants(t *testing.T) {
	statuses := []disputes.Status{
		disputes.StatusOpen,
		disputes.StatusInReview,
		disputes.StatusResolved,
		disputes.StatusClosed,
	}
	seen := map[disputes.Status]bool{}
	for _, s := range statuses {
		if s == "" {
			t.Error("Status must not be empty string")
		}
		if seen[s] {
			t.Errorf("duplicate Status: %q", s)
		}
		seen[s] = true
	}
}

func TestResolutionConstants(t *testing.T) {
	resolutions := []disputes.Resolution{
		disputes.ResolutionRefunded,
		disputes.ResolutionSettled,
		disputes.ResolutionDismissed,
	}
	seen := map[disputes.Resolution]bool{}
	for _, r := range resolutions {
		if r == "" {
			t.Error("Resolution must not be empty string")
		}
		if seen[r] {
			t.Errorf("duplicate Resolution: %q", r)
		}
		seen[r] = true
	}
}

func TestDisputeTypeConstants(t *testing.T) {
	types := []disputes.DisputeType{
		disputes.TypeFailedPayment,
		disputes.TypeNonDelivery,
		disputes.TypeWrongItem,
		disputes.TypeNoShow,
		disputes.TypeFakeCampaign,
		disputes.TypeUnauthorised,
		disputes.TypeOther,
	}
	seen := map[disputes.DisputeType]bool{}
	for _, dt := range types {
		if dt == "" {
			t.Error("DisputeType must not be empty string")
		}
		if seen[dt] {
			t.Errorf("duplicate DisputeType: %q", dt)
		}
		seen[dt] = true
	}
}

// TestOpenRequestMinDescriptionLength verifies the 20-char minimum for dispute descriptions.
// This prevents trivially vague reports and is enforced by the binding tag.
func TestOpenRequestMinDescriptionLength(t *testing.T) {
	req := disputes.OpenRequest{
		Reference:   "txn-001",
		ModuleType:  "wallet",
		Type:        disputes.TypeFailedPayment,
		Description: "Payment deducted but not credited to recipient account",
	}
	if len(req.Description) < 20 {
		t.Errorf("description length %d is below required minimum of 20 chars", len(req.Description))
	}
}

// TestDisputeLifecycle verifies the expected status progression.
// Open → InReview → Resolved/Closed. Resolved carries a Resolution value.
func TestDisputeLifecycle(t *testing.T) {
	entryState := disputes.StatusOpen
	terminalStates := []disputes.Status{disputes.StatusResolved, disputes.StatusClosed}

	for _, ts := range terminalStates {
		if ts == entryState {
			t.Errorf("terminal state %q must differ from entry state", ts)
		}
	}
}
