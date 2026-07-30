package transport

import (
	"strings"
	"testing"
	"time"
)

// TestFormatInterval proves the pure grace-window→Postgres-interval mapping the
// stuck-trip selection predicate depends on, without a database.
func TestFormatInterval(t *testing.T) {
	cases := []struct {
		in   time.Duration
		want string
	}{
		{10 * time.Minute, "600 seconds"},
		{5 * time.Minute, "300 seconds"},
		{time.Second, "1 seconds"},
		{500 * time.Millisecond, "0 seconds"},
		{0, "0 seconds"},
		{-time.Minute, "0 seconds"},
	}
	for _, c := range cases {
		if got := formatInterval(c.in); got != c.want {
			t.Fatalf("formatInterval(%s) = %q, want %q", c.in, got, c.want)
		}
	}
}

// TestStuckTripSelect_Predicate pins the money-path invariants of the transport
// crash-recovery SQL: only completed trips with still-held ('escrowed') transport
// settlements, past the grace window, DISTINCT per trip. Dropping any guard risks
// double-pay or racing a live completion.
func TestStuckTripSelect_Predicate(t *testing.T) {
	q := stuckTripSelect
	for _, must := range []string{
		"t.phase = 'completed'",               // only terminal (completed) trips
		"s.status = 'escrowed'",               // only still-held escrow
		"module_type = 'transport'",           // scoped to this module
		"t.updated_at < NOW() - $1::interval", // grace window (updated_at bumped at completion)
		"DISTINCT",                            // base + delta escrows collapse to one trip
	} {
		if !strings.Contains(q, must) {
			t.Fatalf("stuck-trip predicate missing guard %q", must)
		}
	}
}
