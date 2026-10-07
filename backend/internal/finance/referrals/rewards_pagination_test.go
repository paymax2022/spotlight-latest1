package referrals

// Unit tests for parsePageParams — the ?limit/?offset contract shared by the
// member list endpoints (me/referrals, me/earnings) and the admin ledger feeds.
// Regression: `offset=-1` used to reach SQL verbatim and 500 on
// `OFFSET must not be negative`, and `limit=abc` was swallowed to a silent
// empty page — both must now be a client-visible 400.

import (
	"testing"
)

func TestParsePageParams_DefaultsWhenAbsent(t *testing.T) {
	limit, offset, err := parsePageParams("", "", 50, 200)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if limit != 50 || offset != 0 {
		t.Fatalf("got limit=%d offset=%d, want 50/0", limit, offset)
	}
}

func TestParsePageParams_RejectsMalformedAndNegative(t *testing.T) {
	cases := []struct {
		name, limit, offset string
	}{
		{"negative offset", "", "-1"},
		{"negative limit", "-5", ""},
		{"non-numeric limit", "abc", ""},
		{"non-numeric offset", "", "abc"},
		{"float limit", "1.5", ""},
		{"float offset", "", "0.5"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, _, err := parsePageParams(tc.limit, tc.offset, 50, 200); err == nil {
				t.Fatalf("limit=%q offset=%q: expected error, got nil", tc.limit, tc.offset)
			}
		})
	}
}

func TestParsePageParams_CapsLimitAtMax(t *testing.T) {
	limit, offset, err := parsePageParams("999999999", "10", 50, 200)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if limit != 200 || offset != 10 {
		t.Fatalf("got limit=%d offset=%d, want capped 200/10", limit, offset)
	}
}

func TestParsePageParams_ZeroLimitFallsBackToDefault(t *testing.T) {
	limit, _, err := parsePageParams("0", "", 50, 200)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if limit != 50 {
		t.Fatalf("got limit=%d, want default 50", limit)
	}
}

func TestParsePageParams_ValidValuesPassThrough(t *testing.T) {
	limit, offset, err := parsePageParams("25", "100", 50, 200)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if limit != 25 || offset != 100 {
		t.Fatalf("got limit=%d offset=%d, want 25/100", limit, offset)
	}
}
