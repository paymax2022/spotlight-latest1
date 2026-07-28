package connectprofessional

import "testing"

// The intro state machine is the consent-before-messaging gate: only a PENDING
// request may transition, and only to accepted/declined/withdrawn.
func TestValidIntroTransition(t *testing.T) {
	cases := []struct {
		from IntroStatus
		to   IntroStatus
		want bool
	}{
		{IntroPending, IntroAccepted, true},
		{IntroPending, IntroDeclined, true},
		{IntroPending, IntroWithdrawn, true},
		{IntroPending, IntroPending, false},   // no-op not allowed
		{IntroAccepted, IntroDeclined, false}, // terminal — cannot flip
		{IntroDeclined, IntroAccepted, false},
		{IntroWithdrawn, IntroAccepted, false},
	}
	for _, c := range cases {
		if got := validIntroTransition(c.from, c.to); got != c.want {
			t.Errorf("validIntroTransition(%s->%s)=%v want %v", c.from, c.to, got, c.want)
		}
	}
}
