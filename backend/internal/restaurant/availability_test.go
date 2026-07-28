package restaurant

import (
	"testing"
	"time"
)

func TestHolidayOpenAt(t *testing.T) {
	loc := time.UTC
	noon := time.Date(2026, 12, 25, 12, 0, 0, 0, loc)

	// Closed holiday → never open.
	if holidayOpenAt(HolidayHour{IsClosed: true}, noon, loc) {
		t.Error("closed holiday must never be open")
	}
	// Open 10:00–14:00 → open at noon, closed at 15:00.
	win := HolidayHour{IsClosed: false, OpenMinute: 600, CloseMinute: 840}
	if !holidayOpenAt(win, noon, loc) {
		t.Error("noon should be inside 10:00–14:00")
	}
	if holidayOpenAt(win, time.Date(2026, 12, 25, 15, 0, 0, 0, loc), loc) {
		t.Error("15:00 should be outside 10:00–14:00")
	}
	// Close is exclusive.
	if holidayOpenAt(win, time.Date(2026, 12, 25, 14, 0, 0, 0, loc), loc) {
		t.Error("14:00 (close) should be exclusive")
	}
}

func TestEffectiveOpenWithHoliday(t *testing.T) {
	loc := time.UTC
	// Weekly: open Fridays 09:00–17:00.
	weekly := []BusinessHour{{DayOfWeek: 5, OpenMinute: 540, CloseMinute: 1020}}
	fridayNoon := time.Date(2026, 7, 24, 12, 0, 0, 0, loc) // a Friday

	// No holiday → weekly applies (open).
	if !effectiveOpenWithHoliday(true, weekly, nil, fridayNoon, loc) {
		t.Error("no holiday, within weekly window → open")
	}
	// A closed holiday on this Friday overrides the weekly schedule → closed.
	closed := &HolidayHour{IsClosed: true}
	if effectiveOpenWithHoliday(true, weekly, closed, fridayNoon, loc) {
		t.Error("closed holiday must override an otherwise-open weekly window")
	}
	// A holiday with special hours 13:00–15:00 → closed at noon (outside the special window).
	special := &HolidayHour{IsClosed: false, OpenMinute: 780, CloseMinute: 900}
	if effectiveOpenWithHoliday(true, weekly, special, fridayNoon, loc) {
		t.Error("special-hours holiday should replace the weekly window")
	}
	// Manual switch off → closed regardless of holiday/weekly.
	if effectiveOpenWithHoliday(false, weekly, nil, fridayNoon, loc) {
		t.Error("manual switch off → always closed")
	}
}

func TestTotalEtaMinutes(t *testing.T) {
	if got := totalEtaMinutes(15, 20.0); got != 35.0 {
		t.Errorf("prep 15 + travel 20 = %v, want 35", got)
	}
	if got := totalEtaMinutes(-5, -3); got != 0 {
		t.Errorf("negative inputs should clamp to 0, got %v", got)
	}
	if got := totalEtaMinutes(0, 12.5); got != 12.5 {
		t.Errorf("zero prep → travel only, got %v", got)
	}
}
