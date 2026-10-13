package top5events

import "testing"

func TestEditability(t *testing.T) {
	cases := []struct {
		name       string
		state      EventState
		sold       bool
		soft, hard bool
	}{
		{"draft no sales", EventDraft, false, true, true},
		{"draft sold", EventDraft, true, true, true},
		{"submitted no sales", EventSubmitted, false, true, true},
		{"submitted sold", EventSubmitted, true, true, false},
		{"approved no sales", EventApproved, false, true, true},
		{"approved sold", EventApproved, true, true, false},
		{"live no sales", EventLive, false, true, true},
		{"live sold", EventLive, true, true, false},
		{"paused no sales", EventPaused, false, true, true},
		{"paused sold", EventPaused, true, true, false},
		{"closed", EventClosed, false, false, false},
		{"closed sold", EventClosed, true, false, false},
		{"suspended", EventSuspended, false, false, false},
		{"suspended sold", EventSuspended, true, false, false},
		{"cancelled", EventCancelled, false, false, false},
		{"cancelled sold", EventCancelled, true, false, false},
		{"empty state", EventState(""), false, false, false},
		{"empty state sold", EventState(""), true, false, false},
		{"unknown state", EventState("BOGUS"), false, false, false},
		{"unknown state sold", EventState("BOGUS"), true, false, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			d := editability(c.state, c.sold)
			if d.AllowSoft != c.soft || d.AllowHardTime != c.hard {
				t.Fatalf("got soft=%v hard=%v, want soft=%v hard=%v", d.AllowSoft, d.AllowHardTime, c.soft, c.hard)
			}
			blocked := !d.AllowSoft || !d.AllowHardTime
			if blocked && d.Reason == "" {
				t.Fatalf("expected Reason when a field class is blocked")
			}
			if !blocked && d.Reason != "" {
				t.Fatalf("expected empty Reason when fully allowed, got %q", d.Reason)
			}
		})
	}

	if d := editability(EventLive, true); d.Reason != reasonHardTimeLocked {
		t.Fatalf("LIVE+sold reason = %q, want hard-time lock message", d.Reason)
	}
}
