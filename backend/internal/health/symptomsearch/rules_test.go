package symptomsearch

import (
	"strings"
	"testing"
)

func TestParseRule_Valid(t *testing.T) {
	valid := []string{
		"concept:fever",
		"who:CHILD_UNDER_6",
		"who:PREGNANT_OR_BF",
		"duration_days > 3",
		"duration_days>3", // whitespace-free comparators lex fine
		"term_count >= 2",
		"term_count = 1",
		"concept:headache AND duration_days > 3",
		"NOT who:ADULT",
		"NOT NOT concept:fever",
		"(concept:fever OR concept:cough) AND NOT who:PREGNANT_OR_BF",
		"duration_days <= 3 OR term_count < 4",
		"concept:a1_b2 AND (who:CHILD_6_12 OR duration_days >= 2)",
	}
	for _, expr := range valid {
		if _, err := ParseRule(expr); err != nil {
			t.Errorf("ParseRule(%q) unexpected error: %v", expr, err)
		}
	}
}

func TestParseRule_Malformed(t *testing.T) {
	invalid := []string{
		"",                                // empty
		"   ",                             // whitespace only
		"AND",                             // bare keyword
		"concept:",                        // missing code
		"concept:Fever",                   // uppercase code (CODE := [a-z][a-z0-9_]*)
		"concept:1fever",                  // must start with a letter
		"who:SOMEONE",                     // unknown cohort
		"who:adult",                       // cohorts are UPPERCASE
		"duration_days >",                 // missing integer
		"duration_days three",             // missing comparator
		"duration_days > -1",              // negative (also lexes '-' as bad char)
		"term_count == 2",                 // '==' is not an operator ('=' then '=')
		"concept:fever AND",               // dangling AND
		"(concept:fever",                  // unclosed paren
		"concept:fever)",                  // trailing token
		"concept:fever OR OR concept:c",   // double operator
		"fever",                           // bare word is not a predicate
		"concept:fever and concept:cough", // keywords are case-sensitive UPPERCASE
		"duration_days ! 3",               // illegal character
	}
	for _, expr := range invalid {
		if _, err := ParseRule(expr); err == nil {
			t.Errorf("ParseRule(%q) expected error, got nil (fail-closed contract broken)", expr)
		}
	}
}

// Length bound: the parser refuses oversized expressions outright (bounds the
// recursion depth even for rows written outside the app path); an in-bound
// deeply nested expression still parses.
func TestParseRule_LengthBound(t *testing.T) {
	huge := "NOT " + strings.Repeat("(", 300) + "concept:fever" + strings.Repeat(")", 300)
	if _, err := ParseRule(huge); err == nil {
		t.Fatal("ParseRule must reject expressions over the schema's 500-char cap")
	}
	nested := strings.Repeat("(", 100) + "concept:fever" + strings.Repeat(")", 100)
	if len(nested) > maxRuleExpressionLen {
		t.Fatalf("test fixture exceeds the cap: %d", len(nested))
	}
	if _, err := ParseRule(nested); err != nil {
		t.Fatalf("in-bound nested expression must parse, got %v", err)
	}
}

func TestEvaluate_Predicates(t *testing.T) {
	ctx := &EvalContext{
		Concepts:     map[string]bool{"fever": true, "cough": true},
		Who:          CohortChildUnder6,
		DurationDays: 4, // GT_3D
		TermCount:    2,
	}
	cases := []struct {
		expr string
		want bool
	}{
		{"concept:fever", true},
		{"concept:headache", false},
		{"who:CHILD_UNDER_6", true},
		{"who:ADULT", false},
		{"duration_days > 3", true},
		{"duration_days <= 3", false},
		{"duration_days = 4", true},
		{"term_count >= 2", true},
		{"term_count < 2", false},
		{"NOT concept:headache", true},
		{"concept:fever AND who:CHILD_UNDER_6", true},
		{"concept:fever AND concept:headache", false},
		{"concept:headache OR concept:cough", true},
	}
	for _, tc := range cases {
		got, err := EvaluateExpression(tc.expr, ctx)
		if err != nil {
			t.Fatalf("EvaluateExpression(%q): %v", tc.expr, err)
		}
		if got != tc.want {
			t.Errorf("EvaluateExpression(%q) = %v, want %v", tc.expr, got, tc.want)
		}
	}
}

// Precedence: NOT > AND > OR.
func TestEvaluate_Precedence(t *testing.T) {
	ctx := &EvalContext{Concepts: map[string]bool{"b": true}}
	// a OR b AND c  ⇒  a OR (b AND c)  ⇒  false OR (true AND false) = false
	got, err := EvaluateExpression("concept:a OR concept:b AND concept:c", ctx)
	if err != nil {
		t.Fatal(err)
	}
	if got {
		t.Errorf("expected AND to bind tighter than OR")
	}
	// NOT a AND b  ⇒  (NOT a) AND b  ⇒  true AND true = true
	got, err = EvaluateExpression("NOT concept:a AND concept:b", ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !got {
		t.Errorf("expected NOT to bind tighter than AND")
	}
	// Parens override: NOT (a OR b) = NOT (false OR true) = false
	got, err = EvaluateExpression("NOT (concept:a OR concept:b)", ctx)
	if err != nil {
		t.Fatal(err)
	}
	if got {
		t.Errorf("expected parens to group before NOT")
	}
}

// who: matches only an EXPLICITLY selected cohort; unknown duration never
// satisfies a duration predicate (a rule never fires on unknown data).
func TestEvaluate_AbsentRefiners(t *testing.T) {
	ctx := &EvalContext{Concepts: map[string]bool{"fever": true}, Who: "", DurationDays: 0, TermCount: 1}
	for _, expr := range []string{
		"who:ADULT", "who:PREGNANT_OR_BF",
		"duration_days > 0", "duration_days < 100", "duration_days = 0",
	} {
		got, err := EvaluateExpression(expr, ctx)
		if err != nil {
			t.Fatalf("EvaluateExpression(%q): %v", expr, err)
		}
		if got {
			t.Errorf("EvaluateExpression(%q) = true with absent refiners; rules must not fire on unknown data", expr)
		}
	}
}

// Duration bucket mapping: TODAY→1, D2_3→3, GT_3D→4.
func TestDurationBuckets(t *testing.T) {
	if durationDaysByBucket["TODAY"] != 1 || durationDaysByBucket["D2_3"] != 3 || durationDaysByBucket["GT_3D"] != 4 {
		t.Fatalf("duration bucket mapping does not match the migration header: %v", durationDaysByBucket)
	}
	// The canonical seed rule 'duration_days > 3' fires ONLY for GT_3D.
	for bucket, want := range map[string]bool{"TODAY": false, "D2_3": false, "GT_3D": true} {
		ctx := &EvalContext{Concepts: map[string]bool{}, DurationDays: durationDaysByBucket[bucket]}
		got, err := EvaluateExpression("duration_days > 3", ctx)
		if err != nil {
			t.Fatal(err)
		}
		if got != want {
			t.Errorf("duration_days > 3 with %s = %v, want %v", bucket, got, want)
		}
	}
}
