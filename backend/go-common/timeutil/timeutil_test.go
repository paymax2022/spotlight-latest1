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

func TestIntervalSeconds(t *testing.T) {
	if got := timeutil.IntervalSeconds(90 * time.Second); got != "90 seconds" {
		t.Fatalf("IntervalSeconds = %q", got)
	}
	if got := timeutil.IntervalSeconds(-5 * time.Second); got != "0 seconds" {
		t.Fatalf("negative must clamp: %q", got)
	}
}
