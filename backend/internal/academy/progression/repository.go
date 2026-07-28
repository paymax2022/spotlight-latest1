package progression

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository is the pgx data-access layer for the progression module. Learning
// paths + steps are learner-scoped; adaptive_config is admin-owned. Guarded step
// transitions use UPDATE ... WHERE state=$from inside a tx so an illegal/stale
// move can never advance a step, and the matching ProgressEvent + audit are
// written in the SAME tx so a transition can never be half-applied.
//
// Mastery is REUSED read-only: this package SELECTs academy_mastery_records (owned
// by the assessment package) and never inserts/updates them.
type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

// ErrNotFound is returned when a row does not exist.
var ErrNotFound = errors.New("progression: not found")

// ── helpers ────────────────────────────────────────────────────────────────────

type rowScanner interface{ Scan(dest ...any) error }

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

// insertAuditTx appends an immutable row to public.audit_logs inside a tx.
// module is always "academy.progression".
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
		VALUES ($1,$2,'academy.progression',$3,$4,$5,$6)`
	_, err := tx.Exec(ctx, q, actorArg, action, resourceType, resourceID, toJSONB(newValues), severity)
	return err
}

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
		VALUES ($1,$2,'academy.progression',$3,$4,$5,$6)`
	_, err := r.db.Exec(ctx, q, actorArg, action, resourceType, resourceID, toJSONB(newValues), severity)
	return err
}

// ── Curriculum read (curriculum-as-data) ───────────────────────────────────────

// ObjectivesForSubject returns the subject's learning objectives in curriculum
// order: topic ordinal then objective ordinal (codes as tiebreak). This is the
// ONLY source of a subject's structure — nothing is hardcoded.
func (r *Repository) ObjectivesForSubject(ctx context.Context, subjectID string) ([]Objective, error) {
	const q = `
		SELECT lo.id, t.id, t.ordinal, lo.ordinal, lo.code, lo.title
		FROM public.academy_learning_objectives lo
		JOIN public.academy_topics t ON t.id = lo.topic_id
		WHERE t.subject_id = $1
		ORDER BY t.ordinal, lo.ordinal, t.code, lo.code`
	rows, err := r.db.Query(ctx, q, subjectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Objective{}
	for rows.Next() {
		var o Objective
		if err := rows.Scan(&o.ObjectiveID, &o.TopicID, &o.TopicOrdinal, &o.ObjOrdinal, &o.Code, &o.Title); err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

// ── Mastery read (REUSED from assessment; never written here) ───────────────────

// GetMastery reads a single academy_mastery_records row for user+objective.
func (r *Repository) GetMastery(ctx context.Context, userID, objectiveID string) (*Mastery, error) {
	const q = `
		SELECT objective_id, state, score
		FROM public.academy_mastery_records
		WHERE user_id = $1 AND objective_id = $2`
	return scanMastery(r.db.QueryRow(ctx, q, userID, objectiveID))
}

func scanMastery(row rowScanner) (*Mastery, error) {
	m := &Mastery{}
	err := row.Scan(&m.ObjectiveID, &m.State, &m.Score)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return m, nil
}

// ListMastery reads all of a learner's academy_mastery_records rows.
func (r *Repository) ListMastery(ctx context.Context, userID string) ([]Mastery, error) {
	const q = `
		SELECT objective_id, state, score
		FROM public.academy_mastery_records
		WHERE user_id = $1`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Mastery{}
	for rows.Next() {
		m := Mastery{}
		if err := rows.Scan(&m.ObjectiveID, &m.State, &m.Score); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// ── Question items (read-only projection for the picker) ────────────────────────

// ApprovedItemsForObjectives returns approved question items for a set of
// objectives — minimal projection (id, objective, difficulty) for pickItems.
func (r *Repository) ApprovedItemsForObjectives(ctx context.Context, objectiveIDs []string) ([]QuestionItemRef, error) {
	if len(objectiveIDs) == 0 {
		return []QuestionItemRef{}, nil
	}
	const q = `
		SELECT id, objective_id, difficulty
		FROM public.academy_question_items
		WHERE status = 'approved' AND objective_id = ANY($1)`
	rows, err := r.db.Query(ctx, q, objectiveIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []QuestionItemRef{}
	for rows.Next() {
		var it QuestionItemRef
		var obj *string
		if err := rows.Scan(&it.ID, &obj, &it.Difficulty); err != nil {
			return nil, err
		}
		if obj != nil {
			it.ObjectiveID = *obj
		}
		out = append(out, it)
	}
	return out, rows.Err()
}

// ── Learning paths + steps ──────────────────────────────────────────────────────

// GetPath returns the learner's path for a subject (without steps).
func (r *Repository) GetPath(ctx context.Context, userID, subjectID string) (*LearningPath, error) {
	const q = `
		SELECT id, user_id, class_id, subject_id, state, created_at, updated_at
		FROM public.academy_learning_paths
		WHERE user_id = $1 AND subject_id = $2`
	return scanPath(r.db.QueryRow(ctx, q, userID, subjectID))
}

func scanPath(row rowScanner) (*LearningPath, error) {
	p := &LearningPath{}
	err := row.Scan(&p.ID, &p.UserID, &p.ClassID, &p.SubjectID, &p.State, &p.CreatedAt, &p.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return p, nil
}

// ListSteps returns a path's steps in ordinal order.
func (r *Repository) ListSteps(ctx context.Context, pathID string) ([]PathStep, error) {
	const q = `
		SELECT id, path_id, objective_id, ordinal, state, updated_at
		FROM public.academy_path_steps
		WHERE path_id = $1
		ORDER BY ordinal`
	rows, err := r.db.Query(ctx, q, pathID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PathStep{}
	for rows.Next() {
		var s PathStep
		if err := rows.Scan(&s.ID, &s.PathID, &s.ObjectiveID, &s.Ordinal, &s.State, &s.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// GetStepByObjective returns one step in a path by its objective id.
func (r *Repository) GetStepByObjective(ctx context.Context, pathID, objectiveID string) (*PathStep, error) {
	const q = `
		SELECT id, path_id, objective_id, ordinal, state, updated_at
		FROM public.academy_path_steps
		WHERE path_id = $1 AND objective_id = $2`
	s := &PathStep{}
	err := r.db.QueryRow(ctx, q, pathID, objectiveID).Scan(&s.ID, &s.PathID, &s.ObjectiveID, &s.Ordinal, &s.State, &s.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return s, nil
}

// CreatePathWithSteps creates the learning path and its ordered steps in one tx.
// Idempotent on (user_id, subject_id): if the path already exists it is returned
// unchanged (no duplicate steps). The first step is 'available', the rest 'locked'.
// objectives MUST already be in curriculum order.
func (r *Repository) CreatePathWithSteps(ctx context.Context, actor, userID, subjectID string, classID *string, objectives []Objective) (*LearningPath, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	// Idempotency: lock on the unique pair. INSERT ... ON CONFLICT DO NOTHING then
	// read back; if it pre-existed we leave its steps untouched.
	var pathID string
	var existed bool
	err = tx.QueryRow(ctx, `
		INSERT INTO public.academy_learning_paths (user_id, subject_id, class_id, state)
		VALUES ($1,$2,$3,'active')
		ON CONFLICT (user_id, subject_id) DO NOTHING
		RETURNING id`, userID, subjectID, classID).Scan(&pathID)
	if errors.Is(err, pgx.ErrNoRows) {
		// Conflict: path already exists. Fetch it.
		existed = true
		if err := tx.QueryRow(ctx,
			`SELECT id FROM public.academy_learning_paths WHERE user_id = $1 AND subject_id = $2`,
			userID, subjectID).Scan(&pathID); err != nil {
			return nil, err
		}
	} else if err != nil {
		return nil, err
	}

	if !existed {
		for i, o := range objectives {
			state := StepLocked
			if i == 0 {
				state = StepAvailable
			}
			if _, err := tx.Exec(ctx, `
				INSERT INTO public.academy_path_steps (path_id, objective_id, ordinal, state)
				VALUES ($1,$2,$3,$4)
				ON CONFLICT (path_id, objective_id) DO NOTHING`,
				pathID, o.ObjectiveID, i, string(state)); err != nil {
				return nil, err
			}
		}
		// Emit a path_built progress event + audit.
		if _, err := tx.Exec(ctx, `
			INSERT INTO public.academy_progress_events (user_id, type, objective_id, payload)
			VALUES ($1,$2,NULL,$3)`,
			userID, EvtPathBuilt, toJSONB(map[string]any{"subject_id": subjectID, "steps": len(objectives)})); err != nil {
			return nil, err
		}
		if err := insertAuditTx(ctx, tx, actor, "path.built", "academy_learning_path", pathID,
			map[string]any{"subject_id": subjectID, "steps": len(objectives)}, "info"); err != nil {
			return nil, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return r.GetPath(ctx, userID, subjectID)
}

// UpdatePathStepState performs the GUARDED transition. The update only succeeds
// when the row is still in `from` (UPDATE ... WHERE state=$from), so a stale or
// illegal move affects 0 rows and is rejected + audited. On success it writes the
// matching ProgressEvent. The caller has already validated with canStep; the
// WHERE clause is the authoritative concurrency guard.
//
// When `to` is StepDone, the NEXT step (by ordinal) is unlocked locked→available
// in the same tx (also guarded), so a path always has exactly one frontier.
func (r *Repository) UpdatePathStepState(ctx context.Context, actor, userID, pathID, objectiveID string, from, to PathStepState) (*PathStep, error) {
	if !canStep(from, to) {
		_ = r.insertAudit(ctx, actor, "step.transition_rejected", "academy_path_step", objectiveID,
			map[string]any{"from": string(from), "to": string(to), "reason": "illegal_transition"}, "warning")
		return nil, fmt.Errorf("%w: %s -> %s", ErrIllegalTransition, from, to)
	}

	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	tag, err := tx.Exec(ctx, `
		UPDATE public.academy_path_steps
		SET state = $4, updated_at = now()
		WHERE path_id = $1 AND objective_id = $2 AND state = $3`,
		pathID, objectiveID, string(from), string(to))
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		// Either the step is missing or it has moved underneath us → reject + audit.
		_ = insertAuditTx(ctx, tx, actor, "step.transition_rejected", "academy_path_step", objectiveID,
			map[string]any{"from": string(from), "to": string(to), "reason": "stale_or_missing"}, "warning")
		_ = tx.Commit(ctx) // persist the rejection audit
		return nil, fmt.Errorf("%w: %s -> %s", ErrIllegalTransition, from, to)
	}

	// Progress event for the transition.
	if evt := stepEventTypeFor(from, to); evt != "" {
		if _, err := tx.Exec(ctx, `
			INSERT INTO public.academy_progress_events (user_id, type, objective_id, payload)
			VALUES ($1,$2,$3,$4)`,
			userID, evt, objectiveID, toJSONB(map[string]any{"from": string(from), "to": string(to)})); err != nil {
			return nil, err
		}
	}

	// On completion, unlock the next step (guarded locked→available).
	var unlockedObjective string
	if to == StepDone {
		var curOrdinal int
		if err := tx.QueryRow(ctx,
			`SELECT ordinal FROM public.academy_path_steps WHERE path_id = $1 AND objective_id = $2`,
			pathID, objectiveID).Scan(&curOrdinal); err != nil {
			return nil, err
		}
		err = tx.QueryRow(ctx, `
			UPDATE public.academy_path_steps
			SET state = 'available', updated_at = now()
			WHERE id = (
				SELECT id FROM public.academy_path_steps
				WHERE path_id = $1 AND ordinal > $2 AND state = 'locked'
				ORDER BY ordinal LIMIT 1)
			RETURNING objective_id`, pathID, curOrdinal).Scan(&unlockedObjective)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return nil, err
		}
		if unlockedObjective != "" {
			if _, err := tx.Exec(ctx, `
				INSERT INTO public.academy_progress_events (user_id, type, objective_id, payload)
				VALUES ($1,$2,$3,$4)`,
				userID, EvtStepAvailable, unlockedObjective,
				toJSONB(map[string]any{"unlocked_by": objectiveID})); err != nil {
				return nil, err
			}
		} else {
			// No more locked steps → path complete.
			if _, err := tx.Exec(ctx, `
				UPDATE public.academy_learning_paths SET state = 'completed', updated_at = now()
				WHERE id = $1 AND state = 'active'`, pathID); err != nil {
				return nil, err
			}
		}
	}

	if err := insertAuditTx(ctx, tx, actor, "step.transitioned", "academy_path_step", objectiveID,
		map[string]any{"from": string(from), "to": string(to), "unlocked": unlockedObjective}, "info"); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return r.GetStepByObjective(ctx, pathID, objectiveID)
}

// ── Practice sessions ───────────────────────────────────────────────────────────

// InsertPracticeSession creates an adaptive/drill session row.
func (r *Repository) InsertPracticeSession(ctx context.Context, userID, kind string, objectiveIDs []string) (*PracticeSession, error) {
	if kind == "" {
		kind = "adaptive"
	}
	if objectiveIDs == nil {
		objectiveIDs = []string{}
	}
	const q = `
		INSERT INTO public.academy_practice_sessions (user_id, kind, objective_ids, state)
		VALUES ($1,$2,$3,'created')
		RETURNING id, user_id, kind, objective_ids, state, score, created_at`
	s := &PracticeSession{}
	err := r.db.QueryRow(ctx, q, userID, kind, objectiveIDs).
		Scan(&s.ID, &s.UserID, &s.Kind, &s.ObjectiveIDs, &s.State, &s.Score, &s.CreatedAt)
	if err != nil {
		return nil, err
	}
	_ = r.insertAudit(ctx, userID, "practice_session.created", "academy_practice_session", s.ID,
		map[string]any{"kind": kind, "objectives": len(objectiveIDs)}, "info")
	return s, nil
}

// CompletePracticeSession marks a session completed with a final score (guarded:
// only a 'created' session may complete).
func (r *Repository) CompletePracticeSession(ctx context.Context, userID, sessionID string, score float64) (*PracticeSession, error) {
	const q = `
		UPDATE public.academy_practice_sessions
		SET state = 'completed', score = $3
		WHERE id = $1 AND user_id = $2 AND state = 'created'
		RETURNING id, user_id, kind, objective_ids, state, score, created_at`
	s := &PracticeSession{}
	err := r.db.QueryRow(ctx, q, sessionID, userID, score).
		Scan(&s.ID, &s.UserID, &s.Kind, &s.ObjectiveIDs, &s.State, &s.Score, &s.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return s, nil
}

// ── Recommendations ─────────────────────────────────────────────────────────────

// ReplaceRecommendations deletes the learner's existing recommendations and
// inserts the fresh set in one tx (a recompute is a full replace).
func (r *Repository) ReplaceRecommendations(ctx context.Context, userID string, recos []Recommendation) ([]Recommendation, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `DELETE FROM public.academy_recommendations WHERE user_id = $1`, userID); err != nil {
		return nil, err
	}
	for i := range recos {
		var objArg any
		if recos[i].ObjectiveID != nil {
			objArg = *recos[i].ObjectiveID
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO public.academy_recommendations (user_id, objective_id, reason, score)
			VALUES ($1,$2,$3,$4)`,
			userID, objArg, recos[i].Reason, recos[i].Score); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return r.ListRecommendations(ctx, userID)
}

// ListRecommendations returns the learner's recommendations, highest score first.
func (r *Repository) ListRecommendations(ctx context.Context, userID string) ([]Recommendation, error) {
	const q = `
		SELECT id, user_id, objective_id, reason, score, created_at
		FROM public.academy_recommendations
		WHERE user_id = $1
		ORDER BY score DESC, created_at DESC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Recommendation{}
	for rows.Next() {
		var rec Recommendation
		if err := rows.Scan(&rec.ID, &rec.UserID, &rec.ObjectiveID, &rec.Reason, &rec.Score, &rec.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, rec)
	}
	return out, rows.Err()
}

// ── Adaptive config ─────────────────────────────────────────────────────────────

// GetConfig reads one adaptive_config row by key.
func (r *Repository) GetConfig(ctx context.Context, key string) (*AdaptiveConfig, error) {
	const q = `SELECT key, value, updated_at FROM public.academy_adaptive_config WHERE key = $1`
	c := &AdaptiveConfig{}
	var value []byte
	err := r.db.QueryRow(ctx, q, key).Scan(&c.Key, &value, &c.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	_ = json.Unmarshal(value, &c.Value)
	return c, nil
}

// ListConfig returns all adaptive_config rows.
func (r *Repository) ListConfig(ctx context.Context) ([]AdaptiveConfig, error) {
	const q = `SELECT key, value, updated_at FROM public.academy_adaptive_config ORDER BY key`
	rows, err := r.db.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AdaptiveConfig{}
	for rows.Next() {
		c := AdaptiveConfig{}
		var value []byte
		if err := rows.Scan(&c.Key, &value, &c.UpdatedAt); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(value, &c.Value)
		out = append(out, c)
	}
	return out, rows.Err()
}

// UpsertConfig writes an adaptive_config key/value (admin).
func (r *Repository) UpsertConfig(ctx context.Context, actor, key string, value map[string]any) (*AdaptiveConfig, error) {
	const q = `
		INSERT INTO public.academy_adaptive_config (key, value, updated_at)
		VALUES ($1,$2,now())
		ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`
	if _, err := r.db.Exec(ctx, q, key, toJSONB(value)); err != nil {
		return nil, err
	}
	_ = r.insertAudit(ctx, actor, "adaptive_config.upserted", "academy_adaptive_config", key,
		map[string]any{"key": key}, "info")
	return r.GetConfig(ctx, key)
}

// ── Step resolution helpers (cross-path lookup by objective) ────────────────────

// resolveStep finds the (path_id, current state) of the learner's step for an
// objective. A learner has at most one active path per subject, and an objective
// belongs to one subject, so the lookup is unambiguous. Returns ErrNotFound when
// the learner has no path step for the objective.
func (r *Repository) resolveStep(ctx context.Context, userID, objectiveID string) (string, PathStepState, error) {
	const q = `
		SELECT ps.path_id, ps.state
		FROM public.academy_path_steps ps
		JOIN public.academy_learning_paths lp ON lp.id = ps.path_id
		WHERE lp.user_id = $1 AND ps.objective_id = $2
		ORDER BY ps.updated_at DESC
		LIMIT 1`
	var pathID string
	var state PathStepState
	err := r.db.QueryRow(ctx, q, userID, objectiveID).Scan(&pathID, &state)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", ErrNotFound
	}
	if err != nil {
		return "", "", err
	}
	return pathID, state, nil
}

// frontierObjectives returns the objective ids the learner is actively on across
// all their paths: steps in 'available' or 'in_progress'. These drive
// path-momentum recommendation boosts.
func (r *Repository) frontierObjectives(ctx context.Context, userID string) ([]string, error) {
	const q = `
		SELECT ps.objective_id
		FROM public.academy_path_steps ps
		JOIN public.academy_learning_paths lp ON lp.id = ps.path_id
		WHERE lp.user_id = $1 AND ps.state IN ('available','in_progress')`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}
