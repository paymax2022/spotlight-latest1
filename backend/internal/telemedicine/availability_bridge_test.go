package telemedicine

// availability_bridge_test.go — the doctor's published hours, expanded into the
// slots a patient can book.
//
// The doctor portal's schedule screen writes ONE row: `doctor_availability`, with
// `working_days` like [{day:"mon",enabled:true,startTime:"09:00",endTime:"17:00"}]
// plus the consult length and the gap between consults. This read looks for rows
// in `doctor_availability_slots` — a table nothing in this repository inserts
// into — and so always falls through to `synthSlots`, which answers a fixed
// 7-slot day and a fabricated `(d+i)%3` availability mask. A doctor who
// publishes Monday-to-Friday 09:00–17:00 and one who never opened the screen
// offer patients exactly the same calendar.
//
// Slots are therefore DERIVED on read, never stored — the same doctrine as
// internal/health/vet's ComputeSlots. Everything zone-dependent is left to
// Postgres (`now() AT TIME ZONE zone`, the same trick internal/doctor uses to
// answer the doctor's local day), so the pure expansion below receives a naive
// wall-clock "now" and produces wall-clock labels.
//
// The labels matter as much as the times: features/telemedicine/pricing.ts
// `slotToISO` accepts only /^(\d{1,2}):(\d{2})\s*(AM|PM)$/, so a 24-hour
// "09:00" is silently not a bookable slot on the patient's screen.

import (
	"fmt"
	"testing"
	"time"
)

// minutes turns a wall-clock "09:00" into minutes from local midnight.
func minutes(hhmm string) int {
	var h, m int
	if _, err := fmt.Sscanf(hhmm, "%d:%d", &h, &m); err != nil {
		panic(hhmm)
	}
	return h*60 + m
}

// everyDay makes one window apply to all seven weekdays; the tests below then
// constrain by which localNow date they start from.
func everyDay(from, to int) []clockWindow {
	out := []clockWindow{}
	for d := time.Sunday; d <= time.Saturday; d++ {
		out = append(out, clockWindow{weekday: d, from: from, to: to})
	}
	return out
}

func onlyDay(day time.Weekday, from, to int) []clockWindow {
	return []clockWindow{{weekday: day, from: from, to: to}}
}

// A 30-minute grid across an eight-hour day is 16 slots, and the last one ends
// exactly on the window's close — a slot that would run past it is not offered.
func TestExpandSlots_FillsTheWindowOnTheConsultGrid(t *testing.T) {
	now := time.Date(2026, 11, 16, 7, 0, 0, 0, time.UTC) // a Monday, before opening
	slots := expandSlots("doc-1", everyDay(minutes("09:00"), minutes("17:00")), nil, 30, 0, now, 1, nil)
	if len(slots) != 16 {
		t.Fatalf("len = %d, want 16 (09:00→17:00 in threes); %v", len(slots), labels(slots))
	}
	if slots[0].Date != "2026-11-16" {
		t.Errorf("first date = %q, want the doctor's local today %q", slots[0].Date, "2026-11-16")
	}
	if slots[0].Time != "09:00 AM" {
		t.Errorf("first time = %q, want %q", slots[0].Time, "09:00 AM")
	}
	if last := slots[len(slots)-1]; last.Time != "04:30 PM" {
		t.Errorf("last time = %q, want %q (ends 17:00, inside the window)", last.Time, "04:30 PM")
	}
	for _, s := range slots {
		if !s.Available {
			t.Errorf("slot %s %s came back unavailable with nothing booked", s.Date, s.Time)
		}
	}
}

// The gap between consults moves the grid, not the slot length: 30 + 15 buffers
// step every 45 minutes and the tail of the day stops earlier still.
func TestExpandSlots_TheBufferSitsBetweenConsults(t *testing.T) {
	now := time.Date(2026, 11, 16, 7, 0, 0, 0, time.UTC)
	slots := expandSlots("doc-1", everyDay(minutes("09:00"), minutes("12:00")), nil, 30, 15, now, 1, nil)
	var got []string
	for _, s := range slots {
		got = append(got, s.Time)
	}
	want := []string{"09:00 AM", "09:45 AM", "10:30 AM", "11:15 AM"}
	if len(got) != len(want) {
		t.Fatalf("times = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("times[%d] = %q, want %q", i, got[i], want[i])
		}
	}
}

// A break is time the doctor is not in the room: a slot that overlaps it, even
// partly, is not offered.
func TestExpandSlots_BreaksPunchOutOfTheDay(t *testing.T) {
	now := time.Date(2026, 11, 16, 7, 0, 0, 0, time.UTC)
	breaks := onlyDay(time.Monday, minutes("13:00"), minutes("14:00"))
	slots := expandSlots("doc-1", everyDay(minutes("12:00"), minutes("15:00")), breaks, 30, 0, now, 1, nil)
	var got []string
	for _, s := range slots {
		got = append(got, s.Time)
	}
	want := []string{"12:00 PM", "12:30 PM", "02:00 PM", "02:30 PM"}
	if len(got) != len(want) {
		t.Fatalf("times = %v, want %v — 13:00–14:00 is lunch", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("times[%d] = %q, want %q", i, got[i], want[i])
		}
	}
}

// Only weekdays the doctor enabled produce slots, and a day off yields no empty
// day to click through.
func TestExpandSlots_SkipsDisabledDays(t *testing.T) {
	now := time.Date(2026, 11, 16, 7, 0, 0, 0, time.UTC) // Monday
	slots := expandSlots("doc-1", onlyDay(time.Monday, minutes("09:00"), minutes("10:00")), nil, 30, 0, now, 5, nil)
	if len(slots) != 2 {
		t.Fatalf("len = %d, want the two Monday slots only: %v", len(slots), labels(slots))
	}
	for _, s := range slots {
		if s.Date != "2026-11-16" {
			t.Errorf("slot %s %s is on another day — Tuesday to Friday are closed", s.Date, s.Time)
		}
	}
}

// Half the day is already gone: today starts at the next slot the doctor could
// still take, not at 09:00.
func TestExpandSlots_DropsTodaySlotsAlreadyPast(t *testing.T) {
	now := time.Date(2026, 11, 16, 11, 7, 0, 0, time.UTC) // 11:07 local
	slots := expandSlots("doc-1", everyDay(minutes("09:00"), minutes("17:00")), nil, 30, 0, now, 1, nil)
	if len(slots) == 0 {
		t.Fatal("no slots after 11:07, want the rest of the afternoon")
	}
	if slots[0].Time != "11:30 AM" {
		t.Errorf("first time = %q, want %q — 11:00 already started", slots[0].Time, "11:30 AM")
	}
}

// A booked consult is visible as taken rather than deleted: the patient sees the
// doctor's real day, with that hour unavailable.
func TestExpandSlots_ReportsBookedSlotsUnavailable(t *testing.T) {
	now := time.Date(2026, 11, 16, 7, 0, 0, 0, time.UTC)
	booked := []wallInterval{{
		start: time.Date(2026, 11, 16, 10, 0, 0, 0, time.UTC),
		end:   time.Date(2026, 11, 16, 10, 30, 0, 0, time.UTC),
	}}
	slots := expandSlots("doc-1", everyDay(minutes("09:00"), minutes("11:00")), nil, 30, 0, now, 1, booked)
	if len(slots) != 4 {
		t.Fatalf("len = %d, want the whole morning still listed: %v", len(slots), labels(slots))
	}
	for _, s := range slots {
		// The booking occupies its own thirty minutes, so 10:30 is free again.
		want := s.Time != "10:00 AM"
		if s.Available != want {
			t.Errorf("%s available = %v, want %v", s.Time, s.Available, want)
		}
	}
}

// IDs key the picker's React list and are what a stale selection is resolved
// against, so they must stay unique across the whole calendar.
func TestExpandSlotIDsAreUnique(t *testing.T) {
	now := time.Date(2026, 11, 16, 7, 0, 0, 0, time.UTC)
	slots := expandSlots("doc-1", everyDay(minutes("09:00"), minutes("10:00")), nil, 30, 0, now, 5, nil)
	seen := map[string]bool{}
	for _, s := range slots {
		if s.DoctorID != "doc-1" {
			t.Errorf("slot %s carries doctor %q", s.ID, s.DoctorID)
		}
		if seen[s.ID] {
			t.Fatalf("duplicate slot id %s", s.ID)
		}
		seen[s.ID] = true
	}
	if len(slots) != 10 {
		t.Fatalf("len = %d, want 2 slots on each of 5 days", len(slots))
	}
}

// The stored JSON is what the schedule screen wrote, not a hand-made fixture:
// `enabled:false` is a day off, and an unparsable window is dropped rather than
// inventing an hour.
func TestParseClockWindows_ReadsThePublishedRow(t *testing.T) {
	raw := []byte(`[
		{"day":"mon","enabled":true,"startTime":"09:00","endTime":"17:00"},
		{"day":"sat","enabled":false,"startTime":"09:00","endTime":"17:00"},
		{"day":"sun","enabled":true,"startTime":"17:00","endTime":"17:00"}
	]`)
	got, err := parseClockWindows(raw, "working day")
	if err != nil {
		t.Fatalf("parseClockWindows: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("len = %d, want only the enabled Monday with a real span: %+v", len(got), got)
	}
	if got[0].weekday != time.Monday || got[0].from != 540 || got[0].to != 1020 {
		t.Errorf("window = %+v, want Monday 09:00–17:00 as minutes of the local day", got[0])
	}
}

func TestParseClockWindows_RejectsGarbage(t *testing.T) {
	if _, err := parseClockWindows([]byte(`{"day":"mon"}`), "working day"); err == nil {
		t.Error("an object where the column holds an array parsed, want an error the read can report")
	}
	if _, err := parseClockWindows([]byte(`[{"day":"tues","enabled":true,"startTime":"09:00","endTime":"17:00"}]`), "working day"); err == nil {
		t.Error("an unknown weekday parsed, want the typo surfaced")
	}
}

func labels(slots []Slot) []string {
	out := make([]string, 0, len(slots))
	for _, s := range slots {
		out = append(out, s.Date+" "+s.Time)
	}
	return out
}
