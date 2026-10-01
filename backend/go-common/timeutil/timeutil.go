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

// NowPtr returns a pointer to the current UTC time — for stamped columns
// whose type is *time.Time.
func NowPtr() *time.Time {
	t := time.Now().UTC()
	return &t
}

// StartOfDay truncates t to midnight UTC — the day-bucket boundary used by
// reporting queries.
func StartOfDay(t time.Time) time.Time {
	u := t.UTC()
	return time.Date(u.Year(), u.Month(), u.Day(), 0, 0, 0, 0, time.UTC)
}

// EndOfDay returns the exclusive end of the UTC day containing t — i.e.
// StartOfDay(t)+24h, the correct half-open bound for `ts >= start AND ts <
// end` queries (never 23:59:59, which loses the last second).
func EndOfDay(t time.Time) time.Time {
	return StartOfDay(t).Add(24 * time.Hour)
}

// IntervalSeconds renders d as a Postgres interval literal ("N seconds")
// for use in parameterized interval arithmetic — the formatInterval copies
// in the reconciler loops. Non-positive durations clamp to 0 seconds so
// "no grace period" is a valid input, matching the original semantics.
func IntervalSeconds(d time.Duration) string {
	secs := max(int64(d/time.Second), 0)
	return strconv.FormatInt(secs, 10) + " seconds"
}

// IntervalMinutes is IntervalSeconds with minute granularity — for grace
// periods configured in whole minutes.
func IntervalMinutes(d time.Duration) string {
	mins := max(int64(d/time.Minute), 0)
	return strconv.FormatInt(mins, 10) + " minutes"
}

// Age returns whole days since t — for "N days ago" surfaces.
func Age(t time.Time) int {
	return int(time.Since(t).Hours() / 24)
}

// ClampToRange bounds t into [lo, hi]; zero bounds are ignored so callers
// can pass optional limits without branching.
func ClampToRange(t, lo, hi time.Time) time.Time {
	if !lo.IsZero() && t.Before(lo) {
		return lo
	}
	if !hi.IsZero() && t.After(hi) {
		return hi
	}
	return t
}
