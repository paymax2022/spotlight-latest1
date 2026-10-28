package clinicloc

import (
	"strings"
	"testing"
)

func TestValidate(t *testing.T) {
	f := func(v float64) *float64 { return &v }
	s := func(v string) *string { return &v }
	cases := []struct {
		name string
		in   Input
		bad  bool
	}{
		{"empty", Input{}, false},
		{"valid point", Input{Lat: f(6.45), Lng: f(3.43)}, false},
		{"lat only", Input{Lat: f(6.45)}, true},
		{"lng only", Input{Lng: f(3.43)}, true},
		{"out of range", Input{Lat: f(95), Lng: f(3)}, true},
		{"null island", Input{Lat: f(0), Lng: f(0)}, true},
		{"zero lat is a real place", Input{Lat: f(0), Lng: f(3)}, false},
		{"address too long", Input{Address: s(strings.Repeat("a", 201))}, true},
		{"padding does not count", Input{Address: s("  " + strings.Repeat("a", 200) + "  ")}, false},
		{"state too long", Input{State: s(strings.Repeat("s", 101))}, true},
	}
	for _, c := range cases {
		if got := Validate(c.in) != ""; got != c.bad {
			t.Errorf("%s: rejected=%v, want %v", c.name, got, c.bad)
		}
	}
}

func TestDraftPatchOnlyIncludesSentKeys(t *testing.T) {
	s := func(v string) *string { return &v }
	p := DraftPatch(Input{Address: s(" 5 Awolowo Rd "), State: s("Lagos")})
	if len(p) != 2 || p["address"] != "5 Awolowo Rd" || p["state"] != "Lagos" {
		t.Errorf("patch = %v", p)
	}
	if len(DraftPatch(Input{})) != 0 {
		t.Error("an empty input must produce an empty patch")
	}
}
