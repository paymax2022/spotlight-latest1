package connectonboarding_test

import (
	"testing"
	"time"

	connectonboarding "spotlight/backend/internal/connect/onboarding"
)

func date(y int, m time.Month, d int) time.Time {
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}

// TestComputeAgeBoundaries exercises the 17/18 boundary fail-closed.
func TestComputeAgeBoundaries(t *testing.T) {
	now := date(2026, time.June, 22)
	cases := []struct {
		name string
		dob  time.Time
		want int
	}{
		{"exactly 18 today", date(2008, time.June, 22), 18},
		{"turns 18 tomorrow", date(2008, time.June, 23), 17},
		{"18 and a day", date(2008, time.June, 21), 18},
		{"clearly 17", date(2009, time.January, 1), 17},
		{"future dob", date(2030, time.January, 1), -4},
	}
	for _, tc := range cases {
		if got := connectonboarding.ComputeAge(tc.dob, now); got != tc.want {
			t.Errorf("%s: ComputeAge = %d, want %d", tc.name, got, tc.want)
		}
	}
}

// TestIsAdult verifies the gate decision at the boundary.
func TestIsAdult(t *testing.T) {
	now := date(2026, time.June, 22)
	if !connectonboarding.IsAdult(date(2008, time.June, 22), now) {
		t.Error("someone turning 18 today must be an adult")
	}
	if connectonboarding.IsAdult(date(2008, time.June, 23), now) {
		t.Error("someone who turns 18 tomorrow must be blocked")
	}
	if connectonboarding.IsAdult(date(2009, time.December, 31), now) {
		t.Error("a 16-year-old must be blocked")
	}
}

// TestLeapDayBirthday verifies a Feb-29 DOB is handled conservatively.
func TestLeapDayBirthday(t *testing.T) {
	// Born 2008-02-29; on 2026-02-28 they have not yet "had" the birthday → 17.
	if connectonboarding.ComputeAge(date(2008, time.February, 29), date(2026, time.February, 28)) != 17 {
		t.Error("leap-day birthday must compute fail-closed (17 before Mar 1)")
	}
	if connectonboarding.ComputeAge(date(2008, time.February, 29), date(2026, time.March, 1)) != 18 {
		t.Error("leap-day birthday should be 18 from Mar 1")
	}
}
