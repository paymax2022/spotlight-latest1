package arenaquiz_test

// ---------------------------------------------------------------------------
// LIVE-DB integration tests for the Arena quiz bank repository (append-only +
// idempotent attempts). These drive quiz.Repository against a concrete
// *pgxpool.Pool and the real arena_quiz_question / arena_quiz_attempt tables
// created by supabase/migrations/20260921000000_arena_quiz_bank.sql.
//
// SKIPPED whenever TEST_DATABASE_URL / DATABASE_URL is unset (same pattern as
// backend/tests/crypto/live_db_integration_test.go). The skip is NOT a stub —
// every step below drives the real repository against real tables, so it can be
// un-skipped the moment infra is available.
//
// ── Bring-up note (read before running) ────────────────────────────────────
//  1. Apply the arena migrations, including the quiz bank migration:
//       supabase db reset   # local, port 54322 — replays all migrations
//     Confirm the tables landed:
//       psql "$DATABASE_URL" -c "\d arena_quiz_question"
//       psql "$DATABASE_URL" -c "\d arena_quiz_attempt"
//  2. Set a DISPOSABLE database URL (never production):
//       export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//  3. Run:
//       cd backend && go test ./tests/arenaquiz/... -run LiveDB -v
//
// arena_quiz_attempt has NO FK on competition_id / taker_id, so these tests seed
// nothing beyond the attempt row itself (each with a fresh uuid) — no shared
// fixtures, safe to run repeatedly.
//
// NOTE (deliberately scoped): the full SubmitExam state-transition path is NOT
// exercised here. That path constructs quiz.Service with the real
// PlayAlongService + ContestantService (many arena repos + a signer gateway) and
// performs a guarded THEORY_ASSIGNED → THEORY_TAKEN transition against
// arena_contestant. Standing that whole graph up is a larger fixture than a repo
// idempotency check warrants; it is captured as a follow-up in the QA report.
// The pure scoring + contestant-safe view logic is covered by the unit tests in
// backend/internal/arena/quiz/{scoring_test.go,view_test.go}.
// ---------------------------------------------------------------------------

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/arena/quiz"
)

func liveDBPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = os.Getenv("DATABASE_URL")
	}
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL/DATABASE_URL set — skipping live-DB arena quiz integration test; see bring-up note in live_db_integration_test.go")
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

// newAttempt builds a PLAYALONG attempt record with a fresh competition/taker id
// and the supplied idempotency key.
func newAttempt(idemKey string, score, total int, passed bool) quiz.AttemptRecord {
	return quiz.AttemptRecord{
		CompetitionID: uuid.New().String(),
		Mode:          quiz.ModePlayAlong,
		TakerID:       uuid.New().String(),
		Stage:         1,
		RubricVersion: quiz.DefaultRubricVersion,
		Responses: []quiz.Response{
			{QuestionExternalID: "ND-S1-Q01", OptionIndex: 1, Correct: true},
		},
		Score:          score,
		Total:          total,
		Passed:         passed,
		IdempotencyKey: idemKey,
	}
}

// TestLiveDB_InsertAttempt_Idempotent proves a replay with the SAME
// idempotency_key inserts exactly one row and returns the ORIGINAL stored
// score/total/passed (UNIQUE(idempotency_key) + ON CONFLICT DO NOTHING path).
func TestLiveDB_InsertAttempt_Idempotent(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	repo := quiz.NewRepository(pool)
	ctx := context.Background()

	key := "arenaquiz-idem-" + uuid.New().String()
	rec := newAttempt(key, 21, 30, true)

	first, dup1, err := repo.InsertAttempt(ctx, rec)
	if err != nil {
		t.Fatalf("first InsertAttempt: %v", err)
	}
	if dup1 {
		t.Fatal("first insert must not report a duplicate")
	}
	if first.ID == "" {
		t.Fatal("first insert must return a row id")
	}

	// Replay with the SAME key but DIFFERENT score — the stored (original) score
	// must win, and no second row may be created.
	replay := newAttempt(key, 0, 30, false)
	second, dup2, err := repo.InsertAttempt(ctx, replay)
	if err != nil {
		t.Fatalf("replay InsertAttempt: %v", err)
	}
	if !dup2 {
		t.Fatal("replay must report a duplicate (idempotent)")
	}
	if second.Score != 21 || second.Total != 30 || !second.Passed {
		t.Fatalf("replay must return the ORIGINAL stored outcome 21/30 passed, got %d/%d passed=%v",
			second.Score, second.Total, second.Passed)
	}

	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM arena_quiz_attempt WHERE idempotency_key = $1`, key).Scan(&n); err != nil {
		t.Fatalf("count attempts: %v", err)
	}
	if n != 1 {
		t.Fatalf("arena_quiz_attempt rows for key = %d, want exactly 1 (no duplicate on replay)", n)
	}
}

// TestLiveDB_Attempt_Immutable proves the append-only trigger blocks UPDATE and
// DELETE on a stored attempt (arena_block_mutation).
func TestLiveDB_Attempt_Immutable(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	repo := quiz.NewRepository(pool)
	ctx := context.Background()

	key := "arenaquiz-immutable-" + uuid.New().String()
	rec := newAttempt(key, 15, 30, false)
	stored, _, err := repo.InsertAttempt(ctx, rec)
	if err != nil {
		t.Fatalf("InsertAttempt: %v", err)
	}

	if _, err := pool.Exec(ctx, `UPDATE arena_quiz_attempt SET score = 30 WHERE id = $1`, stored.ID); err == nil {
		t.Error("UPDATE on an append-only attempt must be blocked by the immutability trigger")
	}
	if _, err := pool.Exec(ctx, `DELETE FROM arena_quiz_attempt WHERE id = $1`, stored.ID); err == nil {
		t.Error("DELETE on an append-only attempt must be blocked by the immutability trigger")
	}
}
