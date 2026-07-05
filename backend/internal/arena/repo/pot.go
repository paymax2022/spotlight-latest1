package repo

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/arena/service"
)

// PotRepo persists the pot disbursement state machine (NDC-4). The pot TOTAL is
// never stored here — it is projected from arena_support_txn by the service. This
// repo holds only the control state: distinct approvals + the idempotent
// DISBURSED flip.
type PotRepo struct{ pool *pgxpool.Pool }

// NewPotRepo builds the pot repo.
func NewPotRepo(pool *pgxpool.Pool) *PotRepo { return &PotRepo{pool: pool} }

var _ service.PotRepo = (*PotRepo)(nil)

// State returns the current pot disbursement status + approvals recorded. A
// competition with no control row yet is PENDING with zero approvals.
func (r *PotRepo) State(ctx context.Context, competitionID string) (status string, approvals int, err error) {
	err = r.pool.QueryRow(ctx, `
		SELECT status FROM arena_pot_disbursement WHERE competition_id = $1`, competitionID).Scan(&status)
	if errors.Is(err, pgx.ErrNoRows) {
		status, err = "PENDING", nil
	} else if err != nil {
		return "", 0, err
	}
	err = r.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM arena_pot_approval WHERE competition_id = $1`, competitionID).Scan(&approvals)
	return status, approvals, err
}

// Approve records one distinct approver (idempotent per approver) and returns the
// resulting approval count.
func (r *PotRepo) Approve(ctx context.Context, competitionID, approverID string) (approvals int, err error) {
	if _, err = r.pool.Exec(ctx, `
		INSERT INTO arena_pot_disbursement (competition_id, status)
		VALUES ($1, 'PENDING') ON CONFLICT (competition_id) DO NOTHING`, competitionID); err != nil {
		return 0, err
	}
	if _, err = r.pool.Exec(ctx, `
		INSERT INTO arena_pot_approval (competition_id, approver_id)
		VALUES ($1, $2) ON CONFLICT (competition_id, approver_id) DO NOTHING`,
		competitionID, approverID); err != nil {
		return 0, err
	}
	err = r.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM arena_pot_approval WHERE competition_id = $1`, competitionID).Scan(&approvals)
	return approvals, err
}

// MarkDisbursed flips the pot to DISBURSED atomically with payout (the ledger
// movement), idempotent by idemKey. A second call with the pot already DISBURSED
// is a safe no-op and does NOT re-run the payout.
func (r *PotRepo) MarkDisbursed(ctx context.Context, competitionID, idemKey string, payout func(ctx context.Context) error) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// Lock (or create) the control row.
	if _, err := tx.Exec(ctx, `
		INSERT INTO arena_pot_disbursement (competition_id, status)
		VALUES ($1, 'PENDING') ON CONFLICT (competition_id) DO NOTHING`, competitionID); err != nil {
		return err
	}
	var status string
	if err := tx.QueryRow(ctx, `
		SELECT status FROM arena_pot_disbursement WHERE competition_id = $1 FOR UPDATE`, competitionID).Scan(&status); err != nil {
		return err
	}
	if status == "DISBURSED" {
		return nil // idempotent no-op
	}

	// Run the payout inside the SAME tx so money + state flip commit together.
	if err := payout(withTx(ctx, tx)); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE arena_pot_disbursement
		   SET status = 'DISBURSED', idempotency_key = $2, disbursed_at = now(), updated_at = now()
		 WHERE competition_id = $1`, competitionID, idemKey); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
