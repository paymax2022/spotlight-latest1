package learn_test

// ---------------------------------------------------------------------------
// LIVE-DB integration tests for the Learn Center module.
//
// learn.Service (learn.NewService(pool, audit)) talks to a concrete
// *pgxpool.Pool for every read and for the one mutation (SubmitQuiz). None of
// this can run without a migrated Postgres. This file is SKIPPED whenever
// TEST_DATABASE_URL is unset (same pattern as
// backend/tests/association/live_db_integration_test.go), but is fully written
// end-to-end so it can be un-skipped the moment infra is available — the skip
// is NOT a stub; every step below drives the real Service against real tables.
//
// ── Bring-up note (read before running) ───────────────────────────────────
//  1. Apply the learn-center migration (seeds learn_* tables/CHECK constraints).
//     Confirm the core tables landed:
//       psql "$TEST_DATABASE_URL" -c "\d learn_quizzes"
//       psql "$TEST_DATABASE_URL" -c "\d learn_quiz_options"
//       psql "$TEST_DATABASE_URL" -c "\d learn_quiz_attempts"
//  2. These tests seed their own path/lesson/quiz/question/option rows with
//     fresh uuid.New() ids — no truncation, no shared fixtures, safe to run
//     repeatedly against the same test database.
//  3. Set TEST_DATABASE_URL to a disposable/test database —
//     never point this at production. `supabase db reset` (local, port 54322)
//     is the safest target:
//       export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//  4. Run:
//       cd backend && go test ./tests/learn/... -run LiveDB -v
// ---------------------------------------------------------------------------

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/learn"
)

func liveDBPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping live-DB learn integration test; see bring-up note in live_db_integration_test.go")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping: %v", err)
	}
	return pool
}

// noopAuditor satisfies learn.Auditor without writing anywhere real — the
// production audit sink (spotlight/backend/internal/finance or a shared
// audit package) is out of this file's boundary; nil is also accepted by
// Service (audit is nil-safe per service.go's s.log guard), but a recording
// stub lets tests assert an audit call happened without touching internals.
type recordingAuditor struct {
	calls []auditCall
}

type auditCall struct {
	actorUserID, action, resourceType, resourceID string
}

func (a *recordingAuditor) LogAction(actorUserID, targetUserID, action, module, resourceType, resourceID string, oldValues, newValues map[string]any, ipAddress, userAgent, severity string) {
	a.calls = append(a.calls, auditCall{actorUserID: actorUserID, action: action, resourceType: resourceType, resourceID: resourceID})
}

// seedPath inserts a minimal published learn_paths row and returns its id.
func seedPath(t *testing.T, ctx context.Context, pool *pgxpool.Pool) string {
	t.Helper()
	id := uuid.New().String()
	_, err := pool.Exec(ctx, `
		INSERT INTO learn_paths (id, title, description, icon_color, level, published, sort_order)
		VALUES ($1, 'Test Path', 'desc', '#fff', 'beginner', true, 0)`, id)
	if err != nil {
		t.Fatalf("seed path: %v", err)
	}
	return id
}

// seedLesson inserts a lesson under pathID and returns its id.
func seedLesson(t *testing.T, ctx context.Context, pool *pgxpool.Pool, pathID string) string {
	t.Helper()
	id := uuid.New().String()
	_, err := pool.Exec(ctx, `
		INSERT INTO learn_lessons (id, path_id, title, duration_mins, kind, body, summary, sort_order)
		VALUES ($1, $2, 'Test Lesson', 5, 'article', 'body', 'summary', 0)`, id, pathID)
	if err != nil {
		t.Fatalf("seed lesson: %v", err)
	}
	return id
}

// seedQuizWithOneQuestion inserts a quiz on lessonID with a single question
// with three options (one correct) and returns (quizID, questionID, correctOptionID, wrongOptionID).
func seedQuizWithOneQuestion(t *testing.T, ctx context.Context, pool *pgxpool.Pool, lessonID string) (quizID, questionID, correctOptID, wrongOptID string) {
	t.Helper()
	quizID = uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO learn_quizzes (id, lesson_id) VALUES ($1,$2)`, quizID, lessonID); err != nil {
		t.Fatalf("seed quiz: %v", err)
	}
	questionID = uuid.New().String()
	if _, err := pool.Exec(ctx, `
		INSERT INTO learn_quiz_questions (id, quiz_id, prompt, sort_order)
		VALUES ($1,$2,'What is 2+2?',0)`, questionID, quizID); err != nil {
		t.Fatalf("seed question: %v", err)
	}
	correctOptID = uuid.New().String()
	wrongOptID = uuid.New().String()
	if _, err := pool.Exec(ctx, `
		INSERT INTO learn_quiz_options (id, question_id, label, is_correct, sort_order)
		VALUES ($1,$2,'4',true,0)`, correctOptID, questionID); err != nil {
		t.Fatalf("seed correct option: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO learn_quiz_options (id, question_id, label, is_correct, sort_order)
		VALUES ($1,$2,'5',false,1)`, wrongOptID, questionID); err != nil {
		t.Fatalf("seed wrong option: %v", err)
	}
	return
}

// TestLiveDB_GetQuiz_AnswerKeyNeverSerialized proves end-to-end that the
// client-facing GetQuiz response scrubs every option's Correct flag to false,
// even though the DB row for the correct option has is_correct=true.

// seedUser inserts a synthetic row into auth.users so FKs (learn_quiz_attempts /
// learn_lesson_progress → auth.users) are satisfied on a fresh Supabase DB.
func seedUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool) string {
	t.Helper()
	id := uuid.New().String()
	// email is required by the handle_new_user trigger (user_profiles.email NOT NULL).
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT DO NOTHING`, id, id+"@seed.test"); err != nil {
		t.Fatalf("seed auth.users: %v", err)
	}
	return id
}

func TestLiveDB_GetQuiz_AnswerKeyNeverSerialized(t *testing.T) {
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	svc := learn.NewService(pool, nil)

	pathID := seedPath(t, ctx, pool)
	lessonID := seedLesson(t, ctx, pool, pathID)
	_, _, correctOptID, _ := seedQuizWithOneQuestion(t, ctx, pool, lessonID)

	quiz, err := svc.GetQuiz(ctx, lessonID)
	if err != nil {
		t.Fatalf("GetQuiz: %v", err)
	}
	if len(quiz.Questions) != 1 {
		t.Fatalf("expected 1 question, got %d", len(quiz.Questions))
	}
	for _, o := range quiz.Questions[0].Options {
		if o.Correct {
			t.Errorf("GetQuiz leaked Correct=true for option %s (id=%s is the real correct option)", o.ID, correctOptID)
		}
	}
}

// TestLiveDB_SubmitQuiz_ScoresAuthoritativelyAndPasses drives a full
// submit-quiz round trip: answering the correct option must score 1/1 and
// pass (1.0 >= 0.7), and must persist an attempt row + write an audit entry.
func TestLiveDB_SubmitQuiz_ScoresAuthoritativelyAndPasses(t *testing.T) {
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	auditor := &recordingAuditor{}
	svc := learn.NewService(pool, auditor)

	pathID := seedPath(t, ctx, pool)
	lessonID := seedLesson(t, ctx, pool, pathID)
	quizID, questionID, correctOptID, _ := seedQuizWithOneQuestion(t, ctx, pool, lessonID)

	userID := seedUser(t, ctx, pool)
	result, err := svc.SubmitQuiz(ctx, userID, quizID, learn.QuizAnswers{questionID: correctOptID})
	if err != nil {
		t.Fatalf("SubmitQuiz: %v", err)
	}
	if result.Score != 1 || result.Total != 1 || !result.Passed {
		t.Fatalf("result = %+v, want Score=1 Total=1 Passed=true", result)
	}

	var attemptCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM learn_quiz_attempts WHERE user_id=$1 AND quiz_id=$2`, userID, quizID).Scan(&attemptCount); err != nil {
		t.Fatalf("count attempts: %v", err)
	}
	if attemptCount != 1 {
		t.Errorf("learn_quiz_attempts rows = %d, want 1", attemptCount)
	}

	if len(auditor.calls) != 1 {
		t.Fatalf("audit calls = %d, want 1", len(auditor.calls))
	}
	if auditor.calls[0].action != "learn.quiz.submit" {
		t.Errorf("audit action = %q, want %q", auditor.calls[0].action, "learn.quiz.submit")
	}
}

// TestLiveDB_SubmitQuiz_WrongAnswerFails proves choosing the wrong option
// scores 0/1 and fails.
func TestLiveDB_SubmitQuiz_WrongAnswerFails(t *testing.T) {
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	svc := learn.NewService(pool, nil)

	pathID := seedPath(t, ctx, pool)
	lessonID := seedLesson(t, ctx, pool, pathID)
	quizID, questionID, _, wrongOptID := seedQuizWithOneQuestion(t, ctx, pool, lessonID)

	userID := seedUser(t, ctx, pool)
	result, err := svc.SubmitQuiz(ctx, userID, quizID, learn.QuizAnswers{questionID: wrongOptID})
	if err != nil {
		t.Fatalf("SubmitQuiz: %v", err)
	}
	if result.Score != 0 || result.Passed {
		t.Fatalf("result = %+v, want Score=0 Passed=false", result)
	}
}

// TestLiveDB_SubmitQuiz_RequiresAuthenticatedUser proves the ErrForbidden
// fail-closed guard (service.go:233-235: `if userID == "" { return
// ErrForbidden }`) fires end-to-end and writes NO attempt row.
func TestLiveDB_SubmitQuiz_RequiresAuthenticatedUser(t *testing.T) {
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	svc := learn.NewService(pool, nil)

	pathID := seedPath(t, ctx, pool)
	lessonID := seedLesson(t, ctx, pool, pathID)
	quizID, questionID, correctOptID, _ := seedQuizWithOneQuestion(t, ctx, pool, lessonID)

	_, err := svc.SubmitQuiz(ctx, "", quizID, learn.QuizAnswers{questionID: correctOptID})
	if err != learn.ErrForbidden {
		t.Fatalf("SubmitQuiz with empty userID: err = %v, want ErrForbidden", err)
	}

	var attemptCount int
	if scanErr := pool.QueryRow(ctx, `SELECT count(*) FROM learn_quiz_attempts WHERE quiz_id=$1`, quizID).Scan(&attemptCount); scanErr != nil {
		t.Fatalf("count attempts: %v", scanErr)
	}
	if attemptCount != 0 {
		t.Errorf("an unauthenticated SubmitQuiz must not write an attempt row, found %d", attemptCount)
	}
}

// TestLiveDB_GetLesson_MarksProgressAndAdvancesPathPercent proves the
// documented side effect (service.go GetLesson/markLessonRead): reading a
// lesson marks it complete for the caller, and the owning path's
// ProgressPct advances accordingly (progress() — service.go:107-119).
func TestLiveDB_GetLesson_MarksProgressAndAdvancesPathPercent(t *testing.T) {
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	svc := learn.NewService(pool, nil)

	pathID := seedPath(t, ctx, pool)
	lesson1 := seedLesson(t, ctx, pool, pathID)
	lesson2 := seedLesson(t, ctx, pool, pathID)
	userID := seedUser(t, ctx, pool)

	pBefore, err := svc.GetPath(ctx, userID, pathID)
	if err != nil {
		t.Fatalf("GetPath before: %v", err)
	}
	if pBefore.ProgressPct != 0 {
		t.Fatalf("ProgressPct before reading any lesson = %d, want 0", pBefore.ProgressPct)
	}

	if _, err := svc.GetLesson(ctx, userID, lesson1); err != nil {
		t.Fatalf("GetLesson: %v", err)
	}

	pAfter, err := svc.GetPath(ctx, userID, pathID)
	if err != nil {
		t.Fatalf("GetPath after: %v", err)
	}
	if pAfter.ProgressPct != 50 { // 1 of 2 lessons complete
		t.Errorf("ProgressPct after reading 1 of 2 lessons = %d, want 50", pAfter.ProgressPct)
	}

	// Re-reading the same lesson (idempotent ON CONFLICT) must not double-count.
	if _, err := svc.GetLesson(ctx, userID, lesson1); err != nil {
		t.Fatalf("GetLesson (re-read): %v", err)
	}
	pStill, err := svc.GetPath(ctx, userID, pathID)
	if err != nil {
		t.Fatalf("GetPath after re-read: %v", err)
	}
	if pStill.ProgressPct != 50 {
		t.Errorf("ProgressPct after re-reading the same lesson = %d, want still 50 (idempotent)", pStill.ProgressPct)
	}

	if _, err := svc.GetLesson(ctx, userID, lesson2); err != nil {
		t.Fatalf("GetLesson (second lesson): %v", err)
	}
	pFull, err := svc.GetPath(ctx, userID, pathID)
	if err != nil {
		t.Fatalf("GetPath after both lessons: %v", err)
	}
	if pFull.ProgressPct != 100 {
		t.Errorf("ProgressPct after reading all lessons = %d, want 100", pFull.ProgressPct)
	}
}
