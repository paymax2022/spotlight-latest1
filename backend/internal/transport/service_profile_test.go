package transport

import "testing"

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
	got, err := validateCoverageAreas([]string{"ikeja", "ikeja"})
	if err != nil {
		t.Fatalf("valid input errored: %v", err)
	}
	if len(got) != 1 || got[0] != "ikeja" {
		t.Fatalf("want [ikeja], got %v", got)
	}
	if _, err := validateCoverageAreas([]string{"ikeja", "mars"}); err == nil {
		t.Fatal("expected error for unknown coverage area 'mars'")
	}
}
