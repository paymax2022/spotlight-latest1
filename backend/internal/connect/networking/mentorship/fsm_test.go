package connectmentor

import "testing"

// The mentorship FSM (§4) is deny-by-default: REQUESTED→ACCEPTED|DECLINED;
// ACCEPTED→ACTIVE; ACTIVE⇄PAUSED; ACTIVE/PAUSED→COMPLETED|ENDED_EARLY. Terminal
// states (declined/completed/ended_early) admit no outgoing transition — this is
// also what makes a completion emit fire exactly once.
func TestValidTransition(t *testing.T) {
	cases := []struct {
		from, to MatchState
		want     bool
	}{
		// requested
		{StateRequested, StateAccepted, true},
		{StateRequested, StateDeclined, true},
		{StateRequested, StateActive, false},
		{StateRequested, StateCompleted, false},
		{StateRequested, StateRequested, false},
		// accepted
		{StateAccepted, StateActive, true},
		{StateAccepted, StateCompleted, false}, // must pass through active
		{StateAccepted, StateDeclined, false},
		// active ⇄ paused, and terminals
		{StateActive, StatePaused, true},
		{StateActive, StateCompleted, true},
		{StateActive, StateEndedEarly, true},
		{StatePaused, StateActive, true},
		{StatePaused, StateCompleted, true},
		{StatePaused, StateEndedEarly, true},
		// terminals cannot move (idempotency backstop for completion emit)
		{StateCompleted, StateCompleted, false},
		{StateCompleted, StateActive, false},
		{StateDeclined, StateAccepted, false},
		{StateEndedEarly, StateActive, false},
	}
	for _, c := range cases {
		if got := validTransition(c.from, c.to); got != c.want {
			t.Errorf("validTransition(%s->%s)=%v want %v", c.from, c.to, got, c.want)
		}
	}
}

func TestIsRole(t *testing.T) {
	for _, r := range []string{"mentor", "mentee", "both"} {
		if !isRole(r) {
			t.Errorf("isRole(%q)=false want true", r)
		}
	}
	for _, r := range []string{"", "MENTOR", "admin", "dating"} {
		if isRole(r) {
			t.Errorf("isRole(%q)=true want false", r)
		}
	}
}

func TestCompletionRefsAreDistinct(t *testing.T) {
	mentorRef, menteeRef := completionRefs("match-123")
	if mentorRef == menteeRef {
		t.Fatalf("completion refs must be distinct, both = %q", mentorRef)
	}
	if mentorRef != "mentorship:match-123:complete:mentor" {
		t.Errorf("unexpected mentor ref %q", mentorRef)
	}
	if menteeRef != "mentorship:match-123:complete:mentee" {
		t.Errorf("unexpected mentee ref %q", menteeRef)
	}
}
