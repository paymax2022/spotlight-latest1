package extranet

import (
	"errors"
	"testing"
	"time"
)

func day(s string) time.Time {
	t, err := time.Parse(dateLayout, s)
	if err != nil {
		panic(err)
	}
	return t
}

func TestValidateAvailabilityWindow(t *testing.T) {
	if err := validateAvailabilityWindow(day("2026-11-01"), day("2026-11-01")); err != nil {
		t.Errorf("single night should be valid: %v", err)
	}
	if err := validateAvailabilityWindow(day("2026-11-05"), day("2026-11-01")); !errors.Is(err, ErrValidation) {
		t.Errorf("inverted window: got %v, want ErrValidation", err)
	}
	if err := validateAvailabilityWindow(day("2026-01-01"), day("2027-01-02")); !errors.Is(err, ErrValidation) {
		t.Errorf("window over %d nights should be refused: got %v", maxAvailabilityWindowDays, err)
	}
}

func TestParseAvailabilityWindow_Defaults(t *testing.T) {
	from, to, err := parseAvailabilityWindow("", "")
	if err != nil {
		t.Fatalf("defaults: %v", err)
	}
	if got := int(to.Sub(from).Hours() / 24); got != 89 {
		t.Errorf("default window spans %d days, want 89", got)
	}
}

func TestParseAvailabilityWindow_RejectsBadDates(t *testing.T) {
	if _, _, err := parseAvailabilityWindow("01/11/2026", ""); !errors.Is(err, ErrValidation) {
		t.Errorf("bad from: got %v, want ErrValidation", err)
	}
}
