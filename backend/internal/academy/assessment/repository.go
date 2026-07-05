package assessment

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

// Repository is the pgx data-access layer for the assessment module. Question-bank
// rows are admin-owned; mastery/progress rows are learner-scoped (defence in depth
// on top of RLS). Mastery upserts and the matching audit/progress rows are written
// in ONE transaction so a progression can never be half-applied.
type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

// ErrNotFound is returned when a row does not exist.
var ErrNotFound = errors.New("assessment: not found")

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

// ── Question bank ───────────────────────────────────────────────────────────────

func (r *Repository) InsertItem(ctx context.Context, actor string, req CreateItemRequest) (*QuestionItem, error) {
	id := uuid.New().String()
	now := time.Now()
	typ := req.Type
	if typ == "" {
		typ = "mcq"
	}
	diff := 0.5
	if req.Difficulty != nil {
		diff = *req.Difficulty
	}
	disc := 0.0
	if req.Discrimination != nil {
		disc = *req.Discrimination
	}
	tags := req.Tags
	if tags == nil {
		tags = []string{}
	}
	const q = `
		INSERT INTO public.academy_question_items
			(id, type, stem, options, answer, difficulty, discrimination,
			 objective_id, subject_id, tags, status, created_by, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'draft',$11,$12)`
	if _, err := r.db.Exec(ctx, q, id, typ, req.Stem, toJSONBArray(req.Options), toJSONB(req.Answer),
		diff, disc, req.ObjectiveID, req.SubjectID, tags, actor, now); err != nil {
		return nil, err
	}
	_ = r.insertAudit(ctx, actor, "question_item.created", "academy_question_item", id,
		map[string]any{"status": "draft", "subject_id": req.SubjectID, "objective_id": req.ObjectiveID}, "info")
	return r.GetItem(ctx, id)
}

func (r *Repository) GetItem(ctx context.Context, id string) (*QuestionItem, error) {
	const q = `
		SELECT id, type, stem, options, answer, difficulty, discrimination,
		       objective_id, subject_id, tags, status, created_by, created_at
		FROM public.academy_question_items WHERE id = $1`
	return scanItem(r.db.QueryRow(ctx, q, id))
}

type rowScanner interface{ Scan(dest ...any) error }

func scanItem(row rowScanner) (*QuestionItem, error) {
	it := &QuestionItem{}
	var options, answer []byte
	err := row.Scan(&it.ID, &it.Type, &it.Stem, &options, &answer, &it.Difficulty, &it.Discrimination,
		&it.ObjectiveID, &it.SubjectID, &it.Tags, &it.Status, &it.CreatedBy, &it.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	_ = json.Unmarshal(options, &it.Options)
	_ = json.Unmarshal(answer, &it.Answer)
	return it, nil
}

func (r *Repository) UpdateItem(ctx context.Context, actor, id string, req UpdateItemRequest) (*QuestionItem, error) {
	// COALESCE-style partial update; status is intentionally NOT updatable here.
	const q = `
		UPDATE public.academy_question_items SET
			stem           = COALESCE($2, stem),
			options        = COALESCE($3, options),
			answer         = COALESCE($4, answer),
			difficulty     = COALESCE($5, difficulty),
			discrimination = COALESCE($6, discrimination),
			objective_id   = COALESCE($7, objective_id),
			subject_id     = COALESCE($8, subject_id),
			tags           = COALESCE($9, tags)
		WHERE id = $1`
	var optsArg, ansArg any
	if req.Options != nil {
		optsArg = toJSONBArray(req.Options)
	}
	if req.Answer != nil {
		ansArg = toJSONB(req.Answer)
	}
	var tagsArg any
	if req.Tags != nil {
		tagsArg = req.Tags
	}
	tag, err := r.db.Exec(ctx, q, id, req.Stem, optsArg, ansArg, req.Difficulty, req.Discrimination,
		req.ObjectiveID, req.SubjectID, tagsArg)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	_ = r.insertAudit(ctx, actor, "question_item.updated", "academy_question_item", id, nil, "info")
	return r.GetItem(ctx, id)
}

// TransitionItemStatus runs the guarded item lifecycle. Illegal transitions are
// rejected AND audited (severity=warning). The status read + update + audit happen
// in one tx so the guard reads the committed current state.
func (r *Repository) TransitionItemStatus(ctx context.Context, actor, id string, to ItemStatus) (*QuestionItem, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var from ItemStatus
	err = tx.QueryRow(ctx, `SELECT status FROM public.academy_question_items WHERE id = $1 FOR UPDATE`, id).Scan(&from)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}

	if !canTransitionItem(from, to) {
		_ = insertAuditTx(ctx, tx, actor, "question_item.transition_rejected", "academy_question_item", id,
			map[string]any{"from": string(from), "to": string(to), "reason": "illegal_transition"}, "warning")
		_ = tx.Commit(ctx) // persist the rejection audit
		return nil, fmt.Errorf("%w: %s -> %s", ErrIllegalTransition, from, to)
	}

	if _, err := tx.Exec(ctx, `UPDATE public.academy_question_items SET status = $2 WHERE id = $1`, id, string(to)); err != nil {
		return nil, err
	}
	if err := insertAuditTx(ctx, tx, actor, "question_item.transitioned", "academy_question_item", id,
		map[string]any{"from": string(from), "to": string(to)}, "info"); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return r.GetItem(ctx, id)
}

// ListItems applies the filter. When status="approved" with an objective set this
// also backs the learner practice-serve endpoint.
func (r *Repository) ListItems(ctx context.Context, f ItemFilter) ([]QuestionItem, error) {
	var sb strings.Builder
	sb.WriteString(`
		SELECT id, type, stem, options, answer, difficulty, discrimination,
		       objective_id, subject_id, tags, status, created_by, created_at
		FROM public.academy_question_items WHERE 1=1`)
	args := []any{}
	add := func(clause string, v any) {
		args = append(args, v)
		sb.WriteString(fmt.Sprintf(" AND %s $%d", clause, len(args)))
	}
	if f.SubjectID != "" {
		add("subject_id =", f.SubjectID)
	}
	if f.ObjectiveID != "" {
		add("objective_id =", f.ObjectiveID)
	}
	if f.Status != "" {
		add("status =", f.Status)
	}
	if f.Tag != "" {
		args = append(args, f.Tag)
		sb.WriteString(fmt.Sprintf(" AND $%d = ANY(tags)", len(args)))
	}
	sb.WriteString(" ORDER BY created_at DESC")
	limit := f.Limit
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	args = append(args, limit)
	sb.WriteString(fmt.Sprintf(" LIMIT $%d", len(args)))
	if f.Offset > 0 {
		args = append(args, f.Offset)
		sb.WriteString(fmt.Sprintf(" OFFSET $%d", len(args)))
	}

	rows, err := r.db.Query(ctx, sb.String(), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []QuestionItem{}
	for rows.Next() {
		it, err := scanItem(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *it)
	}
	return out, rows.Err()
}

// GetApprovedItemsForObjective serves the learner practice surface: approved items
// only. Answers ARE included so the service can score server-side; the handler
// strips answers before returning the practice payload to the learner.
func (r *Repository) GetApprovedItemsForObjective(ctx context.Context, objectiveID string, limit int) ([]QuestionItem, error) {
	return r.ListItems(ctx, ItemFilter{ObjectiveID: objectiveID, Status: string(ItemApproved), Limit: limit})
}

func (r *Repository) ItemAnalysis(ctx context.Context, f ItemFilter) ([]ItemAnalysis, error) {
	items, err := r.ListItems(ctx, f)
	if err != nil {
		return nil, err
	}
	out := make([]ItemAnalysis, 0, len(items))
	for _, it := range items {
		out = append(out, ItemAnalysis{ItemID: it.ID, Difficulty: it.Difficulty, Discrimination: it.Discrimination, Status: string(it.Status)})
	}
	return out, nil
}

// ── Mastery records & progress events ──────────────────────────────────────────

func (r *Repository) GetMastery(ctx context.Context, userID, objectiveID string) (*MasteryRecord, error) {
	const q = `
		SELECT id, user_id, objective_id, state, score, history, updated_at
		FROM public.academy_mastery_records WHERE user_id = $1 AND objective_id = $2`
	return scanMastery(r.db.QueryRow(ctx, q, userID, objectiveID))
}

func scanMastery(row rowScanner) (*MasteryRecord, error) {
	m := &MasteryRecord{}
	var history []byte
	err := row.Scan(&m.ID, &m.UserID, &m.ObjectiveID, &m.State, &m.Score, &history, &m.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	_ = json.Unmarshal(history, &m.History)
	return m, nil
}

func (r *Repository) ListMastery(ctx context.Context, userID string) ([]MasteryRecord, error) {
	const q = `
		SELECT id, user_id, objective_id, state, score, history, updated_at
		FROM public.academy_mastery_records WHERE user_id = $1 ORDER BY updated_at DESC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []MasteryRecord{}
	for rows.Next() {
		m, err := scanMastery(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *m)
	}
	return out, rows.Err()
}

func (r *Repository) ListProgress(ctx context.Context, userID string, limit int) ([]ProgressEvent, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	const q = `
		SELECT id, user_id, type, objective_id, payload, created_at
		FROM public.academy_progress_events WHERE user_id = $1
		ORDER BY created_at DESC LIMIT $2`
	rows, err := r.db.Query(ctx, q, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ProgressEvent{}
	for rows.Next() {
		e := ProgressEvent{}
		var payload []byte
		if err := rows.Scan(&e.ID, &e.UserID, &e.Type, &e.ObjectiveID, &payload, &e.CreatedAt); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(payload, &e.Payload)
		out = append(out, e)
	}
	return out, rows.Err()
}

// ApplyProgression atomically: upserts the mastery record to the (already-guarded)
// target state, appends to its history, writes a ProgressEvent when the state
// advanced, and writes the audit row. The transition has been validated by the
// service via canProgress before this is called; here we re-read the committed
// current state under FOR UPDATE and reject if it changed underneath (defence in
// depth against concurrent practice submits).
func (r *Repository) ApplyProgression(ctx context.Context, userID, objectiveID string, expectedFrom, to MasteryState, score float64, eventType string, eventPayload map[string]any) (*MasteryRecord, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	// Seed the record if absent (default not_started), then lock + read.
	const seed = `
		INSERT INTO public.academy_mastery_records (user_id, objective_id, state, score)
		VALUES ($1,$2,'not_started',0)
		ON CONFLICT (user_id, objective_id) DO NOTHING`
	if _, err := tx.Exec(ctx, seed, userID, objectiveID); err != nil {
		return nil, err
	}

	var current MasteryState
	var histRaw []byte
	err = tx.QueryRow(ctx,
		`SELECT state, history FROM public.academy_mastery_records
		 WHERE user_id = $1 AND objective_id = $2 FOR UPDATE`, userID, objectiveID).Scan(&current, &histRaw)
	if err != nil {
		return nil, err
	}

	if current != expectedFrom {
		// State moved under us — re-validate the guard against the live state.
		if !canProgress(current, to) {
			_ = insertAuditTx(ctx, tx, userID, "progression.transition_rejected", "academy_mastery_record", objectiveID,
				map[string]any{"from": string(current), "to": string(to), "reason": "stale_transition"}, "warning")
			_ = tx.Commit(ctx)
			return nil, fmt.Errorf("%w: %s -> %s", ErrIllegalTransition, current, to)
		}
	}

	// Append to history.
	var history []map[string]any
	_ = json.Unmarshal(histRaw, &history)
	history = append(history, map[string]any{
		"from":  string(current),
		"to":    string(to),
		"score": score,
		"at":    time.Now().UTC().Format(time.RFC3339),
	})

	const upd = `
		UPDATE public.academy_mastery_records
		SET state = $3, score = $4, history = $5, updated_at = now()
		WHERE user_id = $1 AND objective_id = $2`
	if _, err := tx.Exec(ctx, upd, userID, objectiveID, string(to), score, toJSONBArray(history)); err != nil {
		return nil, err
	}

	if eventType != "" {
		const evt = `
			INSERT INTO public.academy_progress_events (user_id, type, objective_id, payload)
			VALUES ($1,$2,$3,$4)`
		if _, err := tx.Exec(ctx, evt, userID, eventType, objectiveID, toJSONB(eventPayload)); err != nil {
			return nil, err
		}
	}

	if err := insertAuditTx(ctx, tx, userID, "progression.transitioned", "academy_mastery_record", objectiveID,
		map[string]any{"from": string(current), "to": string(to), "score": score, "event": eventType}, "info"); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return r.GetMastery(ctx, userID, objectiveID)
}

// CountPracticeAttempts returns how many practice ProgressEvents the learner has
// logged for an objective — feeds the min-practice-attempts guard.
func (r *Repository) CountPracticeAttempts(ctx context.Context, userID, objectiveID string) (int, error) {
	const q = `
		SELECT count(*) FROM public.academy_progress_events
		WHERE user_id = $1 AND objective_id = $2 AND type = $3`
	var n int
	err := r.db.QueryRow(ctx, q, userID, objectiveID, EvtPracticeRecorded).Scan(&n)
	return n, err
}

// RecordPracticeEvent appends a practice_recorded ProgressEvent (used by RecordPractice
// when no state upgrade occurs, so the attempt still counts toward the guard).
func (r *Repository) RecordPracticeEvent(ctx context.Context, userID, objectiveID string, payload map[string]any) error {
	const q = `
		INSERT INTO public.academy_progress_events (user_id, type, objective_id, payload)
		VALUES ($1,$2,$3,$4)`
	_, err := r.db.Exec(ctx, q, userID, EvtPracticeRecorded, objectiveID, toJSONB(payload))
	return err
}
