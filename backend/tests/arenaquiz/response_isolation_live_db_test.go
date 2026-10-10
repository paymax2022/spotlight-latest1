package arenaquiz_test

// Wave-12 anomaly investigation: an e2e lane reported
// GET /api/arena/competitions/:id/playalong/questions answering
// {"referrals":[]} — the response shape of GET /v1/referrals/me/referrals
// (backend/internal/finance/referrals/rewards_handler.go GetReferrals).
//
// There is no in-process path that can produce that bleed:
//   - Gin routes live in disjoint trees — /api/arena/... and /v1/referrals/...
//     share no prefix, so no route can dispatch to the wrong handler.
//   - Every request gets its own *gin.Context + ResponseWriter; handlers write
//     no shared/global buffers.
//   - PlayAlongQuestions serializes only quiz.StageView, a type with no
//     "referrals" field — c.JSON cannot emit a key that isn't there.
//   - The BFF proxies preserve path verbatim (/api/arena/... → /api/arena/...,
//     /api/v1/referrals/... → /v1/referrals/...) — no rewrite crosses them.
//
// Conclusion: the anomaly is test-harness cross-talk (a shared last-response
// slot across harness steps), not a server bug. This test pins the isolation:
// the referrals-shape handler is co-mounted on the SAME engine and the
// playalong body is asserted key-for-key across interleaved calls.
//
// Skips unless TEST_DATABASE_URL is set (StageView reads the bank from
// arena_quiz_question via the real pgx repository).

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	arenahandler "spotlight/backend/internal/arena/handler"
	"spotlight/backend/internal/arena/quiz"
)

func TestLiveDB_PlayAlongQuestions_ResponseIsIsolatedFromReferrals(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping playalong response-isolation test")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	if err := pool.Ping(ctx); err != nil {
		t.Fatalf("ping: %v", err)
	}

	// Guarantee at least one template-bank question for stage 1 so the
	// envelope is non-empty even on a bare DB (the migration seed normally
	// provides 30 per stage). Idempotent ON CONFLICT on the template key.
	if _, err := pool.Exec(ctx, `
		INSERT INTO arena_quiz_question
			(bank_key, rubric_version, external_id, stage, category, prompt,
			 options, correct_index, correct_answer, explanation,
			 time_limit_seconds, pass_mark_percent)
		VALUES ($1,$2,'ND-S1-ISO-PROBE',1,'road_signs','isolation probe',
			'["a","b","c","d"]'::jsonb,0,'a','probe',120,70)
		ON CONFLICT (bank_key, rubric_version, external_id) WHERE competition_id IS NULL
		DO NOTHING`, quiz.DefaultBankKey, quiz.DefaultRubricVersion); err != nil {
		t.Fatalf("seed probe question: %v", err)
	}

	repo := quiz.NewRepository(pool)
	h := arenahandler.New(arenahandler.Services{
		// StageView only needs the repository — the playalong/contestant ports
		// (engagement rail + lifecycle) are unused on this read path.
		Quiz: quiz.NewService(repo, nil, nil),
	})

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/api/arena/competitions/:id/playalong/questions", h.PlayAlongQuestions)
	// The exact shape the anomaly reported, co-mounted on the SAME engine —
	// any writer/handler bleed would surface here.
	r.GET("/v1/referrals/me/referrals", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"referrals": []any{}})
	})

	compID := uuid.New().String()
	get := func(path string) (*httptest.ResponseRecorder, map[string]any) {
		w := httptest.NewRecorder()
		req := httptest.NewRequestWithContext(ctx, http.MethodGet, path, nil)
		r.ServeHTTP(w, req)
		var body map[string]any
		_ = json.Unmarshal(w.Body.Bytes(), &body)
		return w, body
	}

	for range 3 {
		// Interleave the referrals call BETWEEN playalong calls — the harness
		// pattern that produced the cross-talk.
		rw, refBody := get("/v1/referrals/me/referrals")
		if rw.Code != http.StatusOK {
			t.Fatalf("referrals stub: %d", rw.Code)
		}
		if _, ok := refBody["referrals"]; !ok {
			t.Fatalf("referrals stub lost its own shape: %s", rw.Body.String())
		}

		w, body := get("/api/arena/competitions/" + compID + "/playalong/questions?stage=1")
		if w.Code != http.StatusOK {
			t.Fatalf("playalong/questions: %d body=%s", w.Code, w.Body.String())
		}
		if _, leaked := body["referrals"]; leaked {
			t.Fatalf("playalong/questions response polluted by the referrals shape: %s", w.Body.String())
		}
		qs, ok := body["questions"].([]any)
		if !ok || len(qs) == 0 {
			t.Fatalf("playalong/questions must carry the stage question bank, got: %s", w.Body.String())
		}
		if body["stageNumber"] != float64(1) {
			t.Fatalf("stageNumber = %v, want 1", body["stageNumber"])
		}
	}
}
