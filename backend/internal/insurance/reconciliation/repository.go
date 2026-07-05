package reconciliation

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository persists reconciliation records + commission entries and reads the
// premium transactions it reconciles. All queries are parameterized.
type Repository struct {
	db *pgxpool.Pool
}

// NewRepository constructs the reconciliation repository.
func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

// Sentinel errors.
var (
	ErrNotFound = errors.New("reconciliation: not found")
)

// --- premium read (for matching) ---

// PremiumForPolicy returns the net posted premium (kobo) for a policy: the sum of
// posted DEBITs minus REVERSALs. This is the expected amount a provider statement
// line is matched against.
func (r *Repository) PremiumForPolicy(ctx context.Context, policyID string) (int64, error) {
	var net int64
	err := r.db.QueryRow(ctx, `
		SELECT COALESCE(SUM(
			CASE WHEN direction = 'DEBIT' THEN amount_kobo
			     WHEN direction = 'REVERSAL' THEN -amount_kobo
			     ELSE 0 END), 0)
		FROM public.insurance_premium_transaction
		WHERE policy_id = $1 AND status IN ('posted','reversed')`, policyID).Scan(&net)
	return net, err
}

// ProviderForPolicy returns the aggregator for a policy.
func (r *Repository) ProviderForPolicy(ctx context.Context, policyID string) (string, error) {
	var provider string
	err := r.db.QueryRow(ctx, `SELECT provider FROM public.insurance_policy WHERE id = $1`, policyID).Scan(&provider)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", ErrNotFound
		}
		return "", err
	}
	return provider, nil
}

// --- reconciliation records ---

const recCols = `id, provider, policy_id, premium_tx_id, statement_ref, expected_amount_kobo,
	statement_amount_kobo, status, break_reason, resolution_note, created_at, resolved_at`

func scanRecord(row interface {
	Scan(dest ...any) error
}) (*ReconciliationRecord, error) {
	var rec ReconciliationRecord
	if err := row.Scan(
		&rec.ID, &rec.Provider, &rec.PolicyID, &rec.PremiumTxID, &rec.StatementRef,
		&rec.ExpectedAmountKobo, &rec.StatementAmountKobo, &rec.Status, &rec.BreakReason,
		&rec.ResolutionNote, &rec.CreatedAt, &rec.ResolvedAt,
	); err != nil {
		return nil, err
	}
	return &rec, nil
}

// InsertRecord appends a reconciliation record (match result or break).
func (r *Repository) InsertRecord(ctx context.Context, rec *ReconciliationRecord) (*ReconciliationRecord, error) {
	row := r.db.QueryRow(ctx, `
		INSERT INTO public.insurance_reconciliation_record
			(provider, policy_id, statement_ref, expected_amount_kobo, statement_amount_kobo,
			 status, break_reason)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		RETURNING `+recCols,
		rec.Provider, rec.PolicyID, rec.StatementRef, rec.ExpectedAmountKobo,
		rec.StatementAmountKobo, string(rec.Status), rec.BreakReason)
	return scanRecord(row)
}

// ListRecords returns reconciliation records, optionally filtered by status +
// provider, newest first.
func (r *Repository) ListRecords(ctx context.Context, status, provider string, limit, offset int) ([]ReconciliationRecord, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	q := `SELECT ` + recCols + ` FROM public.insurance_reconciliation_record WHERE 1=1`
	args := []any{}
	n := 0
	if status != "" {
		n++
		q += fmt.Sprintf(" AND status = $%d", n)
		args = append(args, status)
	}
	if provider != "" {
		n++
		q += fmt.Sprintf(" AND provider = $%d", n)
		args = append(args, provider)
	}
	q += fmt.Sprintf(" ORDER BY created_at DESC LIMIT $%d OFFSET $%d", n+1, n+2)
	args = append(args, limit, offset)
	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ReconciliationRecord
	for rows.Next() {
		rec, err := scanRecord(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *rec)
	}
	return out, rows.Err()
}

// GetRecord returns a single reconciliation record.
func (r *Repository) GetRecord(ctx context.Context, id string) (*ReconciliationRecord, error) {
	row := r.db.QueryRow(ctx, `SELECT `+recCols+` FROM public.insurance_reconciliation_record WHERE id = $1`, id)
	rec, err := scanRecord(row)
	if err != nil {
		return nil, ErrNotFound
	}
	return rec, nil
}

// ResolveBreak records an operator resolution for a BREAK record.
func (r *Repository) ResolveBreak(ctx context.Context, id, note string) error {
	ct, err := r.db.Exec(ctx, `
		UPDATE public.insurance_reconciliation_record
		SET status = $2, resolution_note = $3, resolved_at = now()
		WHERE id = $1 AND status = $4`, id, string(StatusResolved), note, string(StatusBreak))
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// --- commission entries ---

const commCols = `id, policy_id, provider, amount_kobo, ledger_ref, idempotency_key, status,
	created_at, updated_at`

func scanCommission(row interface {
	Scan(dest ...any) error
}) (*CommissionEntry, error) {
	var ce CommissionEntry
	if err := row.Scan(
		&ce.ID, &ce.PolicyID, &ce.Provider, &ce.AmountKobo, &ce.LedgerRef,
		&ce.IdempotencyKey, &ce.Status, &ce.CreatedAt, &ce.UpdatedAt,
	); err != nil {
		return nil, err
	}
	return &ce, nil
}

// UpsertCommission records a commission entry (idempotent on idempotency_key).
// On a duplicate key it is a no-op (the entry was already recorded at bind).
func (r *Repository) UpsertCommission(ctx context.Context, ce *CommissionEntry) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.insurance_commission_entry
			(policy_id, provider, amount_kobo, ledger_ref, idempotency_key, status)
		VALUES ($1,$2,$3,$4,$5,$6)
		ON CONFLICT (idempotency_key) DO NOTHING`,
		ce.PolicyID, ce.Provider, ce.AmountKobo, ce.LedgerRef, ce.IdempotencyKey, string(ce.Status))
	return err
}

// GetCommissionByPolicy returns the commission entry for a policy, or ErrNotFound.
func (r *Repository) GetCommissionByPolicy(ctx context.Context, policyID string) (*CommissionEntry, error) {
	row := r.db.QueryRow(ctx, `SELECT `+commCols+` FROM public.insurance_commission_entry WHERE policy_id = $1 LIMIT 1`, policyID)
	ce, err := scanCommission(row)
	if err != nil {
		return nil, ErrNotFound
	}
	return ce, nil
}

// SetCommissionStatus moves a commission entry to a new status (confirm/reverse).
func (r *Repository) SetCommissionStatus(ctx context.Context, id string, to CommissionStatus) error {
	ct, err := r.db.Exec(ctx, `
		UPDATE public.insurance_commission_entry
		SET status = $2, updated_at = now() WHERE id = $1`, id, string(to))
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ListCommission returns commission entries (the commission ledger view),
// optionally filtered by status + provider, newest first.
func (r *Repository) ListCommission(ctx context.Context, status, provider string, limit, offset int) ([]CommissionEntry, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	q := `SELECT ` + commCols + ` FROM public.insurance_commission_entry WHERE 1=1`
	args := []any{}
	n := 0
	if status != "" {
		n++
		q += fmt.Sprintf(" AND status = $%d", n)
		args = append(args, status)
	}
	if provider != "" {
		n++
		q += fmt.Sprintf(" AND provider = $%d", n)
		args = append(args, provider)
	}
	q += fmt.Sprintf(" ORDER BY created_at DESC LIMIT $%d OFFSET $%d", n+1, n+2)
	args = append(args, limit, offset)
	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []CommissionEntry
	for rows.Next() {
		ce, err := scanCommission(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *ce)
	}
	return out, rows.Err()
}

// CommissionTotal returns the sum of commission (kobo) for a status filter — the
// commission ledger view summary.
func (r *Repository) CommissionTotal(ctx context.Context, status, provider string) (int64, error) {
	q := `SELECT COALESCE(SUM(amount_kobo),0) FROM public.insurance_commission_entry WHERE 1=1`
	args := []any{}
	n := 0
	if status != "" {
		n++
		q += fmt.Sprintf(" AND status = $%d", n)
		args = append(args, status)
	}
	if provider != "" {
		n++
		q += fmt.Sprintf(" AND provider = $%d", n)
		args = append(args, provider)
	}
	var total int64
	err := r.db.QueryRow(ctx, q, args...).Scan(&total)
	return total, err
}
