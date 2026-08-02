package content

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

// Repository is the pgx data-access layer for the academy content module. All SQL
// is parameterized. Publish transitions and the matching audit row are written in
// ONE transaction so a transition can never be half-applied. Times are UTC.
type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

// ErrNotFound is returned when a row does not exist.
var ErrNotFound = errors.New("academy.content: not found")

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

// insertAudit is the non-tx variant for standalone audits (CRUD path).
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

type rowScanner interface{ Scan(dest ...any) error }

// ── Lessons (publish surface) ───────────────────────────────────────────────────

func scanLesson(row rowScanner) (*Lesson, error) {
	l := &Lesson{}
	err := row.Scan(&l.ID, &l.ObjectiveID, &l.Title, &l.Type, &l.VersionID,
		&l.MediaRef, &l.Transcript, &l.DurationS, &l.Status, &l.CreatedAt, &l.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return l, nil
}

const lessonCols = `id, objective_id, title, type, version_id, media_ref, transcript, duration_s, status, created_at, updated_at`

func (r *Repository) GetLesson(ctx context.Context, id string) (*Lesson, error) {
	q := `SELECT ` + lessonCols + ` FROM public.academy_edu_lessons WHERE id = $1`
	return scanLesson(r.db.QueryRow(ctx, q, id))
}

// ListLiveLessonsForObjective serves the learner surface: live lessons for a
// learning objective, ordered by recency.
func (r *Repository) ListLiveLessonsForObjective(ctx context.Context, objectiveID string, limit int) ([]Lesson, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	q := `SELECT ` + lessonCols + `
		FROM public.academy_edu_lessons
		WHERE objective_id = $1 AND status = 'live'
		ORDER BY updated_at DESC LIMIT $2`
	rows, err := r.db.Query(ctx, q, objectiveID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Lesson{}
	for rows.Next() {
		l, err := scanLesson(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *l)
	}
	return out, rows.Err()
}

// TransitionLesson runs the guarded publish lifecycle for a lesson. Illegal
// transitions are rejected AND audited (severity=warning). The status read +
// update + audit happen in one tx so the guard reads the committed state.
func (r *Repository) TransitionLesson(ctx context.Context, actor, id string, to PublishStatus) (*Lesson, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var from PublishStatus
	err = tx.QueryRow(ctx, `SELECT status FROM public.academy_edu_lessons WHERE id = $1 FOR UPDATE`, id).Scan(&from)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}

	if !canPublish(from, to) {
		_ = insertAuditTx(ctx, tx, actor, "lesson.publish_rejected", "academy_lesson", id,
			map[string]any{"from": string(from), "to": string(to), "reason": "illegal_transition"}, "warning")
		_ = tx.Commit(ctx) // persist the rejection audit
		return nil, fmt.Errorf("%w: %s -> %s", ErrIllegalTransition, from, to)
	}

	if _, err := tx.Exec(ctx, `UPDATE public.academy_edu_lessons SET status = $2, updated_at = now() WHERE id = $1`, id, string(to)); err != nil {
		return nil, err
	}
	if err := insertAuditTx(ctx, tx, actor, "lesson.published", "academy_lesson", id,
		map[string]any{"from": string(from), "to": string(to)}, "info"); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return r.GetLesson(ctx, id)
}

// ── Content bundles (publish surface + manifest) ─────────────────────────────────

const bundleCols = `id, name, version_id, arena_code, size_budget_bytes, lesson_ids, access_card_mapping, status, manifest, created_at`

func scanBundle(row rowScanner) (*ContentBundle, error) {
	b := &ContentBundle{}
	var manifest []byte
	err := row.Scan(&b.ID, &b.Name, &b.VersionID, &b.ArenaCode, &b.SizeBudgetBytes,
		&b.LessonIDs, &b.AccessCardMap, &b.Status, &manifest, &b.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	_ = json.Unmarshal(manifest, &b.Manifest)
	return b, nil
}

func (r *Repository) GetBundle(ctx context.Context, id string) (*ContentBundle, error) {
	q := `SELECT ` + bundleCols + ` FROM public.academy_content_bundles WHERE id = $1`
	return scanBundle(r.db.QueryRow(ctx, q, id))
}

// ListLiveBundles serves the learner surface: bundles that are live.
func (r *Repository) ListLiveBundles(ctx context.Context, limit int) ([]ContentBundle, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	q := `SELECT ` + bundleCols + `
		FROM public.academy_content_bundles WHERE status = 'live'
		ORDER BY created_at DESC LIMIT $1`
	rows, err := r.db.Query(ctx, q, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ContentBundle{}
	for rows.Next() {
		b, err := scanBundle(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *b)
	}
	return out, rows.Err()
}

// TransitionBundle runs the guarded publish lifecycle for a content bundle. On
// approved→live it (re)packages the manifest (offline bundles re-package then):
// the manifest is rebuilt from the bundle's live lessons. All in one tx.
func (r *Repository) TransitionBundle(ctx context.Context, actor, id string, to PublishStatus) (*ContentBundle, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var from PublishStatus
	var lessonIDs []string
	err = tx.QueryRow(ctx,
		`SELECT status, lesson_ids FROM public.academy_content_bundles WHERE id = $1 FOR UPDATE`, id).
		Scan(&from, &lessonIDs)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}

	if !canPublish(from, to) {
		_ = insertAuditTx(ctx, tx, actor, "bundle.publish_rejected", "academy_content_bundle", id,
			map[string]any{"from": string(from), "to": string(to), "reason": "illegal_transition"}, "warning")
		_ = tx.Commit(ctx)
		return nil, fmt.Errorf("%w: %s -> %s", ErrIllegalTransition, from, to)
	}

	if repackagesManifest(from, to) {
		// Re-package the bundle manifest from its lessons (offline re-package).
		manifest, err := r.buildManifestTx(ctx, tx, id, lessonIDs)
		if err != nil {
			return nil, err
		}
		if _, err := tx.Exec(ctx,
			`UPDATE public.academy_content_bundles SET status = $2, manifest = $3 WHERE id = $1`,
			id, string(to), toJSONB(manifest)); err != nil {
			return nil, err
		}
		if err := insertAuditTx(ctx, tx, actor, "bundle.packaged", "academy_content_bundle", id,
			map[string]any{"from": string(from), "to": string(to), "lesson_count": len(lessonIDs)}, "info"); err != nil {
			return nil, err
		}
	} else {
		if _, err := tx.Exec(ctx,
			`UPDATE public.academy_content_bundles SET status = $2 WHERE id = $1`, id, string(to)); err != nil {
			return nil, err
		}
		if err := insertAuditTx(ctx, tx, actor, "bundle.published", "academy_content_bundle", id,
			map[string]any{"from": string(from), "to": string(to)}, "info"); err != nil {
			return nil, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return r.GetBundle(ctx, id)
}

// buildManifestTx assembles the offline bundle manifest from the bundle's live
// lessons (lesson id → media_ref + duration). Read inside the publish tx so the
// manifest reflects the committed lesson state.
func (r *Repository) buildManifestTx(ctx context.Context, tx pgx.Tx, bundleID string, lessonIDs []string) (map[string]any, error) {
	items := []map[string]any{}
	var total int64
	if len(lessonIDs) > 0 {
		rows, err := tx.Query(ctx,
			`SELECT id, title, media_ref, duration_s, status
			 FROM public.academy_edu_lessons WHERE id = ANY($1)`, lessonIDs)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		for rows.Next() {
			var lid, title, status string
			var media *string
			var dur int
			if err := rows.Scan(&lid, &title, &media, &dur, &status); err != nil {
				return nil, err
			}
			items = append(items, map[string]any{
				"lesson_id": lid, "title": title, "media_ref": media,
				"duration_s": dur, "status": status,
			})
			total += int64(dur)
		}
		if err := rows.Err(); err != nil {
			return nil, err
		}
	}
	return map[string]any{
		"bundle_id":        bundleID,
		"packaged_at":      time.Now().UTC().Format(time.RFC3339),
		"lesson_count":     len(items),
		"total_duration_s": total,
		"items":            items,
	}, nil
}

// ── Productions (pipeline board) ─────────────────────────────────────────────────

const productionCols = `id, lesson_id, title, stage, owner_id, sla_due, status, notes, created_at, updated_at`

func scanProduction(row rowScanner) (*Production, error) {
	p := &Production{}
	err := row.Scan(&p.ID, &p.LessonID, &p.Title, &p.Stage, &p.OwnerID,
		&p.SLADue, &p.Status, &p.Notes, &p.CreatedAt, &p.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return p, nil
}

func (r *Repository) GetProduction(ctx context.Context, id string) (*Production, error) {
	q := `SELECT ` + productionCols + ` FROM public.academy_content_productions WHERE id = $1`
	return scanProduction(r.db.QueryRow(ctx, q, id))
}

func (r *Repository) InsertProduction(ctx context.Context, actor string, req CreateProductionRequest) (*Production, error) {
	id := uuid.New().String()
	const q = `
		INSERT INTO public.academy_content_productions
			(id, lesson_id, title, stage, owner_id, sla_due, status, notes, created_at, updated_at)
		VALUES ($1,$2,$3,'script',$4,$5,'active',$6, now(), now())`
	if _, err := r.db.Exec(ctx, q, id, req.LessonID, req.Title, req.OwnerID, req.SLADue, req.Notes); err != nil {
		return nil, err
	}
	_ = r.insertAudit(ctx, actor, "production.created", "academy_content_production", id,
		map[string]any{"title": req.Title, "stage": string(StageScript)}, "info")
	return r.GetProduction(ctx, id)
}

func (r *Repository) UpdateProduction(ctx context.Context, actor, id string, req UpdateProductionRequest) (*Production, error) {
	var statusArg any
	if req.Status != "" {
		statusArg = string(req.Status)
	}
	const q = `
		UPDATE public.academy_content_productions SET
			title    = COALESCE($2, title),
			owner_id = COALESCE($3, owner_id),
			sla_due  = COALESCE($4, sla_due),
			status   = COALESCE($5, status),
			notes    = COALESCE($6, notes),
			updated_at = now()
		WHERE id = $1`
	tag, err := r.db.Exec(ctx, q, id, req.Title, req.OwnerID, req.SLADue, statusArg, req.Notes)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	_ = r.insertAudit(ctx, actor, "production.updated", "academy_content_production", id, nil, "info")
	return r.GetProduction(ctx, id)
}

// AdvanceProduction runs the guarded pipeline stage machine. Illegal stage moves
// are rejected AND audited. When advancing to `publish`, the row is also flagged
// done. All in one tx so the guard reads the committed stage.
func (r *Repository) AdvanceProduction(ctx context.Context, actor, id string, to ProductionStage) (*Production, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var from ProductionStage
	err = tx.QueryRow(ctx, `SELECT stage FROM public.academy_content_productions WHERE id = $1 FOR UPDATE`, id).Scan(&from)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}

	if !canStage(from, to) {
		_ = insertAuditTx(ctx, tx, actor, "production.advance_rejected", "academy_content_production", id,
			map[string]any{"from": string(from), "to": string(to), "reason": "illegal_transition"}, "warning")
		_ = tx.Commit(ctx)
		return nil, fmt.Errorf("%w: %s -> %s", ErrIllegalTransition, from, to)
	}

	status := string(ProdActive)
	if to == StagePublish {
		status = string(ProdDone)
	}
	if _, err := tx.Exec(ctx,
		`UPDATE public.academy_content_productions SET stage = $2, status = $3, updated_at = now() WHERE id = $1`,
		id, string(to), status); err != nil {
		return nil, err
	}
	if err := insertAuditTx(ctx, tx, actor, "production.advanced", "academy_content_production", id,
		map[string]any{"from": string(from), "to": string(to)}, "info"); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return r.GetProduction(ctx, id)
}

func (r *Repository) ListProductions(ctx context.Context, f ProductionFilter) ([]Production, error) {
	var sb strings.Builder
	sb.WriteString(`SELECT ` + productionCols + ` FROM public.academy_content_productions WHERE 1=1`)
	args := []any{}
	add := func(clause string, v any) {
		args = append(args, v)
		sb.WriteString(fmt.Sprintf(" AND %s $%d", clause, len(args)))
	}
	if f.Stage != "" {
		add("stage =", f.Stage)
	}
	if f.Status != "" {
		add("status =", f.Status)
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
	out := []Production{}
	for rows.Next() {
		p, err := scanProduction(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *p)
	}
	return out, rows.Err()
}

// ── Localizations ────────────────────────────────────────────────────────────────

const localizationCols = `id, entity_type, entity_id, lang, payload, status, updated_at`

func scanLocalization(row rowScanner) (*Localization, error) {
	l := &Localization{}
	var payload []byte
	err := row.Scan(&l.ID, &l.EntityType, &l.EntityID, &l.Lang, &payload, &l.Status, &l.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	_ = json.Unmarshal(payload, &l.Payload)
	return l, nil
}

// UpsertLocalization writes the per-(entity_type, entity_id, lang) localization.
func (r *Repository) UpsertLocalization(ctx context.Context, actor string, req UpsertLocalizationRequest) (*Localization, error) {
	status := req.Status
	if status == "" {
		status = "draft"
	}
	const q = `
		INSERT INTO public.academy_localizations
			(entity_type, entity_id, lang, payload, status, updated_at)
		VALUES ($1,$2,$3,$4,$5, now())
		ON CONFLICT (entity_type, entity_id, lang) DO UPDATE SET
			payload    = EXCLUDED.payload,
			status     = EXCLUDED.status,
			updated_at = now()`
	if _, err := r.db.Exec(ctx, q, req.EntityType, req.EntityID, req.Lang, toJSONB(req.Payload), status); err != nil {
		return nil, err
	}
	_ = r.insertAudit(ctx, actor, "localization.upserted", "academy_localization", req.EntityType+":"+req.EntityID+":"+req.Lang,
		map[string]any{"entity_type": req.EntityType, "lang": req.Lang, "status": status}, "info")
	return r.GetLocalization(ctx, req.EntityType, req.EntityID, req.Lang)
}

func (r *Repository) GetLocalization(ctx context.Context, entityType, entityID, lang string) (*Localization, error) {
	q := `SELECT ` + localizationCols + `
		FROM public.academy_localizations
		WHERE entity_type = $1 AND entity_id = $2 AND lang = $3`
	return scanLocalization(r.db.QueryRow(ctx, q, entityType, entityID, lang))
}

// ListLocalizations lists localizations, optionally filtered by entity.
func (r *Repository) ListLocalizations(ctx context.Context, entityType, entityID string) ([]Localization, error) {
	var sb strings.Builder
	sb.WriteString(`SELECT ` + localizationCols + ` FROM public.academy_localizations WHERE 1=1`)
	args := []any{}
	if entityType != "" {
		args = append(args, entityType)
		sb.WriteString(fmt.Sprintf(" AND entity_type = $%d", len(args)))
	}
	if entityID != "" {
		args = append(args, entityID)
		sb.WriteString(fmt.Sprintf(" AND entity_id = $%d", len(args)))
	}
	sb.WriteString(" ORDER BY updated_at DESC LIMIT 200")
	rows, err := r.db.Query(ctx, sb.String(), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Localization{}
	for rows.Next() {
		l, err := scanLocalization(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *l)
	}
	return out, rows.Err()
}

// DeleteLocalization removes one localization row by its natural key.
func (r *Repository) DeleteLocalization(ctx context.Context, actor, entityType, entityID, lang string) error {
	tag, err := r.db.Exec(ctx,
		`DELETE FROM public.academy_localizations WHERE entity_type = $1 AND entity_id = $2 AND lang = $3`,
		entityType, entityID, lang)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	_ = r.insertAudit(ctx, actor, "localization.deleted", "academy_localization", entityType+":"+entityID+":"+lang, nil, "info")
	return nil
}
