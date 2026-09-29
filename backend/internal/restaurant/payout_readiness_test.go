package restaurant

import "testing"

// payoutBlockReason must switch on the ACTUAL status strings written to
// restaurants.kyb_status / restaurant_kyb.status (see KYBStatus consts in
// kyb.go), not on guessed spellings. A prior version matched "needs_info"
// while the real value is "needs_more_info", so a bounced-back merchant fell
// through to the generic default message instead of the specific one.
func TestPayoutBlockReason(t *testing.T) {
	if got := payoutBlockReason(string(KYBApproved), true); got != "" {
		t.Errorf("payable outlet must report no reason, got %q", got)
	}

	cases := []struct {
		name     string
		status   string
		wantSame string // another status whose message must differ from this one
	}{
		{"none", string(KYBStatusNone), "submitted"},
		{"submitted", string(KYBSubmitted), "none"},
		{"under_review", string(KYBUnderReview), "none"},
		{"needs_more_info", string(KYBNeedsInfo), "submitted"},
		{"rejected", string(KYBRejected), "submitted"},
	}
	seen := map[string]string{}
	for _, c := range cases {
		reason := payoutBlockReason(c.status, false)
		if reason == "" {
			t.Errorf("%s: not payable but gave no reason", c.name)
		}
		seen[c.name] = reason
	}

	if seen["needs_more_info"] == payoutBlockReason("default-fallthrough-nonsense-status", false) {
		t.Error("needs_more_info must not fall through to the generic default message")
	}
	for _, c := range cases {
		if seen[c.name] == seen[c.wantSame] {
			t.Errorf("%s and %s must not read the same — the owner's next action differs", c.name, c.wantSame)
		}
	}
}
