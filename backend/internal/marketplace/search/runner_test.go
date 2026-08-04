package search

import (
	"testing"
	"time"
)

func TestResolveInterval(t *testing.T) {
	const def = 2 * time.Second
	cases := []struct {
		name string
		raw  string
		want time.Duration
	}{
		{"empty falls back to default", "", def},
		{"valid ms", "500", 500 * time.Millisecond},
		{"valid seconds worth of ms", "2000", 2 * time.Second},
		{"zero is non-positive → default", "0", def},
		{"negative → default", "-100", def},
		{"garbage → default", "abc", def},
		{"fractional ms is valid (bare number)", "12.5", 12500 * time.Microsecond}, // "12.5ms"
		{"a value with units is rejected (must be bare ms)", "10s", def},           // "10sms" → invalid
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := ResolveInterval(c.raw, def); got != c.want {
				t.Errorf("ResolveInterval(%q) = %v, want %v", c.raw, got, c.want)
			}
		})
	}
}
