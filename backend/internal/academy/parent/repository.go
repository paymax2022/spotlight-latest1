package parent

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository is the pgx data-access layer for the academy parent layer. All SQL is
// parameterized. The guardian-link gate is enforced here AND in the service (defence
// in depth on top of RLS). Times are UTC. No money column writes (approvals only
// gate the order; commerce reads the approval state).
type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

// ErrNotFound is returned when a scoped row does not exist.
var ErrNotFound = errors.New("academy.parent: not found")

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

// ── Guardian-link gate (child safety) ────────────────────────────────────────────

// IsActiveGuardianLink reports whether the guardian holds an ACTIVE link to the
// minor. This is the fail-closed gate every parent op consults: only status='active'
// returns true; pending/revoked/absent return false.
func (r *Repository) IsActiveGuardianLink(ctx context.Context, guardianID, minorID string) (bool, error) {
	const q = `
		SELECT EXISTS (
			SELECT 1 FROM public.academy_guardian_links
			WHERE guardian_user_id = $1 AND minor_user_id = $2 AND status = 'active'
		)`
	var ok bool
	if err := r.db.QueryRow(ctx, q, guardianID, minorID).Scan(&ok); err != nil {
		return false, err
	}
	return ok, nil
}

// ListActiveChildren returns the minors a guardian is actively linked to.
func (r *Repository) ListActiveChildren(ctx context.Context, guardianID string) ([]Child, error) {
	const q = `
		SELECT id, minor_user_id, status, created_at
		FROM public.academy_guardian_links
		WHERE guardian_user_id = $1 AND status = 'active'
		ORDER BY created_at ASC`
	rows, err := r.db.Query(ctx, q, guardianID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Child{}
	for rows.Next() {
		var c Child
		if err := rows.Scan(&c.LinkID, &c.MinorUserID, &c.Status, &c.LinkedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// ── Dashboard aggregation reads ──────────────────────────────────────────────────

// MasteryRowsForMinor returns the minor's mastery records joined to subjects via
// objective→topic→subject. Optionally scoped to a single subject.
func (r *Repository) MasteryRowsForMinor(ctx context.Context, minorID, subjectID string) ([]MasteryRow, error) {
	var sb strings.Builder
	sb.WriteString(`
		SELECT mr.objective_id, s.id, s.code, s.name, mr.state, mr.score
		FROM public.academy_mastery_records mr
		JOIN public.academy_learning_objectives lo ON lo.id = mr.objective_id
		JOIN public.academy_topics t ON t.id = lo.topic_id
		JOIN public.academy_subjects s ON s.id = t.subject_id
		WHERE mr.user_id = $1`)
	args := []any{minorID}
	if subjectID != "" {
		args = append(args, subjectID)
		sb.WriteString(" AND s.id = $2")
	}
	sb.WriteString(" ORDER BY s.code ASC")
	rows, err := r.db.Query(ctx, sb.String(), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []MasteryRow{}
	for rows.Next() {
		var m MasteryRow
		if err := rows.Scan(&m.ObjectiveID, &m.SubjectID, &m.SubjectCode, &m.SubjectName, &m.State, &m.Score); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// RecentProgressForMinor returns the minor's most recent progress events.
func (r *Repository) RecentProgressForMinor(ctx context.Context, minorID string, limit int) ([]ProgressEvent, error) {
	if limit <= 0 || limit > 200 {
		limit = 20
	}
	const q = `
		SELECT id, type, objective_id, payload, created_at
		FROM public.academy_progress_events
		WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`
	rows, err := r.db.Query(ctx, q, minorID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ProgressEvent{}
	for rows.Next() {
		var e ProgressEvent
		var payload []byte
		if err := rows.Scan(&e.ID, &e.Type, &e.ObjectiveID, &payload, &e.CreatedAt); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(payload, &e.Payload)
		out = append(out, e)
	}
	return out, rows.Err()
}

// LatestReadinessForMinor returns the readiness of the minor's most recent scored
// attempt, or nil when there is none.
func (r *Repository) LatestReadinessForMinor(ctx context.Context, minorID string) (*float64, error) {
	const q = `
		SELECT readiness FROM public.academy_attempts
		WHERE user_id = $1 AND readiness IS NOT NULL
		ORDER BY created_at DESC LIMIT 1`
	var readiness *float64
	err := r.db.QueryRow(ctx, q, minorID).Scan(&readiness)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return readiness, nil
}

// ── Parent controls ──────────────────────────────────────────────────────────────

const controlsCols = `id, guardian_user_id, minor_user_id, screen_time_minutes, allowed_hours, content_max_age, updated_at`

func scanControls(row rowScanner) (*ParentControls, error) {
	p := &ParentControls{}
	var allowed []byte
	err := row.Scan(&p.ID, &p.GuardianUserID, &p.MinorUserID, &p.ScreenTimeMinutes, &allowed, &p.ContentMaxAge, &p.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	_ = json.Unmarshal(allowed, &p.AllowedHours)
	return p, nil
}

// UpsertControls writes the per-(guardian, minor) controls row + audit.
func (r *Repository) UpsertControls(ctx context.Context, guardianID, minorID string, req UpsertControlsRequest) (*ParentControls, error) {
	const q = `
		INSERT INTO public.academy_parent_controls
			(guardian_user_id, minor_user_id, screen_time_minutes, allowed_hours, content_max_age, updated_at)
		VALUES ($1,$2,$3,$4,$5, now())
		ON CONFLICT (guardian_user_id, minor_user_id) DO UPDATE SET
			screen_time_minutes = EXCLUDED.screen_time_minutes,
			allowed_hours       = EXCLUDED.allowed_hours,
			content_max_age     = EXCLUDED.content_max_age,
			updated_at          = now()`
	if _, err := r.db.Exec(ctx, q, guardianID, minorID, req.ScreenTimeMinutes, toJSONB(req.AllowedHours), req.ContentMaxAge); err != nil {
		return nil, err
	}
	_ = r.insertAudit(ctx, guardianID, "parent_controls.upserted", "academy_parent_controls", minorID,
		map[string]any{"screen_time_minutes": req.ScreenTimeMinutes, "content_max_age": req.ContentMaxAge}, "info")
	return r.GetControls(ctx, guardianID, minorID)
}

func (r *Repository) GetControls(ctx context.Context, guardianID, minorID string) (*ParentControls, error) {
	q := `SELECT ` + controlsCols + `
		FROM public.academy_parent_controls
		WHERE guardian_user_id = $1 AND minor_user_id = $2`
	return scanControls(r.db.QueryRow(ctx, q, guardianID, minorID))
}

// ── Progress reports ─────────────────────────────────────────────────────────────

// InsertReport writes a generated report row (append-only audit trail).
func (r *Repository) InsertReport(ctx context.Context, actor, minorID, period string, payload map[string]any) (*ProgressReport, error) {
	id := uuid.New().String()
	const q = `
		INSERT INTO public.academy_progress_reports (id, minor_user_id, period, payload, generated_at)
		VALUES ($1,$2,$3,$4, now())`
	if _, err := r.db.Exec(ctx, q, id, minorID, period, toJSONB(payload)); err != nil {
		return nil, err
	}
	_ = r.insertAudit(ctx, actor, "progress_report.generated", "academy_progress_report", id,
		map[string]any{"minor_user_id": minorID, "period": period}, "info")
	return r.GetReport(ctx, id)
}

func (r *Repository) GetReport(ctx context.Context, id string) (*ProgressReport, error) {
	const q = `
		SELECT id, minor_user_id, period, payload, generated_at
		FROM public.academy_progress_reports WHERE id = $1`
	rep := &ProgressReport{}
	var payload []byte
	err := r.db.QueryRow(ctx, q, id).Scan(&rep.ID, &rep.MinorUserID, &rep.Period, &payload, &rep.GeneratedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	_ = json.Unmarshal(payload, &rep.Payload)
	return rep, nil
}

// ListReports returns a minor's reports (most recent first).
func (r *Repository) ListReports(ctx context.Context, minorID string, limit int) ([]ProgressReport, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	const q = `
		SELECT id, minor_user_id, period, payload, generated_at
		FROM public.academy_progress_reports
		WHERE minor_user_id = $1 ORDER BY generated_at DESC LIMIT $2`
	rows, err := r.db.Query(ctx, q, minorID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ProgressReport{}
	for rows.Next() {
		var rep ProgressReport
		var payload []byte
		if err := rows.Scan(&rep.ID, &rep.MinorUserID, &rep.Period, &payload, &rep.GeneratedAt); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(payload, &rep.Payload)
		out = append(out, rep)
	}
	return out, rows.Err()
}

// ── Purchase approvals ───────────────────────────────────────────────────────────

// ListPendingApprovals returns the guardian's pending purchase approvals joined to
// their orders.
func (r *Repository) ListPendingApprovals(ctx context.Context, guardianID string) ([]PurchaseApproval, error) {
	const q = `
		SELECT pa.id, pa.order_id, pa.guardian_user_id, pa.minor_user_id, pa.state,
		       o.kind, o.amount_minor, o.state, pa.decided_at, pa.created_at
		FROM public.academy_purchase_approvals pa
		JOIN public.academy_orders o ON o.id = pa.order_id
		WHERE pa.guardian_user_id = $1 AND pa.state = 'pending'
		ORDER BY pa.created_at ASC`
	rows, err := r.db.Query(ctx, q, guardianID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PurchaseApproval{}
	for rows.Next() {
		var a PurchaseApproval
		if err := rows.Scan(&a.ID, &a.OrderID, &a.GuardianUserID, &a.MinorUserID, &a.State,
			&a.OrderKind, &a.OrderAmount, &a.OrderState, &a.DecidedAt, &a.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// GetApproval fetches a single approval by id.
func (r *Repository) GetApproval(ctx context.Context, id string) (*PurchaseApproval, error) {
	const q = `
		SELECT pa.id, pa.order_id, pa.guardian_user_id, pa.minor_user_id, pa.state,
		       o.kind, o.amount_minor, o.state, pa.decided_at, pa.created_at
		FROM public.academy_purchase_approvals pa
		JOIN public.academy_orders o ON o.id = pa.order_id
		WHERE pa.id = $1`
	a := &PurchaseApproval{}
	err := r.db.QueryRow(ctx, q, id).Scan(&a.ID, &a.OrderID, &a.GuardianUserID, &a.MinorUserID, &a.State,
		&a.OrderKind, &a.OrderAmount, &a.OrderState, &a.DecidedAt, &a.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return a, nil
}

// DecideApproval runs the guarded pending→approved|rejected transition. Only a
// PENDING approval can be decided; the read + update + audit happen in one tx so
// the guard reads committed state. The caller has already verified the guardian
// link; this only gates the order (commerce reads the approval state).
func (r *Repository) DecideApproval(ctx context.Context, actor, id string, to ApprovalState) (*PurchaseApproval, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var from ApprovalState
	err = tx.QueryRow(ctx, `SELECT state FROM public.academy_purchase_approvals WHERE id = $1 FOR UPDATE`, id).Scan(&from)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}

	if from != ApprovalPending {
		_ = insertAuditTx(ctx, tx, actor, "purchase_approval.decide_rejected", "academy_purchase_approval", id,
			map[string]any{"from": string(from), "to": string(to), "reason": "not_pending"}, "warning")
		_ = tx.Commit(ctx)
		return nil, ErrIllegalTransition
	}

	const upd = `
		UPDATE public.academy_purchase_approvals
		SET state = $2, decided_at = now()
		WHERE id = $1`
	if _, err := tx.Exec(ctx, upd, id, string(to)); err != nil {
		return nil, err
	}
	if err := insertAuditTx(ctx, tx, actor, "purchase_approval.decided", "academy_purchase_approval", id,
		map[string]any{"from": string(from), "to": string(to)}, "info"); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return r.GetApproval(ctx, id)
}

// ── Notification templates (admin) ───────────────────────────────────────────────

const templateCols = `id, key, channel, title, body, status`

func scanTemplate(row rowScanner) (*NotificationTemplate, error) {
	t := &NotificationTemplate{}
	err := row.Scan(&t.ID, &t.Key, &t.Channel, &t.Title, &t.Body, &t.Status)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return t, nil
}

// UpsertTemplate writes the per-key notification template.
func (r *Repository) UpsertTemplate(ctx context.Context, actor string, req UpsertTemplateRequest) (*NotificationTemplate, error) {
	status := req.Status
	if status == "" {
		status = "active"
	}
	const q = `
		INSERT INTO public.academy_notification_templates (key, channel, title, body, status)
		VALUES ($1,$2,$3,$4,$5)
		ON CONFLICT (key) DO UPDATE SET
			channel = EXCLUDED.channel,
			title   = EXCLUDED.title,
			body    = EXCLUDED.body,
			status  = EXCLUDED.status`
	if _, err := r.db.Exec(ctx, q, req.Key, req.Channel, req.Title, req.Body, status); err != nil {
		return nil, err
	}
	_ = r.insertAudit(ctx, actor, "notification_template.upserted", "academy_notification_template", req.Key,
		map[string]any{"channel": req.Channel, "status": status}, "info")
	return r.GetTemplate(ctx, req.Key)
}

func (r *Repository) GetTemplate(ctx context.Context, key string) (*NotificationTemplate, error) {
	q := `SELECT ` + templateCols + ` FROM public.academy_notification_templates WHERE key = $1`
	return scanTemplate(r.db.QueryRow(ctx, q, key))
}

func (r *Repository) ListTemplates(ctx context.Context) ([]NotificationTemplate, error) {
	q := `SELECT ` + templateCols + ` FROM public.academy_notification_templates ORDER BY key ASC`
	rows, err := r.db.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []NotificationTemplate{}
	for rows.Next() {
		t, err := scanTemplate(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *t)
	}
	return out, rows.Err()
}

func (r *Repository) DeleteTemplate(ctx context.Context, actor, key string) error {
	tag, err := r.db.Exec(ctx, `DELETE FROM public.academy_notification_templates WHERE key = $1`, key)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	_ = r.insertAudit(ctx, actor, "notification_template.deleted", "academy_notification_template", key, nil, "info")
	return nil
}
