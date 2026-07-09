package feeshardship

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

// Store is the data-access contract the service depends on. Defining it as an in-package
// interface (rather than a concrete *Repository) lets hardship_test.go substitute an
// in-memory fake so the SF-9 human-review workflow is unit-testable with NO live DB —
// mirroring feesschool / feesinvoice isolation.
type Store interface {
	// Insert appends a NEW hardship request. The service always inserts it `pending`
	// (SF-9); this method never sets a terminal status.
	Insert(ctx context.Context, r HardshipRequest) (*HardshipRequest, error)
	Get(ctx context.Context, id string) (*HardshipRequest, error)
	// ListPendingBySchool returns the review queue: all `pending` requests whose invoice
	// belongs to the given school (joined via the invoice → student → school spine).
	ListPendingBySchool(ctx context.Context, schoolID string) ([]HardshipRequest, error)
	// SetReviewed performs the GUARDED review UPDATE: it re-checks status='pending' in the
	// WHERE clause so a concurrent review cannot double-review; returns ErrAlreadyReviewed if
	// the row is no longer pending. It records reviewer + reviewed_at + note + the terminal
	// status (approved/denied). This is the ONLY method that moves a request off `pending`,
	// and it is only ever called from the human Approve/Deny paths.
	SetReviewed(ctx context.Context, id string, reviewerID string, status RequestStatus, note string) (*HardshipRequest, error)
	WriteAudit(ctx context.Context, actorID, action, entityID, from, to string, detail any) error
}

// Repository is the pgx implementation of Store against public.academy_hardship_requests
// (the additive table added by the integration migration — see report for the exact
// columns). Every query is parameterized. This table holds NO money.
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

const hardshipCols = `id, invoice_id, guardian_user_id, reason, requested_at, status, reviewed_by, reviewed_at, review_note`

func scanHardship(row pgx.Row) (*HardshipRequest, error) {
	var r HardshipRequest
	var status string
	if err := row.Scan(&r.ID, &r.InvoiceID, &r.GuardianUserID, &r.Reason, &r.RequestedAt,
		&status, &r.ReviewedBy, &r.ReviewedAt, &r.ReviewNote); err != nil {
		return nil, err
	}
	r.Status = RequestStatus(status)
	return &r, nil
}

// Insert appends a request in `pending` (SF-9 — never a terminal status at insert time).
func (r *Repository) Insert(ctx context.Context, req HardshipRequest) (*HardshipRequest, error) {
	id := uuid.New().String()
	now := time.Now()
	const q = `INSERT INTO academy_hardship_requests
	    (id, invoice_id, guardian_user_id, reason, requested_at, status)
	    VALUES ($1,$2,$3,$4,$5,'pending')`
	if _, err := r.db.Exec(ctx, q, id, req.InvoiceID, req.GuardianUserID, req.Reason, now); err != nil {
		return nil, err
	}
	return r.Get(ctx, id)
}

func (r *Repository) Get(ctx context.Context, id string) (*HardshipRequest, error) {
	q := `SELECT ` + hardshipCols + ` FROM academy_hardship_requests WHERE id = $1`
	out, err := scanHardship(r.db.QueryRow(ctx, q, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return out, err
}

// ListPendingBySchool returns the school's pending review queue, resolving the invoice's
// school via the student spine (academy_invoices → academy_students.school_id).
func (r *Repository) ListPendingBySchool(ctx context.Context, schoolID string) ([]HardshipRequest, error) {
	q := `SELECT ` + prefixCols("h") + `
	           FROM academy_hardship_requests h
	           JOIN academy_invoices i ON i.id = h.invoice_id
	           JOIN academy_students s ON s.id = i.student_id
	           WHERE h.status = 'pending' AND s.school_id = $1
	           ORDER BY h.requested_at ASC`
	rows, err := r.db.Query(ctx, q, schoolID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []HardshipRequest{}
	for rows.Next() {
		hr, err := scanHardship(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *hr)
	}
	return out, rows.Err()
}

// SetReviewed is the GUARDED review UPDATE. WHERE status='pending' means a request that has
// already been reviewed (or was never pending) yields 0 rows → ErrAlreadyReviewed. It is the
// single choke-point that moves a request off `pending`, always driven by a human reviewer.
func (r *Repository) SetReviewed(ctx context.Context, id, reviewerID string, status RequestStatus, note string) (*HardshipRequest, error) {
	now := time.Now()
	const upd = `UPDATE academy_hardship_requests
	             SET status = $2, reviewed_by = $3, reviewed_at = $4, review_note = $5
	             WHERE id = $1 AND status = 'pending'`
	tag, err := r.db.Exec(ctx, upd, id, string(status), nullStr(reviewerID), now, nullStr(note))
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		// Either the row does not exist or it is no longer pending.
		if _, gerr := r.Get(ctx, id); errors.Is(gerr, ErrNotFound) {
			return nil, ErrNotFound
		}
		return nil, ErrAlreadyReviewed
	}
	return r.Get(ctx, id)
}

// WriteAudit writes an immutable audit row (module 'academy.fees') via the shared helper.
func (r *Repository) WriteAudit(ctx context.Context, actorID, action, entityID, from, to string, detail any) error {
	return writeAudit(ctx, r.db, actorID, action, entityID, from, to, detail)
}

// writeAudit reuses public.academy_commerce_audit — the same immutable audit table the
// sibling fees packages write to (actor_id, action, entity_type, entity_id, from_state,
// to_state, detail). The 'academy.fees' module tag lives in the action prefix
// (e.g. 'hardship_request_submitted'). Best-effort at the callsite.
func writeAudit(ctx context.Context, q querier, actorID, action, entityID, from, to string, detail any) error {
	const ins = `INSERT INTO public.academy_commerce_audit
	             (actor_id, action, entity_type, entity_id, from_state, to_state, detail)
	             VALUES ($1,$2,'academy_hardship_request',$3,$4,$5,$6)`
	_, err := q.Exec(ctx, ins, nullStr(actorID), action, nullUUID(entityID), nullStr(from), nullStr(to), toJSON(detail))
	return err
}

// prefixCols returns hardshipCols aliased to a table prefix (for the join query).
func prefixCols(alias string) string {
	return alias + `.id, ` + alias + `.invoice_id, ` + alias + `.guardian_user_id, ` +
		alias + `.reason, ` + alias + `.requested_at, ` + alias + `.status, ` +
		alias + `.reviewed_by, ` + alias + `.reviewed_at, ` + alias + `.review_note`
}

// ── small helpers (kept package-local, mirroring feesschool/helpers.go) ──────────

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
	b, err := json.Marshal(v)
	if err != nil {
		return []byte("{}")
	}
	return b
}
