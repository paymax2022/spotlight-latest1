package connectpayouts

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound is returned when a payout id does not exist.
var ErrNotFound = errors.New("connect: payout not found")

// ErrForwardOnly is returned when a status transition is attempted on a payout
// that is no longer in a forward-transitionable state (e.g. trying to settle or
// reject a payout that is already 'settled' or 'failed'). Ledger/payout status
// is forward-only by design — corrections are reversing entries, never in-place
// edits — so the caller must re-read the row and decide (idempotent no-op vs
// real conflict) rather than the repo silently no-op'ing.
var ErrForwardOnly = errors.New("connect: payout is not in a forward-transitionable state")

// Repository handles connect_payouts over a pgx pool. Inserts record the payout;
// a forward-only status update stamps the settlement reference. Parameterized.
type Repository struct {
	db *pgxpool.Pool
}

// NewRepository builds a payouts repository.
func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

const payoutColumns = `id, creator_id, amount_kobo, status, destination_ref,
	ledger_ref, settlement_ref, created_at, updated_at`

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
		&out.LedgerRef, &out.SettlementRef, &out.CreatedAt, &out.UpdatedAt,
	); err != nil {
		return nil, fmt.Errorf("payouts: insert: %w", err)
	}
	return out, nil
}

// Get fetches a single payout by id, or ErrNotFound.
func (r *Repository) Get(ctx context.Context, id string) (*Payout, error) {
	const q = `SELECT ` + payoutColumns + ` FROM connect_payouts WHERE id = $1`
	var p Payout
	err := r.db.QueryRow(ctx, q, id).Scan(
		&p.ID, &p.CreatorID, &p.AmountKobo, &p.Status, &p.DestinationRef,
		&p.LedgerRef, &p.SettlementRef, &p.CreatedAt, &p.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("payouts: get: %w", err)
	}
	return &p, nil
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
			&p.LedgerRef, &p.SettlementRef, &p.CreatedAt, &p.UpdatedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// MarkSettled stamps the (admin-supplied) settlement reference and moves the
// payout to 'settled' — forward-only from 'requested' or 'processing'. Returns
// ErrForwardOnly if the row is not in one of those states (already settled/
// failed, or concurrently transitioned) so the caller can distinguish a real
// conflict from a race and decide whether to treat it as an idempotent no-op.
func (r *Repository) MarkSettled(ctx context.Context, id, settlementRef string) error {
	const upd = `UPDATE connect_payouts
		SET status = 'settled', settlement_ref = COALESCE(NULLIF($2,''), settlement_ref), updated_at = now()
		WHERE id = $1 AND status IN ('requested','processing')`
	tag, err := r.db.Exec(ctx, upd, id, settlementRef)
	if err != nil {
		return fmt.Errorf("payouts: mark settled: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrForwardOnly
	}
	return nil
}

// MarkFailed moves the payout to 'failed' — forward-only from 'requested' or
// 'processing'. It does NOT touch the ledger; the caller is responsible for
// reversing the parked settlement debit (via the ledger's own reversal path)
// BEFORE calling this, so a failed payout row always implies the money has
// already been restored to the creator's wallet.
func (r *Repository) MarkFailed(ctx context.Context, id string) error {
	const upd = `UPDATE connect_payouts
		SET status = 'failed', updated_at = now()
		WHERE id = $1 AND status IN ('requested','processing')`
	tag, err := r.db.Exec(ctx, upd, id)
	if err != nil {
		return fmt.Errorf("payouts: mark failed: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrForwardOnly
	}
	return nil
}

// adminPayoutColumns joins connect_payouts to the creator's profile handle so
// the admin console can render a human-readable creator, not just a uuid.
// connect_creator_profiles.handle is preferred (creator-facing display handle);
// user_profiles.display_name is the fallback for creators without a Connect
// creator profile row.
const adminPayoutColumns = `p.id, p.creator_id, p.amount_kobo, p.status, p.destination_ref,
	p.ledger_ref, p.settlement_ref, p.created_at, p.updated_at,
	COALESCE(NULLIF(cp.handle, ''), up.display_name, '')`

const adminPayoutFrom = `FROM connect_payouts p
	LEFT JOIN connect_creator_profiles cp ON cp.user_id = p.creator_id
	LEFT JOIN user_profiles up ON up.id = p.creator_id`

// AdminList returns payouts across all creators for the admin console, newest
// first, narrowed by AdminListFilter. It does NOT resolve CreatorTier (that is
// a live tiers.Service lookup, not a stored column) — the service layer fills
// it in per row after calling this.
func (r *Repository) AdminList(ctx context.Context, f AdminListFilter) ([]AdminPayout, error) {
	limit := f.Limit
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	offset := f.Offset
	if offset < 0 {
		offset = 0
	}
	var creatorID *string
	if f.CreatorID != nil && *f.CreatorID != "" {
		creatorID = f.CreatorID
	}
	q := `SELECT ` + adminPayoutColumns + ` AS creator_handle
		` + adminPayoutFrom + `
		WHERE ($1 = '' OR p.status = $1)
		  AND ($2::uuid IS NULL OR p.creator_id = $2)
		  AND ($3::timestamptz IS NULL OR p.created_at >= $3)
		  AND ($4::timestamptz IS NULL OR p.created_at <= $4)
		ORDER BY p.created_at DESC
		LIMIT $5 OFFSET $6`
	rows, err := r.db.Query(ctx, q, f.Status, creatorID, f.From, f.To, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("payouts: admin list: %w", err)
	}
	defer rows.Close()
	var out []AdminPayout
	for rows.Next() {
		var p AdminPayout
		if err := rows.Scan(
			&p.ID, &p.CreatorID, &p.AmountKobo, &p.Status, &p.DestinationRef,
			&p.LedgerRef, &p.SettlementRef, &p.CreatedAt, &p.UpdatedAt, &p.CreatorHandle,
		); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// AdminGet fetches a single payout (with creator handle) for the admin detail
// view, or ErrNotFound.
func (r *Repository) AdminGet(ctx context.Context, id string) (*AdminPayout, error) {
	q := `SELECT ` + adminPayoutColumns + ` AS creator_handle
		` + adminPayoutFrom + `
		WHERE p.id = $1`
	var p AdminPayout
	err := r.db.QueryRow(ctx, q, id).Scan(
		&p.ID, &p.CreatorID, &p.AmountKobo, &p.Status, &p.DestinationRef,
		&p.LedgerRef, &p.SettlementRef, &p.CreatedAt, &p.UpdatedAt, &p.CreatorHandle,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("payouts: admin get: %w", err)
	}
	return &p, nil
}
