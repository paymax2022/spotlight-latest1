package feessession

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

// Store is the data-access contract for sessions + classes. Defined as an in-package
// interface so session_test.go can substitute an in-memory fake (no live DB) — the same
// isolation edupay_test.go uses.
type Store interface {
	// Sessions.
	InsertSession(ctx context.Context, s AcademicSession) (*AcademicSession, error)
	GetSession(ctx context.Context, id string) (*AcademicSession, error)
	ListSessions(ctx context.Context, schoolID string) ([]AcademicSession, error)
	// SetSessionStatus does a GUARDED status UPDATE (WHERE status=$from FOR UPDATE).
	SetSessionStatus(ctx context.Context, id string, from, to SessionStatus) (*AcademicSession, error)
	// Classes.
	InsertClass(ctx context.Context, c Class) (*Class, error)
	GetClass(ctx context.Context, id string) (*Class, error)
	ListClasses(ctx context.Context, schoolID, sessionID string) ([]Class, error)
	UpdateClass(ctx context.Context, id string, req UpdateClassRequest) (*Class, error)
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

// ── Sessions ────────────────────────────────────────────────────────────────────

const sessionCols = `id, school_id, name, term_structure, start_date, end_date, status, created_at`

func scanSession(row pgx.Row) (*AcademicSession, error) {
	var s AcademicSession
	var status string
	var term []byte
	err := row.Scan(&s.ID, &s.SchoolID, &s.Name, &term, &s.StartDate, &s.EndDate, &status, &s.CreatedAt)
	if err != nil {
		return nil, err
	}
	s.Status = SessionStatus(status)
	s.TermStructure = rawOrEmptyObject(term)
	return &s, nil
}

func (r *Repository) InsertSession(ctx context.Context, s AcademicSession) (*AcademicSession, error) {
	id := uuid.New().String()
	now := time.Now()
	const q = `INSERT INTO academy_sessions (id, school_id, name, term_structure, start_date, end_date, status, created_at)
	           VALUES ($1,$2,$3,$4,$5,$6,'active',$7)`
	if _, err := r.db.Exec(ctx, q, id, s.SchoolID, s.Name, toJSON(s.TermStructure), s.StartDate, s.EndDate, now); err != nil {
		return nil, err
	}
	return r.GetSession(ctx, id)
}

func (r *Repository) GetSession(ctx context.Context, id string) (*AcademicSession, error) {
	q := `SELECT ` + sessionCols + ` FROM academy_sessions WHERE id = $1`
	s, err := scanSession(r.db.QueryRow(ctx, q, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return s, err
}

func (r *Repository) ListSessions(ctx context.Context, schoolID string) ([]AcademicSession, error) {
	q := `SELECT ` + sessionCols + ` FROM academy_sessions WHERE school_id = $1 ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, schoolID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AcademicSession{}
	for rows.Next() {
		s, err := scanSession(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *s)
	}
	return out, rows.Err()
}

// SetSessionStatus performs the GUARDED status UPDATE inside a tx. The service has
// already validated the move via SessionTransition; this re-asserts the precondition at
// the DB so concurrent status changes can't race.
func (r *Repository) SetSessionStatus(ctx context.Context, id string, from, to SessionStatus) (*AcademicSession, error) {
	err := r.withTx(ctx, func(tx pgx.Tx) error {
		const sel = `SELECT status FROM academy_sessions WHERE id = $1 FOR UPDATE`
		var cur string
		if err := tx.QueryRow(ctx, sel, id).Scan(&cur); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}
		if SessionStatus(cur) != from {
			return ErrIllegalTransition
		}
		const upd = `UPDATE academy_sessions SET status = $2 WHERE id = $1 AND status = $3`
		tag, err := tx.Exec(ctx, upd, id, string(to), string(from))
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return ErrIllegalTransition
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return r.GetSession(ctx, id)
}

// ── Classes ─────────────────────────────────────────────────────────────────────

const classCols = `id, school_id, session_id, name, level, class_teacher_user_id, created_at`

func scanClass(row pgx.Row) (*Class, error) {
	var c Class
	err := row.Scan(&c.ID, &c.SchoolID, &c.SessionID, &c.Name, &c.Level, &c.ClassTeacherUserID, &c.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &c, nil
}

func (r *Repository) InsertClass(ctx context.Context, c Class) (*Class, error) {
	id := uuid.New().String()
	now := time.Now()
	const q = `INSERT INTO academy_fee_classes (id, school_id, session_id, name, level, class_teacher_user_id, created_at)
	           VALUES ($1,$2,$3,$4,$5,$6,$7)`
	if _, err := r.db.Exec(ctx, q, id, c.SchoolID, nullStr(deref(c.SessionID)), c.Name,
		nullStr(deref(c.Level)), nullStr(deref(c.ClassTeacherUserID)), now); err != nil {
		return nil, err
	}
	return r.GetClass(ctx, id)
}

func (r *Repository) GetClass(ctx context.Context, id string) (*Class, error) {
	q := `SELECT ` + classCols + ` FROM academy_fee_classes WHERE id = $1`
	c, err := scanClass(r.db.QueryRow(ctx, q, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return c, err
}

// ListClasses filters by school (required) and optionally session.
func (r *Repository) ListClasses(ctx context.Context, schoolID, sessionID string) ([]Class, error) {
	q := `SELECT ` + classCols + ` FROM academy_fee_classes WHERE school_id = $1`
	args := []any{schoolID}
	if sessionID != "" {
		args = append(args, sessionID)
		q += " AND session_id = $2"
	}
	q += " ORDER BY created_at DESC"
	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Class{}
	for rows.Next() {
		c, err := scanClass(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *c)
	}
	return out, rows.Err()
}

func (r *Repository) UpdateClass(ctx context.Context, id string, req UpdateClassRequest) (*Class, error) {
	const q = `UPDATE academy_fee_classes SET
	    name = COALESCE($2, name),
	    level = COALESCE($3, level),
	    class_teacher_user_id = COALESCE($4, class_teacher_user_id)
	    WHERE id = $1`
	tag, err := r.db.Exec(ctx, q, id, nullStr(req.Name), nullStr(req.Level), nullStr(req.ClassTeacherUserID))
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	return r.GetClass(ctx, id)
}

// ── Audit ───────────────────────────────────────────────────────────────────────

func (r *Repository) WriteAudit(ctx context.Context, actorID, action, entityType, entityID, from, to string, detail any) error {
	return writeAudit(ctx, r.db, actorID, action, entityType, entityID, from, to, detail)
}

// writeAudit reuses public.academy_commerce_audit (the sibling edupay audit table).
func writeAudit(ctx context.Context, q querier, actorID, action, entityType, entityID, from, to string, detail any) error {
	const ins = `INSERT INTO public.academy_commerce_audit
	             (actor_id, action, entity_type, entity_id, from_state, to_state, detail)
	             VALUES ($1,$2,$3,$4,$5,$6,$7)`
	_, err := q.Exec(ctx, ins, nullStr(actorID), action, entityType, nullUUID(entityID), nullStr(from), nullStr(to), toJSON(detail))
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

func deref(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func ptrOrNil(s string) *string {
	if s == "" {
		return nil
	}
	v := s
	return &v
}

func rawOrEmptyObject(b []byte) json.RawMessage {
	if len(b) == 0 {
		return json.RawMessage("{}")
	}
	return json.RawMessage(b)
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
