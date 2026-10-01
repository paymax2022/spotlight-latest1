package timeutil_test

import (
	"testing"
	"time"

	"spotlight/backend/go-common/timeutil"
)

func TestParseDate(t *testing.T) {
	tm, err := timeutil.ParseDate("2026-09-30")
	if err != nil {
		t.Fatalf("ParseDate: %v", err)
	}
	if tm.Year() != 2026 || tm.Month() != 9 || tm.Day() != 30 {
		t.Fatalf("ParseDate = %v", tm)
	}
	tm, err = timeutil.ParseDate("")
	if err != nil || !tm.IsZero() {
		t.Fatal("empty must yield zero,nil")
	}
	if _, err = timeutil.ParseDate("30/09/2026"); err == nil {
		t.Fatal("bad layout must error")
	}
}

func TestParseDatePtr(t *testing.T) {
	if timeutil.ParseDatePtr("") != nil {
		t.Fatal("empty must be nil")
	}
	if timeutil.ParseDatePtr("bad") != nil {
		t.Fatal("bad must be nil")
	}
	if p := timeutil.ParseDatePtr("2026-01-01"); p == nil {
		t.Fatal("valid must be non-nil")
	}
}

func TestParseTime(t *testing.T) {
	for _, s := range []string{
		"2026-09-30T12:00:00Z",
		"2026-09-30T12:00:00.123Z",
		"2026-09-30 12:00:00",
		"2026-09-30",
	} {
		if _, err := timeutil.ParseTime(s); err != nil {
			t.Fatalf("ParseTime(%q): %v", s, err)
		}
	}
	if tm, err := timeutil.ParseTime(""); err != nil || !tm.IsZero() {
		t.Fatal("empty must yield zero,nil")
	}
	if _, err := timeutil.ParseTime("garbage!!"); err == nil {
		t.Fatal("garbage must error")
	}
}

func TestParseTimePtr(t *testing.T) {
	if p := timeutil.ParseTimePtr("2026-09-30T12:00:00Z"); p == nil {
		t.Fatal("valid must be non-nil")
	}
	if timeutil.ParseTimePtr("bad") != nil {
		t.Fatal("bad must be nil")
	}
}

func TestRFC3339(t *testing.T) {
	if got := timeutil.RFC3339(time.Time{}); got != "" {
		t.Fatalf("zero time = %q, want empty", got)
	}
	tm := time.Date(2026, 9, 30, 12, 0, 0, 0, time.UTC)
	if got := timeutil.RFC3339(tm); got != "2026-09-30T12:00:00Z" {
		t.Fatalf("RFC3339 = %q", got)
	}
	if got := timeutil.RFC3339Ptr(nil); got != "" {
		t.Fatalf("RFC3339Ptr(nil) = %q", got)
	}
}

func TestNowPtr(t *testing.T) {
	p := timeutil.NowPtr()
	if p == nil || p.IsZero() {
		t.Fatal("NowPtr must be non-nil non-zero")
	}
}

func TestStartEndOfDay(t *testing.T) {
	tm := time.Date(2026, 9, 30, 15, 30, 0, 0, time.UTC)
	sod := timeutil.StartOfDay(tm)
	if sod.Hour() != 0 || sod.Day() != 30 {
		t.Fatalf("StartOfDay = %v", sod)
	}
	eod := timeutil.EndOfDay(tm)
	if eod.Day() != 1 || eod.Month() != 10 {
		t.Fatalf("EndOfDay must be exclusive next-day midnight: %v", eod)
	}
	if !eod.After(sod) {
		t.Fatal("EndOfDay must be after StartOfDay")
	}
}

func TestIntervalSeconds(t *testing.T) {
	if got := timeutil.IntervalSeconds(90 * time.Second); got != "90 seconds" {
		t.Fatalf("IntervalSeconds = %q", got)
	}
	if got := timeutil.IntervalSeconds(-5 * time.Second); got != "0 seconds" {
		t.Fatalf("negative must clamp: %q", got)
	}
}

func TestIntervalMinutes(t *testing.T) {
	if got := timeutil.IntervalMinutes(2 * time.Hour); got != "120 minutes" {
		t.Fatalf("IntervalMinutes = %q", got)
	}
	if got := timeutil.IntervalMinutes(-1); got != "0 minutes" {
		t.Fatalf("negative must clamp: %q", got)
	}
}

func TestAge(t *testing.T) {
	old := time.Now().Add(-48 * time.Hour)
	if got := timeutil.Age(old); got != 2 {
		t.Fatalf("Age = %d, want 2", got)
	}
}

func TestClampToRange(t *testing.T) {
	lo := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	hi := time.Date(2026, 12, 31, 0, 0, 0, 0, time.UTC)
	mid := time.Date(2026, 6, 15, 0, 0, 0, 0, time.UTC)
	if got := timeutil.ClampToRange(mid, lo, hi); got != mid {
		t.Fatal("in-range passthrough")
	}
	before := time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)
	if got := timeutil.ClampToRange(before, lo, hi); got != lo {
		t.Fatal("below lo must clamp to lo")
	}
	if got := timeutil.ClampToRange(mid, time.Time{}, hi); got != mid {
		t.Fatal("zero lo must be ignored")
	}
}
