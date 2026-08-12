package academy_test

// ---------------------------------------------------------------------------
// LIVE-DB integration test for the academy mock-exam module (ADR-028).
//
// The module's repository/analytics SQL previously referenced columns that
// never existed on academy_mock_attempt_metadata / academy_attempts and died
// at runtime with SQLSTATE 42703. This test drives the real repository,
// service, and analytics queries against a migrated Postgres so the Go code
// can never silently drift from supabase/migrations again.
//
// SKIPPED when TEST_DATABASE_URL (or DATABASE_URL) is unset. Target the local
// Supabase instance after a fresh replay:
//
//	export TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
//	cd backend && go test ./tests/academy/... -run LiveDB -v
//
// Every row is created by the test with fresh uuids / unique codes — no
// truncation, no shared fixtures, safe to re-run against the same database.
// ---------------------------------------------------------------------------

import (
	"context"
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/academy/assessment"
)

func liveDBPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = os.Getenv("DATABASE_URL")
	}
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL/DATABASE_URL not set — skipping live-DB mock-exam test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// seedMockExam creates the FK chain a mock attempt needs: auth user →
// curriculum version → class → approved template → instance (with a marking
// scheme whose keys the test answers against).
func seedMockExam(t *testing.T, ctx context.Context, pool *pgxpool.Pool) (userID, templateID, instanceID string) {
	t.Helper()

	userID = uuid.NewString()
	if _, err := pool.Exec(ctx,
		`INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
		userID, userID+"@seed.test"); err != nil {
		t.Fatalf("seed auth.users: %v", err)
	}

	runTag := uuid.NewString()[:8]
	var versionID string
	if err := pool.QueryRow(ctx,
		`INSERT INTO academy_curriculum_versions (code, name) VALUES ($1, $2) RETURNING id`,
		"TEST-MOCK-"+runTag, "mock-exam live test").Scan(&versionID); err != nil {
		t.Fatalf("seed curriculum version: %v", err)
	}

	var classID string
	if err := pool.QueryRow(ctx,
		`INSERT INTO academy_classes (version_id, phase, code, name) VALUES ($1, 'SSS', $2, 'SSS3 (test)') RETURNING id`,
		versionID, "SSS3-"+runTag).Scan(&classID); err != nil {
		t.Fatalf("seed class: %v", err)
	}

	if err := pool.QueryRow(ctx, `
		INSERT INTO academy_mock_exam_templates
			(version_id, class_id, name, exam_type, total_questions, total_seconds, status)
		VALUES ($1, $2, $3, 'class_mock', 2, 600, 'approved')
		RETURNING id`,
		versionID, classID, "Mock live test "+runTag).Scan(&templateID); err != nil {
		t.Fatalf("seed template: %v", err)
	}

	if err := pool.QueryRow(ctx, `
		INSERT INTO academy_mock_exam_instances (template_id, exam_code, variant, seed, marking_scheme)
		VALUES ($1, $2, 1, 42, '{"total_marks":100,"pass_mark":50,"answer_keys":{"q1":"B","q2":"C"}}'::jsonb)
		RETURNING id`,
		templateID, "TEST-"+runTag).Scan(&instanceID); err != nil {
		t.Fatalf("seed instance: %v", err)
	}

	return userID, templateID, instanceID
}

func TestLiveDB_MockExamAttemptLifecycle(t *testing.T) {
	pool := liveDBPool(t)
	ctx := context.Background()
	userID, templateID, instanceID := seedMockExam(t, ctx, pool)

	repo := assessment.NewMockExamRepository(pool)
	svc := assessment.NewMockExamService(pool)

	// Create: one academy_attempts row + one metadata row, id = metadata.id.
	attempt, err := repo.CreateAttempt(ctx, userID, instanceID, templateID)
	if err != nil {
		t.Fatalf("CreateAttempt: %v", err)
	}
	if attempt.Status != "in_progress" {
		t.Fatalf("new attempt status = %q, want in_progress", attempt.Status)
	}
	if attempt.UserID != userID || attempt.InstanceID != instanceID || attempt.TemplateID != templateID {
		t.Fatalf("attempt identity mismatch: %+v", attempt)
	}
	if attempt.SubmittedAt != nil {
		t.Fatalf("new attempt has submitted_at = %v, want nil", attempt.SubmittedAt)
	}

	// Save progress: answers + flagged land on the metadata table.
	flagged := []string{uuid.NewString()}
	if err := repo.UpdateAttempt(ctx, attempt.ID,
		map[string]interface{}{"q1": "B"}, flagged); err != nil {
		t.Fatalf("UpdateAttempt: %v", err)
	}

	// Read back through the bridge view.
	got, err := repo.GetAttempt(ctx, attempt.ID)
	if err != nil {
		t.Fatalf("GetAttempt after save: %v", err)
	}
	var answers map[string]string
	if err := json.Unmarshal(got.Answers, &answers); err != nil {
		t.Fatalf("answers not json: %v (%s)", err, got.Answers)
	}
	if answers["q1"] != "B" {
		t.Fatalf("answers round-trip = %v, want q1=B", answers)
	}
	if len(got.FlaggedQuestions) != 1 || got.FlaggedQuestions[0] != flagged[0] {
		t.Fatalf("flagged round-trip = %v, want %v", got.FlaggedQuestions, flagged)
	}
	if got.Status != "in_progress" {
		t.Fatalf("status after save = %q, want in_progress", got.Status)
	}

	// GetExamProgress exercises the template/instance/mapping reads too.
	progress, err := svc.GetExamProgress(ctx, attempt.ID)
	if err != nil {
		t.Fatalf("GetExamProgress: %v", err)
	}
	if progress.AnsweredCount != 1 {
		t.Fatalf("AnsweredCount = %d, want 1", progress.AnsweredCount)
	}

	// Submit: grades against the marking scheme, flips state to scored.
	result, err := svc.SubmitExam(ctx, attempt.ID, map[string]interface{}{"q1": "B", "q2": "C"})
	if err != nil {
		t.Fatalf("SubmitExam: %v", err)
	}
	if result.ScorePercent != 100 || result.Grade != "A" {
		t.Fatalf("grading = %.1f%% (%s), want 100%% (A)", result.ScorePercent, result.Grade)
	}

	got, err = repo.GetAttempt(ctx, attempt.ID)
	if err != nil {
		t.Fatalf("GetAttempt after submit: %v", err)
	}
	if got.Status != "graded" {
		t.Fatalf("status after submit = %q, want graded", got.Status)
	}
	if got.SubmittedAt == nil || time.Since(*got.SubmittedAt) > time.Minute {
		t.Fatalf("submitted_at after submit = %v, want recent", got.SubmittedAt)
	}

	// The bridge view must project performance->>'score_pct' as score_percent.
	var scorePct float64
	if err := pool.QueryRow(ctx,
		`SELECT score_percent FROM v_mock_attempt_scores WHERE id = $1`,
		attempt.ID).Scan(&scorePct); err != nil {
		t.Fatalf("view score_percent: %v", err)
	}
	if scorePct != 100 {
		t.Fatalf("view score_percent = %v, want 100", scorePct)
	}

	// Analytics: these are exactly the queries that used to 42703.
	analytics := assessment.NewAnalyticsService(pool)
	learner, err := analytics.GetLearnerAnalytics(ctx, userID)
	if err != nil {
		t.Fatalf("GetLearnerAnalytics: %v", err)
	}
	if learner.TotalAttempts != 1 || learner.AverageScore != 100 {
		t.Fatalf("learner analytics = %d attempts avg %.1f, want 1 attempt avg 100",
			learner.TotalAttempts, learner.AverageScore)
	}

	admin, err := analytics.GetAdminAnalytics(ctx, "week")
	if err != nil {
		t.Fatalf("GetAdminAnalytics: %v", err)
	}
	if admin.TotalAttempts < 1 {
		t.Fatalf("admin analytics TotalAttempts = %d, want >= 1", admin.TotalAttempts)
	}
}
