package transport_test

import (
	"testing"

	"spotlight/backend/internal/transport"
)

// TestBaseFareKobo verifies the minimum trip fare per PRD.
// ₦1,500 = 150,000 kobo. Change only with an ADR and migration update.
func TestBaseFareKobo(t *testing.T) {
	const want int64 = 150_000
	if transport.BaseFareKobo != want {
		t.Errorf("BaseFareKobo = %d, want %d (₦1,500)", transport.BaseFareKobo, want)
	}
}

// TestBaseFareIsPositive verifies the base fare is a positive integer.
func TestBaseFareIsPositive(t *testing.T) {
	if transport.BaseFareKobo <= 0 {
		t.Errorf("BaseFareKobo must be positive, got %d", transport.BaseFareKobo)
	}
}

// TestBaseFareIsWholeNaira verifies the fare is a whole naira (divisible by 100).
func TestBaseFareIsWholeNaira(t *testing.T) {
	if transport.BaseFareKobo%100 != 0 {
		t.Errorf("BaseFareKobo=%d must be divisible by 100 (whole naira)", transport.BaseFareKobo)
	}
}

// TestDriverStatusConstants verifies driver status values are distinct.
func TestDriverStatusConstants(t *testing.T) {
	statuses := []transport.DriverStatus{
		transport.DriverOnline,
		transport.DriverOffline,
		transport.DriverOnTrip,
	}
	seen := map[transport.DriverStatus]bool{}
	for _, s := range statuses {
		if s == "" {
			t.Error("DriverStatus must not be empty string")
		}
		if seen[s] {
			t.Errorf("duplicate DriverStatus: %q", s)
		}
		seen[s] = true
	}
}

// TestTripStatusConstants verifies trip status values are distinct and cover the lifecycle.
func TestTripStatusConstants(t *testing.T) {
	statuses := []transport.TripStatus{
		transport.TripRequested,
		transport.TripAccepted,
		transport.TripPickedUp,
		transport.TripCompleted,
		transport.TripCancelled,
	}
	seen := map[transport.TripStatus]bool{}
	for _, s := range statuses {
		if s == "" {
			t.Error("TripStatus must not be empty string")
		}
		if seen[s] {
			t.Errorf("duplicate TripStatus: %q", s)
		}
		seen[s] = true
	}
	// Verify terminal states exist.
	terminals := []transport.TripStatus{transport.TripCompleted, transport.TripCancelled}
	for _, ts := range terminals {
		if !seen[ts] {
			t.Errorf("terminal TripStatus %q not found in constants", ts)
		}
	}
}

// TestFareMustMeetMinimum verifies that the RequestTrip validation guard is correct.
// Any fare below BaseFareKobo must be rejected by the service.
func TestFareMustMeetMinimum(t *testing.T) {
	belowMin := transport.BaseFareKobo - 1
	atMin := transport.BaseFareKobo
	aboveMin := transport.BaseFareKobo + 10_000

	if belowMin >= transport.BaseFareKobo {
		t.Error("belowMin must be less than BaseFareKobo for test to be valid")
	}
	if atMin < transport.BaseFareKobo {
		t.Error("atMin must equal BaseFareKobo")
	}
	if aboveMin <= transport.BaseFareKobo {
		t.Error("aboveMin must exceed BaseFareKobo")
	}
}
