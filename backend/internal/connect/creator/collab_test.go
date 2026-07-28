package connectcreator

import "testing"

// The collab-request state machine: only a PENDING request may transition, and
// only to accepted/declined/withdrawn (deny-by-default).
func TestValidCollabTransition(t *testing.T) {
	cases := []struct {
		from, to string
		want     bool
	}{
		{"pending", "accepted", true},
		{"pending", "declined", true},
		{"pending", "withdrawn", true},
		{"pending", "pending", false},
		{"accepted", "declined", false},
		{"declined", "accepted", false},
		{"withdrawn", "accepted", false},
	}
	for _, c := range cases {
		if got := validCollabTransition(c.from, c.to); got != c.want {
			t.Errorf("validCollabTransition(%s->%s)=%v want %v", c.from, c.to, got, c.want)
		}
	}
}

// Fan-message policy is enforced server-side; only the three known policies are valid.
func TestValidFanPolicy(t *testing.T) {
	for _, p := range []FanMessagePolicy{FanOpen, FanVerifiedOnly, FanOff} {
		if !ValidFanPolicy(p) {
			t.Errorf("%q should be a valid fan policy", p)
		}
	}
	for _, p := range []FanMessagePolicy{"", "everyone", "paid_only"} {
		if ValidFanPolicy(p) {
			t.Errorf("%q must be rejected", p)
		}
	}
}
