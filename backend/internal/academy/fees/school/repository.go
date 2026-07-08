package feesschool

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Store is the data-access contract the service depends on. Defining it as an in-package
// interface (rather than a concrete *Repository) lets school_test.go substitute an
// in-memory fake so the guard/verification logic is unit-testable with NO live DB —
// exactly the isolation approach REUSE-MAP/edupay_test.go call for.
type Store interface {
	Insert(ctx context.Context, s School) (*School, error)
	Get(ctx context.Context, id string) (*School, error)
	List(ctx context.Context, ownerUserID string) ([]School, error)
	Update(ctx context.Context, id string, req UpdateSchoolRequest) (*School, error)
	// SetVerificationTier performs a GUARDED tier UPDATE: it re-checks the current tier
	// under FOR UPDATE (WHERE verification_tier=$from) so a concurrent verify cannot
	// double-move; returns ErrIllegalTierMove if the row is no longer at `from`.
	SetVerificationTier(ctx context.Context, id string, from, to VerificationTier) (*School, error)
	// ExportRoster returns the school's students (roster) for SF-10.
	ExportRoster(ctx context.Context, schoolID string) ([]ExportStudent, error)
	// ExportFees returns the school's fee schedules for SF-10.
	ExportFees(ctx context.Context, schoolID string) ([]ExportFee, error)
	WriteAudit(ctx context.Context, actorID, action, entityID, from, to string, detail any) error
}

// Repository is the pgx implementation of Store against public.academy_schools and the
// fees tables. Every query is parameterized; money lives in *_minor bigint columns.
type Repository struct {
	db *pgxpool.Pool
}

// NewRepository builds the pgx-backed Store.
func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

// querier abstracts *pgxpool.Pool and pgx.Tx.
type querier interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

const schoolCols = `id, name, code, level, virtual_account_ref, contact, owner_user_id, verification_tier, status, created_at`

func scanSchool(row pgx.Row) (*School, error) {
	var s School
	var tier string
	err := row.Scan(&s.ID, &s.Name, &s.Code, &s.Level, &s.VirtualAccountRef, &s.Contact,
		&s.OwnerUserID, &tier, &s.Status, &s.CreatedAt)
	if err != nil {
		return nil, err
	}
	s.VerificationTier = VerificationTier(tier)
	return &s, nil
}

func (r *Repository) Insert(ctx context.Context, s School) (*School, error) {
	id := uuid.New().String()
	now := time.Now()
	const q = `INSERT INTO academy_schools
	    (id, name, code, level, virtual_account_ref, contact, owner_user_id, verification_tier, status, created_at)
	    VALUES ($1,$2,$3,$4,$5,$6,$7,'unverified','active',$8)`
	if _, err := r.db.Exec(ctx, q, id, s.Name, nullStr(deref(s.Code)), nullStr(deref(s.Level)),
		nullStr(deref(s.VirtualAccountRef)), nullStr(deref(s.Contact)), nullStr(deref(s.OwnerUserID)), now); err != nil {
		return nil, err
	}
	return r.Get(ctx, id)
}

func (r *Repository) Get(ctx context.Context, id string) (*School, error) {
	q := `SELECT ` + schoolCols + ` FROM academy_schools WHERE id = $1`
	s, err := scanSchool(r.db.QueryRow(ctx, q, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return s, err
}

// List returns schools; when ownerUserID is non-empty it filters to that owner's schools
// (the member-facing "my schools" view). Empty ⇒ all active schools (admin directory).
func (r *Repository) List(ctx context.Context, ownerUserID string) ([]School, error) {
	q := `SELECT ` + schoolCols + ` FROM academy_schools WHERE status = 'active'`
	args := []any{}
	if ownerUserID != "" {
		args = append(args, ownerUserID)
		q += " AND owner_user_id = $1"
	}
	q += " ORDER BY name ASC"
	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []School{}
	for rows.Next() {
		s, err := scanSchool(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *s)
	}
	return out, rows.Err()
}

// Update sets only the descriptive columns supplied (empty string ⇒ leave unchanged via
// COALESCE). It NEVER touches verification_tier or status.
func (r *Repository) Update(ctx context.Context, id string, req UpdateSchoolRequest) (*School, error) {
	const q = `UPDATE academy_schools SET
	    name = COALESCE($2, name),
	    code = COALESCE($3, code),
	    level = COALESCE($4, level),
	    virtual_account_ref = COALESCE($5, virtual_account_ref),
	    contact = COALESCE($6, contact)
	    WHERE id = $1`
	tag, err := r.db.Exec(ctx, q, id, nullStr(req.Name), nullStr(req.Code), nullStr(req.Level),
		nullStr(req.VirtualAccountRef), nullStr(req.Contact))
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	return r.Get(ctx, id)
}

// SetVerificationTier performs the GUARDED tier UPDATE inside a tx. The service has
// already validated the move via VerifyTransition; this re-asserts the precondition at
// the DB (WHERE verification_tier=$from FOR UPDATE) so concurrent verifies can't race.
func (r *Repository) SetVerificationTier(ctx context.Context, id string, from, to VerificationTier) (*School, error) {
	var out *School
	err := r.withTx(ctx, func(tx pgx.Tx) error {
		const sel = `SELECT verification_tier FROM academy_schools WHERE id = $1 FOR UPDATE`
		var cur string
		if err := tx.QueryRow(ctx, sel, id).Scan(&cur); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}
		if VerificationTier(cur) != from {
			return ErrIllegalTierMove
		}
		const upd = `UPDATE academy_schools SET verification_tier = $2 WHERE id = $1 AND verification_tier = $3`
		tag, err := tx.Exec(ctx, upd, id, string(to), string(from))
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return ErrIllegalTierMove
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	out, err = r.Get(ctx, id)
	return out, err
}

func (r *Repository) ExportRoster(ctx context.Context, schoolID string) ([]ExportStudent, error) {
	const q = `SELECT id, admission_number, class_id, status, minor_flag
	           FROM academy_students WHERE school_id = $1 ORDER BY created_at ASC`
	rows, err := r.db.Query(ctx, q, schoolID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ExportStudent{}
	for rows.Next() {
		var e ExportStudent
		if err := rows.Scan(&e.StudentID, &e.AdmissionNumber, &e.ClassID, &e.Status, &e.MinorFlag); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func (r *Repository) ExportFees(ctx context.Context, schoolID string) ([]ExportFee, error) {
	const q = `SELECT id, name, amount_minor, currency, locked
	           FROM academy_fee_schedules WHERE school_id = $1 ORDER BY created_at ASC`
	rows, err := r.db.Query(ctx, q, schoolID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ExportFee{}
	for rows.Next() {
		var e ExportFee
		if err := rows.Scan(&e.FeeScheduleID, &e.Name, &e.AmountMinor, &e.Currency, &e.Locked); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// WriteAudit writes an immutable audit row (module 'academy.fees') to public.audit_logs.
func (r *Repository) WriteAudit(ctx context.Context, actorID, action, entityID, from, to string, detail any) error {
	return writeAudit(ctx, r.db, actorID, action, entityID, from, to, detail)
}

// writeAudit is shared with the tx path. Reuses public.academy_commerce_audit — the exact
// immutable audit table the sibling academy/edupay package writes to (same column shape:
// actor_id, action, entity_type, entity_id, from_state, to_state, detail). The 'academy.fees'
// module tag lives in the action prefix (e.g. 'school_verified'). Best-effort at the callsite.
func writeAudit(ctx context.Context, q querier, actorID, action, entityID, from, to string, detail any) error {
	const ins = `INSERT INTO public.academy_commerce_audit
	             (actor_id, action, entity_type, entity_id, from_state, to_state, detail)
	             VALUES ($1,$2,'academy_school',$3,$4,$5,$6)`
	_, err := q.Exec(ctx, ins, nullStr(actorID), action, nullUUID(entityID), nullStr(from), nullStr(to), toJSON(detail))
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
