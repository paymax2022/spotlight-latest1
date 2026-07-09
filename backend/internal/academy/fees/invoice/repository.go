package feesinvoice

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	feesstatemachine "spotlight/backend/internal/academy/fees/statemachine"
)

// Store is the data-access contract for invoices + invoice payments. Defined as an
// in-package interface so invoice_test.go can substitute an in-memory fake (no live DB),
// mirroring feeschedule_test.go / edupay_test.go isolation.
//
// SF-2 STRUCTURAL GUARANTEE: this interface has NO method that sets a balance/amount_paid
// column, because academy_invoices HAS no such column. Balance is only ever read via
// SumSucceededPayments. The only writes to the payment table are APPENDS (AppendPayment).
type Store interface {
	InsertInvoice(ctx context.Context, inv Invoice, dueDate *time.Time) (*Invoice, error)
	GetInvoice(ctx context.Context, id string) (*Invoice, error)
	ListInvoicesByStudent(ctx context.Context, studentID string) ([]Invoice, error)
	// SetInvoiceStatus does a GUARDED status UPDATE (WHERE status=$from). Status ONLY —
	// there is intentionally no balance/amount_paid write path (SF-2).
	SetInvoiceStatus(ctx context.Context, id string, from, to feesstatemachine.InvoiceState, setIssuedAt bool) (*Invoice, error)

	// AppendPayment inserts an immutable payment row. Idempotent on the globally-UNIQUE
	// idempotency_key: on replay it returns the EXISTING row and inserted=false (never a
	// second insert). This is the money-path idempotency guarantee.
	AppendPayment(ctx context.Context, p Payment) (row *Payment, inserted bool, err error)
	GetPaymentByIdempotencyKey(ctx context.Context, idempotencyKey string) (*Payment, error)
	// SumSucceededPayments is the SF-2 derived amount_paid: SUM(amount_minor) over
	// academy_invoice_payments WHERE invoice_id=$1 AND status='succeeded'.
	SumSucceededPayments(ctx context.Context, invoiceID string) (int64, error)
	ListPayments(ctx context.Context, invoiceID string) ([]Payment, error)

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

// invoiceCols deliberately does NOT include a balance or amount_paid column — those do not
// exist on academy_invoices (SF-2). Balance/AmountPaidMinor are derived by the service.
const invoiceCols = `id, student_id, fee_schedule_id, total_amount_minor, due_date, status, issued_at, created_at`

func scanInvoice(row pgx.Row) (*Invoice, error) {
	var inv Invoice
	var status string
	err := row.Scan(&inv.ID, &inv.StudentID, &inv.FeeScheduleID, &inv.TotalAmountMinor,
		&inv.DueDate, &status, &inv.IssuedAt, &inv.CreatedAt)
	if err != nil {
		return nil, err
	}
	inv.Status = feesstatemachine.InvoiceState(status)
	return &inv, nil
}

// InsertInvoice creates an invoice (status 'draft'). No balance column is written.
func (r *Repository) InsertInvoice(ctx context.Context, inv Invoice, dueDate *time.Time) (*Invoice, error) {
	id := uuid.New().String()
	now := time.Now()
	status := inv.Status
	if status == "" {
		status = feesstatemachine.InvoiceDraft
	}
	const q = `INSERT INTO academy_invoices
	    (id, student_id, fee_schedule_id, total_amount_minor, due_date, status, created_at)
	    VALUES ($1,$2,$3,$4,$5,$6,$7)`
	if _, err := r.db.Exec(ctx, q, id, inv.StudentID, inv.FeeScheduleID, inv.TotalAmountMinor,
		dueDate, string(status), now); err != nil {
		return nil, err
	}
	return r.GetInvoice(ctx, id)
}

func (r *Repository) GetInvoice(ctx context.Context, id string) (*Invoice, error) {
	q := `SELECT ` + invoiceCols + ` FROM academy_invoices WHERE id = $1`
	inv, err := scanInvoice(r.db.QueryRow(ctx, q, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return inv, err
}

func (r *Repository) ListInvoicesByStudent(ctx context.Context, studentID string) ([]Invoice, error) {
	q := `SELECT ` + invoiceCols + ` FROM academy_invoices WHERE student_id = $1 ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, studentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Invoice{}
	for rows.Next() {
		inv, err := scanInvoice(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *inv)
	}
	return out, rows.Err()
}

// SetInvoiceStatus performs the GUARDED status UPDATE inside a tx. The service has already
// validated the move via feesstatemachine.InvoiceTransition; this re-asserts the precondition
// at the DB so concurrent transitions can't race. STATUS ONLY — no money column touched.
func (r *Repository) SetInvoiceStatus(ctx context.Context, id string, from, to feesstatemachine.InvoiceState, setIssuedAt bool) (*Invoice, error) {
	err := r.withTx(ctx, func(tx pgx.Tx) error {
		const sel = `SELECT status FROM academy_invoices WHERE id = $1 FOR UPDATE`
		var cur string
		if err := tx.QueryRow(ctx, sel, id).Scan(&cur); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}
		if feesstatemachine.InvoiceState(cur) != from {
			return ErrIllegalTransition
		}
		q := `UPDATE academy_invoices SET status = $2`
		if setIssuedAt {
			q += `, issued_at = now()`
		}
		q += ` WHERE id = $1 AND status = $3`
		tag, err := tx.Exec(ctx, q, id, string(to), string(from))
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
	return r.GetInvoice(ctx, id)
}

// AppendPayment inserts one immutable payment row. Idempotent on the globally-UNIQUE
// idempotency_key (ON CONFLICT DO NOTHING): a replay inserts nothing and returns the
// existing row with inserted=false. NEVER a second insert (money-path invariant).
func (r *Repository) AppendPayment(ctx context.Context, p Payment) (*Payment, bool, error) {
	id := uuid.New().String()
	now := time.Now()
	status := p.Status
	if status == "" {
		status = PaymentSucceeded
	}
	const ins = `INSERT INTO academy_invoice_payments
	    (id, invoice_id, guardian_user_id, amount_minor, gateway_ref, ledger_reference, status, idempotency_key, created_at)
	    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
	    ON CONFLICT (idempotency_key) DO NOTHING`
	tag, err := r.db.Exec(ctx, ins, id, p.InvoiceID, p.GuardianUserID, p.AmountMinor,
		nullStr(deref(p.GatewayRef)), nullStr(deref(p.LedgerReference)), string(status), p.IdempotencyKey, now)
	if err != nil {
		return nil, false, err
	}
	if tag.RowsAffected() == 0 {
		// Replay: return the existing row for this idempotency key.
		ex, gerr := r.GetPaymentByIdempotencyKey(ctx, p.IdempotencyKey)
		return ex, false, gerr
	}
	inserted := &Payment{
		ID: id, InvoiceID: p.InvoiceID, GuardianUserID: p.GuardianUserID, AmountMinor: p.AmountMinor,
		GatewayRef: ptrOrNil(deref(p.GatewayRef)), LedgerReference: ptrOrNil(deref(p.LedgerReference)),
		Status: status, IdempotencyKey: p.IdempotencyKey, CreatedAt: now,
	}
	return inserted, true, nil
}

func (r *Repository) GetPaymentByIdempotencyKey(ctx context.Context, idempotencyKey string) (*Payment, error) {
	const q = `SELECT id, invoice_id, guardian_user_id, amount_minor, gateway_ref, ledger_reference,
	                  status, idempotency_key, created_at
	           FROM academy_invoice_payments WHERE idempotency_key = $1`
	p, err := scanPayment(r.db.QueryRow(ctx, q, idempotencyKey))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return p, err
}

// SumSucceededPayments is the SF-2 derived amount_paid. There is no cached column; this SUM
// over the append-only payment rows is the single source of truth.
func (r *Repository) SumSucceededPayments(ctx context.Context, invoiceID string) (int64, error) {
	const q = `SELECT COALESCE(SUM(amount_minor), 0) FROM academy_invoice_payments
	           WHERE invoice_id = $1 AND status = 'succeeded'`
	var sum int64
	if err := r.db.QueryRow(ctx, q, invoiceID).Scan(&sum); err != nil {
		return 0, err
	}
	return sum, nil
}

func (r *Repository) ListPayments(ctx context.Context, invoiceID string) ([]Payment, error) {
	const q = `SELECT id, invoice_id, guardian_user_id, amount_minor, gateway_ref, ledger_reference,
	                  status, idempotency_key, created_at
	           FROM academy_invoice_payments WHERE invoice_id = $1 ORDER BY created_at ASC`
	rows, err := r.db.Query(ctx, q, invoiceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Payment{}
	for rows.Next() {
		p, err := scanPayment(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *p)
	}
	return out, rows.Err()
}

func scanPayment(row pgx.Row) (*Payment, error) {
	var p Payment
	var status string
	err := row.Scan(&p.ID, &p.InvoiceID, &p.GuardianUserID, &p.AmountMinor, &p.GatewayRef,
		&p.LedgerReference, &status, &p.IdempotencyKey, &p.CreatedAt)
	if err != nil {
		return nil, err
	}
	p.Status = PaymentStatus(status)
	return &p, nil
}

// ── Audit ───────────────────────────────────────────────────────────────────────

func (r *Repository) WriteAudit(ctx context.Context, actorID, action, entityID, from, to string, detail any) error {
	return writeAudit(ctx, r.db, actorID, action, entityID, from, to, detail)
}

// writeAudit reuses public.academy_commerce_audit (the sibling edupay/fees audit table).
func writeAudit(ctx context.Context, q querier, actorID, action, entityID, from, to string, detail any) error {
	const ins = `INSERT INTO public.academy_commerce_audit
	             (actor_id, action, entity_type, entity_id, from_state, to_state, detail)
	             VALUES ($1,$2,'academy_invoice',$3,$4,$5,$6)`
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
