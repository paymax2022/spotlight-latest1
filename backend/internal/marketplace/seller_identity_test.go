package marketplace

import (
	"strings"
	"testing"
	"time"
)

func TestPublicDisplayName(t *testing.T) {
	cases := map[string]string{
		"Tunde Adeyemi":        "Tunde A.",
		"  chioma   okonkwo  ": "chioma O.",
		"Ngozi Okonjo Iweala":  "Ngozi I.",
		"Madonna":              "Madonna",
		"":                     "Seller",
		"   ":                  "Seller",
		"Ada ٣":                "Ada", // last token not a letter: no stray initial
		"Émile Zola":           "Émile Z.",
		"Aisha 'Queen' Bello":  "Aisha B.",
		"Wang Xiaoming":        "Wang X.",
	}
	for in, want := range cases {
		if got := PublicDisplayName(in); got != want {
			t.Errorf("PublicDisplayName(%q) = %q, want %q", in, got, want)
		}
	}
}

// The full surname must never leak, whatever the input.
func TestPublicDisplayName_NeverContainsTheSurname(t *testing.T) {
	for _, full := range []string{"Tunde Adeyemi", "Ngozi Okonjo Iweala", "Émile Zola"} {
		got := PublicDisplayName(full)
		for _, w := range []string{"Adeyemi", "Okonjo", "Iweala", "Zola"} {
			if strings.Contains(got, w) {
				t.Errorf("PublicDisplayName(%q) = %q leaks %q", full, got, w)
			}
		}
	}
}

func TestTenureLabel(t *testing.T) {
	now := time.Date(2026, 10, 10, 12, 0, 0, 0, time.UTC)
	day := 24 * time.Hour
	cases := []struct {
		name  string
		since time.Time
		want  string
	}{
		{"zero time", time.Time{}, ""},
		{"future (clock skew)", now.Add(day), ""},
		{"today", now, "New seller"},
		{"29 days", now.Add(-29 * day), "New seller"},
		{"30 days", now.Add(-30 * day), "1 month on Paymax"},
		{"95 days", now.Add(-95 * day), "3 months on Paymax"},
		{"364 days", now.Add(-364 * day), "12 months on Paymax"},
		{"1 year", now.Add(-365 * day), "1 year on Paymax"},
		{"2.5 years", now.Add(-900 * day), "2 years on Paymax"},
	}
	for _, c := range cases {
		if got := TenureLabel(now, c.since); got != c.want {
			t.Errorf("%s: TenureLabel = %q, want %q", c.name, got, c.want)
		}
	}
}
