package connectassess

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository is the pgxpool store for the Connect-owned catalogue + append-only
// badge ledger. It also performs a single READ-ONLY query against the reused
// arena_quiz_attempt table to derive the SA-04 cooldown (the quiz engine owns all
// WRITES to arena_quiz_* — we never mutate them here).
type Repository struct{ pool *pgxpool.Pool }

// NewRepository builds the assessments repository.
func NewRepository(pool *pgxpool.Pool) *Repository { return &Repository{pool: pool} }

const assessmentCols = `id, domain, title, bank_key, rubric_version, pass_threshold, active, created_at`

func scanAssessment(row pgx.Row) (Assessment, error) {
	var a Assessment
	if err := row.Scan(&a.ID, &a.Domain, &a.Title, &a.BankKey, &a.Version,
		&a.PassThreshold, &a.Active, &a.CreatedAt); err != nil {
		return Assessment{}, err
	}
	return a, nil
}

// ListActive returns the active catalogue (SA-01), ordered by domain.
func (r *Repository) ListActive(ctx context.Context) ([]Assessment, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT `+assessmentCols+` FROM connect_skill_assessments WHERE active ORDER BY domain, title`)
	if err != nil {
		return nil, fmt.Errorf("connect: list assessments: %w", err)
	}
	defer rows.Close()
	out := []Assessment{}
	for rows.Next() {
		a, err := scanAssessment(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// ListAll returns the full catalogue incl. inactive (admin, ADM-SA-01).
func (r *Repository) ListAll(ctx context.Context) ([]Assessment, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT `+assessmentCols+` FROM connect_skill_assessments ORDER BY domain, rubric_version`)
	if err != nil {
		return nil, fmt.Errorf("connect: list assessments (admin): %w", err)
	}
	defer rows.Close()
	out := []Assessment{}
	for rows.Next() {
		a, err := scanAssessment(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// Get resolves an assessment by id.
func (r *Repository) Get(ctx context.Context, id string) (*Assessment, error) {
	a, err := scanAssessment(r.pool.QueryRow(ctx,
		`SELECT `+assessmentCols+` FROM connect_skill_assessments WHERE id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("connect: get assessment: %w", err)
	}
	return &a, nil
}

// LastAttempt reads the most-recent recorded quiz attempt for (assessment, user)
// to enforce the SA-04 cooldown. READ-ONLY reuse of arena_quiz_attempt: the quiz
// engine wrote the row (mode PLAYALONG, competition_id == assessment id). Returns
// nil when the user has never attempted this assessment.
func (r *Repository) LastAttempt(ctx context.Context, assessmentID, userID string) (*AttemptMeta, error) {
	var m AttemptMeta
	err := r.pool.QueryRow(ctx, `
		SELECT passed, created_at FROM arena_quiz_attempt
		 WHERE competition_id = $1 AND taker_id = $2 AND mode = 'PLAYALONG'
		 ORDER BY created_at DESC LIMIT 1`, assessmentID, userID).Scan(&m.Passed, &m.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("connect: last attempt: %w", err)
	}
	return &m, nil
}

// IssueBadge appends a skill badge idempotently. The composite UNIQUE
// (user_id, assessment_id, assessment_version) makes this once-per-version:
// issued=true ONLY on the first insert (RETURNING fires), so callers can gate the
// loyalty emission on it. On a conflict it loads and returns the existing badge
// with issued=false. Append-only: never UPDATE/DELETE.
func (r *Repository) IssueBadge(ctx context.Context, in BadgeInsert) (issued bool, badge *Badge, err error) {
	var b Badge
	err = r.pool.QueryRow(ctx, `
		INSERT INTO connect_skill_badges
			(user_id, assessment_id, assessment_version, score, idempotency_key)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (user_id, assessment_id, assessment_version) DO NOTHING
		RETURNING id, user_id, assessment_id, assessment_version, score, passed_at`,
		in.UserID, in.AssessmentID, in.Version, in.Score, in.IdempotencyKey).
		Scan(&b.ID, &b.UserID, &b.AssessmentID, &b.Version, &b.Score, &b.PassedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		// Already earned for this version — load the existing badge (no re-issue).
		existing, gerr := r.getBadge(ctx, in.UserID, in.AssessmentID, in.Version)
		if gerr != nil {
			return false, nil, gerr
		}
		existing.Domain = in.Domain
		return false, existing, nil
	}
	if err != nil {
		return false, nil, fmt.Errorf("connect: issue badge: %w", err)
	}
	b.Domain = in.Domain
	return true, &b, nil
}

func (r *Repository) getBadge(ctx context.Context, userID, assessmentID, version string) (*Badge, error) {
	var b Badge
	err := r.pool.QueryRow(ctx, `
		SELECT id, user_id, assessment_id, assessment_version, score, passed_at
		  FROM connect_skill_badges
		 WHERE user_id = $1 AND assessment_id = $2 AND assessment_version = $3`,
		userID, assessmentID, version).
		Scan(&b.ID, &b.UserID, &b.AssessmentID, &b.Version, &b.Score, &b.PassedAt)
	if err != nil {
		return nil, fmt.Errorf("connect: get badge: %w", err)
	}
	return &b, nil
}

// ListBadges returns a user's earned badges (joined to the catalogue for domain).
func (r *Repository) ListBadges(ctx context.Context, userID string) ([]Badge, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT b.id, b.user_id, b.assessment_id, a.domain, b.assessment_version, b.score, b.passed_at
		  FROM connect_skill_badges b
		  JOIN connect_skill_assessments a ON a.id = b.assessment_id
		 WHERE b.user_id = $1
		 ORDER BY b.passed_at DESC`, userID)
	if err != nil {
		return nil, fmt.Errorf("connect: list badges: %w", err)
	}
	defer rows.Close()
	out := []Badge{}
	for rows.Next() {
		var b Badge
		if err := rows.Scan(&b.ID, &b.UserID, &b.AssessmentID, &b.Domain,
			&b.Version, &b.Score, &b.PassedAt); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// Upsert creates/updates an assessment definition (ADM-SA-01). The conflict target
// (domain, rubric_version) means a NEW version is a NEW row: editing questions =
// bumping the version, never re-pointing an already-issued badge (PN-12).
func (r *Repository) Upsert(ctx context.Context, in UpsertInput) (*Assessment, error) {
	threshold := in.PassThreshold
	if threshold <= 0 || threshold > 100 {
		threshold = 70
	}
	active := true
	if in.Active != nil {
		active = *in.Active
	}
	a, err := scanAssessment(r.pool.QueryRow(ctx, `
		INSERT INTO connect_skill_assessments (domain, title, bank_key, rubric_version, pass_threshold, active)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (domain, rubric_version) DO UPDATE SET
			title = EXCLUDED.title, bank_key = EXCLUDED.bank_key,
			pass_threshold = EXCLUDED.pass_threshold, active = EXCLUDED.active
		RETURNING `+assessmentCols, in.Domain, in.Title, in.BankKey, in.Version, threshold, active))
	if err != nil {
		return nil, fmt.Errorf("connect: upsert assessment: %w", err)
	}
	return &a, nil
}
