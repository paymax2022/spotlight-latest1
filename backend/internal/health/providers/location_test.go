package healthproviders

import (
	"strings"
	"testing"
)

func TestParseLocation(t *testing.T) {
	f := func(v float64) *float64 { return &v }
	s := func(v string) *string { return &v }
	cases := []struct {
		name     string
		addr     *string
		city     *string
		state    *string
		lat, lng *float64
		bad      bool
	}{
		{"valid", s("5 Awolowo Rd"), s("Lagos"), s("Lagos"), f(6.45), f(3.43), false},
		{"coordinates only", nil, nil, nil, f(6.45), f(3.43), false},
		{"no coordinates", s("5 Awolowo Rd"), nil, nil, nil, nil, true},
		{"lat without lng", nil, nil, nil, f(6.45), nil, true},
		{"out of range", nil, nil, nil, f(91), f(3), true},
		{"null island", nil, nil, nil, f(0), f(0), true},
		{"address too long", s(strings.Repeat("a", 201)), nil, nil, f(6.45), f(3.43), true},
		{"state too long", nil, nil, s(strings.Repeat("s", 101)), f(6.45), f(3.43), true},
	}
	for _, c := range cases {
		_, msg := parseLocation(c.addr, c.city, c.state, c.lat, c.lng)
		if (msg != "") != c.bad {
			t.Errorf("%s: msg=%q, bad=%v", c.name, msg, c.bad)
		}
	}
}

func TestParseLocationTrims(t *testing.T) {
	a, c, st := "  5 Awolowo Rd ", " Lagos ", " Lagos "
	lat, lng := 6.45, 3.43
	in, msg := parseLocation(&a, &c, &st, &lat, &lng)
	if msg != "" || in.Address != "5 Awolowo Rd" || in.City != "Lagos" || in.State != "Lagos" {
		t.Fatalf("in=%+v msg=%q", in, msg)
	}
}
