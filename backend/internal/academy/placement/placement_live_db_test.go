package placement_test

// LIVE-DB test for the placement engine: BuildQuiz assembles a per-subject
// diagnostic (no answer key) for a class from the seeded curriculum question
// bank, and Score marks answers into a per-subject placement. Verifies the
// engine end-to-end against the seeded NERDC-2025 entry-class questions.
//
// Skips unless TEST_DATABASE_URL/DATABASE_URL is set. Requires the placement
// question seed (20261102000000_academy_placement_questions.sql).

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/academy/placement"
)

func liveDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = os.Getenv("DATABASE_URL")
	}
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL/DATABASE_URL set — skipping placement live-DB test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	return pool
}

func correctOption(t *testing.T, ctx context.Context, pool *pgxpool.Pool, qid string) string {
	t.Helper()
	var opt string
	if err := pool.QueryRow(ctx, `SELECT answer->'correct'->>0 FROM academy_question_items WHERE id=$1`, qid).Scan(&opt); err != nil {
		t.Fatalf("correct option for %s: %v", qid, err)
	}
	return opt
}

func TestLiveDB_Placement_BuildAndScore(t *testing.T) {
	pool := liveDB(t)
	defer pool.Close()
	ctx := context.Background()
	svc := placement.NewService(pool)

	quiz, err := svc.BuildQuiz(ctx, "P4", 2)
	if err != nil {
		t.Fatalf("BuildQuiz: %v", err)
	}
	if len(quiz.Questions) == 0 {
		t.Fatal("P4 quiz is empty — the placement seed is missing")
	}
	subjects := map[string]bool{}
	for _, q := range quiz.Questions {
		subjects[q.SubjectCode] = true
		if len(q.Options) == 0 {
			t.Fatalf("question %s has no options", q.ID)
		}
		if q.Stem == "" {
			t.Fatalf("question %s has no stem", q.ID)
		}
	}
	if !subjects["ENG"] || !subjects["MTH"] {
		t.Fatalf("P4 quiz should span core subjects incl ENG+MTH, got %v", subjects)
	}

	// Answer ENG correctly, MTH incorrectly → per-subject placement diverges.
	var answers []placement.Answer
	for _, q := range quiz.Questions {
		right := correctOption(t, ctx, pool, q.ID)
		switch q.SubjectCode {
		case "ENG":
			answers = append(answers, placement.Answer{QuestionID: q.ID, Selected: []string{right}})
		case "MTH":
			wrong := "z" // never a valid option id → guaranteed wrong
			answers = append(answers, placement.Answer{QuestionID: q.ID, Selected: []string{wrong}})
		default:
			answers = append(answers, placement.Answer{QuestionID: q.ID, Selected: []string{right}})
		}
	}

	res, err := svc.Score(ctx, "00000000-0000-0000-0000-000000000001", "P4", answers)
	if err != nil {
		t.Fatalf("Score: %v", err)
	}
	var eng, mth *placement.SubjectScore
	for i := range res.Subjects {
		switch res.Subjects[i].Code {
		case "ENG":
			eng = &res.Subjects[i]
		case "MTH":
			mth = &res.Subjects[i]
		}
	}
	if eng == nil || mth == nil {
		t.Fatalf("result missing ENG/MTH subjects: %+v", res.Subjects)
	}
	if eng.ScorePct != 1.0 || eng.Level != "above_track" {
		t.Fatalf("ENG: got pct=%.2f level=%s, want 1.0/above_track", eng.ScorePct, eng.Level)
	}
	if mth.ScorePct != 0.0 || mth.Level != "below_track" {
		t.Fatalf("MTH: got pct=%.2f level=%s, want 0.0/below_track", mth.ScorePct, mth.Level)
	}
	if res.OverallPct <= 0 || res.OverallPct >= 1 {
		t.Fatalf("overall should be a partial score, got %.2f", res.OverallPct)
	}
}
