package connectpayouts

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository handles connect_payouts over a pgx pool. Inserts record the payout;
// a forward-only status update stamps the settlement reference. Parameterized.
type Repository struct {
	db *pgxpool.Pool
}

// NewRepository builds a payouts repository.
func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

const payoutColumns = `id, creator_id, amount_kobo, status, destination_ref,
	ledger_ref, settlement_ref, created_at`

// Insert records a payout in 'requested' status after the wallet debit.
func (r *Repository) Insert(ctx context.Context, p *Payout) (*Payout, error) {
	const ins = `INSERT INTO connect_payouts
		(creator_id, amount_kobo, status, destination_ref, idempotency_key, ledger_ref)
		VALUES ($1,$2,'requested',$3,$4,$5)
		RETURNING ` + payoutColumns
	out := &Payout{}
	if err := r.db.QueryRow(ctx, ins,
		p.CreatorID, p.AmountKobo, p.DestinationRef, p.IdempotencyKey, p.LedgerRef,
	).Scan(
		&out.ID, &out.CreatorID, &out.AmountKobo, &out.Status, &out.DestinationRef,
		&out.LedgerRef, &out.SettlementRef, &out.CreatedAt,
	); err != nil {
		return nil, fmt.Errorf("payouts: insert: %w", err)
	}
	return out, nil
}

// MarkProcessing stamps the provider settlement reference and moves the payout to
// 'processing' (forward-only from 'requested').
func (r *Repository) MarkProcessing(ctx context.Context, id, settlementRef string) error {
	const upd = `UPDATE connect_payouts
		SET status = 'processing', settlement_ref = NULLIF($2,''), updated_at = now()
		WHERE id = $1 AND status = 'requested'`
	if _, err := r.db.Exec(ctx, upd, id, settlementRef); err != nil {
		return fmt.Errorf("payouts: mark processing: %w", err)
	}
	return nil
}

// List returns a creator's payouts, newest first.
func (r *Repository) List(ctx context.Context, creatorID string, limit int) ([]Payout, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	const q = `SELECT ` + payoutColumns + ` FROM connect_payouts
		WHERE creator_id = $1 ORDER BY created_at DESC LIMIT $2`
	rows, err := r.db.Query(ctx, q, creatorID, limit)
	if err != nil {
		return nil, fmt.Errorf("payouts: list: %w", err)
	}
	defer rows.Close()
	var out []Payout
	for rows.Next() {
		var p Payout
		if err := rows.Scan(
			&p.ID, &p.CreatorID, &p.AmountKobo, &p.Status, &p.DestinationRef,
			&p.LedgerRef, &p.SettlementRef, &p.CreatedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}
