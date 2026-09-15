package utilitybills

// Saved beneficiaries are a convenience feature, not a money path — but they are
// USER-SCOPED PII (a meter number, a smartcard number, a phone number, plus the
// label the member gave it). Every query below therefore carries the user_id
// predicate in SQL rather than filtering in Go: an ownership check that lives in
// the WHERE clause cannot be forgotten by a later caller, and a cross-user read
// returns zero rows instead of somebody else's meter.

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// BeneficiaryRepository owns public.saved_utility_beneficiaries.
type BeneficiaryRepository struct {
	db *pgxpool.Pool
}

// NewBeneficiaryRepository constructs the repository over the pgx pool.
func NewBeneficiaryRepository(db *pgxpool.Pool) *BeneficiaryRepository {
	return &BeneficiaryRepository{db: db}
}

const beneficiaryCols = `id, user_id, category, biller_id, label, customer_reference, customer_name, created_at`

func scanBeneficiary(row pgx.Row) (*BeneficiaryRow, error) {
	var b BeneficiaryRow
	if err := row.Scan(&b.ID, &b.UserID, &b.Category, &b.BillerID, &b.Label,
		&b.CustomerReference, &b.CustomerName, &b.CreatedAt); err != nil {
		return nil, err
	}
	return &b, nil
}

// List returns a member's saved beneficiaries, newest first, optionally filtered
// by category. Ports service.ts's listUtilityBeneficiaries.
func (r *BeneficiaryRepository) List(ctx context.Context, userID, category string) ([]BeneficiaryRow, error) {
	q := `SELECT ` + beneficiaryCols + ` FROM public.saved_utility_beneficiaries WHERE user_id = $1`
	args := []any{userID}
	if category != "" {
		args = append(args, category)
		q += fmt.Sprintf(` AND category = $%d`, len(args))
	}
	q += ` ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("utilitybills: list beneficiaries: %w", err)
	}
	defer rows.Close()
	out := []BeneficiaryRow{}
	for rows.Next() {
		b, err := scanBeneficiary(rows)
		if err != nil {
			return nil, fmt.Errorf("utilitybills: scan beneficiary: %w", err)
		}
		out = append(out, *b)
	}
	return out, rows.Err()
}

// Save upserts a beneficiary on the table's natural key
// UNIQUE(user_id, biller_id, customer_reference), porting the TS upsert's
// onConflict exactly. Re-saving the same meter under a new label renames it
// rather than creating a duplicate.
func (r *BeneficiaryRepository) Save(ctx context.Context, userID, category, billerID, label, customerReference, customerName string) (*BeneficiaryRow, error) {
	var name any
	if customerName != "" {
		name = customerName
	}
	b, err := scanBeneficiary(r.db.QueryRow(ctx, `
		INSERT INTO public.saved_utility_beneficiaries
			(user_id, category, biller_id, label, customer_reference, customer_name)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (user_id, biller_id, customer_reference) DO UPDATE
		SET label = EXCLUDED.label,
		    category = EXCLUDED.category,
		    customer_name = COALESCE(EXCLUDED.customer_name, public.saved_utility_beneficiaries.customer_name)
		RETURNING `+beneficiaryCols,
		userID, category, billerID, label, customerReference, name))
	if err != nil {
		return nil, fmt.Errorf("utilitybills: save beneficiary: %w", err)
	}
	return b, nil
}

// Delete removes a beneficiary the caller owns. The user_id predicate is the
// authZ: deleting someone else's row reports ErrNotFound and changes nothing.
func (r *BeneficiaryRepository) Delete(ctx context.Context, userID, beneficiaryID string) error {
	tag, err := r.db.Exec(ctx, `
		DELETE FROM public.saved_utility_beneficiaries WHERE id = $1 AND user_id = $2`,
		beneficiaryID, userID)
	if err != nil {
		return fmt.Errorf("utilitybills: delete beneficiary: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("%w: utility beneficiary %s", ErrNotFound, beneficiaryID)
	}
	return nil
}

// TouchLastUsed stamps last_transaction_at when a saved beneficiary is paid, so
// the client can order by recency. Best-effort: a failure here must never affect
// a payment, so the caller logs and continues.
func (r *BeneficiaryRepository) TouchLastUsed(ctx context.Context, userID, billerID, customerReference string) error {
	_, err := r.db.Exec(ctx, `
		UPDATE public.saved_utility_beneficiaries SET last_transaction_at = now()
		WHERE user_id = $1 AND biller_id = $2 AND customer_reference = $3`,
		userID, billerID, customerReference)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("utilitybills: touch beneficiary: %w", err)
	}
	return nil
}
