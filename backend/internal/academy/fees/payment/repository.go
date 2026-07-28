package feespayment

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// IntentRepository is the pgx-backed IntentStore over public.academy_payment_intents.
// It lives INSIDE this package because IntentStore's method set references the
// unexported intentRecord type, so it cannot be implemented from another package.
// It persists only the thin reference→(invoice, guardian, amount, key) mapping — no
// money state; the ledger + academy_invoice_payments remain the sources of truth.
type IntentRepository struct{ db *pgxpool.Pool }

// NewIntentStore builds the pgx IntentStore. Wire it at the composition root
// (registerAcademyFees) into NewService.
func NewIntentStore(pool *pgxpool.Pool) *IntentRepository { return &IntentRepository{db: pool} }

const intentCols = `reference, invoice_id, guardian_user_id, school_id, amount_minor, idempotency_key, is_installment, confirmed`

func scanIntent(row pgx.Row) (*intentRecord, error) {
	var r intentRecord
	if err := row.Scan(
		&r.Reference, &r.InvoiceID, &r.GuardianUserID, &r.SchoolID,
		&r.AmountMinor, &r.IdempotencyKey, &r.IsInstallment, &r.Confirmed,
	); err != nil {
		return nil, err
	}
	return &r, nil
}

// PutIntent records a pending intent idempotently on idempotency_key. On a fresh
// insert it returns (nil, true, nil). On a replay (same key) it returns the EXISTING
// row (existing, false, nil) so the caller reuses the same reference/gateway session.
func (s *IntentRepository) PutIntent(ctx context.Context, in intentRecord) (*intentRecord, bool, error) {
	const ins = `INSERT INTO public.academy_payment_intents
	  (reference, invoice_id, guardian_user_id, school_id, amount_minor, idempotency_key, is_installment, confirmed)
	  VALUES ($1,$2,$3,$4,$5,$6,$7,false)
	  ON CONFLICT (idempotency_key) DO NOTHING
	  RETURNING ` + intentCols
	if _, err := scanIntent(s.db.QueryRow(ctx, ins,
		in.Reference, in.InvoiceID, in.GuardianUserID, in.SchoolID,
		in.AmountMinor, in.IdempotencyKey, in.IsInstallment,
	)); err == nil {
		return nil, true, nil // freshly inserted — no prior record
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return nil, false, err
	}
	// Conflict on idempotency_key → return the existing row (replay).
	const sel = `SELECT ` + intentCols + ` FROM public.academy_payment_intents WHERE idempotency_key = $1`
	existing, err := scanIntent(s.db.QueryRow(ctx, sel, in.IdempotencyKey))
	if err != nil {
		return nil, false, err
	}
	return existing, false, nil
}

// GetByReference resolves a pending intent by gateway reference (confirmation path).
// Not-found returns ErrUnknownReference so the confirmation is a benign no-op.
func (s *IntentRepository) GetByReference(ctx context.Context, reference string) (*intentRecord, error) {
	const q = `SELECT ` + intentCols + ` FROM public.academy_payment_intents WHERE reference = $1`
	rec, err := scanIntent(s.db.QueryRow(ctx, q, reference))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrUnknownReference
	}
	return rec, err
}

// MarkConfirmed flips a pending intent to confirmed (best-effort idempotency aid).
func (s *IntentRepository) MarkConfirmed(ctx context.Context, reference string) error {
	_, err := s.db.Exec(ctx, `UPDATE public.academy_payment_intents SET confirmed = true WHERE reference = $1`, reference)
	return err
}
