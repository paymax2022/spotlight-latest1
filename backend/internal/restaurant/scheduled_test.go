package restaurant

import (
	"errors"
	"testing"
	"time"
)

func TestValidateScheduledFor(t *testing.T) {
	loc := time.UTC
	now := time.Date(2026, 7, 27, 10, 0, 0, 0, loc) // Monday 10:00
	// Restaurant open Mondays 09:00–17:00.
	openHours := []BusinessHour{{DayOfWeek: 1, OpenMinute: 540, CloseMinute: 1020}}

	// Valid: 2h ahead, within hours.
	if err := validateScheduledFor(now, now.Add(2*time.Hour), openHours, loc); err != nil {
		t.Errorf("valid slot rejected: %v", err)
	}
	// Too soon (< lead).
	if err := validateScheduledFor(now, now.Add(5*time.Minute), openHours, loc); !errors.Is(err, ErrScheduledSlotInvalid) {
		t.Errorf("a slot inside the lead window must be rejected with ErrScheduledSlotInvalid, got %v", err)
	}
	// Past.
	if err := validateScheduledFor(now, now.Add(-time.Hour), openHours, loc); !errors.Is(err, ErrScheduledSlotInvalid) {
		t.Errorf("a past slot must be rejected with ErrScheduledSlotInvalid, got %v", err)
	}
	// Beyond horizon.
	if err := validateScheduledFor(now, now.Add(scheduledHorizon+time.Hour), openHours, loc); !errors.Is(err, ErrScheduledSlotInvalid) {
		t.Errorf("a slot beyond the horizon must be rejected with ErrScheduledSlotInvalid, got %v", err)
	}
	// Within lead+horizon but restaurant CLOSED at the slot (20:00 Monday, SG-002).
	closedSlot := time.Date(2026, 7, 27, 20, 0, 0, 0, loc)
	if err := validateScheduledFor(now, closedSlot, openHours, loc); !errors.Is(err, ErrRestaurantClosed) {
		t.Errorf("a slot while the restaurant is closed must be rejected with ErrRestaurantClosed, got %v", err)
	}
	// No weekly schedule → hours check skipped (governed by is_open elsewhere).
	if err := validateScheduledFor(now, now.Add(2*time.Hour), nil, loc); err != nil {
		t.Errorf("no-schedule restaurant: slot should validate on lead/horizon only, got %v", err)
	}
}
