package estate

import (
	"testing"
	"time"
)

func TestAnalyticsTypes(t *testing.T) {
	if len(AnalyticsTypes) != 9 {
		t.Fatalf("expected 9 analytics types, got %d", len(AnalyticsTypes))
	}
	for _, ty := range AnalyticsTypes {
		if !validAnalyticsType(ty) {
			t.Errorf("%q should be valid", ty)
		}
	}
	if validAnalyticsType("bogus") {
		t.Error("unknown type must be rejected")
	}
}

func TestResolveRangeDefaults(t *testing.T) {
	now := time.Date(2026, 6, 23, 12, 0, 0, 0, time.UTC)
	// Blank → last 30 days ending today.
	s, e := resolveRange("", "", now)
	if e.Before(now.Add(-time.Hour)) {
		t.Errorf("end should be ~now, got %v", e)
	}
	if d := e.Sub(s); d < 29*24*time.Hour || d > 31*24*time.Hour {
		t.Errorf("default window should be ~30d, got %v", d)
	}
}

func TestResolveRangeExplicit(t *testing.T) {
	now := time.Date(2026, 6, 23, 12, 0, 0, 0, time.UTC)
	s, e := resolveRange("2026-01-01", "2026-01-31", now)
	if s.Format("2006-01-02") != "2026-01-01" {
		t.Errorf("start = %v", s)
	}
	if e.Format("2006-01-02") != "2026-01-31" {
		t.Errorf("end (inclusive) = %v", e)
	}
	if !e.After(s) {
		t.Error("end must be after start")
	}
}

func TestResolveRangeInverted(t *testing.T) {
	now := time.Date(2026, 6, 23, 12, 0, 0, 0, time.UTC)
	// from after to → corrected, never inverted.
	s, e := resolveRange("2026-12-01", "2026-01-01", now)
	if s.After(e) {
		t.Error("resolveRange must never return start after end")
	}
}
