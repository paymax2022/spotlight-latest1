package repo

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/arena/service"
)

// SupportRepo tags ledgered gifts to a competition (money → display only, NEVER
// merit) and reads the pot aggregates. The money movement is a finance ledger
// entry; this row is a projection tagged for the pot + People's Champion.
type SupportRepo struct{ pool *pgxpool.Pool }

// NewSupportRepo builds the support repo.
func NewSupportRepo(pool *pgxpool.Pool) *SupportRepo { return &SupportRepo{pool: pool} }

var _ service.SupportRepo = (*SupportRepo)(nil)

// TagAfterLedger records the support row AFTER the money movement succeeded.
// Idempotent by idempotency_key (a duplicate is a safe no-op).
func (r *SupportRepo) TagAfterLedger(ctx context.Context, competitionID, contestantID, homeState, backerID, ledgerRef, idemKey string, amountKobo int64) error {
	_, err := q(ctx, r.pool).Exec(ctx, `
		INSERT INTO arena_support_txn
			(competition_id, contestant_id, home_state, backer_id, amount_kobo, rail, ledger_ref, idempotency_key)
		VALUES ($1, NULLIF($2,'')::uuid, NULLIF($3,''), $4, $5, 'SUPPORT', $6, $7)
		ON CONFLICT (idempotency_key) DO NOTHING`,
		competitionID, contestantID, homeState, backerID, amountKobo, ledgerRef, idemKey)
	return err
}

// Rows returns all tagged support contributions for a competition (pot + tallies).
func (r *SupportRepo) Rows(ctx context.Context, competitionID string) ([]service.SupportRow, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT COALESCE(contestant_id::text,''), COALESCE(home_state,''), amount_kobo
		  FROM arena_support_txn
		 WHERE competition_id = $1`, competitionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []service.SupportRow{}
	for rows.Next() {
		var sr service.SupportRow
		if err := rows.Scan(&sr.ContestantID, &sr.HomeState, &sr.AmountKobo); err != nil {
			return nil, err
		}
		out = append(out, sr)
	}
	return out, rows.Err()
}
