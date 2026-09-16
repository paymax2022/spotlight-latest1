package assessment

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"
	"time"
)

// Regression tests for two grading defects found live on 2026-08-12 against
// the seeded mock-exam content (P4-MOCK-V1):
//
//  1. gradeExam distributed marks with integer division (100 / n questions),
//     so any exam whose question count does not divide 100 could never reach
//     100% — a perfect 60-question exam scored 60/100 (grade D).
//  2. The results read-back hydrated top-level score/score_percent/total_time
//     from performance keys that were never written (score/score_percent
//     instead of the persisted score_raw/score_pct), returning zeros.
//
// Both are pure logic and are covered here DB-free per TEST_STRATEGY.md.

// mockInstance builds an exam instance whose marking scheme has n questions,
// all keyed to answer "A".
func mockInstance(t *testing.T, n int) *MockExamInstance {
	t.Helper()
	keys := make(map[string]string, n)
	for i := 1; i <= n; i++ {
		keys[fmt.Sprintf("q%d", i)] = "A"
	}
	scheme, err := json.Marshal(map[string]interface{}{
		"total_marks": 100,
		"pass_mark":   50,
		"answer_keys": keys,
	})
	if err != nil {
		t.Fatalf("marshal marking scheme: %v", err)
	}
	return &MockExamInstance{MarkingScheme: scheme}
}

// mockAnswers answers the first `correct` questions with "A" and the rest
// with "B".
func mockAnswers(n, correct int) map[string]interface{} {
	answers := make(map[string]interface{}, n)
	for i := 1; i <= n; i++ {
		if i <= correct {
			answers[fmt.Sprintf("q%d", i)] = "A"
		} else {
			answers[fmt.Sprintf("q%d", i)] = "B"
		}
	}
	return answers
}

func TestGradeExamNonDivisorQuestionCount(t *testing.T) {
	svc := &MockExamService{}
	tests := []struct {
		name        string
		questions   int
		correct     int
		wantPercent float64
		wantGrade   string
	}{
		// The live repro: 45/60 correct scored 45% instead of 75%.
		{"45 of 60 correct", 60, 45, 75, "C"},
		// A perfect 60-question exam could previously only reach 60%.
		{"perfect 60-question exam", 60, 60, 100, "A"},
		{"perfect 30-question exam", 30, 30, 100, "A"},
		{"2 of 3 correct", 3, 2, 100.0 * 2 / 3, "D"},
		{"divisor count still exact", 2, 2, 100, "A"},
		{"all wrong", 60, 0, 0, "F"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := svc.gradeExam(context.Background(),
				mockInstance(t, tt.questions), mockAnswers(tt.questions, tt.correct))

			if diff := result.ScorePercent - tt.wantPercent; diff > 1e-9 || diff < -1e-9 {
				t.Errorf("ScorePercent = %v, want %v", result.ScorePercent, tt.wantPercent)
			}
			if diff := result.Score - tt.wantPercent; diff > 1e-9 || diff < -1e-9 {
				t.Errorf("Score = %v, want %v (total_marks=100)", result.Score, tt.wantPercent)
			}
			if result.Grade != tt.wantGrade {
				t.Errorf("Grade = %q, want %q", result.Grade, tt.wantGrade)
			}
			if result.CorrectAnswers != tt.correct {
				t.Errorf("CorrectAnswers = %d, want %d", result.CorrectAnswers, tt.correct)
			}

			// The persisted performance JSON must carry the same numbers —
			// it is what the results read-back and the score views consume.
			if got := result.Performance["score_pct"].(float64); got != result.ScorePercent {
				t.Errorf("performance score_pct = %v, want %v", got, result.ScorePercent)
			}
			if got := result.Performance["score_raw"].(float64); got != result.Score {
				t.Errorf("performance score_raw = %v, want %v", got, result.Score)
			}
		})
	}
}

func TestGradeExamEmptyAnswerKeys(t *testing.T) {
	svc := &MockExamService{}
	instance := &MockExamInstance{MarkingScheme: json.RawMessage(`{"total_marks":100}`)}

	result := svc.gradeExam(context.Background(), instance, map[string]interface{}{"q1": "A"})
	if result.Score != 0 || result.ScorePercent != 0 || result.Grade != "F" {
		t.Errorf("empty answer keys: got score=%v pct=%v grade=%q, want 0/0/F",
			result.Score, result.ScorePercent, result.Grade)
	}
}

func TestBuildMockExamResultHydratesFromPerformance(t *testing.T) {
	started := time.Date(2026, 8, 12, 10, 0, 0, 0, time.UTC)
	submitted := started.Add(30 * time.Minute)
	attempt := &MockExamAttempt{
		ID:         "attempt-1",
		TemplateID: "template-1",
		Status:     "graded",
		StartedAt:  started,
		SubmittedAt: &submitted,
		Performance: json.RawMessage(
			`{"score_raw":75,"score_pct":75,"grade":"C","correct_answers":45,"total_answered":60}`),
	}

	result := buildMockExamResult(attempt)

	if result.Score != 75 {
		t.Errorf("Score = %v, want 75", result.Score)
	}
	if result.ScorePercent != 75 {
		t.Errorf("ScorePercent = %v, want 75", result.ScorePercent)
	}
	if result.Grade != "C" {
		t.Errorf("Grade = %q, want C", result.Grade)
	}
	if result.TotalTime != 1800 {
		t.Errorf("TotalTime = %d, want 1800", result.TotalTime)
	}
	if result.Status != "graded" || result.ID != "attempt-1" || result.TemplateID != "template-1" {
		t.Errorf("identity fields not carried: %+v", result)
	}
	if result.GradedAt == nil || !result.GradedAt.Equal(submitted) {
		t.Errorf("GradedAt = %v, want %v", result.GradedAt, submitted)
	}
}

func TestBuildMockExamResultNilPerformance(t *testing.T) {
	attempt := &MockExamAttempt{ID: "attempt-2", Status: "graded", StartedAt: time.Date(2026, 8, 12, 10, 0, 0, 0, time.UTC)}

	result := buildMockExamResult(attempt)
	if result.Score != 0 || result.ScorePercent != 0 || result.TotalTime != 0 {
		t.Errorf("nil performance/submitted_at: got %+v, want zero score fields", result)
	}
}
