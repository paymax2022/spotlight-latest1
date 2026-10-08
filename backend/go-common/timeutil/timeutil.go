// Package timeutil replaces the date/time parsing and Postgres interval
// helpers copy-pasted across internal modules (parseDate, parseTime,
// rfc3339, formatInterval).
package timeutil

import (
	"strconv"
	"strings"
	"time"
)

// DateLayout is the canonical date-only format used across the API surface.
const DateLayout = "2006-01-02"

// ParseDate parses a date-only string ("2006-01-02") in UTC — the common
// parseDate body. Empty input returns the zero Time and no error so optional
// filters stay nil-able; callers requiring presence must check IsZero.
func ParseDate(s string) (time.Time, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return time.Time{}, nil
	}
	return time.ParseInLocation(DateLayout, s, time.UTC)
}

// ParseDatePtr is ParseDate returning *time.Time — nil for empty/unparseable,
// matching the tri-state optional-filter convention (BoolParam, IntParam).
func ParseDatePtr(s string) *time.Time {
	t, err := ParseDate(s)
	if err != nil || t.IsZero() {
		return nil
	}
	return &t
}

// timeLayouts is the accepted input set for ParseTime, ordered most common
// first. Covers the timestamp shapes the copy-pasted parsers accepted.
var timeLayouts = []string{
	time.RFC3339Nano,
	time.RFC3339,
	"2006-01-02T15:04:05",
	"2006-01-02 15:04:05",
	"2006-01-02T15:04",
	DateLayout,
}

// ParseTime parses s against the accepted layouts (RFC3339 first). Empty
// input returns the zero Time and no error — same optional convention as
// ParseDate.
func ParseTime(s string) (time.Time, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return time.Time{}, nil
	}
	var firstErr error
	for _, layout := range timeLayouts {
		t, err := time.ParseInLocation(layout, s, time.UTC)
		if err == nil {
			return t, nil
		}
		if firstErr == nil {
			firstErr = err
		}
	}
	return time.Time{}, firstErr
}

// ParseTimePtr is ParseTime returning *time.Time for optional filters.
func ParseTimePtr(s string) *time.Time {
	t, err := ParseTime(s)
	if err != nil || t.IsZero() {
		return nil
	}
	return &t
}

// RFC3339 formats t in UTC RFC3339 — the rfc3339 helper copies. Zero times
// format as "" rather than the year-1 sentinel so JSON output stays clean.
func RFC3339(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.UTC().Format(time.RFC3339)
}

// RFC3339Ptr is RFC3339 for *time.Time — nil formats as "".
func RFC3339Ptr(t *time.Time) string {
	if t == nil {
		return ""
	}
	return RFC3339(*t)
}

// IntervalSeconds renders d as a Postgres interval literal ("N seconds")
// for use in parameterized interval arithmetic — the formatInterval copies
// in the reconciler loops. Non-positive durations clamp to 0 seconds so
// "no grace period" is a valid input, matching the original semantics.
func IntervalSeconds(d time.Duration) string {
	secs := max(int64(d/time.Second), 0)
	return strconv.FormatInt(secs, 10) + " seconds"
}
