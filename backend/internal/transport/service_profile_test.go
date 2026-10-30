package transport

import (
	"strings"
	"testing"
)

func TestValidateServiceInterests_DedupeAndReject(t *testing.T) {
	got, err := validateServiceInterests([]string{"rides", "rides", "movers"})
	if err != nil {
		t.Fatalf("valid input errored: %v", err)
	}
	if len(got) != 2 || got[0] != "rides" || got[1] != "movers" {
		t.Fatalf("want deduped, order-stable [rides movers], got %v", got)
	}
	if _, err := validateServiceInterests([]string{"flying"}); err == nil {
		t.Fatal("expected error for unknown service interest 'flying'")
	}
}

func TestValidateCoverageAreas_DedupeAndReject(t *testing.T) {
	got, err := validateCoverageAreas([]string{"lagos/ikeja", "lagos/ikeja"})
	if err != nil {
		t.Fatalf("valid input errored: %v", err)
	}
	if len(got) != 1 || got[0] != "lagos/ikeja" {
		t.Fatalf("want [lagos/ikeja], got %v", got)
	}
	// Bare LGA names are no longer accepted: six LGA names exist in more than
	// one state, so an unqualified value cannot be resolved on read.
	if _, err := validateCoverageAreas([]string{"ikeja"}); err == nil {
		t.Fatal("expected error for unqualified coverage area 'ikeja'")
	}
	if _, err := validateCoverageAreas([]string{"lagos/mars"}); err == nil {
		t.Fatal("expected error for unknown coverage area 'lagos/mars'")
	}
	if _, err := validateCoverageAreas([]string{"atlantis/ikeja"}); err == nil {
		t.Fatal("expected error for unknown state in 'atlantis/ikeja'")
	}
}

func TestAreaSlug(t *testing.T) {
	cases := map[string]string{
		"Lagos":             "lagos",
		"FCT - Abuja":       "fct_abuja",
		"Irepodun/Ifelodun": "irepodun_ifelodun",
		"Akwa Ibom":         "akwa_ibom",
		"  Ogun  ":          "ogun",
	}
	for in, want := range cases {
		if got := areaSlug(in); got != want {
			t.Errorf("areaSlug(%q) = %q, want %q", in, got, want)
		}
	}
}

// The allow-list is generated from the embedded dataset, so a broken embed or a
// slug change would silently empty the picker. Assert its shape directly.
func TestOnboardingOptions_NationwideCoverage(t *testing.T) {
	opts := OnboardingOptions()
	if len(opts.Services) == 0 {
		t.Fatal("services allow-list is empty")
	}
	if len(opts.States) != 37 {
		t.Fatalf("want 37 states (36 + FCT), got %d", len(opts.States))
	}
	if len(opts.CoverageAreas) < 700 {
		t.Fatalf("want the full LGA set (773), got %d", len(opts.CoverageAreas))
	}
	for _, a := range opts.CoverageAreas {
		if a.State == "" {
			t.Fatalf("coverage area %q has no state", a.Value)
		}
		if !strings.HasPrefix(a.Value, a.State+"/") {
			t.Fatalf("coverage area %q is not namespaced under %q", a.Value, a.State)
		}
	}
	for _, s := range opts.States {
		if s.Value != areaSlug(s.Label) {
			t.Fatalf("state %q has value %q", s.Label, s.Value)
		}
	}
}

// LGAs that repeat across states must stay distinct ids.
func TestOnboardingOptions_DuplicateLGAsRemainDistinct(t *testing.T) {
	seen := map[string]bool{}
	for _, a := range coverageAreaOptions {
		if seen[a.Value] {
			t.Fatalf("duplicate coverage area id %q", a.Value)
		}
		seen[a.Value] = true
	}
	if !seen["kogi/bassa"] || !seen["plateau/bassa"] {
		t.Fatal("expected Bassa to exist under both Kogi and Plateau")
	}
}
