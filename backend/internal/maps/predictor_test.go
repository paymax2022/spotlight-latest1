package maps

import "testing"

// scoreHistoryMatch is the pure matching/scoring core of the history predictor
// (MAPSERVICE.md §6). DB-dependent candidate fetching is left to integration; here
// we pin the scoring rule: exact → high + match, fuzzy → tiered, no-relation →
// miss, and the same-neighborhood spatial bonus.

func TestScoreHistoryMatch(t *testing.T) {
	cases := []struct {
		name      string
		query     string
		candidate string
		sameCell  bool
		wantConf  Confidence
		wantOK    bool
	}{
		// Exact match → high confidence, true.
		{"exact", "10 awolowo road ikoyi", "10 awolowo road ikoyi", false, 0.90, true},
		{"exact_same_cell_bonus", "10 awolowo road ikoyi", "10 awolowo road ikoyi", true, 0.95, true},

		// Prefix either direction → strong partial.
		{"query_prefix_of_candidate", "10 awolowo", "10 awolowo road ikoyi", false, 0.78, true},
		{"candidate_prefix_of_query", "10 awolowo road ikoyi lagos", "10 awolowo road ikoyi", false, 0.78, true},

		// Substring containment → weak partial.
		{"substring", "awolowo road", "10 awolowo road ikoyi", false, 0.70, true},

		// Spatial bonus lifts a weak partial just over the predict floor.
		{"weak_with_cell_bonus", "awolowo road", "10 awolowo road ikoyi", true, 0.75, true},

		// No relation → miss.
		{"no_match", "lekki phase 1", "10 awolowo road ikoyi", false, 0, false},
		{"no_match_same_cell_still_miss", "lekki phase 1", "10 awolowo road ikoyi", true, 0, false},

		// Empty inputs → miss.
		{"empty_query", "", "10 awolowo road ikoyi", false, 0, false},
		{"empty_candidate", "10 awolowo road ikoyi", "", false, 0, false},
		{"both_empty", "", "", false, 0, false},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			gotConf, gotOK := scoreHistoryMatch(c.query, c.candidate, c.sameCell)
			if gotOK != c.wantOK {
				t.Fatalf("scoreHistoryMatch(%q, %q, %v) ok = %v, want %v",
					c.query, c.candidate, c.sameCell, gotOK, c.wantOK)
			}
			if !almostEqual(gotConf, c.wantConf) {
				t.Fatalf("scoreHistoryMatch(%q, %q, %v) conf = %v, want %v",
					c.query, c.candidate, c.sameCell, gotConf, c.wantConf)
			}
		})
	}
}

// A bare weak-partial (no spatial bonus) scores below predictStrongFloor, so the
// predictor must NOT deflect on it alone — "false positives are worse than a miss".
func TestWeakPartialBelowPredictFloor(t *testing.T) {
	conf, ok := scoreHistoryMatch("awolowo road", "10 awolowo road ikoyi", false)
	if !ok {
		t.Fatalf("expected weak partial to be a (scored) match")
	}
	if conf >= predictStrongFloor {
		t.Fatalf("weak partial conf %v must be below predictStrongFloor %v", conf, predictStrongFloor)
	}
}

// An exact match must clear the predict floor so a true known place deflects.
func TestExactClearsPredictFloor(t *testing.T) {
	conf, ok := scoreHistoryMatch("ikeja city mall", "ikeja city mall", false)
	if !ok || conf < predictStrongFloor {
		t.Fatalf("exact match conf %v ok %v must clear predictStrongFloor %v", conf, ok, predictStrongFloor)
	}
}
