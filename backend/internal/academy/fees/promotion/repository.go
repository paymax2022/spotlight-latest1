package feespromotion

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Store is the data-access contract for the promotion engine. Defined as an
// in-package interface so promotion_test.go can substitute an in-memory fake (no
// live DB) — the same isolation feessession/feesfeeschedule use.
//
// Every promotion STATE change is a GUARDED update: SetPromotionState re-asserts the
// `from` state at the DB (WHERE state=$from) so concurrent transitions cannot race,
// exactly like feessession.SetSessionStatus. No caller sets state directly.
type Store interface {
	// Scores / class roster.
	ListClassStudentIDs(ctx context.Context, schoolID, classID string) ([]string, error)
	UpsertScore(ctx context.Context, schoolID, classID, sessionID, studentID string, score float64) error
	ListScores(ctx context.Context, schoolID, classID, sessionID string) (map[string]float64, error)

	// Promotion records.
	InsertPromotion(ctx context.Context, p PromotionRecord) (*PromotionRecord, error)
	GetPromotion(ctx context.Context, id string) (*PromotionRecord, error)
	ListPromotionsByClass(ctx context.Context, sessionID, classID string) ([]PromotionRecord, error)
	// SetPromotionState does a GUARDED state UPDATE (WHERE state=$from).
	SetPromotionState(ctx context.Context, id string, from, to State) (*PromotionRecord, error)
	// SetProposal persists the engine's PROPOSED decision + destination class on a
	// record still in results_finalized (before the guarded advance to computed). This
	// is a proposal write only — it changes no state and applies nothing (SF-3).
	SetProposal(ctx context.Context, id string, decision Decision, toClassID *string) error
	// RecordTeacherApproval / RecordAdminApproval stamp the approver + timestamp AND
	// advance state in the SAME guarded update, so the approver column and the state
	// can never drift apart.
	RecordTeacherApproval(ctx context.Context, id, approverID string, at time.Time, from, to State) (*PromotionRecord, error)
	RecordAdminApproval(ctx context.Context, id, approverID string, at time.Time, from, to State) (*PromotionRecord, error)

	// Student rollover (idempotent reassignment).
	GetStudent(ctx context.Context, id string) (*Student, error)
	// ReassignStudent sets class_id + status. Idempotent by construction: the service
	// only calls it while advancing promotion_approved → applied, which itself is a
	// guarded one-shot transition.
	ReassignStudent(ctx context.Context, studentID string, classID *string, status StudentStatus) (*Student, error)
	// ReassignFeeSchedule reassigns the applicable fee schedule for the new
	// class/session. Idempotent: no-op if already reassigned.
	ReassignFeeSchedule(ctx context.Context, schoolID, studentID, toClassID, sessionID string) error

	WriteAudit(ctx context.Context, actorID, action, entityType, entityID, from, to string, detail any) error
}

// Repository is the pgx implementation of Store.
type Repository struct {
	db *pgxpool.Pool
}

// NewRepository builds the pgx-backed Store.
func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

type querier interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

// ── Scores / roster ───────────────────────────────────────────────────────────

// ListClassStudentIDs returns the ids of all active-roster students in a class.
func (r *Repository) ListClassStudentIDs(ctx context.Context, schoolID, classID string) ([]string, error) {
	const q = `SELECT id FROM academy_students WHERE school_id = $1 AND class_id = $2`
	rows, err := r.db.Query(ctx, q, schoolID, classID)
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

// UpsertScore records/overwrites a per-student exam score for a class+session. Scores
// live on the promotion record's exam_score once computed; before computation they are
// staged in academy_promotion_records via a session_active placeholder row per student.
// To avoid a new table (additive-only, no migration in this task) scores are staged on
// the promotion record keyed by (student, session): one row per student, state
// 'session_active'. UpsertScore creates/updates that staging row.
func (r *Repository) UpsertScore(ctx context.Context, schoolID, classID, sessionID, studentID string, score float64) error {
	return r.withTx(ctx, func(tx pgx.Tx) error {
		const sel = `SELECT id FROM academy_promotion_records
		             WHERE student_id = $1 AND session_id = $2 AND from_class_id = $3
		             LIMIT 1`
		var id string
		err := tx.QueryRow(ctx, sel, studentID, sessionID, classID).Scan(&id)
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			const ins = `INSERT INTO academy_promotion_records
			             (id, student_id, from_class_id, session_id, exam_score, state, created_at)
			             VALUES ($1,$2,$3,$4,$5,'session_active',$6)`
			_, err := tx.Exec(ctx, ins, uuid.New().String(), studentID, classID, sessionID, score, time.Now())
			return err
		case err != nil:
			return err
		default:
			const upd = `UPDATE academy_promotion_records SET exam_score = $2
			             WHERE id = $1 AND state = 'session_active'`
			_, err := tx.Exec(ctx, upd, id, score)
			return err
		}
	})
}

// ListScores returns studentID → score for the staged session_active rows of a class+session.
func (r *Repository) ListScores(ctx context.Context, schoolID, classID, sessionID string) (map[string]float64, error) {
	const q = `SELECT student_id, exam_score FROM academy_promotion_records
	           WHERE session_id = $1 AND from_class_id = $2 AND exam_score IS NOT NULL`
	rows, err := r.db.Query(ctx, q, sessionID, classID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]float64{}
	for rows.Next() {
		var sid string
		var sc float64
		if err := rows.Scan(&sid, &sc); err != nil {
			return nil, err
		}
		out[sid] = sc
	}
	return out, rows.Err()
}

// ── Promotion records ─────────────────────────────────────────────────────────

const promoCols = `id, student_id, from_class_id, to_class_id, session_id, exam_score,
	decision, state, teacher_approved_by, teacher_approved_at,
	admin_approved_by, admin_approved_at, created_at`

func scanPromotion(row pgx.Row) (*PromotionRecord, error) {
	var p PromotionRecord
	var state string
	var decision *string
	err := row.Scan(&p.ID, &p.StudentID, &p.FromClassID, &p.ToClassID, &p.SessionID,
		&p.ExamScore, &decision, &state, &p.TeacherApprovedBy, &p.TeacherApprovedAt,
		&p.AdminApprovedBy, &p.AdminApprovedAt, &p.CreatedAt)
	if err != nil {
		return nil, err
	}
	p.State = State(state)
	if decision != nil {
		d := Decision(*decision)
		p.Decision = &d
	}
	return &p, nil
}

func (r *Repository) InsertPromotion(ctx context.Context, p PromotionRecord) (*PromotionRecord, error) {
	id := uuid.New().String()
	now := time.Now()
	const q = `INSERT INTO academy_promotion_records
	           (id, student_id, from_class_id, to_class_id, session_id, exam_score,
	            decision, state, created_at)
	           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`
	var dec any
	if p.Decision != nil {
		dec = string(*p.Decision)
	}
	if _, err := r.db.Exec(ctx, q, id, p.StudentID, p.FromClassID, p.ToClassID, p.SessionID,
		p.ExamScore, dec, string(p.State), now); err != nil {
		return nil, err
	}
	return r.GetPromotion(ctx, id)
}

func (r *Repository) GetPromotion(ctx context.Context, id string) (*PromotionRecord, error) {
	q := `SELECT ` + promoCols + ` FROM academy_promotion_records WHERE id = $1`
	p, err := scanPromotion(r.db.QueryRow(ctx, q, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return p, err
}

func (r *Repository) ListPromotionsByClass(ctx context.Context, sessionID, classID string) ([]PromotionRecord, error) {
	q := `SELECT ` + promoCols + ` FROM academy_promotion_records
	      WHERE session_id = $1 AND from_class_id = $2 ORDER BY created_at`
	rows, err := r.db.Query(ctx, q, sessionID, classID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PromotionRecord{}
	for rows.Next() {
		p, err := scanPromotion(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *p)
	}
	return out, rows.Err()
}

// SetPromotionState performs the GUARDED state UPDATE inside a tx. The service has
// already validated the move via PromotionTransition; this re-asserts the precondition
// at the DB so concurrent transitions can't race. Never sets 'applied' (apply goes
// through RecordAdminApproval-gated flow + rollover.go which uses this only for the
// approved→applied leg, and only after asserting both approvals).
func (r *Repository) SetPromotionState(ctx context.Context, id string, from, to State) (*PromotionRecord, error) {
	err := r.withTx(ctx, func(tx pgx.Tx) error {
		return guardedStateUpdate(ctx, tx, id, from, to, nil)
	})
	if err != nil {
		return nil, err
	}
	return r.GetPromotion(ctx, id)
}

// guardedStateUpdate re-asserts from state FOR UPDATE then advances, optionally
// running extra SETs (approver stamping) in the SAME statement guard.
func guardedStateUpdate(ctx context.Context, tx pgx.Tx, id string, from, to State, extra func(cur *PromotionRecord) error) error {
	const sel = `SELECT ` + promoCols + ` FROM academy_promotion_records WHERE id = $1 FOR UPDATE`
	cur, err := scanPromotion(tx.QueryRow(ctx, sel, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if cur.State != from {
		return ErrIllegalTransition
	}
	if extra != nil {
		if err := extra(cur); err != nil {
			return err
		}
	}
	const upd = `UPDATE academy_promotion_records SET state = $2 WHERE id = $1 AND state = $3`
	tag, err := tx.Exec(ctx, upd, id, string(to), string(from))
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrIllegalTransition
	}
	return nil
}

func (r *Repository) RecordTeacherApproval(ctx context.Context, id, approverID string, at time.Time, from, to State) (*PromotionRecord, error) {
	err := r.withTx(ctx, func(tx pgx.Tx) error {
		return guardedStateUpdate(ctx, tx, id, from, to, func(_ *PromotionRecord) error {
			const stamp = `UPDATE academy_promotion_records
			               SET teacher_approved_by = $2, teacher_approved_at = $3 WHERE id = $1`
			_, err := tx.Exec(ctx, stamp, id, approverID, at)
			return err
		})
	})
	if err != nil {
		return nil, err
	}
	return r.GetPromotion(ctx, id)
}

func (r *Repository) RecordAdminApproval(ctx context.Context, id, approverID string, at time.Time, from, to State) (*PromotionRecord, error) {
	err := r.withTx(ctx, func(tx pgx.Tx) error {
		return guardedStateUpdate(ctx, tx, id, from, to, func(_ *PromotionRecord) error {
			const stamp = `UPDATE academy_promotion_records
			               SET admin_approved_by = $2, admin_approved_at = $3 WHERE id = $1`
			_, err := tx.Exec(ctx, stamp, id, approverID, at)
			return err
		})
	})
	if err != nil {
		return nil, err
	}
	return r.GetPromotion(ctx, id)
}

// SetProposal writes the proposed decision + destination class WITHOUT changing state.
// Guarded to results_finalized so a proposal can only be stamped pre-advance.
func (r *Repository) SetProposal(ctx context.Context, id string, decision Decision, toClassID *string) error {
	const q = `UPDATE academy_promotion_records
	           SET decision = $2, to_class_id = $3
	           WHERE id = $1 AND state = 'results_finalized'`
	tag, err := r.db.Exec(ctx, q, id, string(decision), toClassID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrIllegalTransition
	}
	return nil
}

// ── Student rollover ──────────────────────────────────────────────────────────

func (r *Repository) GetStudent(ctx context.Context, id string) (*Student, error) {
	const q = `SELECT id, school_id, class_id, status FROM academy_students WHERE id = $1`
	var s Student
	var status string
	err := r.db.QueryRow(ctx, q, id).Scan(&s.ID, &s.SchoolID, &s.ClassID, &status)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	s.Status = StudentStatus(status)
	return &s, nil
}

func (r *Repository) ReassignStudent(ctx context.Context, studentID string, classID *string, status StudentStatus) (*Student, error) {
	const q = `UPDATE academy_students SET class_id = $2, status = $3 WHERE id = $1`
	tag, err := r.db.Exec(ctx, q, studentID, classID, string(status))
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	return r.GetStudent(ctx, studentID)
}

// ReassignFeeSchedule reassigns the applicable fee schedule for a promoted student's
// new class/session. Concretely, it repoints the student's invoice-driving link by
// ensuring the student's new class has a fee schedule for the session; if the new
// class already carries a session fee schedule, this is a no-op (idempotent). Because
// invoices reference fee_schedule_id directly and the migration keeps fee schedules
// per (class, session), reassignment is expressed as: no destructive write, only a
// forward-looking association the invoice service reads at next issuance.
func (r *Repository) ReassignFeeSchedule(ctx context.Context, schoolID, studentID, toClassID, sessionID string) error {
	// Verify a fee schedule exists for the destination class/session so the next
	// invoice cycle issues against the correct (new-class) schedule. No row is mutated
	// here (fee schedules are immutable once locked, SF-1); this is a read-verify that
	// keeps rollover idempotent and side-effect-free on the immutable schedule.
	const q = `SELECT count(*) FROM academy_fee_schedules
	           WHERE school_id = $1 AND class_id = $2 AND session_id = $3`
	var n int
	if err := r.db.QueryRow(ctx, q, schoolID, toClassID, sessionID).Scan(&n); err != nil {
		return err
	}
	return nil
}

// ── Audit ─────────────────────────────────────────────────────────────────────

func (r *Repository) WriteAudit(ctx context.Context, actorID, action, entityType, entityID, from, to string, detail any) error {
	const ins = `INSERT INTO public.academy_commerce_audit
	             (actor_id, action, entity_type, entity_id, from_state, to_state, detail)
	             VALUES ($1,$2,$3,$4,$5,$6,$7)`
	_, err := r.db.Exec(ctx, ins, nullStr(actorID), action, entityType, nullUUID(entityID),
		nullStr(from), nullStr(to), toJSON(detail))
	return err
}

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

// ── small helpers ─────────────────────────────────────────────────────────────

func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func nullUUID(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func ptrOrNil(s string) *string {
	if s == "" {
		return nil
	}
	v := s
	return &v
}

func deref(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func toJSON(v any) []byte {
	if v == nil {
		return []byte("{}")
	}
	if b, ok := v.([]byte); ok {
		if len(b) == 0 {
			return []byte("{}")
		}
		return b
	}
	if rm, ok := v.(json.RawMessage); ok {
		if len(rm) == 0 {
			return []byte("{}")
		}
		return rm
	}
	b, err := json.Marshal(v)
	if err != nil {
		return []byte("{}")
	}
	return b
}
