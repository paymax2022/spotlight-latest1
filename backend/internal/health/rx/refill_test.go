package healthrx

import "testing"

// TS-8 DP-004 (refill within limits; blocked when exhausted). Pure, deterministic —
// no I/O.

func TestCanRefill(t *testing.T) {
	cases := []struct {
		used, authorized int
		want             bool
	}{
		{0, 0, false}, // no refills authorized → none allowed (dispense-once)
		{0, 2, true},  // first refill of 2
		{1, 2, true},  // second refill of 2
		{2, 2, false}, // exhausted
		{3, 2, false}, // over (defensive)
	}
	for _, c := range cases {
		if got := canRefill(c.used, c.authorized); got != c.want {
			t.Errorf("canRefill(used=%d, auth=%d) = %v, want %v", c.used, c.authorized, got, c.want)
		}
	}
}

func TestRefillsRemaining(t *testing.T) {
	cases := []struct {
		used, authorized, want int
	}{
		{0, 3, 3},
		{1, 3, 2},
		{3, 3, 0},
		{5, 3, 0}, // never negative
	}
	for _, c := range cases {
		if got := refillsRemaining(c.used, c.authorized); got != c.want {
			t.Errorf("refillsRemaining(used=%d, auth=%d) = %d, want %d", c.used, c.authorized, got, c.want)
		}
	}
}

func TestValidRefillCount(t *testing.T) {
	if validRefillCount(-1) {
		t.Error("negative refill count must be invalid")
	}
	if !validRefillCount(0) {
		t.Error("zero refills must be valid (the default, dispense-once)")
	}
	if !validRefillCount(maxRefillsAuthorized) {
		t.Error("the maximum must be valid")
	}
	if validRefillCount(maxRefillsAuthorized + 1) {
		t.Error("above the maximum must be invalid")
	}
}
