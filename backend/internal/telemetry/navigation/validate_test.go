package navigation

import (
	"strings"
	"testing"
)

func TestCleanRoute(t *testing.T) {
	cases := []struct {
		in   string
		want string
		ok   bool
	}{
		{"crypto/assets", "crypto/assets", true},
		{"wallet", "wallet", true},
		{"pay?amount=500", "", false},
		{"users/3f2504e0-4f89-11d3-9a0c-0305e82c3301", "", false},
		{"profile/foo@bar.com", "", false},
		{"orders/12345", "", false},
		{strings.Repeat("a", 300), "", false},
		{"", "", false},
	}
	for _, tc := range cases {
		got, ok := CleanRoute(tc.in)
		if got != tc.want || ok != tc.ok {
			t.Errorf("CleanRoute(%q) = (%q,%v), want (%q,%v)", tc.in, got, ok, tc.want, tc.ok)
		}
	}
}
