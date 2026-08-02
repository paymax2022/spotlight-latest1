package exam

import (
	"testing"
	"time"
)

// ── canAttempt: legal + illegal transitions ─────────────────────────────────────

func TestCanAttempt_Allowed(t *testing.T) {
	legal := []struct{ from, to AttemptState }{
		{AttemptCreated, AttemptStarted},
		{AttemptStarted, AttemptPaused},
		{AttemptStarted, AttemptSubmitted},
		{AttemptPaused, AttemptStarted},
		{AttemptPaused, AttemptSubmitted},
		{AttemptSubmitted, AttemptScored},
		{AttemptScored, AttemptReviewed},
	}
	for _, c := range legal {
		if !canAttempt(c.from, c.to) {
			t.Errorf("expected %s -> %s to be allowed", c.from, c.to)
		}
	}
}

func TestCanAttempt_Illegal(t *testing.T) {
	illegal := []struct{ from, to AttemptState }{
		{AttemptCreated, AttemptSubmitted}, // must start first
		{AttemptCreated, AttemptScored},
		{AttemptStarted, AttemptScored},   // must submit first
		{AttemptStarted, AttemptReviewed}, // must submit + score first
		{AttemptSubmitted, AttemptStarted}, // cannot reopen a frozen attempt
		{AttemptSubmitted, AttemptReviewed},
		{AttemptScored, AttemptSubmitted}, // no going back
		{AttemptReviewed, AttemptScored},  // terminal
		{AttemptReviewed, AttemptStarted},
		{AttemptPaused, AttemptScored}, // must submit first
	}
	for _, c := range illegal {
		if canAttempt(c.from, c.to) {
			t.Errorf("expected %s -> %s to be ILLEGAL", c.from, c.to)
		}
	}
}

// ── Submit idempotency contract ──────────────────────────────────────────────────
//
// Two guarantees back idempotent submit:
//  1. Once the attempt is terminal-for-responses (submitted/scored/reviewed) it must
//     NOT accept another submit transition — isTerminalForResponses short-circuits and
//     no further freeze occurs.
//  2. The guarded UPDATE ... WHERE state=$from means a concurrent second submit affects
//     zero rows when the first has already advanced the state — modelled here by the
//     canAttempt guard returning false for any from-state past `started`/`paused`.

func TestSubmit_Idempotency_FrozenStatesRejectResubmit(t *testing.T) {
	frozen := []AttemptState{AttemptSubmitted, AttemptScored, AttemptReviewed}
	for _, s := range frozen {
		if !isTerminalForResponses(s) {
			t.Errorf("state %s must be terminal-for-responses (responses immutable)", s)
		}
		// A frozen attempt must not be allowed to transition back to submitted.
		if canAttempt(s, AttemptSubmitted) {
			t.Errorf("frozen state %s must not allow another submit", s)
		}
	}
}

func TestSubmit_Idempotency_LiveStatesAcceptSubmit(t *testing.T) {
	for _, s := range []AttemptState{AttemptStarted, AttemptPaused} {
		if isTerminalForResponses(s) {
			t.Errorf("state %s must NOT be terminal (responses still mutable)", s)
		}
		if !canAttempt(s, AttemptSubmitted) {
			t.Errorf("live state %s must allow submit", s)
		}
	}
}

// ── score(): UTME 400-scale ──────────────────────────────────────────────────────

func TestScore_UTME400Scale(t *testing.T) {
	rules := map[string]any{"scale": "400"}
	// 3 of 4 correct overall = 0.75 → 0.75 * 400 = 300.
	responses := []ResponseInput{
		{QuestionItemID: "q1"}, {QuestionItemID: "q2"},
		{QuestionItemID: "q3"}, {QuestionItemID: "q4"},
	}
	correct := map[string]bool{"q1": true, "q2": true, "q3": true, "q4": false}
	subjects := map[string]string{"q1": "math", "q2": "math", "q3": "eng", "q4": "eng"}

	res := score(rules, responses, correct, subjects, 0, 0)

	if res.Overall != 300 {
		t.Errorf("UTME overall = %v, want 300", res.Overall)
	}
	if len(res.Subjects) != 2 {
		t.Fatalf("expected 2 subjects, got %d", len(res.Subjects))
	}
	// math: 2/2 = 100 scaled; eng: 1/2 = 50 scaled.
	for _, s := range res.Subjects {
		switch s.Subject {
		case "math":
			if s.Scaled != 100 {
				t.Errorf("math scaled = %v, want 100", s.Scaled)
			}
		case "eng":
			if s.Scaled != 50 {
				t.Errorf("eng scaled = %v, want 50", s.Scaled)
			}
		}
	}
}

// ── score(): grade-band (WASSCE default) ─────────────────────────────────────────

func TestScore_GradeBand_Default(t *testing.T) {
	rules := map[string]any{} // no scale → grade-band scoring
	// 4 of 4 correct = 100% → A1.
	responses := []ResponseInput{
		{QuestionItemID: "q1"}, {QuestionItemID: "q2"},
		{QuestionItemID: "q3"}, {QuestionItemID: "q4"},
	}
	correct := map[string]bool{"q1": true, "q2": true, "q3": true, "q4": true}
	subjects := map[string]string{"q1": "bio", "q2": "bio", "q3": "bio", "q4": "bio"}

	res := score(rules, responses, correct, subjects, 0, 0)
	if res.Grade != "A1" {
		t.Errorf("grade = %q, want A1 (100%%)", res.Grade)
	}

	// 50% → C6 on the default ladder.
	correct2 := map[string]bool{"q1": true, "q2": true, "q3": false, "q4": false}
	res2 := score(rules, responses, correct2, subjects, 0, 0)
	if res2.Grade != "C6" {
		t.Errorf("grade = %q, want C6 (50%%)", res2.Grade)
	}

	// 0% → F9.
	correct3 := map[string]bool{"q1": false, "q2": false, "q3": false, "q4": false}
	res3 := score(rules, responses, correct3, subjects, 0, 0)
	if res3.Grade != "F9" {
		t.Errorf("grade = %q, want F9 (0%%)", res3.Grade)
	}
}

func TestScore_GradeBand_CustomBands(t *testing.T) {
	rules := map[string]any{"bands": map[string]any{"PASS": 50.0, "FAIL": 0.0}}
	responses := []ResponseInput{{QuestionItemID: "q1"}, {QuestionItemID: "q2"}}
	correct := map[string]bool{"q1": true, "q2": false} // 50%
	subjects := map[string]string{"q1": "x", "q2": "x"}

	res := score(rules, responses, correct, subjects, 0, 0)
	if res.Grade != "PASS" {
		t.Errorf("grade = %q, want PASS (custom band at 50%%)", res.Grade)
	}
}

// ── Readiness: coverage × mastery × mock, mock-only fallback ──────────────────────

func TestScore_Readiness_MockOnly_WhenNoMastery(t *testing.T) {
	rules := map[string]any{}
	responses := []ResponseInput{{QuestionItemID: "q1"}, {QuestionItemID: "q2"}}
	correct := map[string]bool{"q1": true, "q2": false} // mock = 0.5
	subjects := map[string]string{"q1": "x", "q2": "x"}

	res := score(rules, responses, correct, subjects, 0, 0) // totalObj == 0 → mock-only
	if res.Readiness != 0.5 {
		t.Errorf("mock-only readiness = %v, want 0.5", res.Readiness)
	}
}

func TestScore_Readiness_Composite(t *testing.T) {
	rules := map[string]any{}
	responses := []ResponseInput{{QuestionItemID: "q1"}, {QuestionItemID: "q2"}}
	correct := map[string]bool{"q1": true, "q2": false} // mock = 0.5
	subjects := map[string]string{"q1": "x", "q2": "x"}

	// mastered 2 of 4 objectives → mastery factor 0.5; coverage 1.0.
	// readiness = 1.0 × 0.5 × 0.5 = 0.25.
	res := score(rules, responses, correct, subjects, 2, 4)
	if res.Readiness != 0.25 {
		t.Errorf("composite readiness = %v, want 0.25", res.Readiness)
	}
}

// ── Deadline-late marking via injectable clock ───────────────────────────────────
//
// The server-authoritative timer says: a submission after server_deadline is still
// accepted but flagged late. We model the pure decision here using a fixed clock and
// the same comparison the service performs.

func lateDecision(now time.Time, deadline *time.Time) bool {
	return deadline != nil && now.After(*deadline)
}

func TestDeadline_LateMarking(t *testing.T) {
	base := time.Date(2026, 6, 27, 10, 0, 0, 0, time.UTC)
	deadline := base.Add(30 * time.Minute) // 10:30

	// Submit at 10:15 → on time.
	if lateDecision(base.Add(15*time.Minute), &deadline) {
		t.Error("submission before deadline must NOT be late")
	}
	// Submit at 10:45 → late but accepted.
	if !lateDecision(base.Add(45*time.Minute), &deadline) {
		t.Error("submission after deadline MUST be marked late")
	}
	// Exactly at deadline → not late (After is strict).
	if lateDecision(deadline, &deadline) {
		t.Error("submission exactly at deadline must not be late")
	}
}

func TestServerDeadline_DerivedFromBlueprint(t *testing.T) {
	// The service computes server_deadline = started_at + total_seconds. Verify the
	// arithmetic the Begin path relies on with an injectable clock.
	started := time.Date(2026, 6, 27, 9, 0, 0, 0, time.UTC)
	totalSeconds := 7200 // 2h
	deadline := started.Add(time.Duration(totalSeconds) * time.Second)
	want := time.Date(2026, 6, 27, 11, 0, 0, 0, time.UTC)
	if !deadline.Equal(want) {
		t.Errorf("server_deadline = %v, want %v", deadline, want)
	}
}

// ── resultToScoreMap: subject_name is persisted when resolved, omitted otherwise ──

func TestResultToScoreMap_CarriesSubjectName(t *testing.T) {
	res := Result{
		Subjects: []SubjectScore{
			{Subject: "sub-mth", Name: "Mathematics", Raw: 3, Total: 4, Scaled: 75, Grade: "A1"},
			{Subject: "general", Raw: 1, Total: 2, Scaled: 50}, // synthetic bucket → no name
		},
		Overall: 88,
	}
	m := resultToScoreMap(res)
	subs, ok := m["subjects"].([]map[string]any)
	if !ok || len(subs) != 2 {
		t.Fatalf("expected 2 subject rows, got %#v", m["subjects"])
	}
	if got := subs[0]["subject_name"]; got != "Mathematics" {
		t.Errorf("subjects[0].subject_name = %v, want Mathematics", got)
	}
	if _, present := subs[1]["subject_name"]; present {
		t.Error("subjects[1] has no resolved name → subject_name must be omitted, not empty")
	}
}
