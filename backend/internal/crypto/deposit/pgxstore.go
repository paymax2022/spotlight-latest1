package deposit

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PGStore is the production Store. Each settled credit is one immutable crypto_deposits
// row (UNIQUE on provider_op_id) plus a crypto_holdings upsert, applied atomically —
// the same id-on-conflict-then-move-holding shape as crypto.Repository.RecordFill.
//
// The replay guarantee is structural, not advisory: ON CONFLICT DO NOTHING on
// provider_op_id yields no returned row, so the balance is touched only by the first
// insert of a given operation; every duplicate commits nothing and returns
// OutcomeDuplicate. A failure at any step rolls the whole thing back.
type PGStore struct{ pool *pgxpool.Pool }

func NewPGStore(pool *pgxpool.Pool) *PGStore { return &PGStore{pool: pool} }

func (s *PGStore) ApplyCredit(ctx context.Context, a Apply) (Outcome, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return OutcomeRejected, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	const ins = `
		INSERT INTO crypto_deposits
			(provider, provider_account_id, provider_op_id, user_id, asset_id,
			 symbol, network, address, units, confirmations, required_confs, tx_hash)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
		ON CONFLICT (provider_op_id) DO NOTHING
		RETURNING id`
	var id string
	err = tx.QueryRow(ctx, ins,
		a.Provider, a.ProviderAccountID, a.ProviderOpID, a.UserID, a.AssetID,
		a.Symbol, a.Network, a.Address, a.Units, a.Confirmations, a.RequiredConfs, a.TxHash,
	).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		// Already settled for this operation id — credit nothing, tell the caller it was a
		// duplicate. Commit (no-op write) so the read of the prior row is consistent.
		if cerr := tx.Commit(ctx); cerr != nil {
			return OutcomeRejected, cerr
		}
		return OutcomeDuplicate, nil
	}
	if err != nil {
		return OutcomeRejected, fmt.Errorf("deposit: insert crypto_deposits: %w", err)
	}

	// First time: move the holding projection. A credit upserts (the row may not exist).
	const upHolding = `
		INSERT INTO crypto_holdings (user_id, asset_id, units)
		VALUES ($1,$2,$3)
		ON CONFLICT (user_id, asset_id) DO UPDATE
		  SET units = crypto_holdings.units + EXCLUDED.units, updated_at = now()`
	if _, err := tx.Exec(ctx, upHolding, a.UserID, a.AssetID, a.Units); err != nil {
		return OutcomeRejected, fmt.Errorf("deposit: credit holding: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return OutcomeRejected, err
	}
	return OutcomeSettled, nil
}

// Balance reads a user's crypto-unit holding for one asset. Exported for tests and the
// portfolio/receipt surfaces so they read the SAME projection the credit path writes.
func Balance(ctx context.Context, pool *pgxpool.Pool, userID, assetID string) (int64, error) {
	var units int64
	err := pool.QueryRow(ctx,
		`SELECT COALESCE(units,0) FROM crypto_holdings WHERE user_id=$1 AND asset_id=$2`,
		userID, assetID).Scan(&units)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil
	}
	return units, err
}
