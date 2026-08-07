package exam

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository is the pgx data-access layer for the exam module. Arena / blueprint /
// combination rows are admin-owned config; attempts + responses are learner-scoped
// (defence in depth on top of RLS). The attempt state machine uses guarded UPDATEs
// (WHERE state = $from) so transitions are idempotent and race-safe.
type Repository struct {
	db *pgxpool.Pool
}

// NewRepository constructs the exam repository.
func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

// ErrNotFound is returned when a row does not exist.
var ErrNotFound = errors.New("exam: not found")

// ── helpers ────────────────────────────────────────────────────────────────────

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

type rowScanner interface{ Scan(dest ...any) error }

// insertAuditTx appends an immutable row to public.audit_logs inside a tx.
// module is always "academy"; severity defaults to info, "warning" for rejections.
func insertAuditTx(ctx context.Context, tx pgx.Tx, actor, action, resourceType, resourceID string, newValues map[string]any, severity string) error {
	if severity == "" {
		severity = "info"
	}
	var actorArg any
	if actor != "" {
		actorArg = actor
	}
	const q = `
		INSERT INTO public.audit_logs
			(actor_user_id, action, module, resource_type, resource_id, new_values, severity)
		VALUES ($1,$2,'academy',$3,$4,$5,$6)`
	_, err := tx.Exec(ctx, q, actorArg, action, resourceType, resourceID, toJSONB(newValues), severity)
	return err
}

// insertAudit is the non-tx variant for read-path / standalone audits.
func (r *Repository) insertAudit(ctx context.Context, actor, action, resourceType, resourceID string, newValues map[string]any, severity string) error {
	if severity == "" {
		severity = "info"
	}
	var actorArg any
	if actor != "" {
		actorArg = actor
	}
	const q = `
		INSERT INTO public.audit_logs
			(actor_user_id, action, module, resource_type, resource_id, new_values, severity)
		VALUES ($1,$2,'academy',$3,$4,$5,$6)`
	_, err := r.db.Exec(ctx, q, actorArg, action, resourceType, resourceID, toJSONB(newValues), severity)
	return err
}

// ── Arenas ──────────────────────────────────────────────────────────────────────

const arenaCols = `id, code, name, subject_set, scoring_rules, calendar, countdown_at, status`

func scanArena(row rowScanner) (*Arena, error) {
	a := &Arena{}
	var scoring, calendar []byte
	err := row.Scan(&a.ID, &a.Code, &a.Name, &a.SubjectSet, &scoring, &calendar, &a.CountdownAt, &a.Status)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	_ = json.Unmarshal(scoring, &a.ScoringRules)
	_ = json.Unmarshal(calendar, &a.Calendar)
	return a, nil
}

// InsertArena creates an exam arena (admin).
func (r *Repository) InsertArena(ctx context.Context, actor string, req CreateArenaRequest) (*Arena, error) {
	id := uuid.New().String()
	subjects := req.SubjectSet
	if subjects == nil {
		subjects = []string{}
	}
	const q = `
		INSERT INTO public.academy_exam_arenas
			(id, code, name, subject_set, scoring_rules, calendar, countdown_at, status)
		VALUES ($1,$2,$3,$4,$5,$6,$7,'active')`
	if _, err := r.db.Exec(ctx, q, id, req.Code, req.Name, subjects,
		toJSONB(req.ScoringRules), toJSONB(req.Calendar), req.CountdownAt); err != nil {
		return nil, err
	}
	_ = r.insertAudit(ctx, actor, "exam_arena.created", "academy_exam_arena", id,
		map[string]any{"code": req.Code}, "info")
	return r.GetArena(ctx, id)
}

// GetArena reads one arena by id.
func (r *Repository) GetArena(ctx context.Context, id string) (*Arena, error) {
	q := `SELECT ` + arenaCols + ` FROM public.academy_exam_arenas WHERE id = $1`
	return scanArena(r.db.QueryRow(ctx, q, id))
}

// ListArenas reads all arenas.
func (r *Repository) ListArenas(ctx context.Context) ([]Arena, error) {
	q := `SELECT ` + arenaCols + ` FROM public.academy_exam_arenas ORDER BY code`
	rows, err := r.db.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Arena{}
	for rows.Next() {
		a, err := scanArena(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *a)
	}
	return out, rows.Err()
}

// UpdateArena partial-updates an arena (admin).
func (r *Repository) UpdateArena(ctx context.Context, actor, id string, req UpdateArenaRequest) (*Arena, error) {
	const q = `
		UPDATE public.academy_exam_arenas SET
			name          = COALESCE($2, name),
			subject_set   = COALESCE($3, subject_set),
			scoring_rules = COALESCE($4, scoring_rules),
			calendar      = COALESCE($5, calendar),
			countdown_at  = COALESCE($6, countdown_at),
			status        = COALESCE($7, status)
		WHERE id = $1`
	var subjArg, scoreArg, calArg any
	if req.SubjectSet != nil {
		subjArg = req.SubjectSet
	}
	if req.ScoringRules != nil {
		scoreArg = toJSONB(req.ScoringRules)
	}
	if req.Calendar != nil {
		calArg = toJSONB(req.Calendar)
	}
	tag, err := r.db.Exec(ctx, q, id, req.Name, subjArg, scoreArg, calArg, req.CountdownAt, req.Status)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	_ = r.insertAudit(ctx, actor, "exam_arena.updated", "academy_exam_arena", id, nil, "info")
	return r.GetArena(ctx, id)
}

// ── Blueprints ────────────────────────────────────────────────────────────────

const blueprintCols = `id, arena_id, name, variant, sections, total_items, total_seconds, navigation, tools, shuffle, pause_policy, status`

func scanBlueprint(row rowScanner) (*CBTBlueprint, error) {
	b := &CBTBlueprint{}
	var sections, navigation, tools []byte
	err := row.Scan(&b.ID, &b.ArenaID, &b.Name, &b.Variant, &sections, &b.TotalItems, &b.TotalSeconds,
		&navigation, &tools, &b.Shuffle, &b.PausePolicy, &b.Status)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	_ = json.Unmarshal(sections, &b.Sections)
	_ = json.Unmarshal(navigation, &b.Navigation)
	_ = json.Unmarshal(tools, &b.Tools)
	return b, nil
}

// InsertBlueprint creates a CBT blueprint under an arena (admin).
func (r *Repository) InsertBlueprint(ctx context.Context, actor, arenaID string, req CreateBlueprintRequest) (*CBTBlueprint, error) {
	id := uuid.New().String()
	variant := req.Variant
	if variant == "" {
		variant = string(VariantFull)
	}
	pausePolicy := req.PausePolicy
	if pausePolicy == "" {
		pausePolicy = string(PauseNone)
	}
	shuffle := true
	if req.Shuffle != nil {
		shuffle = *req.Shuffle
	}
	const q = `
		INSERT INTO public.academy_cbt_blueprints
			(id, arena_id, name, variant, sections, total_items, total_seconds,
			 navigation, tools, shuffle, pause_policy, status)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'active')`
	if _, err := r.db.Exec(ctx, q, id, arenaID, req.Name, variant, toJSONBArray(req.Sections),
		req.TotalItems, req.TotalSeconds, toJSONB(req.Navigation), toJSONB(req.Tools),
		shuffle, pausePolicy); err != nil {
		return nil, err
	}
	_ = r.insertAudit(ctx, actor, "cbt_blueprint.created", "academy_cbt_blueprint", id,
		map[string]any{"arena_id": arenaID, "total_seconds": req.TotalSeconds}, "info")
	return r.GetBlueprint(ctx, id)
}

// GetBlueprint reads one blueprint by id.
func (r *Repository) GetBlueprint(ctx context.Context, id string) (*CBTBlueprint, error) {
	q := `SELECT ` + blueprintCols + ` FROM public.academy_cbt_blueprints WHERE id = $1`
	return scanBlueprint(r.db.QueryRow(ctx, q, id))
}

// ListBlueprintsForArena reads all blueprints for an arena.
func (r *Repository) ListBlueprintsForArena(ctx context.Context, arenaID string) ([]CBTBlueprint, error) {
	q := `SELECT ` + blueprintCols + ` FROM public.academy_cbt_blueprints WHERE arena_id = $1 ORDER BY name`
	rows, err := r.db.Query(ctx, q, arenaID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []CBTBlueprint{}
	for rows.Next() {
		b, err := scanBlueprint(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *b)
	}
	return out, rows.Err()
}

// UpdateBlueprint partial-updates a blueprint (admin).
func (r *Repository) UpdateBlueprint(ctx context.Context, actor, id string, req UpdateBlueprintRequest) (*CBTBlueprint, error) {
	const q = `
		UPDATE public.academy_cbt_blueprints SET
			name          = COALESCE($2, name),
			variant       = COALESCE($3, variant),
			sections      = COALESCE($4, sections),
			total_items   = COALESCE($5, total_items),
			total_seconds = COALESCE($6, total_seconds),
			navigation    = COALESCE($7, navigation),
			tools         = COALESCE($8, tools),
			shuffle       = COALESCE($9, shuffle),
			pause_policy  = COALESCE($10, pause_policy),
			status        = COALESCE($11, status)
		WHERE id = $1`
	var sectArg, navArg, toolArg any
	if req.Sections != nil {
		sectArg = toJSONBArray(req.Sections)
	}
	if req.Navigation != nil {
		navArg = toJSONB(req.Navigation)
	}
	if req.Tools != nil {
		toolArg = toJSONB(req.Tools)
	}
	tag, err := r.db.Exec(ctx, q, id, req.Name, req.Variant, sectArg, req.TotalItems, req.TotalSeconds,
		navArg, toolArg, req.Shuffle, req.PausePolicy, req.Status)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	_ = r.insertAudit(ctx, actor, "cbt_blueprint.updated", "academy_cbt_blueprint", id, nil, "info")
	return r.GetBlueprint(ctx, id)
}

// ── Subject-combination rules ────────────────────────────────────────────────────

const combinationCols = `id, arena_id, course, required_subjects, guidance`

func scanCombination(row rowScanner) (*SubjectCombinationRule, error) {
	r := &SubjectCombinationRule{}
	err := row.Scan(&r.ID, &r.ArenaID, &r.Course, &r.RequiredSubjects, &r.Guidance)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return r, nil
}

// InsertCombination creates a subject-combination rule (admin).
func (r *Repository) InsertCombination(ctx context.Context, actor string, req CombinationRequest) (*SubjectCombinationRule, error) {
	id := uuid.New().String()
	subjects := req.RequiredSubjects
	if subjects == nil {
		subjects = []string{}
	}
	const q = `
		INSERT INTO public.academy_subject_combination_rules
			(id, arena_id, course, required_subjects, guidance)
		VALUES ($1,$2,$3,$4,$5)`
	if _, err := r.db.Exec(ctx, q, id, req.ArenaID, req.Course, subjects, req.Guidance); err != nil {
		return nil, err
	}
	_ = r.insertAudit(ctx, actor, "combination_rule.created", "academy_subject_combination_rule", id,
		map[string]any{"arena_id": req.ArenaID, "course": req.Course}, "info")
	return r.GetCombination(ctx, id)
}

// GetCombination reads one rule by id.
func (r *Repository) GetCombination(ctx context.Context, id string) (*SubjectCombinationRule, error) {
	q := `SELECT ` + combinationCols + ` FROM public.academy_subject_combination_rules WHERE id = $1`
	return scanCombination(r.db.QueryRow(ctx, q, id))
}

// UpdateCombination partial-updates a rule (admin).
func (r *Repository) UpdateCombination(ctx context.Context, actor, id string, req CombinationRequest) (*SubjectCombinationRule, error) {
	const q = `
		UPDATE public.academy_subject_combination_rules SET
			arena_id          = COALESCE($2, arena_id),
			course            = COALESCE($3, course),
			required_subjects = COALESCE($4, required_subjects),
			guidance          = COALESCE($5, guidance)
		WHERE id = $1`
	var arenaArg, courseArg, subjArg any
	if req.ArenaID != "" {
		arenaArg = req.ArenaID
	}
	if req.Course != "" {
		courseArg = req.Course
	}
	if req.RequiredSubjects != nil {
		subjArg = req.RequiredSubjects
	}
	tag, err := r.db.Exec(ctx, q, id, arenaArg, courseArg, subjArg, req.Guidance)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	_ = r.insertAudit(ctx, actor, "combination_rule.updated", "academy_subject_combination_rule", id, nil, "info")
	return r.GetCombination(ctx, id)
}

// DeleteCombination removes a rule (admin).
func (r *Repository) DeleteCombination(ctx context.Context, actor, id string) error {
	tag, err := r.db.Exec(ctx, `DELETE FROM public.academy_subject_combination_rules WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	_ = r.insertAudit(ctx, actor, "combination_rule.deleted", "academy_subject_combination_rule", id, nil, "info")
	return nil
}

// GetCombinations reads rules for an arena, optionally filtered by course.
func (r *Repository) GetCombinations(ctx context.Context, arenaID, course string) ([]SubjectCombinationRule, error) {
	var sb strings.Builder
	sb.WriteString(`SELECT ` + combinationCols + ` FROM public.academy_subject_combination_rules WHERE 1=1`)
	args := []any{}
	if arenaID != "" {
		args = append(args, arenaID)
		sb.WriteString(fmt.Sprintf(" AND arena_id = $%d", len(args)))
	}
	if course != "" {
		args = append(args, course)
		sb.WriteString(fmt.Sprintf(" AND course = $%d", len(args)))
	}
	sb.WriteString(" ORDER BY course")
	rows, err := r.db.Query(ctx, sb.String(), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SubjectCombinationRule{}
	for rows.Next() {
		c, err := scanCombination(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *c)
	}
	return out, rows.Err()
}

// ── Attempts ──────────────────────────────────────────────────────────────────

const attemptCols = `id, user_id, blueprint_id, arena_id, state, started_at, server_deadline,
	paused_at, submitted_at, score, readiness, predicted, integrity, offline_origin,
	idempotency_key, created_at`

func scanAttempt(row rowScanner) (*Attempt, error) {
	a := &Attempt{}
	var score, predicted, integrity []byte
	err := row.Scan(&a.ID, &a.UserID, &a.BlueprintID, &a.ArenaID, &a.State, &a.StartedAt,
		&a.ServerDeadline, &a.PausedAt, &a.SubmittedAt, &score, &a.Readiness, &predicted,
		&integrity, &a.OfflineOrigin, &a.IdempotencyKey, &a.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	_ = json.Unmarshal(score, &a.Score)
	_ = json.Unmarshal(predicted, &a.Predicted)
	_ = json.Unmarshal(integrity, &a.Integrity)
	return a, nil
}

// CreateAttempt inserts a started attempt with a server-authoritative deadline.
// The arena_id is resolved from the blueprint by the service. Idempotency key is
// optional; the unique index uq_academy_attempts_idem enforces single-use.
func (r *Repository) CreateAttempt(ctx context.Context, userID, blueprintID string, arenaID *string, startedAt, serverDeadline time.Time, offlineOrigin bool, idemKey *string) (*Attempt, error) {
	id := uuid.New().String()
	const q = `
		INSERT INTO public.academy_attempts
			(id, user_id, blueprint_id, arena_id, state, started_at, server_deadline,
			 offline_origin, idempotency_key)
		VALUES ($1,$2,$3,$4,'started',$5,$6,$7,$8)`
	if _, err := r.db.Exec(ctx, q, id, userID, blueprintID, arenaID, startedAt, serverDeadline,
		offlineOrigin, idemKey); err != nil {
		return nil, err
	}
	_ = r.insertAudit(ctx, userID, "exam_attempt.started", "academy_attempt", id,
		map[string]any{"blueprint_id": blueprintID, "server_deadline": serverDeadline.UTC().Format(time.RFC3339)}, "info")
	return r.GetAttempt(ctx, id)
}

// GetAttempt reads one attempt by id.
func (r *Repository) GetAttempt(ctx context.Context, id string) (*Attempt, error) {
	q := `SELECT ` + attemptCols + ` FROM public.academy_attempts WHERE id = $1`
	return scanAttempt(r.db.QueryRow(ctx, q, id))
}

// GetAttemptByIdempotencyKey returns the existing attempt for a reused key, or
// ErrNotFound. Backs idempotent Begin/Submit.
func (r *Repository) GetAttemptByIdempotencyKey(ctx context.Context, key string) (*Attempt, error) {
	q := `SELECT ` + attemptCols + ` FROM public.academy_attempts WHERE idempotency_key = $1`
	return scanAttempt(r.db.QueryRow(ctx, q, key))
}

// UpdateAttemptState performs a GUARDED state transition: UPDATE ... WHERE state=$from.
// If zero rows are affected the attempt is missing OR already moved on (race / replay);
// the caller treats that as a no-op/idempotent outcome. The fields map supplies any
// extra columns to set alongside state (paused_at, submitted_at, integrity, etc.).
func (r *Repository) UpdateAttemptState(ctx context.Context, actor, id string, from, to AttemptState, fields map[string]any) (*Attempt, bool, error) {
	if !validAttemptState(to) {
		return nil, false, fmt.Errorf("%w: %s", ErrInvalidInput, to)
	}

	// Build SET clause: state plus any guarded extra fields. Whitelist columns.
	var sets []string
	args := []any{id, string(from), string(to)}
	sets = append(sets, "state = $3")
	idx := 4
	for _, col := range orderedFieldKeys(fields) {
		switch col {
		case "paused_at", "submitted_at", "started_at", "server_deadline":
			sets = append(sets, fmt.Sprintf("%s = $%d", col, idx))
			args = append(args, fields[col])
			idx++
		case "integrity", "score", "predicted":
			sets = append(sets, fmt.Sprintf("%s = $%d", col, idx))
			args = append(args, toJSONB(fields[col]))
			idx++
		case "readiness":
			sets = append(sets, fmt.Sprintf("%s = $%d", col, idx))
			args = append(args, fields[col])
			idx++
		}
	}

	q := fmt.Sprintf(`UPDATE public.academy_attempts SET %s WHERE id = $1 AND state = $2`,
		strings.Join(sets, ", "))
	tag, err := r.db.Exec(ctx, q, args...)
	if err != nil {
		return nil, false, err
	}
	if tag.RowsAffected() == 0 {
		// Guard failed: either missing or already in a different state (idempotent replay).
		cur, gerr := r.GetAttempt(ctx, id)
		if gerr != nil {
			return nil, false, gerr
		}
		_ = r.insertAudit(ctx, actor, "exam_attempt.transition_noop", "academy_attempt", id,
			map[string]any{"expected_from": string(from), "to": string(to), "actual": string(cur.State)}, "info")
		return cur, false, nil
	}
	_ = r.insertAudit(ctx, actor, "exam_attempt.transitioned", "academy_attempt", id,
		map[string]any{"from": string(from), "to": string(to)}, "info")
	updated, err := r.GetAttempt(ctx, id)
	return updated, true, err
}

// orderedFieldKeys returns a deterministic key order so generated SQL is stable.
func orderedFieldKeys(fields map[string]any) []string {
	order := []string{"started_at", "server_deadline", "paused_at", "submitted_at", "integrity", "score", "predicted", "readiness"}
	out := make([]string, 0, len(fields))
	for _, k := range order {
		if _, ok := fields[k]; ok {
			out = append(out, k)
		}
	}
	return out
}

// ── Responses ──────────────────────────────────────────────────────────────────

// InsertResponses writes the frozen response set for an attempt in one tx. Called
// exactly once at submit time; responses are immutable thereafter. correctByID
// supplies the server-scored correctness per question item.
func (r *Repository) InsertResponses(ctx context.Context, attemptID string, inputs []ResponseInput, correctByID map[string]bool) error {
	if len(inputs) == 0 {
		return nil
	}
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	const q = `
		INSERT INTO public.academy_responses
			(attempt_id, question_item_id, selected, correct, time_ms, flagged)
		VALUES ($1,$2,$3,$4,$5,$6)`
	for _, in := range inputs {
		var correctArg any
		if c, ok := correctByID[in.QuestionItemID]; ok {
			correctArg = c
		}
		if _, err := tx.Exec(ctx, q, attemptID, in.QuestionItemID, toJSONB(in.Selected),
			correctArg, in.TimeMS, in.Flagged); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// CountResponses reports how many responses already exist for an attempt — used to
// keep submit idempotent (skip re-inserting frozen responses on replay).
func (r *Repository) CountResponses(ctx context.Context, attemptID string) (int, error) {
	var n int
	err := r.db.QueryRow(ctx, `SELECT count(*) FROM public.academy_responses WHERE attempt_id = $1`, attemptID).Scan(&n)
	return n, err
}

// GetResponses reads all responses for an attempt (review breakdown).
func (r *Repository) GetResponses(ctx context.Context, attemptID string) ([]Response, error) {
	const q = `
		SELECT id, attempt_id, question_item_id, selected, correct, time_ms, flagged, created_at
		FROM public.academy_responses WHERE attempt_id = $1 ORDER BY created_at`
	rows, err := r.db.Query(ctx, q, attemptID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Response{}
	for rows.Next() {
		resp := Response{}
		var selected []byte
		if err := rows.Scan(&resp.ID, &resp.AttemptID, &resp.QuestionItemID, &selected,
			&resp.Correct, &resp.TimeMS, &resp.Flagged, &resp.CreatedAt); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(selected, &resp.Selected)
		out = append(out, resp)
	}
	return out, rows.Err()
}

// GetQuestionAnswers fetches the canonical answers + subject_id for a set of
// question items so the service can score server-side. Returns maps keyed by item id.
func (r *Repository) GetQuestionAnswers(ctx context.Context, ids []string) (map[string]map[string]any, map[string]string, error) {
	answers := map[string]map[string]any{}
	subjects := map[string]string{}
	if len(ids) == 0 {
		return answers, subjects, nil
	}
	const q = `SELECT id, answer, subject_id FROM public.academy_question_items WHERE id = ANY($1)`
	rows, err := r.db.Query(ctx, q, ids)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var answer []byte
		var subjectID *string
		if err := rows.Scan(&id, &answer, &subjectID); err != nil {
			return nil, nil, err
		}
		m := map[string]any{}
		_ = json.Unmarshal(answer, &m)
		answers[id] = m
		if subjectID != nil {
			subjects[id] = *subjectID
		}
	}
	return answers, subjects, rows.Err()
}

// GetSubjectNames resolves subject ids → human names from public.academy_subjects
// so the per-subject score carries a label (not a raw uuid). Unknown ids are simply
// absent from the returned map; callers fall back to the id. Empty input → empty map.
func (r *Repository) GetSubjectNames(ctx context.Context, ids []string) (map[string]string, error) {
	names := map[string]string{}
	if len(ids) == 0 {
		return names, nil
	}
	const q = `SELECT id, name FROM public.academy_subjects WHERE id = ANY($1)`
	rows, err := r.db.Query(ctx, q, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id, name string
		if err := rows.Scan(&id, &name); err != nil {
			return nil, err
		}
		names[id] = name
	}
	return names, rows.Err()
}

// SelectApprovedQuestions returns up to `limit` approved question items for a
// subject, WITHOUT the answer key (served to learners). Deterministic order (by
// id) so the same blueprint yields the same set across fetches within an attempt.
func (r *Repository) SelectApprovedQuestions(ctx context.Context, subjectID string, limit int) ([]ServedQuestion, error) {
	const q = `
		SELECT id, type, stem, options, subject_id, objective_id
		FROM public.academy_question_items
		WHERE subject_id = $1 AND status = 'approved'
		ORDER BY id
		LIMIT $2`
	rows, err := r.db.Query(ctx, q, subjectID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ServedQuestion{}
	for rows.Next() {
		sq := ServedQuestion{}
		var options []byte
		if err := rows.Scan(&sq.ID, &sq.Type, &sq.Stem, &options, &sq.SubjectID, &sq.ObjectiveID); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(options, &sq.Options)
		out = append(out, sq)
	}
	return out, rows.Err()
}

// CountMasteredForUser returns how many of the user's objectives are mastered/
// exam_ready — feeds the mastery factor of the readiness formula.
func (r *Repository) CountMasteredForUser(ctx context.Context, userID string) (mastered, total int, err error) {
	const q = `
		SELECT
			count(*) FILTER (WHERE state IN ('mastered','exam_ready')),
			count(*)
		FROM public.academy_mastery_records WHERE user_id = $1`
	err = r.db.QueryRow(ctx, q, userID).Scan(&mastered, &total)
	return mastered, total, err
}
