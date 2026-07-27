package restaurant

import (
	"testing"
	"time"
)

func hhmm(t *testing.T, s string) int {
	t.Helper()
	m, err := parseHHMM(s)
	if err != nil {
		t.Fatalf("parseHHMM(%q): %v", s, err)
	}
	return m
}

func TestParseHHMM(t *testing.T) {
	ok := map[string]int{"09:00": 540, "9:00": 540, "00:00": 0, "18:30": 1110, "23:59": 1439, "24:00": 1440}
	for s, want := range ok {
		if got, err := parseHHMM(s); err != nil || got != want {
			t.Errorf("parseHHMM(%q) = %d,%v; want %d,nil", s, got, err, want)
		}
	}
	for _, bad := range []string{"24:01", "25:00", "12:60", "-1:00", "abc", "1200", "12:", ":30", "12:30:00"} {
		if _, err := parseHHMM(bad); err == nil {
			t.Errorf("parseHHMM(%q) should error", bad)
		}
	}
}

// weekday guard: the fixed dates used below must land on the expected weekdays, else
// the whole suite is meaningless.
func TestFixtureWeekdays(t *testing.T) {
	for _, c := range []struct {
		date time.Time
		want time.Weekday
	}{
		{time.Date(2026, 7, 27, 0, 0, 0, 0, time.UTC), time.Monday},
		{time.Date(2026, 7, 31, 0, 0, 0, 0, time.UTC), time.Friday},
		{time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC), time.Saturday},
		{time.Date(2026, 8, 2, 0, 0, 0, 0, time.UTC), time.Sunday},
	} {
		if c.date.Weekday() != c.want {
			t.Fatalf("%s is %s, expected %s", c.date.Format("2006-01-02"), c.date.Weekday(), c.want)
		}
	}
}

func at(y, mo, d, h, mi int) time.Time {
	return time.Date(y, time.Month(mo), d, h, mi, 0, 0, time.UTC)
}

func TestIsOpenAt(t *testing.T) {
	mon := int(time.Monday)
	fri := int(time.Friday)

	// Mon–Fri 09:00–17:00 (same-day), plus a Fri 18:00→02:00 overnight window.
	sameDay := func(day int) BusinessHour {
		return BusinessHour{DayOfWeek: day, OpenMinute: hhmm(t, "09:00"), CloseMinute: hhmm(t, "17:00")}
	}
	overnight := BusinessHour{DayOfWeek: fri, OpenMinute: hhmm(t, "18:00"), CloseMinute: hhmm(t, "02:00")}
	hours := []BusinessHour{sameDay(mon), sameDay(fri), overnight}

	cases := []struct {
		name string
		when time.Time
		open bool
	}{
		{"Mon noon inside", at(2026, 7, 27, 12, 0), true},
		{"Mon 09:00 open edge (inclusive)", at(2026, 7, 27, 9, 0), true},
		{"Mon 08:59 before open", at(2026, 7, 27, 8, 59), false},
		{"Mon 17:00 close edge (exclusive)", at(2026, 7, 27, 17, 0), false},
		{"Sun closed (no rows)", at(2026, 8, 2, 12, 0), false},
		{"Fri evening inside overnight", at(2026, 7, 31, 20, 0), true},
		{"Fri 17:59 gap between day+overnight", at(2026, 7, 31, 17, 59), false},
		{"Sat 01:00 overnight spill from Fri", at(2026, 8, 1, 1, 0), true},
		{"Sat 02:00 overnight close edge (exclusive)", at(2026, 8, 1, 2, 0), false},
		{"Sat 03:00 fully closed", at(2026, 8, 1, 3, 0), false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := isOpenAt(hours, c.when, time.UTC); got != c.open {
				t.Errorf("isOpenAt(%s) = %v, want %v", c.when.Format("Mon 15:04"), got, c.open)
			}
		})
	}
}

// TestIsOpenAt_SplitShift: two windows on the same day (lunch + dinner) with a gap.
func TestIsOpenAt_SplitShift(t *testing.T) {
	mon := int(time.Monday)
	hours := []BusinessHour{
		{DayOfWeek: mon, OpenMinute: hhmm(t, "11:00"), CloseMinute: hhmm(t, "14:00")},
		{DayOfWeek: mon, OpenMinute: hhmm(t, "18:00"), CloseMinute: hhmm(t, "22:00")},
	}
	checks := map[time.Time]bool{
		at(2026, 7, 27, 12, 0): true,  // lunch
		at(2026, 7, 27, 16, 0): false, // gap
		at(2026, 7, 27, 19, 0): true,  // dinner
		at(2026, 7, 27, 22, 0): false, // dinner close
	}
	for when, want := range checks {
		if got := isOpenAt(hours, when, time.UTC); got != want {
			t.Errorf("split-shift %s = %v, want %v", when.Format("15:04"), got, want)
		}
	}
}

// TestIsOpenAt_24h: a full-day window 00:00–24:00 is open at any minute that day.
func TestIsOpenAt_24h(t *testing.T) {
	mon := int(time.Monday)
	hours := []BusinessHour{{DayOfWeek: mon, OpenMinute: 0, CloseMinute: 1440}}
	for _, h := range []int{0, 6, 12, 23} {
		if !isOpenAt(hours, at(2026, 7, 27, h, 0), time.UTC) {
			t.Errorf("24h window should be open at %02d:00", h)
		}
	}
	// ...but not the next day.
	if isOpenAt(hours, at(2026, 7, 28, 12, 0), time.UTC) {
		t.Error("24h Monday window must not leak into Tuesday")
	}
}

func TestEffectiveOpen(t *testing.T) {
	hours := []BusinessHour{{DayOfWeek: int(time.Monday), OpenMinute: hhmm(t, "09:00"), CloseMinute: hhmm(t, "17:00")}}
	within := at(2026, 7, 27, 12, 0)
	outside := at(2026, 7, 27, 20, 0)

	if effectiveOpen(false, hours, within, time.UTC) {
		t.Error("manual switch off must force closed even within hours")
	}
	if !effectiveOpen(true, nil, outside, time.UTC) {
		t.Error("no hours defined ⇒ governed only by the manual switch (back-compat)")
	}
	if !effectiveOpen(true, hours, within, time.UTC) {
		t.Error("on + within hours ⇒ open")
	}
	if effectiveOpen(true, hours, outside, time.UTC) {
		t.Error("on + outside hours ⇒ closed")
	}
}
