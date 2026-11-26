package connectvoting

import "testing"

// TestCanTransition covers the forward-only results-status lifecycle (§2). A
// regression (e.g. published → declared) must be refused, unknown statuses must
// be refused, and staying put or advancing must be allowed.
func TestCanTransition(t *testing.T) {
	cases := []struct {
		from, to string
		want     bool
	}{
		{"not_declared", "finalists_announced", true},
		{"not_declared", "results_published", true}, // skip-ahead is allowed
		{"finalists_announced", "winners_declared", true},
		{"winners_declared", "winners_declared", true}, // idempotent re-set
		{"results_published", "winners_declared", false}, // never regress
		{"prizes_fulfilled", "not_declared", false},
		{"results_published", "bogus", false}, // unknown target
		{"bogus", "results_published", false}, // unknown source
	}
	for _, c := range cases {
		if got := CanTransition(c.from, c.to); got != c.want {
			t.Errorf("CanTransition(%q,%q) = %v, want %v", c.from, c.to, got, c.want)
		}
	}
}

// TestResultsPublishedSet pins which lifecycle states expose winners publicly
// (§3: "Only display official winner badges after authorised results have been
// published"). Anything before results_published must NOT be in the set.
func TestResultsPublishedSet(t *testing.T) {
	mustBePublic := []string{"results_published", "prize_fulfilment_in_progress", "prizes_fulfilled"}
	mustNotBePublic := []string{"not_declared", "finalists_announced", "winners_declared"}
	for _, s := range mustBePublic {
		if !resultsPublishedSet[s] {
			t.Errorf("resultsPublishedSet[%q] = false, want true", s)
		}
	}
	for _, s := range mustNotBePublic {
		if resultsPublishedSet[s] {
			t.Errorf("resultsPublishedSet[%q] = true, want false (winners would leak pre-publication)", s)
		}
	}
}

// TestValidMethodologies guards the winner-selection methodology allowlist (§2):
// the configurable methods are accepted, an arbitrary string is not.
func TestValidMethodologies(t *testing.T) {
	for _, m := range []string{"public_voting", "judges_evaluation", "administrative_selection", "combined_voting_judges", "panel_evaluation", "other"} {
		if !validMethodologies[m] {
			t.Errorf("validMethodologies[%q] = false, want true", m)
		}
	}
	if validMethodologies["vote_count_auto"] {
		t.Error("auto-derivation must never be a configurable methodology")
	}
}

// TestNullableUUID checks the FK helper that turns an absent position into NULL
// so a winner can be declared before positions exist (joint/unpositioned awards).
func TestNullableUUID(t *testing.T) {
	if v := nullableUUID(nil); v != nil {
		t.Errorf("nullableUUID(nil) = %v, want nil", v)
	}
	empty := ""
	if v := nullableUUID(&empty); v != nil {
		t.Errorf("nullableUUID(\"\") = %v, want nil", v)
	}
	id := "abc"
	if v := nullableUUID(&id); v != "abc" {
		t.Errorf("nullableUUID(\"abc\") = %v, want \"abc\"", v)
	}
}
