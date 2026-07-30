package healthconsent

import (
	"testing"
	"time"
)

// TS-1 AC-004 (explicit, scoped, expiring, gates access) + AC-008 (withdrawal stops
// sharing). Pure, deterministic assertions on the canonical active-grant rule that
// HasActiveGrant enforces — no DB.

func now() time.Time      { return time.Date(2026, 7, 30, 12, 0, 0, 0, time.UTC) }
func ptr(t time.Time) *time.Time { return &t }

func TestGrantActive(t *testing.T) {
	cases := []struct {
		name      string
		state     string
		grant     string
		expires   *time.Time
		want      string
		expect    bool
	}{
		{"active exact scope, no expiry", "ACTIVE", "RECORDS", nil, "RECORDS", true},
		{"ALL covers any scope", "ACTIVE", "ALL", nil, "LAB_RESULTS", true},
		{"scope-gated: RECORDS grant, LAB want", "ACTIVE", "RECORDS", nil, "LAB_RESULTS", false},
		{"withdrawn (revoked) → inactive (AC-008)", "REVOKED", "RECORDS", nil, "RECORDS", false},
		{"expired → inactive (AC-004)", "ACTIVE", "RECORDS", ptr(now().Add(-time.Hour)), "RECORDS", false},
		{"future expiry → active", "ACTIVE", "RECORDS", ptr(now().Add(time.Hour)), "RECORDS", true},
		{"exactly at expiry → inactive (half-open)", "ACTIVE", "RECORDS", ptr(now()), "RECORDS", false},
	}
	for _, c := range cases {
		if got := grantActive(c.state, c.grant, c.expires, c.want, now()); got != c.expect {
			t.Errorf("%s: grantActive = %v, want %v", c.name, got, c.expect)
		}
	}
}

// AC-004: only recognised scopes may be granted.
func TestValidScope(t *testing.T) {
	for _, s := range []string{"RECORDS", "PRESCRIPTIONS", "LAB_RESULTS", "ALL"} {
		if !validScope(s) {
			t.Errorf("%q should be a valid scope", s)
		}
	}
	for _, s := range []string{"", "records", "EVERYTHING", "ADMIN"} {
		if validScope(s) {
			t.Errorf("%q must be rejected as a scope", s)
		}
	}
}
