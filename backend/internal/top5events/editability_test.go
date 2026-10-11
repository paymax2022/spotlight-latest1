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
		{"approved no sales", EventApproved, false, true, true},
		{"live no sales", EventLive, false, true, true},
		{"paused no sales", EventPaused, false, true, true},
		{"live sold", EventLive, true, true, false},
		{"closed", EventClosed, false, false, false},
		{"closed sold", EventClosed, true, false, false},
		{"cancelled", EventCancelled, false, false, false},
		{"cancelled sold", EventCancelled, true, false, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			d := editability(c.state, c.sold)
			if d.AllowSoft != c.soft || d.AllowHardTime != c.hard {
				t.Fatalf("got soft=%v hard=%v, want soft=%v hard=%v", d.AllowSoft, d.AllowHardTime, c.soft, c.hard)
			}
			if (!d.AllowSoft || !d.AllowHardTime) && d.Reason == "" {
				t.Fatalf("expected Reason when a field class is blocked")
			}
		})
	}
}
