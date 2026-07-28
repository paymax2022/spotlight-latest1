package feesstudent

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Store is the data-access contract for students + guardian links. Defined as an
// in-package interface so student_test.go can substitute an in-memory fake (no live DB) —
// the same isolation edupay_test.go / feeschedule_test.go use.
//
// NOTE ON GUARDIAN REUSE: none of these methods insert an identity row. AddGuardian /
// RemoveGuardian only mutate the academy_students.guardian_user_ids[] array — the
// guardian must already exist as an auth.users identity (validated in the service via the
// injected identityChecker). This package has no INSERT into auth.users / academy_roles /
// any identity table.
type Store interface {
	// Insert creates a student. Returns ErrAdmissionNumberTaken on the UNIQUE
	// (school_id, admission_number) violation (per-school uniqueness, SF).
	Insert(ctx context.Context, s Student) (*Student, error)
	Get(ctx context.Context, id string) (*Student, error)
	List(ctx context.Context, schoolID, classID string) ([]Student, error)
	// ExistsAdmissionNumber reports whether (school_id, admission_number) already exists.
	// Used for a friendly pre-check before Insert (the DB UNIQUE is the real guard).
	ExistsAdmissionNumber(ctx context.Context, schoolID, admissionNumber string) (bool, error)
	// SetGuardians replaces the guardian_user_ids[] array for a student (link/unlink).
	SetGuardians(ctx context.Context, id string, guardianUserIDs []string) (*Student, error)
	WriteAudit(ctx context.Context, actorID, action, entityID, from, to string, detail any) error
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

const studentCols = `id, school_id, class_id, edupay_account_id, admission_number, student_user_id,
	guardian_user_ids, status, minor_flag, created_at`

func scanStudent(row pgx.Row) (*Student, error) {
	var s Student
	var status string
	var guardians []string
	err := row.Scan(&s.ID, &s.SchoolID, &s.ClassID, &s.EduPayAccountID, &s.AdmissionNumber,
		&s.StudentUserID, &guardians, &status, &s.MinorFlag, &s.CreatedAt)
	if err != nil {
		return nil, err
	}
	if guardians == nil {
		guardians = []string{}
	}
	s.GuardianUserIDs = guardians
	s.Status = StudentStatus(status)
	return &s, nil
}

// uniqueViolation reports whether err is a Postgres unique_violation (SQLSTATE 23505),
// which for academy_students means the (school_id, admission_number) UNIQUE was hit.
func uniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code == "23505"
	}
	return false
}

func (r *Repository) Insert(ctx context.Context, s Student) (*Student, error) {
	id := uuid.New().String()
	now := time.Now()
	guardians := s.GuardianUserIDs
	if guardians == nil {
		guardians = []string{}
	}
	const q = `INSERT INTO academy_students
	    (id, school_id, class_id, edupay_account_id, admission_number, student_user_id,
	     guardian_user_ids, status, minor_flag, created_at)
	    VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8,$9)`
	_, err := r.db.Exec(ctx, q, id, s.SchoolID, nullStr(deref(s.ClassID)), nullStr(deref(s.EduPayAccountID)),
		nullStr(deref(s.AdmissionNumber)), nullStr(deref(s.StudentUserID)), guardians, s.MinorFlag, now)
	if err != nil {
		if uniqueViolation(err) {
			return nil, ErrAdmissionNumberTaken
		}
		return nil, err
	}
	return r.Get(ctx, id)
}

func (r *Repository) Get(ctx context.Context, id string) (*Student, error) {
	q := `SELECT ` + studentCols + ` FROM academy_students WHERE id = $1`
	s, err := scanStudent(r.db.QueryRow(ctx, q, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return s, err
}

// List filters by school (required) and optionally class.
func (r *Repository) List(ctx context.Context, schoolID, classID string) ([]Student, error) {
	q := `SELECT ` + studentCols + ` FROM academy_students WHERE school_id = $1`
	args := []any{schoolID}
	if classID != "" {
		args = append(args, classID)
		q += " AND class_id = $2"
	}
	q += " ORDER BY created_at DESC"
	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Student{}
	for rows.Next() {
		s, err := scanStudent(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *s)
	}
	return out, rows.Err()
}

func (r *Repository) ExistsAdmissionNumber(ctx context.Context, schoolID, admissionNumber string) (bool, error) {
	if strings.TrimSpace(admissionNumber) == "" {
		return false, nil
	}
	const q = `SELECT EXISTS(SELECT 1 FROM academy_students WHERE school_id = $1 AND admission_number = $2)`
	var exists bool
	if err := r.db.QueryRow(ctx, q, schoolID, admissionNumber).Scan(&exists); err != nil {
		return false, err
	}
	return exists, nil
}

// SetGuardians replaces the guardian_user_ids[] array atomically. No identity is created —
// the array holds references to EXISTING auth.users ids.
func (r *Repository) SetGuardians(ctx context.Context, id string, guardianUserIDs []string) (*Student, error) {
	if guardianUserIDs == nil {
		guardianUserIDs = []string{}
	}
	const q = `UPDATE academy_students SET guardian_user_ids = $2 WHERE id = $1`
	tag, err := r.db.Exec(ctx, q, id, guardianUserIDs)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	return r.Get(ctx, id)
}

// ── Audit ───────────────────────────────────────────────────────────────────────

func (r *Repository) WriteAudit(ctx context.Context, actorID, action, entityID, from, to string, detail any) error {
	return writeAudit(ctx, r.db, actorID, action, entityID, from, to, detail)
}

// writeAudit reuses public.academy_commerce_audit (the sibling edupay/fees audit table).
func writeAudit(ctx context.Context, q querier, actorID, action, entityID, from, to string, detail any) error {
	const ins = `INSERT INTO public.academy_commerce_audit
	             (actor_id, action, entity_type, entity_id, from_state, to_state, detail)
	             VALUES ($1,$2,'academy_student',$3,$4,$5,$6)`
	_, err := q.Exec(ctx, ins, nullStr(actorID), action, nullUUID(entityID), nullStr(from), nullStr(to), toJSON(detail))
	return err
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
