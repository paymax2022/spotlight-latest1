package quiz

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository is the pgxpool-backed store for the quiz bank + append-only attempts.
// It is the ONLY place that touches arena_quiz_question / arena_quiz_attempt.
// Both tables are immutable (append-only) via the arena_block_mutation trigger;
// the repo relies on the ON CONFLICT / unique constraints for idempotency and
// never issues UPDATE/DELETE.
type Repository struct{ pool *pgxpool.Pool }

// NewRepository builds the quiz repository.
func NewRepository(pool *pgxpool.Pool) *Repository { return &Repository{pool: pool} }

// isUniqueViolation reports a Postgres 23505 unique_violation.
func isUniqueViolation(err error) bool {
	var pgErr interface{ SQLState() string }
	if errors.As(err, &pgErr) {
		return pgErr.SQLState() == "23505"
	}
	return false
}

const questionCols = `id, COALESCE(competition_id::text,''), bank_key, rubric_version, external_id,
	stage, category, prompt, COALESCE(image_url,''), options, correct_index, correct_answer, explanation,
	time_limit_seconds, COALESCE(pass_mark_percent,0)`

func scanQuestion(row pgx.Row) (Question, error) {
	var (
		q       Question
		optsRaw []byte
	)
	if err := row.Scan(&q.ID, &q.CompetitionID, &q.BankKey, &q.RubricVersion, &q.ExternalID,
		&q.Stage, &q.Category, &q.Prompt, &q.ImageURL, &optsRaw, &q.CorrectIndex, &q.CorrectAnswer,
		&q.Explanation, &q.TimeLimitSecs, &q.PassMarkPercent); err != nil {
		return Question{}, err
	}
	if len(optsRaw) > 0 {
		_ = json.Unmarshal(optsRaw, &q.Options)
	}
	return q, nil
}

// ListForStage returns the questions for a stage. When competitionID is non-empty
// it prefers the competition-BOUND copy (imported rows); if none are bound it
// falls back to the template bank rows (competition_id IS NULL). Ordered by
// external_id so the paper is deterministic.
func (r *Repository) ListForStage(ctx context.Context, bankKey, rubricVersion string, stage int, competitionID string) ([]Question, error) {
	if competitionID != "" {
		bound, err := r.query(ctx, `
			SELECT `+questionCols+` FROM arena_quiz_question
			 WHERE bank_key = $1 AND rubric_version = $2 AND stage = $3 AND competition_id = $4
			 ORDER BY external_id`, bankKey, rubricVersion, stage, competitionID)
		if err != nil {
			return nil, err
		}
		if len(bound) > 0 {
			return bound, nil
		}
	}
	return r.query(ctx, `
		SELECT `+questionCols+` FROM arena_quiz_question
		 WHERE bank_key = $1 AND rubric_version = $2 AND stage = $3 AND competition_id IS NULL
		 ORDER BY external_id`, bankKey, rubricVersion, stage)
}

// ListForCompetition returns bound rows for a competition (admin full view),
// optionally filtered by stage (0 = all) and category ("" = all).
func (r *Repository) ListForCompetition(ctx context.Context, competitionID string, stage int, category string) ([]Question, error) {
	return r.query(ctx, `
		SELECT `+questionCols+` FROM arena_quiz_question
		 WHERE competition_id = $1
		   AND ($2 = 0 OR stage = $2)
		   AND ($3 = '' OR category = $3)
		 ORDER BY stage, external_id`, competitionID, stage, category)
}

func (r *Repository) query(ctx context.Context, sql string, args ...any) ([]Question, error) {
	rows, err := r.pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Question{}
	for rows.Next() {
		q, err := scanQuestion(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, q)
	}
	return out, rows.Err()
}

// ImportBank binds the template bank to a competition by inserting a
// competition-scoped copy of every stage question. Idempotent: ON CONFLICT
// (bank_key, rubric_version, external_id) is the TEMPLATE key, so bound copies use
// a distinct partial-uniqueness via (competition_id, external_id) — we guard with
// ON CONFLICT DO NOTHING on that pair. Returns the number of rows imported (0 when
// already bound). It reads the template rows (competition_id IS NULL) and copies.
func (r *Repository) ImportBank(ctx context.Context, competitionID, bankKey, rubricVersion string) (int, error) {
	tag, err := r.pool.Exec(ctx, `
		INSERT INTO arena_quiz_question
			(competition_id, bank_key, rubric_version, external_id, stage, category,
			 prompt, image_url, options, correct_index, correct_answer, explanation,
			 time_limit_seconds, pass_mark_percent)
		SELECT $1, bank_key, rubric_version, external_id, stage, category,
		       prompt, image_url, options, correct_index, correct_answer, explanation,
		       time_limit_seconds, pass_mark_percent
		  FROM arena_quiz_question
		 WHERE bank_key = $2 AND rubric_version = $3 AND competition_id IS NULL
		ON CONFLICT (competition_id, external_id) WHERE competition_id IS NOT NULL
		DO NOTHING`,
		competitionID, bankKey, rubricVersion)
	if err != nil {
		return 0, err
	}
	return int(tag.RowsAffected()), nil
}

// StageCounts returns per-stage question counts for a competition (bound rows;
// falls back to template counts when nothing is bound yet).
func (r *Repository) StageCounts(ctx context.Context, competitionID, bankKey, rubricVersion string) (map[int]int, error) {
	counts := map[int]int{}
	// Bound first.
	rows, err := r.pool.Query(ctx, `
		SELECT stage, COUNT(*) FROM arena_quiz_question
		 WHERE competition_id = $1 GROUP BY stage`, competitionID)
	if err != nil {
		return nil, err
	}
	func() {
		defer rows.Close()
		for rows.Next() {
			var st, n int
			if err := rows.Scan(&st, &n); err == nil {
				counts[st] = n
			}
		}
	}()
	if len(counts) > 0 {
		return counts, nil
	}
	// Template fallback.
	trows, err := r.pool.Query(ctx, `
		SELECT stage, COUNT(*) FROM arena_quiz_question
		 WHERE bank_key = $1 AND rubric_version = $2 AND competition_id IS NULL
		 GROUP BY stage`, bankKey, rubricVersion)
	if err != nil {
		return nil, err
	}
	defer trows.Close()
	for trows.Next() {
		var st, n int
		if err := trows.Scan(&st, &n); err == nil {
			counts[st] = n
		}
	}
	return counts, trows.Err()
}

// AttemptStats returns per-stage attempt + pass counts for a competition (both modes).
func (r *Repository) AttemptStats(ctx context.Context, competitionID string) (attempts map[int]int, passes map[int]int, err error) {
	attempts, passes = map[int]int{}, map[int]int{}
	rows, err := r.pool.Query(ctx, `
		SELECT stage, COUNT(*), COUNT(*) FILTER (WHERE passed) FROM arena_quiz_attempt
		 WHERE competition_id = $1 GROUP BY stage`, competitionID)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var st, a, p int
		if err := rows.Scan(&st, &a, &p); err != nil {
			return nil, nil, err
		}
		attempts[st], passes[st] = a, p
	}
	return attempts, passes, rows.Err()
}

// InsertAttempt records an append-only quiz attempt, idempotent by idempotency_key.
// On a duplicate key it returns the ALREADY-STORED attempt (score/total/passed) so
// a replay is a safe no-op that still reports the original outcome.
func (r *Repository) InsertAttempt(ctx context.Context, a AttemptRecord) (AttemptRecord, bool, error) {
	respJSON, _ := json.Marshal(a.Responses)
	var (
		id  string
		dup bool
	)
	err := r.pool.QueryRow(ctx, `
		INSERT INTO arena_quiz_attempt
			(competition_id, mode, taker_id, contestant_id, stage, batch, rubric_version,
			 responses, score, total, passed, response_time_ms, idempotency_key)
		VALUES ($1,$2,$3, NULLIF($4,'')::uuid, $5, NULLIF($6,''), $7, $8,
		        $9,$10,$11, $12, $13)
		ON CONFLICT (idempotency_key) DO NOTHING
		RETURNING id`,
		a.CompetitionID, a.Mode, a.TakerID, a.ContestantID, a.Stage, a.Batch, a.RubricVersion,
		respJSON, a.Score, a.Total, a.Passed, nullInt64(a.ResponseTimeMs), a.IdempotencyKey).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		// Duplicate idempotency_key — load the stored attempt.
		dup = true
		stored, gerr := r.getByIdemKey(ctx, a.IdempotencyKey)
		if gerr != nil {
			return AttemptRecord{}, true, gerr
		}
		return stored, true, nil
	}
	if err != nil {
		if isUniqueViolation(err) {
			stored, gerr := r.getByIdemKey(ctx, a.IdempotencyKey)
			if gerr != nil {
				return AttemptRecord{}, true, gerr
			}
			return stored, true, nil
		}
		return AttemptRecord{}, false, err
	}
	a.ID = id
	return a, dup, nil
}

func (r *Repository) getByIdemKey(ctx context.Context, idemKey string) (AttemptRecord, error) {
	row := r.pool.QueryRow(ctx, `
		SELECT id, competition_id, mode, taker_id, COALESCE(contestant_id::text,''),
		       stage, COALESCE(batch,''), rubric_version, score, total, passed
		  FROM arena_quiz_attempt WHERE idempotency_key = $1`, idemKey)
	return scanAttempt(row, idemKey)
}

// GetAttempt returns the stored attempt for a (competition, contestant, stage) —
// the proctor-attest score lookup for THEORY_EXAM. Returns ok=false when none.
func (r *Repository) GetAttempt(ctx context.Context, competitionID, contestantID string, stage int) (AttemptRecord, bool, error) {
	row := r.pool.QueryRow(ctx, `
		SELECT id, competition_id, mode, taker_id, COALESCE(contestant_id::text,''),
		       stage, COALESCE(batch,''), rubric_version, score, total, passed
		  FROM arena_quiz_attempt
		 WHERE competition_id = $1 AND contestant_id = $2 AND stage = $3
		   AND mode = 'THEORY_EXAM'
		 ORDER BY created_at DESC LIMIT 1`, competitionID, contestantID, stage)
	a, err := scanAttempt(row, "")
	if errors.Is(err, pgx.ErrNoRows) {
		return AttemptRecord{}, false, nil
	}
	if err != nil {
		return AttemptRecord{}, false, err
	}
	return a, true, nil
}

func scanAttempt(row pgx.Row, idemKey string) (AttemptRecord, error) {
	var a AttemptRecord
	if err := row.Scan(&a.ID, &a.CompetitionID, &a.Mode, &a.TakerID, &a.ContestantID,
		&a.Stage, &a.Batch, &a.RubricVersion, &a.Score, &a.Total, &a.Passed); err != nil {
		return AttemptRecord{}, err
	}
	a.IdempotencyKey = idemKey
	return a, nil
}

func nullInt64(v int64) any {
	if v <= 0 {
		return nil
	}
	return v
}

// AttemptRecord is the persisted-attempt DTO shared with the service.
type AttemptRecord struct {
	ID             string
	CompetitionID  string
	Mode           string
	TakerID        string
	ContestantID   string // "" for Play-Along spectators
	Stage          int
	Batch          string
	RubricVersion  string
	Responses      []Response
	Score          int
	Total          int
	Passed         bool
	ResponseTimeMs int64
	IdempotencyKey string
}
