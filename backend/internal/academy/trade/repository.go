package trade

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository is the pgx data-access layer for the academy trade module. Catalog rows
// (modules/lessons/projects/skill-assessments/mentors) are admin-owned; submissions/
// attempts/matches are learner-scoped (defence in depth on top of RLS). Guarded
// transitions and credential issuance are written in ONE transaction so they can
// never be half-applied. Every query is parameterized.
type Repository struct {
	db *pgxpool.Pool
}

// NewRepository wires the trade repository to a pgx pool.
func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

// ErrNotFound is returned when a row does not exist.
var ErrNotFound = errors.New("trade: not found")

// querier abstracts *pgxpool.Pool and pgx.Tx so the same helpers run either against
// the pool or inside a transaction. Both satisfy this signature set directly.
type querier interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

type rowScanner interface{ Scan(dest ...any) error }

// ── helpers ───────────────────────────────────────────────────────────────────

func toJSONB(v any) []byte {
	if v == nil {
		return []byte("{}")
	}
	b, err := json.Marshal(v)
	if err != nil || len(b) == 0 {
		return []byte("{}")
	}
	return b
}

func toJSONBArray(v any) []byte {
	if v == nil {
		return []byte("[]")
	}
	b, err := json.Marshal(v)
	if err != nil || len(b) == 0 {
		return []byte("[]")
	}
	return b
}

func rawOrEmptyObject(b []byte) json.RawMessage {
	if len(b) == 0 {
		return json.RawMessage("{}")
	}
	return json.RawMessage(b)
}

func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// insertAudit appends an immutable row to public.audit_logs (module 'academy.trade').
// severity defaults to info; "warning" for rejected transitions. Best-effort on the
// non-tx path; tx variant returns the error so a guarded write rolls back together.
func (r *Repository) insertAudit(ctx context.Context, actor, action, resourceType, resourceID string, newValues map[string]any, severity string) error {
	return insertAuditTx(ctx, r.db, actor, action, resourceType, resourceID, newValues, severity)
}

func insertAuditTx(ctx context.Context, q querier, actor, action, resourceType, resourceID string, newValues map[string]any, severity string) error {
	if severity == "" {
		severity = "info"
	}
	const sql = `
		INSERT INTO public.audit_logs
			(actor_user_id, action, module, resource_type, resource_id, new_values, severity)
		VALUES ($1,$2,'academy.trade',$3,$4,$5,$6)`
	_, err := q.Exec(ctx, sql, nullStr(actor), action, resourceType, nullStr(resourceID), toJSONB(newValues), severity)
	return err
}

// withTx runs fn inside a transaction; commits on success, rolls back on error.
func (r *Repository) withTx(ctx context.Context, fn func(tx pgx.Tx) error) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ── Modules ───────────────────────────────────────────────────────────────────

func (r *Repository) InsertModule(ctx context.Context, actor string, req CreateModuleRequest) (*TradeModule, error) {
	id := uuid.New().String()
	status := req.Status
	if status == "" {
		status = "active"
	}
	const q = `
		INSERT INTO public.academy_trade_modules (id, trade_track, title, ordinal, status)
		VALUES ($1,$2,$3,$4,$5)`
	if _, err := r.db.Exec(ctx, q, id, req.TradeTrack, req.Title, req.Ordinal, status); err != nil {
		return nil, err
	}
	_ = r.insertAudit(ctx, actor, "trade_module.created", "academy_trade_module", id,
		map[string]any{"trade_track": req.TradeTrack, "title": req.Title}, "info")
	return r.GetModule(ctx, id)
}

func (r *Repository) GetModule(ctx context.Context, id string) (*TradeModule, error) {
	const q = `SELECT id, trade_track, title, ordinal, status FROM public.academy_trade_modules WHERE id = $1`
	return scanModule(r.db.QueryRow(ctx, q, id))
}

func scanModule(row rowScanner) (*TradeModule, error) {
	m := &TradeModule{}
	err := row.Scan(&m.ID, &m.TradeTrack, &m.Title, &m.Ordinal, &m.Status)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return m, nil
}

// ListModules returns the modules for a trade track, ordered for display.
func (r *Repository) ListModules(ctx context.Context, tradeTrack string) ([]TradeModule, error) {
	q := `SELECT id, trade_track, title, ordinal, status FROM public.academy_trade_modules`
	args := []any{}
	if tradeTrack != "" {
		q += ` WHERE trade_track = $1`
		args = append(args, tradeTrack)
	}
	q += ` ORDER BY ordinal ASC, title ASC`
	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []TradeModule{}
	for rows.Next() {
		m, err := scanModule(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *m)
	}
	return out, rows.Err()
}

func (r *Repository) UpdateModule(ctx context.Context, actor, id string, req UpdateModuleRequest) (*TradeModule, error) {
	const q = `
		UPDATE public.academy_trade_modules SET
			title   = COALESCE($2, title),
			ordinal = COALESCE($3, ordinal),
			status  = COALESCE($4, status)
		WHERE id = $1`
	tag, err := r.db.Exec(ctx, q, id, req.Title, req.Ordinal, req.Status)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	_ = r.insertAudit(ctx, actor, "trade_module.updated", "academy_trade_module", id, nil, "info")
	return r.GetModule(ctx, id)
}

// ── Lessons ───────────────────────────────────────────────────────────────────

func (r *Repository) InsertLesson(ctx context.Context, actor string, req CreateLessonRequest) (*TradeLesson, error) {
	id := uuid.New().String()
	typ := req.Type
	if typ == "" {
		typ = "video"
	}
	status := req.Status
	if status == "" {
		status = "draft"
	}
	const q = `
		INSERT INTO public.academy_trade_lessons (id, module_id, title, type, media_ref, transcript, ordinal, status)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`
	if _, err := r.db.Exec(ctx, q, id, req.ModuleID, req.Title, typ, req.MediaRef, req.Transcript, req.Ordinal, status); err != nil {
		return nil, err
	}
	_ = r.insertAudit(ctx, actor, "trade_lesson.created", "academy_trade_lesson", id,
		map[string]any{"module_id": req.ModuleID, "title": req.Title}, "info")
	return r.GetLesson(ctx, id)
}

func (r *Repository) GetLesson(ctx context.Context, id string) (*TradeLesson, error) {
	const q = `SELECT id, module_id, title, type, media_ref, transcript, ordinal, status
	           FROM public.academy_trade_lessons WHERE id = $1`
	return scanLesson(r.db.QueryRow(ctx, q, id))
}

func scanLesson(row rowScanner) (*TradeLesson, error) {
	l := &TradeLesson{}
	err := row.Scan(&l.ID, &l.ModuleID, &l.Title, &l.Type, &l.MediaRef, &l.Transcript, &l.Ordinal, &l.Status)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return l, nil
}

// ListLessonsForModules returns lessons for the given module ids, ordered. Empty input
// returns an empty slice without touching the DB.
func (r *Repository) ListLessonsForModules(ctx context.Context, moduleIDs []string) ([]TradeLesson, error) {
	if len(moduleIDs) == 0 {
		return []TradeLesson{}, nil
	}
	const q = `SELECT id, module_id, title, type, media_ref, transcript, ordinal, status
	           FROM public.academy_trade_lessons WHERE module_id = ANY($1)
	           ORDER BY ordinal ASC, title ASC`
	rows, err := r.db.Query(ctx, q, moduleIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []TradeLesson{}
	for rows.Next() {
		l, err := scanLesson(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *l)
	}
	return out, rows.Err()
}

func (r *Repository) UpdateLesson(ctx context.Context, actor, id string, req UpdateLessonRequest) (*TradeLesson, error) {
	const q = `
		UPDATE public.academy_trade_lessons SET
			title      = COALESCE($2, title),
			type       = COALESCE($3, type),
			media_ref  = COALESCE($4, media_ref),
			transcript = COALESCE($5, transcript),
			ordinal    = COALESCE($6, ordinal),
			status     = COALESCE($7, status)
		WHERE id = $1`
	tag, err := r.db.Exec(ctx, q, id, req.Title, req.Type, req.MediaRef, req.Transcript, req.Ordinal, req.Status)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	_ = r.insertAudit(ctx, actor, "trade_lesson.updated", "academy_trade_lesson", id, nil, "info")
	return r.GetLesson(ctx, id)
}

// ── Projects ──────────────────────────────────────────────────────────────────

func (r *Repository) InsertProject(ctx context.Context, actor string, req CreateProjectRequest) (*TradeProject, error) {
	id := uuid.New().String()
	const q = `
		INSERT INTO public.academy_trade_projects (id, module_id, title, rubric, ordinal)
		VALUES ($1,$2,$3,$4,$5)`
	if _, err := r.db.Exec(ctx, q, id, req.ModuleID, req.Title, toJSONB(req.Rubric), req.Ordinal); err != nil {
		return nil, err
	}
	_ = r.insertAudit(ctx, actor, "trade_project.created", "academy_trade_project", id,
		map[string]any{"module_id": req.ModuleID, "title": req.Title}, "info")
	return r.GetProject(ctx, id)
}

func (r *Repository) GetProject(ctx context.Context, id string) (*TradeProject, error) {
	const q = `SELECT id, module_id, title, rubric, ordinal FROM public.academy_trade_projects WHERE id = $1`
	return scanProject(r.db.QueryRow(ctx, q, id))
}

func scanProject(row rowScanner) (*TradeProject, error) {
	p := &TradeProject{}
	var rubric []byte
	err := row.Scan(&p.ID, &p.ModuleID, &p.Title, &rubric, &p.Ordinal)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	p.Rubric = rawOrEmptyObject(rubric)
	return p, nil
}

// ListProjectsForModules returns projects for the given module ids, ordered.
func (r *Repository) ListProjectsForModules(ctx context.Context, moduleIDs []string) ([]TradeProject, error) {
	if len(moduleIDs) == 0 {
		return []TradeProject{}, nil
	}
	const q = `SELECT id, module_id, title, rubric, ordinal
	           FROM public.academy_trade_projects WHERE module_id = ANY($1)
	           ORDER BY ordinal ASC, title ASC`
	rows, err := r.db.Query(ctx, q, moduleIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []TradeProject{}
	for rows.Next() {
		p, err := scanProject(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *p)
	}
	return out, rows.Err()
}

func (r *Repository) UpdateProject(ctx context.Context, actor, id string, req UpdateProjectRequest) (*TradeProject, error) {
	const q = `
		UPDATE public.academy_trade_projects SET
			title   = COALESCE($2, title),
			rubric  = COALESCE($3, rubric),
			ordinal = COALESCE($4, ordinal)
		WHERE id = $1`
	var rubricArg any
	if len(req.Rubric) > 0 {
		rubricArg = toJSONB(req.Rubric)
	}
	tag, err := r.db.Exec(ctx, q, id, req.Title, rubricArg, req.Ordinal)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	_ = r.insertAudit(ctx, actor, "trade_project.updated", "academy_trade_project", id, nil, "info")
	return r.GetProject(ctx, id)
}

// ── Project submissions ───────────────────────────────────────────────────────

// InsertSubmission opens a submission in 'submitted'. files are signed-URL refs.
func (r *Repository) InsertSubmission(ctx context.Context, userID, projectID string, files []map[string]any) (*ProjectSubmission, error) {
	id := uuid.New().String()
	const q = `
		INSERT INTO public.academy_project_submissions (id, user_id, project_id, files, state)
		VALUES ($1,$2,$3,$4,'submitted')`
	if _, err := r.db.Exec(ctx, q, id, userID, projectID, toJSONBArray(files)); err != nil {
		return nil, err
	}
	_ = r.insertAudit(ctx, userID, "trade_submission.submitted", "academy_project_submission", id,
		map[string]any{"project_id": projectID, "file_count": len(files)}, "info")
	return r.GetSubmission(ctx, id)
}

func (r *Repository) GetSubmission(ctx context.Context, id string) (*ProjectSubmission, error) {
	const q = `
		SELECT id, user_id, project_id, files, state, rubric_score, reviewer_id, feedback, created_at, reviewed_at
		FROM public.academy_project_submissions WHERE id = $1`
	return scanSubmission(r.db.QueryRow(ctx, q, id))
}

func scanSubmission(row rowScanner) (*ProjectSubmission, error) {
	s := &ProjectSubmission{}
	var files []byte
	err := row.Scan(&s.ID, &s.UserID, &s.ProjectID, &files, &s.State, &s.RubricScore, &s.ReviewerID, &s.Feedback, &s.CreatedAt, &s.ReviewedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if len(files) == 0 {
		files = []byte("[]")
	}
	s.Files = json.RawMessage(files)
	return s, nil
}

// ListSubmissionsForUser returns a learner's submissions, newest first.
func (r *Repository) ListSubmissionsForUser(ctx context.Context, userID string) ([]ProjectSubmission, error) {
	const q = `
		SELECT id, user_id, project_id, files, state, rubric_score, reviewer_id, feedback, created_at, reviewed_at
		FROM public.academy_project_submissions WHERE user_id = $1 ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ProjectSubmission{}
	for rows.Next() {
		s, err := scanSubmission(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *s)
	}
	return out, rows.Err()
}

// ReviewSubmission runs the GUARDED review step. The reviewer drives the submission
// submitted→reviewed→passed|failed in one atomic transaction. The current state is
// re-read FOR UPDATE so concurrent reviews cannot double-apply; illegal transitions
// are rejected AND audited (severity=warning).
func (r *Repository) ReviewSubmission(ctx context.Context, reviewerID, id string, rubricScore float64, pass bool, feedback string) (*ProjectSubmission, error) {
	final := SubmissionFailed
	if pass {
		final = SubmissionPassed
	}

	var out *ProjectSubmission
	err := r.withTx(ctx, func(tx pgx.Tx) error {
		var from SubmissionState
		err := tx.QueryRow(ctx, `SELECT state FROM public.academy_project_submissions WHERE id = $1 FOR UPDATE`, id).Scan(&from)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}

		// Guard both edges of the review: submitted→reviewed and reviewed→final.
		if !canSubmission(from, SubmissionReviewed) || !canSubmission(SubmissionReviewed, final) {
			_ = insertAuditTx(ctx, tx, reviewerID, "trade_submission.review_rejected", "academy_project_submission", id,
				map[string]any{"from": string(from), "to": string(final), "reason": "illegal_transition"}, "warning")
			return fmt.Errorf("%w: %s -> %s", ErrIllegalTransition, from, final)
		}

		const upd = `
			UPDATE public.academy_project_submissions
			SET state = $2, rubric_score = $3, reviewer_id = $4, feedback = $5, reviewed_at = now()
			WHERE id = $1 AND state = $6`
		tag, err := tx.Exec(ctx, upd, id, string(final), rubricScore, reviewerID, nullStr(feedback), string(from))
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return ErrIllegalTransition // state moved underneath us
		}
		if err := insertAuditTx(ctx, tx, reviewerID, "trade_submission.reviewed", "academy_project_submission", id,
			map[string]any{"from": string(from), "to": string(final), "rubric_score": rubricScore}, "info"); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		// Persist the rejection audit (best-effort) when the guard rejected pre-write.
		if errors.Is(err, ErrIllegalTransition) {
			_ = r.insertAudit(ctx, reviewerID, "trade_submission.review_rejected", "academy_project_submission", id,
				map[string]any{"to": string(final), "reason": "illegal_transition"}, "warning")
		}
		return nil, err
	}
	out, err = r.GetSubmission(ctx, id)
	return out, err
}

// ── Skill assessments ─────────────────────────────────────────────────────────

func (r *Repository) InsertAssessment(ctx context.Context, actor string, req CreateSkillAssessmentRequest) (*SkillAssessment, error) {
	id := uuid.New().String()
	threshold := 0.7
	if req.PassThreshold != nil {
		threshold = *req.PassThreshold
	}
	status := req.Status
	if status == "" {
		status = "active"
	}
	const q = `
		INSERT INTO public.academy_skill_assessments (id, trade_track, title, rubric, pass_threshold, credential_title, status)
		VALUES ($1,$2,$3,$4,$5,$6,$7)`
	if _, err := r.db.Exec(ctx, q, id, req.TradeTrack, req.Title, toJSONB(req.Rubric), threshold, req.CredentialTitle, status); err != nil {
		return nil, err
	}
	_ = r.insertAudit(ctx, actor, "skill_assessment.created", "academy_skill_assessment", id,
		map[string]any{"trade_track": req.TradeTrack, "title": req.Title}, "info")
	return r.GetAssessment(ctx, id)
}

func (r *Repository) GetAssessment(ctx context.Context, id string) (*SkillAssessment, error) {
	const q = `SELECT id, trade_track, title, rubric, pass_threshold, credential_title, status
	           FROM public.academy_skill_assessments WHERE id = $1`
	return scanAssessment(r.db.QueryRow(ctx, q, id))
}

func scanAssessment(row rowScanner) (*SkillAssessment, error) {
	a := &SkillAssessment{}
	var rubric []byte
	err := row.Scan(&a.ID, &a.TradeTrack, &a.Title, &rubric, &a.PassThreshold, &a.CredentialTitle, &a.Status)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	a.Rubric = rawOrEmptyObject(rubric)
	return a, nil
}

func (r *Repository) ListAssessments(ctx context.Context, tradeTrack string) ([]SkillAssessment, error) {
	q := `SELECT id, trade_track, title, rubric, pass_threshold, credential_title, status
	      FROM public.academy_skill_assessments`
	args := []any{}
	if tradeTrack != "" {
		q += ` WHERE trade_track = $1`
		args = append(args, tradeTrack)
	}
	q += ` ORDER BY title ASC`
	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SkillAssessment{}
	for rows.Next() {
		a, err := scanAssessment(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *a)
	}
	return out, rows.Err()
}

func (r *Repository) UpdateAssessment(ctx context.Context, actor, id string, req UpdateSkillAssessmentRequest) (*SkillAssessment, error) {
	const q = `
		UPDATE public.academy_skill_assessments SET
			title            = COALESCE($2, title),
			rubric           = COALESCE($3, rubric),
			pass_threshold   = COALESCE($4, pass_threshold),
			credential_title = COALESCE($5, credential_title),
			status           = COALESCE($6, status)
		WHERE id = $1`
	var rubricArg any
	if len(req.Rubric) > 0 {
		rubricArg = toJSONB(req.Rubric)
	}
	tag, err := r.db.Exec(ctx, q, id, req.Title, rubricArg, req.PassThreshold, req.CredentialTitle, req.Status)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	_ = r.insertAudit(ctx, actor, "skill_assessment.updated", "academy_skill_assessment", id, nil, "info")
	return r.GetAssessment(ctx, id)
}

// ── Skill attempts ────────────────────────────────────────────────────────────

// FindAttemptByIdem returns a prior graded attempt for an idempotency key, or
// ErrNotFound. Backs the idempotent take-assessment replay.
func (r *Repository) FindAttemptByIdem(ctx context.Context, idemKey string) (*SkillAttempt, error) {
	const q = `
		SELECT id, user_id, assessment_id, score, passed, state, credential_id, idempotency_key, created_at
		FROM public.academy_skill_attempts WHERE idempotency_key = $1`
	return scanAttempt(r.db.QueryRow(ctx, q, idemKey))
}

func (r *Repository) GetAttempt(ctx context.Context, id string) (*SkillAttempt, error) {
	const q = `
		SELECT id, user_id, assessment_id, score, passed, state, credential_id, idempotency_key, created_at
		FROM public.academy_skill_attempts WHERE id = $1`
	return scanAttempt(r.db.QueryRow(ctx, q, id))
}

func scanAttempt(row rowScanner) (*SkillAttempt, error) {
	a := &SkillAttempt{}
	err := row.Scan(&a.ID, &a.UserID, &a.AssessmentID, &a.Score, &a.Passed, &a.State, &a.CredentialID, &a.IdempotencyKey, &a.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return a, nil
}

// GradeAttempt inserts a graded attempt idempotently on idempotency_key, and on PASS
// stores the issued credential_id. The whole write is one transaction:
//   - INSERT the attempt with ON CONFLICT (idempotency_key) DO NOTHING. If a row
//     already exists (replay), it is returned WITHOUT calling the issuer again.
//   - The issuer is invoked INSIDE the tx via the issue callback ONLY on a fresh
//     PASS, and its returned credential_id is persisted on the attempt row.
//
// issue is called at most once per distinct idempotency_key: a concurrent/replayed
// attempt that loses the INSERT race returns the existing row and skips issuance.
func (r *Repository) GradeAttempt(
	ctx context.Context,
	userID, assessmentID string,
	score float64,
	passed bool,
	idemKey string,
	issue func(ctx context.Context, tx pgx.Tx) (credentialID string, err error),
) (*SkillAttempt, error) {
	// Fast path: a prior attempt for this key already exists → replay, no re-issue.
	if idemKey != "" {
		if prior, err := r.FindAttemptByIdem(ctx, idemKey); err == nil {
			return prior, nil
		} else if !errors.Is(err, ErrNotFound) {
			return nil, err
		}
	}

	var attemptID string
	err := r.withTx(ctx, func(tx pgx.Tx) error {
		id := uuid.New().String()
		const ins = `
			INSERT INTO public.academy_skill_attempts
				(id, user_id, assessment_id, score, passed, state, idempotency_key)
			VALUES ($1,$2,$3,$4,$5,'graded',$6)
			ON CONFLICT (idempotency_key) DO NOTHING
			RETURNING id`
		err := tx.QueryRow(ctx, ins, id, userID, assessmentID, score, passed, nullStr(idemKey)).Scan(&attemptID)
		if errors.Is(err, pgx.ErrNoRows) {
			// Lost the idempotency race: a concurrent attempt with the same key won.
			// Resolve to that row and do NOT issue a second credential.
			prior, ferr := findAttemptByIdemTx(ctx, tx, idemKey)
			if ferr != nil {
				return ferr
			}
			attemptID = prior.ID
			return nil
		}
		if err != nil {
			return err
		}

		_ = insertAuditTx(ctx, tx, userID, "skill_attempt.graded", "academy_skill_attempt", attemptID,
			map[string]any{"assessment_id": assessmentID, "score": score, "passed": passed}, "info")

		// Issue the credential ONLY on a fresh PASS, inside this tx so the attempt and
		// its credential_id commit atomically. Idempotency is guaranteed by the unique
		// idempotency_key above: this branch runs at most once per key.
		if passed && issue != nil {
			credentialID, ierr := issue(ctx, tx)
			if ierr != nil {
				return ierr
			}
			if credentialID != "" {
				if _, uerr := tx.Exec(ctx,
					`UPDATE public.academy_skill_attempts SET credential_id = $2 WHERE id = $1`,
					attemptID, credentialID); uerr != nil {
					return uerr
				}
				_ = insertAuditTx(ctx, tx, userID, "trade_credential.issued", "academy_credential", credentialID,
					map[string]any{"attempt_id": attemptID, "assessment_id": assessmentID}, "info")
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return r.GetAttempt(ctx, attemptID)
}

func findAttemptByIdemTx(ctx context.Context, tx pgx.Tx, idemKey string) (*SkillAttempt, error) {
	const q = `
		SELECT id, user_id, assessment_id, score, passed, state, credential_id, idempotency_key, created_at
		FROM public.academy_skill_attempts WHERE idempotency_key = $1`
	return scanAttempt(tx.QueryRow(ctx, q, idemKey))
}

// ── Mentors & matches ─────────────────────────────────────────────────────────

func (r *Repository) InsertMentor(ctx context.Context, actor string, req CreateMentorRequest) (*Mentor, error) {
	id := uuid.New().String()
	status := req.Status
	if status == "" {
		status = "active"
	}
	const q = `
		INSERT INTO public.academy_mentors (id, user_id, trade_track, bio, status)
		VALUES ($1,$2,$3,$4,$5)
		ON CONFLICT (user_id, trade_track) DO UPDATE SET bio = EXCLUDED.bio, status = EXCLUDED.status
		RETURNING id`
	if err := r.db.QueryRow(ctx, q, id, req.UserID, req.TradeTrack, req.Bio, status).Scan(&id); err != nil {
		return nil, err
	}
	_ = r.insertAudit(ctx, actor, "mentor.approved", "academy_mentor", id,
		map[string]any{"user_id": req.UserID, "trade_track": req.TradeTrack, "status": status}, "info")
	return r.GetMentor(ctx, id)
}

func (r *Repository) GetMentor(ctx context.Context, id string) (*Mentor, error) {
	const q = `SELECT id, user_id, trade_track, bio, status FROM public.academy_mentors WHERE id = $1`
	return scanMentor(r.db.QueryRow(ctx, q, id))
}

func scanMentor(row rowScanner) (*Mentor, error) {
	m := &Mentor{}
	err := row.Scan(&m.ID, &m.UserID, &m.TradeTrack, &m.Bio, &m.Status)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return m, nil
}

// ListMentors returns active mentors, optionally filtered by trade track.
func (r *Repository) ListMentors(ctx context.Context, tradeTrack string) ([]Mentor, error) {
	var sb strings.Builder
	sb.WriteString(`SELECT id, user_id, trade_track, bio, status FROM public.academy_mentors WHERE status = 'active'`)
	args := []any{}
	if tradeTrack != "" {
		args = append(args, tradeTrack)
		sb.WriteString(fmt.Sprintf(" AND trade_track = $%d", len(args)))
	}
	sb.WriteString(" ORDER BY trade_track ASC")
	rows, err := r.db.Query(ctx, sb.String(), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Mentor{}
	for rows.Next() {
		m, err := scanMentor(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *m)
	}
	return out, rows.Err()
}

// InsertMatch opens a mentor match in 'requested'.
func (r *Repository) InsertMatch(ctx context.Context, learnerID, mentorID string) (*MentorMatch, error) {
	id := uuid.New().String()
	const q = `
		INSERT INTO public.academy_mentor_matches (id, learner_id, mentor_id, state)
		VALUES ($1,$2,$3,'requested')`
	if _, err := r.db.Exec(ctx, q, id, learnerID, mentorID); err != nil {
		return nil, err
	}
	_ = r.insertAudit(ctx, learnerID, "mentor_match.requested", "academy_mentor_match", id,
		map[string]any{"mentor_id": mentorID}, "info")
	return r.GetMatch(ctx, id)
}

func (r *Repository) GetMatch(ctx context.Context, id string) (*MentorMatch, error) {
	const q = `SELECT id, learner_id, mentor_id, state, created_at FROM public.academy_mentor_matches WHERE id = $1`
	return scanMatch(r.db.QueryRow(ctx, q, id))
}

func scanMatch(row rowScanner) (*MentorMatch, error) {
	m := &MentorMatch{}
	err := row.Scan(&m.ID, &m.LearnerID, &m.MentorID, &m.State, &m.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return m, nil
}

// TransitionMatch runs the GUARDED mentor-match lifecycle requested→active→closed in
// one tx. The current state is re-read FOR UPDATE; illegal transitions are rejected
// AND audited (severity=warning). actor is the mentor (accept/close) or learner.
func (r *Repository) TransitionMatch(ctx context.Context, actor, id string, to MatchState) (*MentorMatch, error) {
	err := r.withTx(ctx, func(tx pgx.Tx) error {
		var from MatchState
		err := tx.QueryRow(ctx, `SELECT state FROM public.academy_mentor_matches WHERE id = $1 FOR UPDATE`, id).Scan(&from)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if !canMatch(from, to) {
			_ = insertAuditTx(ctx, tx, actor, "mentor_match.transition_rejected", "academy_mentor_match", id,
				map[string]any{"from": string(from), "to": string(to), "reason": "illegal_transition"}, "warning")
			return fmt.Errorf("%w: %s -> %s", ErrIllegalTransition, from, to)
		}
		tag, err := tx.Exec(ctx, `UPDATE public.academy_mentor_matches SET state = $2 WHERE id = $1 AND state = $3`,
			id, string(to), string(from))
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return ErrIllegalTransition
		}
		return insertAuditTx(ctx, tx, actor, "mentor_match.transitioned", "academy_mentor_match", id,
			map[string]any{"from": string(from), "to": string(to)}, "info")
	})
	if err != nil {
		return nil, err
	}
	return r.GetMatch(ctx, id)
}
