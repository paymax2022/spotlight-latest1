// Package connectonboarding implements the 18+ age gate for Paymax Connect.
// Safety invariant 1 (dating/CLAUDE.md §28): 18+ only, hard age gate, fail-closed;
// suspected minors are routed to the admin underage queue immediately.
package connectonboarding

import "time"

// MinAdultAge is the hard minimum. No teen/under-18 mode ever exists.
const MinAdultAge = 18

const dobLayout = "2006-01-02"

// ComputeAge returns full years elapsed between dob and now. A dob in the
// future yields a negative result (handled fail-closed by callers).
func ComputeAge(dob, now time.Time) int {
	years := now.Year() - dob.Year()
	if now.Month() < dob.Month() || (now.Month() == dob.Month() && now.Day() < dob.Day()) {
		years--
	}
	return years
}

// IsAdult reports whether dob corresponds to an age >= 18 at now.
func IsAdult(dob, now time.Time) bool {
	return ComputeAge(dob, now) >= MinAdultAge
}
