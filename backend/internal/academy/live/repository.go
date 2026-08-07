package live

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository is the pgx data-access layer for the academy live + community +
// moderation module. Live sessions are host/admin-owned; community rows are member-
// scoped. Guarded state updates re-read the committed current state under FOR UPDATE
// so a transition can never be applied from a stale state.
type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

// ErrNotFound is returned when a row does not exist.
var ErrNotFound = errors.New("academy/live: not found")

// ── helpers ──────────────────────────────────────────────────────────────────

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

type rowScanner interface{ Scan(dest ...any) error }

// insertAuditTx appends an immutable row to public.audit_logs inside a tx.
// module is always "academy.live"; severity defaults to info, "warning" for rejections.
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
		VALUES ($1,$2,'academy.live',$3,$4,$5,$6)`
	_, err := tx.Exec(ctx, q, actorArg, action, resourceType, resourceID, toJSONB(newValues), severity)
	return err
}

// insertAudit is the non-tx variant for standalone audits.
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
		VALUES ($1,$2,'academy.live',$3,$4,$5,$6)`
	_, err := r.db.Exec(ctx, q, actorArg, action, resourceType, resourceID, toJSONB(newValues), severity)
	return err
}

// IsMinor reports whether the user is the minor side of ANY guardian link — the
// academy's signal that a user is a minor (mirrors identity.IsMinor; kept local so
// this package does not import identity).
func (r *Repository) IsMinor(ctx context.Context, userID string) (bool, error) {
	const q = `SELECT EXISTS (SELECT 1 FROM public.academy_guardian_links WHERE minor_user_id = $1)`
	var ok bool
	if err := r.db.QueryRow(ctx, q, userID).Scan(&ok); err != nil {
		return false, err
	}
	return ok, nil
}

// ── Live sessions ──────────────────────────────────────────────────────────────

func scanSession(row rowScanner) (*LiveSession, error) {
	s := &LiveSession{}
	err := row.Scan(&s.ID, &s.HostID, &s.Title, &s.TradeTrack, &s.SubjectID,
		&s.ScheduledAt, &s.State, &s.RoomRef, &s.ReplayRef, &s.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return s, nil
}

const sessionCols = `id, host_id, title, trade_track, subject_id, scheduled_at, state, room_ref, replay_ref, created_at`

func (r *Repository) InsertSession(ctx context.Context, actor string, req ScheduleSessionRequest) (*LiveSession, error) {
	id := uuid.New().String()
	const q = `
		INSERT INTO public.academy_live_sessions
			(id, host_id, title, trade_track, subject_id, scheduled_at, state, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,'scheduled',now())`
	if _, err := r.db.Exec(ctx, q, id, actor, req.Title, req.TradeTrack, req.SubjectID, req.ScheduledAt); err != nil {
		return nil, err
	}
	_ = r.insertAudit(ctx, actor, "live_session.scheduled", "academy_live_session", id,
		map[string]any{"title": req.Title, "trade_track": req.TradeTrack, "subject_id": req.SubjectID}, "info")
	return r.GetSession(ctx, id)
}

func (r *Repository) GetSession(ctx context.Context, id string) (*LiveSession, error) {
	q := `SELECT ` + sessionCols + ` FROM public.academy_live_sessions WHERE id = $1`
	return scanSession(r.db.QueryRow(ctx, q, id))
}

// TransitionSession runs the guarded live-session lifecycle and optionally stores a
// room_ref (on →live) or replay_ref (on →ended) in the SAME transaction. Illegal
// transitions are rejected AND audited (severity=warning). The state read + update +
// audit happen in one tx so the guard reads the committed current state.
func (r *Repository) TransitionSession(ctx context.Context, actor, id string, to SessionState, roomRef, replayRef *string) (*LiveSession, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var from SessionState
	err = tx.QueryRow(ctx, `SELECT state FROM public.academy_live_sessions WHERE id = $1 FOR UPDATE`, id).Scan(&from)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}

	if !canSession(from, to) {
		_ = insertAuditTx(ctx, tx, actor, "live_session.transition_rejected", "academy_live_session", id,
			map[string]any{"from": string(from), "to": string(to), "reason": "illegal_transition"}, "warning")
		_ = tx.Commit(ctx) // persist the rejection audit
		return nil, fmt.Errorf("%w: %s -> %s", ErrIllegalTransition, from, to)
	}

	const upd = `
		UPDATE public.academy_live_sessions
		SET state = $2,
		    room_ref   = COALESCE($3, room_ref),
		    replay_ref = COALESCE($4, replay_ref)
		WHERE id = $1`
	if _, err := tx.Exec(ctx, upd, id, string(to), roomRef, replayRef); err != nil {
		return nil, err
	}
	if err := insertAuditTx(ctx, tx, actor, "live_session.transitioned", "academy_live_session", id,
		map[string]any{"from": string(from), "to": string(to)}, "info"); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return r.GetSession(ctx, id)
}

// ListSessions returns sessions for the requested view (upcoming/live/replay/all).
func (r *Repository) ListSessions(ctx context.Context, f SessionFilter) ([]LiveSession, error) {
	limit := f.Limit
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	q := `SELECT ` + sessionCols + ` FROM public.academy_live_sessions WHERE `
	var where, order string
	args := []any{}
	switch f.View {
	case "live":
		where = `state = 'live'`
		order = ` ORDER BY created_at DESC`
	case "replay":
		where = `state = 'ended' AND replay_ref IS NOT NULL`
		order = ` ORDER BY created_at DESC`
	case "", "upcoming":
		where = `state = 'scheduled'`
		order = ` ORDER BY scheduled_at ASC NULLS LAST, created_at ASC`
	default: // all non-cancelled
		where = `state <> 'cancelled'`
		order = ` ORDER BY created_at DESC`
	}
	args = append(args, limit)
	rows, err := r.db.Query(ctx, q+where+order+fmt.Sprintf(" LIMIT $%d", len(args)), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []LiveSession{}
	for rows.Next() {
		s, err := scanSession(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *s)
	}
	return out, rows.Err()
}

// ListAllSessions returns EVERY live session regardless of state (admin oversight read —
// mirrors ListSessions without the view/state filter). Ordered newest-first.
func (r *Repository) ListAllSessions(ctx context.Context, limit int) ([]LiveSession, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	q := `SELECT ` + sessionCols + ` FROM public.academy_live_sessions ORDER BY created_at DESC LIMIT $1`
	rows, err := r.db.Query(ctx, q, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []LiveSession{}
	for rows.Next() {
		s, err := scanSession(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *s)
	}
	return out, rows.Err()
}

// ── Participants ───────────────────────────────────────────────────────────────

// JoinParticipant upserts a participant row (re-join clears left_at). UNIQUE
// (session_id, user_id) makes this idempotent.
func (r *Repository) JoinParticipant(ctx context.Context, sessionID, userID string, role ParticipantRole) (*Participant, error) {
	const q = `
		INSERT INTO public.academy_live_participants (session_id, user_id, role, joined_at)
		VALUES ($1,$2,$3,now())
		ON CONFLICT (session_id, user_id)
		DO UPDATE SET joined_at = now(), left_at = NULL, role = EXCLUDED.role
		RETURNING id, session_id, user_id, role, joined_at, left_at`
	p := &Participant{}
	err := r.db.QueryRow(ctx, q, sessionID, userID, string(role)).
		Scan(&p.ID, &p.SessionID, &p.UserID, &p.Role, &p.JoinedAt, &p.LeftAt)
	if err != nil {
		return nil, err
	}
	return p, nil
}

// LeaveParticipant stamps left_at for a participant.
func (r *Repository) LeaveParticipant(ctx context.Context, sessionID, userID string) error {
	const q = `
		UPDATE public.academy_live_participants
		SET left_at = now()
		WHERE session_id = $1 AND user_id = $2 AND left_at IS NULL`
	tag, err := r.db.Exec(ctx, q, sessionID, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ── Study groups + members ─────────────────────────────────────────────────────

func (r *Repository) InsertGroup(ctx context.Context, owner string, req CreateGroupRequest) (*StudyGroup, error) {
	id := uuid.New().String()
	const q = `
		INSERT INTO public.academy_study_groups (id, name, scope, scope_ref, owner_id, goal, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,now())`
	if _, err := r.db.Exec(ctx, q, id, req.Name, req.Scope, req.ScopeRef, owner, toJSONB(req.Goal)); err != nil {
		return nil, err
	}
	// Owner is auto-joined.
	if err := r.JoinGroup(ctx, id, owner); err != nil {
		return nil, err
	}
	_ = r.insertAudit(ctx, owner, "study_group.created", "academy_study_group", id,
		map[string]any{"name": req.Name, "scope": req.Scope}, "info")
	return r.GetGroup(ctx, id)
}

func (r *Repository) GetGroup(ctx context.Context, id string) (*StudyGroup, error) {
	const q = `SELECT id, name, scope, scope_ref, owner_id, goal, created_at FROM public.academy_study_groups WHERE id = $1`
	g := &StudyGroup{}
	var goal []byte
	err := r.db.QueryRow(ctx, q, id).Scan(&g.ID, &g.Name, &g.Scope, &g.ScopeRef, &g.OwnerID, &goal, &g.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	_ = json.Unmarshal(goal, &g.Goal)
	return g, nil
}

func (r *Repository) ListGroups(ctx context.Context, limit int) ([]StudyGroup, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	const q = `
		SELECT id, name, scope, scope_ref, owner_id, goal, created_at
		FROM public.academy_study_groups ORDER BY created_at DESC LIMIT $1`
	rows, err := r.db.Query(ctx, q, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []StudyGroup{}
	for rows.Next() {
		g := StudyGroup{}
		var goal []byte
		if err := rows.Scan(&g.ID, &g.Name, &g.Scope, &g.ScopeRef, &g.OwnerID, &goal, &g.CreatedAt); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(goal, &g.Goal)
		out = append(out, g)
	}
	return out, rows.Err()
}

// JoinGroup adds a member (idempotent on the (group_id, user_id) PK).
func (r *Repository) JoinGroup(ctx context.Context, groupID, userID string) error {
	const q = `
		INSERT INTO public.academy_group_members (group_id, user_id, joined_at)
		VALUES ($1,$2,now())
		ON CONFLICT (group_id, user_id) DO NOTHING`
	_, err := r.db.Exec(ctx, q, groupID, userID)
	return err
}

// ── Discussions ────────────────────────────────────────────────────────────────

func (r *Repository) InsertDiscussion(ctx context.Context, userID string, req PostDiscussionRequest) (*Discussion, error) {
	id := uuid.New().String()
	const q = `
		INSERT INTO public.academy_discussions (id, scope, ref_id, user_id, body, parent_id, state, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,'visible',now())`
	if _, err := r.db.Exec(ctx, q, id, req.Scope, req.RefID, userID, req.Body, req.ParentID); err != nil {
		return nil, err
	}
	_ = r.insertAudit(ctx, userID, "discussion.posted", "academy_discussion", id,
		map[string]any{"scope": req.Scope, "ref_id": req.RefID}, "info")
	return r.GetDiscussion(ctx, id)
}

func (r *Repository) GetDiscussion(ctx context.Context, id string) (*Discussion, error) {
	const q = `
		SELECT id, scope, ref_id, user_id, body, parent_id, state, created_at
		FROM public.academy_discussions WHERE id = $1`
	d := &Discussion{}
	err := r.db.QueryRow(ctx, q, id).Scan(&d.ID, &d.Scope, &d.RefID, &d.UserID, &d.Body, &d.ParentID, &d.State, &d.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return d, nil
}

// ListVisibleDiscussions returns ONLY visible discussions for a scope/ref — hidden
// (moderated) posts are excluded from every member-facing read.
func (r *Repository) ListVisibleDiscussions(ctx context.Context, scope, refID string, limit int) ([]Discussion, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	const q = `
		SELECT id, scope, ref_id, user_id, body, parent_id, state, created_at
		FROM public.academy_discussions
		WHERE scope = $1 AND ref_id = $2 AND state = 'visible'
		ORDER BY created_at ASC LIMIT $3`
	rows, err := r.db.Query(ctx, q, scope, refID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Discussion{}
	for rows.Next() {
		d := Discussion{}
		if err := rows.Scan(&d.ID, &d.Scope, &d.RefID, &d.UserID, &d.Body, &d.ParentID, &d.State, &d.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// HideDiscussion flips a discussion to hidden (moderation). Audited. Idempotent:
// hiding an already-hidden discussion is a no-op that still returns the row.
func (r *Repository) HideDiscussion(ctx context.Context, actor, id string) (*Discussion, error) {
	const q = `UPDATE public.academy_discussions SET state = 'hidden' WHERE id = $1`
	tag, err := r.db.Exec(ctx, q, id)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		// Either missing or already hidden — confirm existence.
		if _, gerr := r.GetDiscussion(ctx, id); gerr != nil {
			return nil, gerr
		}
	}
	_ = r.insertAudit(ctx, actor, "discussion.hidden", "academy_discussion", id, nil, "warning")
	return r.GetDiscussion(ctx, id)
}

// ── Moderation reports ─────────────────────────────────────────────────────────

func (r *Repository) InsertReport(ctx context.Context, reporterID string, req ReportContentRequest) (*ModerationReport, error) {
	id := uuid.New().String()
	var reporterArg any
	if reporterID != "" {
		reporterArg = reporterID
	}
	const q = `
		INSERT INTO public.academy_moderation_reports
			(id, entity_type, entity_id, reporter_id, reason, state, created_at)
		VALUES ($1,$2,$3,$4,$5,'pending',now())`
	if _, err := r.db.Exec(ctx, q, id, req.EntityType, req.EntityID, reporterArg, req.Reason); err != nil {
		return nil, err
	}
	_ = r.insertAudit(ctx, reporterID, "moderation.reported", "academy_moderation_report", id,
		map[string]any{"entity_type": req.EntityType, "entity_id": req.EntityID, "reason": req.Reason}, "info")
	return r.GetReport(ctx, id)
}

func (r *Repository) GetReport(ctx context.Context, id string) (*ModerationReport, error) {
	const q = `
		SELECT id, entity_type, entity_id, reporter_id, reason, state, action, moderator_id, created_at, decided_at
		FROM public.academy_moderation_reports WHERE id = $1`
	return scanReport(r.db.QueryRow(ctx, q, id))
}

func scanReport(row rowScanner) (*ModerationReport, error) {
	m := &ModerationReport{}
	err := row.Scan(&m.ID, &m.EntityType, &m.EntityID, &m.ReporterID, &m.Reason,
		&m.State, &m.Action, &m.ModeratorID, &m.CreatedAt, &m.DecidedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return m, nil
}

func (r *Repository) ListReports(ctx context.Context, state string, limit int) ([]ModerationReport, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	q := `
		SELECT id, entity_type, entity_id, reporter_id, reason, state, action, moderator_id, created_at, decided_at
		FROM public.academy_moderation_reports`
	args := []any{}
	if state != "" {
		args = append(args, state)
		q += fmt.Sprintf(" WHERE state = $%d", len(args))
	}
	args = append(args, limit)
	q += fmt.Sprintf(" ORDER BY created_at ASC LIMIT $%d", len(args))
	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ModerationReport{}
	for rows.Next() {
		m, err := scanReport(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *m)
	}
	return out, rows.Err()
}

// TransitionReport runs a GUARDED moderation-report workflow transition (triage /
// escalate) in ONE transaction, mirroring DecideReport's guarded pattern: it re-reads the
// current state under FOR UPDATE, rejects (and audits) an illegal transition per
// canReport, then flips state + stamps moderator_id. Unlike DecideReport it records no
// action and no decided_at (these are pre-decision workflow steps, not final decisions).
// auditAction is the audit-log action code (e.g. "moderation.triaged").
//
// NOTE: the academy_moderation_reports.state CHECK currently permits only
// pending|actioned|dismissed — persisting 'triaged'/'escalated' requires an additive
// migration widening that CHECK before this path succeeds at the DB layer.
func (r *Repository) TransitionReport(ctx context.Context, moderatorID, reportID string, to ReportState, auditAction string) (*ModerationReport, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var curState ReportState
	var entityType, entityID string
	err = tx.QueryRow(ctx,
		`SELECT state, entity_type, entity_id FROM public.academy_moderation_reports WHERE id = $1 FOR UPDATE`, reportID).
		Scan(&curState, &entityType, &entityID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}

	if !canReport(curState, to) {
		_ = insertAuditTx(ctx, tx, moderatorID, auditAction+"_rejected", "academy_moderation_report", reportID,
			map[string]any{"from": string(curState), "to": string(to), "reason": "illegal_transition"}, "warning")
		_ = tx.Commit(ctx) // persist the rejection audit
		return nil, fmt.Errorf("%w: report %s -> %s", ErrIllegalTransition, curState, to)
	}

	const upd = `
		UPDATE public.academy_moderation_reports
		SET state = $2, moderator_id = $3
		WHERE id = $1 AND state = $4`
	if _, err := tx.Exec(ctx, upd, reportID, string(to), moderatorID, string(curState)); err != nil {
		return nil, err
	}
	if err := insertAuditTx(ctx, tx, moderatorID, auditAction, "academy_moderation_report", reportID,
		map[string]any{"from": string(curState), "to": string(to), "entity_type": entityType, "entity_id": entityID}, "info"); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return r.GetReport(ctx, reportID)
}

// DecideReport resolves a pending report: sets state (actioned/dismissed), action,
// moderator_id and decided_at in ONE guarded transaction (only fires WHERE
// state='pending'). When action='hide' and the report targets a discussion, the
// discussion is flipped to hidden in the SAME transaction. Audited.
func (r *Repository) DecideReport(ctx context.Context, moderatorID, reportID, action string, toState ReportState) (*ModerationReport, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var curState ReportState
	var entityType, entityID string
	err = tx.QueryRow(ctx,
		`SELECT state, entity_type, entity_id FROM public.academy_moderation_reports WHERE id = $1 FOR UPDATE`, reportID).
		Scan(&curState, &entityType, &entityID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}

	if curState != ReportPending {
		_ = insertAuditTx(ctx, tx, moderatorID, "moderation.decide_rejected", "academy_moderation_report", reportID,
			map[string]any{"from": string(curState), "reason": "not_pending"}, "warning")
		_ = tx.Commit(ctx)
		return nil, fmt.Errorf("%w: report not pending (%s)", ErrIllegalTransition, curState)
	}

	const upd = `
		UPDATE public.academy_moderation_reports
		SET state = $2, action = $3, moderator_id = $4, decided_at = $5
		WHERE id = $1 AND state = 'pending'`
	if _, err := tx.Exec(ctx, upd, reportID, string(toState), action, moderatorID, time.Now()); err != nil {
		return nil, err
	}

	// Enforce the action: hide flips the offending discussion to hidden in-tx.
	if action == ActionHide && entityType == "discussion" {
		if _, err := tx.Exec(ctx, `UPDATE public.academy_discussions SET state = 'hidden' WHERE id = $1`, entityID); err != nil {
			return nil, err
		}
	}

	if err := insertAuditTx(ctx, tx, moderatorID, "moderation.decided", "academy_moderation_report", reportID,
		map[string]any{"action": action, "state": string(toState), "entity_type": entityType, "entity_id": entityID}, "info"); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return r.GetReport(ctx, reportID)
}
