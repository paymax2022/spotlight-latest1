package feesfeeschedule

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

// Store is the data-access contract for fee schedules. Defined as an in-package interface
// so feeschedule_test.go can substitute an in-memory fake and exercise the SF-1
// immutability guard without a live DB (mirrors edupay_test.go isolation).
type Store interface {
	Insert(ctx context.Context, fs FeeSchedule, dueDate *time.Time) (*FeeSchedule, error)
	Get(ctx context.Context, id string) (*FeeSchedule, error)
	List(ctx context.Context, schoolID, sessionID, classID string) ([]FeeSchedule, error)
	// CountReferencingInvoices returns how many academy_invoices rows reference this
	// schedule. > 0 means the schedule is referenced and thus immutable (SF-1).
	CountReferencingInvoices(ctx context.Context, feeScheduleID string) (int64, error)
	// UpdateMutable edits ONLY name / due_date, and ONLY when the row is not locked
	// (guarded WHERE locked = false); returns ErrFeeScheduleImmutable if locked.
	UpdateMutable(ctx context.Context, id, name string, dueDate *time.Time, touchDueDate bool) (*FeeSchedule, error)
	// Lock sets locked = true (idempotent). Called when the first invoice issues (the
	// cross-service call is E2's invoice service; exposed here so this package owns the flag).
	Lock(ctx context.Context, id string) (*FeeSchedule, error)
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

const feeCols = `id, school_id, session_id, class_id, class_code, term, name, amount_minor, currency,
	fee_items, installment_policy, locked, due_date, status, created_at`

func scanFeeSchedule(row pgx.Row) (*FeeSchedule, error) {
	f := &FeeSchedule{Currency: "NGN"}
	var feeItems, installment []byte
	err := row.Scan(&f.ID, &f.SchoolID, &f.SessionID, &f.ClassID, &f.ClassCode, &f.Term, &f.Name,
		&f.AmountMinor, &f.Currency, &feeItems, &installment, &f.Locked, &f.DueDate, &f.Status, &f.CreatedAt)
	if err != nil {
		return nil, err
	}
	f.FeeItems = rawOrEmptyArray(feeItems)
	f.InstallmentPolicy = rawOrEmptyObject(installment)
	return f, nil
}

// Insert creates a fee schedule (locked=false). fee_items + installment_policy are set
// here at creation time only (SF-6). Status starts 'active'.
func (r *Repository) Insert(ctx context.Context, fs FeeSchedule, dueDate *time.Time) (*FeeSchedule, error) {
	id := uuid.New().String()
	now := time.Now()
	currency := fs.Currency
	if currency == "" {
		currency = "NGN"
	}
	const q = `INSERT INTO academy_fee_schedules
	    (id, school_id, session_id, class_id, class_code, term, name, amount_minor, currency,
	     fee_items, installment_policy, locked, due_date, status, created_at)
	    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,false,$12,'active',$13)`
	if _, err := r.db.Exec(ctx, q, id, fs.SchoolID, nullStr(deref(fs.SessionID)), nullStr(deref(fs.ClassID)),
		nullStr(deref(fs.ClassCode)), nullStr(deref(fs.Term)), fs.Name, fs.AmountMinor, currency,
		toJSONArray(fs.FeeItems), toJSONObject(fs.InstallmentPolicy), dueDate, now); err != nil {
		return nil, err
	}
	return r.Get(ctx, id)
}

func (r *Repository) Get(ctx context.Context, id string) (*FeeSchedule, error) {
	q := `SELECT ` + feeCols + ` FROM academy_fee_schedules WHERE id = $1`
	f, err := scanFeeSchedule(r.db.QueryRow(ctx, q, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return f, err
}

// List filters by school (required) and optionally session/class.
func (r *Repository) List(ctx context.Context, schoolID, sessionID, classID string) ([]FeeSchedule, error) {
	q := `SELECT ` + feeCols + ` FROM academy_fee_schedules WHERE school_id = $1`
	args := []any{schoolID}
	if sessionID != "" {
		args = append(args, sessionID)
		q += " AND session_id = $" + itoa(len(args))
	}
	if classID != "" {
		args = append(args, classID)
		q += " AND class_id = $" + itoa(len(args))
	}
	q += " ORDER BY created_at DESC"
	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []FeeSchedule{}
	for rows.Next() {
		f, err := scanFeeSchedule(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *f)
	}
	return out, rows.Err()
}

// CountReferencingInvoices counts academy_invoices rows pointing at this schedule. This is
// the SF-1 "already referenced" signal (independent of the `locked` flag) — even a draft
// invoice referencing the schedule makes it immutable.
func (r *Repository) CountReferencingInvoices(ctx context.Context, feeScheduleID string) (int64, error) {
	const q = `SELECT COUNT(*) FROM academy_invoices WHERE fee_schedule_id = $1`
	var n int64
	if err := r.db.QueryRow(ctx, q, feeScheduleID).Scan(&n); err != nil {
		return 0, err
	}
	return n, nil
}

// UpdateMutable edits ONLY name (and optionally due_date) and ONLY on an UNLOCKED row.
// The `WHERE locked = false` clause is a DB-level backstop for SF-1; when it matches zero
// rows the service maps it to ErrFeeScheduleImmutable. fee_items / installment_policy /
// amount are never touched here (SF-6).
func (r *Repository) UpdateMutable(ctx context.Context, id, name string, dueDate *time.Time, touchDueDate bool) (*FeeSchedule, error) {
	// Distinguish "not found" from "locked" so the service returns the right sentinel.
	cur, err := r.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	if cur.Locked {
		return nil, ErrFeeScheduleImmutable
	}
	q := `UPDATE academy_fee_schedules SET name = COALESCE($2, name)`
	args := []any{id, nullStr(name)}
	if touchDueDate {
		args = append(args, dueDate)
		q += ", due_date = $" + itoa(len(args))
	}
	q += " WHERE id = $1 AND locked = false"
	tag, err := r.db.Exec(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		// Row exists (checked above) but locked flipped true concurrently ⇒ immutable.
		return nil, ErrFeeScheduleImmutable
	}
	return r.Get(ctx, id)
}

// Lock sets locked = true. Idempotent: re-locking an already-locked schedule is a no-op.
func (r *Repository) Lock(ctx context.Context, id string) (*FeeSchedule, error) {
	const q = `UPDATE academy_fee_schedules SET locked = true WHERE id = $1`
	tag, err := r.db.Exec(ctx, q, id)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	return r.Get(ctx, id)
}

func (r *Repository) WriteAudit(ctx context.Context, actorID, action, entityID, from, to string, detail any) error {
	return writeAudit(ctx, r.db, actorID, action, entityID, from, to, detail)
}

// writeAudit reuses public.academy_commerce_audit (the sibling edupay audit table).
func writeAudit(ctx context.Context, q querier, actorID, action, entityID, from, to string, detail any) error {
	const ins = `INSERT INTO public.academy_commerce_audit
	             (actor_id, action, entity_type, entity_id, from_state, to_state, detail)
	             VALUES ($1,$2,'academy_fee_schedule',$3,$4,$5,$6)`
	_, err := q.Exec(ctx, ins, nullStr(actorID), action, nullUUID(entityID), nullStr(from), nullStr(to), toJSONObject(nil, detail))
	return err
}

// ── helpers ─────────────────────────────────────────────────────────────────────

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

func rawOrEmptyArray(b []byte) json.RawMessage {
	if len(b) == 0 {
		return json.RawMessage("[]")
	}
	return json.RawMessage(b)
}

// toJSONArray marshals fee_items, defaulting to a JSON array literal.
func toJSONArray(rm json.RawMessage) []byte {
	if len(rm) == 0 {
		return []byte("[]")
	}
	return rm
}

// toJSONObject marshals installment_policy (or an arbitrary detail via the variadic form),
// defaulting to a JSON object literal.
func toJSONObject(rm json.RawMessage, detail ...any) []byte {
	if len(detail) == 1 {
		if detail[0] == nil {
			return []byte("{}")
		}
		b, err := json.Marshal(detail[0])
		if err != nil {
			return []byte("{}")
		}
		return b
	}
	if len(rm) == 0 {
		return []byte("{}")
	}
	return rm
}

// itoa is a tiny dependency-free int→string for positional placeholders.
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[i:])
}
