package crypto

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// This file extends Repository with SQL for swap orders, the address allow-list,
// deposit addresses, and the withdrawal state machine. Holdings are moved ONLY
// through these transactional methods (asset-unit legs); the cash legs live in the
// finance ledger and are posted by the service.

// ── Swap ────────────────────────────────────────────────────────────────────

// RecordSwapFill atomically writes the swap order row and moves BOTH holding
// projections in ONE transaction: from-asset units decrement (CHECK units>=0
// fail-closes an oversell) and to-asset units increment. ON CONFLICT on the
// idempotency key makes a replay a no-op (dup=true → holdings untouched, caller
// must NOT re-post the ledger legs).
func (r *Repository) RecordSwapFill(ctx context.Context, o SwapOrder) (string, bool, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return "", false, err
	}
	defer tx.Rollback(ctx)

	const insOrder = `INSERT INTO crypto_swap_orders
		(user_id, from_asset_id, to_asset_id, status, from_units, to_units,
		 from_price_kobo, to_price_kobo, cash_kobo, spread_kobo, spread_bps, idempotency_key, reference)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
		ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
		RETURNING id`
	var orderID string
	err = tx.QueryRow(ctx, insOrder,
		o.UserID, o.FromAssetID, o.ToAssetID, "filled", o.FromUnits, o.ToUnits,
		o.FromPriceKobo, o.ToPriceKobo, o.CashKobo, o.SpreadKobo, o.SpreadBps,
		o.IdempotencyKey(), o.Reference,
	).Scan(&orderID)
	if err == pgx.ErrNoRows {
		if e := tx.QueryRow(ctx,
			`SELECT id FROM crypto_swap_orders WHERE idempotency_key=$1`, o.IdempotencyKey()).Scan(&orderID); e != nil {
			return "", false, e
		}
		_ = tx.Commit(ctx)
		return orderID, true, nil
	}
	if err != nil {
		return "", false, fmt.Errorf("crypto: insert swap order: %w", err)
	}

	// Decrement the `from` holding via UPDATE — NOT INSERT ... ON CONFLICT: Postgres
	// evaluates CHECK(units>=0) against the proposed insert tuple (a negative delta)
	// before ON CONFLICT resolves to UPDATE, so an upsert spuriously fails the check
	// even when the resulting balance is non-negative. UPDATE checks the final row,
	// so it fail-closes only on a real oversell.
	const debitFrom = `UPDATE crypto_holdings SET units = units - $3, updated_at=now()
		WHERE user_id=$1 AND asset_id=$2`
	ct, err := tx.Exec(ctx, debitFrom, o.UserID, o.FromAssetID, o.FromUnits)
	if err != nil {
		return "", false, fmt.Errorf("crypto: swap debit holding: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return "", false, ErrInsufficient
	}
	// … and credit the `to` holding (upsert: positive delta, row may not exist yet).
	const creditTo = `INSERT INTO crypto_holdings (user_id, asset_id, units)
		VALUES ($1,$2,$3)
		ON CONFLICT (user_id, asset_id) DO UPDATE
		  SET units = crypto_holdings.units + EXCLUDED.units, updated_at=now()`
	if _, err := tx.Exec(ctx, creditTo, o.UserID, o.ToAssetID, o.ToUnits); err != nil {
		return "", false, fmt.Errorf("crypto: swap credit holding: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return "", false, err
	}
	return orderID, false, nil
}

// SwapOrdersForUser returns the caller's swap history (newest first).
func (r *Repository) SwapOrdersForUser(ctx context.Context, userID string, limit, offset int) ([]SwapOrder, error) {
	const q = `SELECT s.id, s.user_id, s.from_asset_id, fa.symbol, s.to_asset_id, ta.symbol,
	                  s.status, s.from_units, s.to_units, s.from_price_kobo, s.to_price_kobo,
	                  s.cash_kobo, s.spread_kobo, s.spread_bps, s.reference, s.created_at
	           FROM crypto_swap_orders s
	           JOIN crypto_assets fa ON fa.id = s.from_asset_id
	           JOIN crypto_assets ta ON ta.id = s.to_asset_id
	           WHERE s.user_id=$1 ORDER BY s.created_at DESC LIMIT $2 OFFSET $3`
	rows, err := r.db.Query(ctx, q, userID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SwapOrder{}
	for rows.Next() {
		var o SwapOrder
		var ref *string
		if err := rows.Scan(&o.ID, &o.UserID, &o.FromAssetID, &o.FromSymbol, &o.ToAssetID, &o.ToSymbol,
			&o.Status, &o.FromUnits, &o.ToUnits, &o.FromPriceKobo, &o.ToPriceKobo,
			&o.CashKobo, &o.SpreadKobo, &o.SpreadBps, &ref, &o.CreatedAt); err != nil {
			return nil, err
		}
		if ref != nil {
			o.Reference = *ref
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

// ── Address allow-list ──────────────────────────────────────────────────────

// AddAddress inserts a whitelisted address (idempotent on the active partial
// unique index). Returns the row; dup=true when it already existed.
func (r *Repository) AddAddress(ctx context.Context, userID, assetID, label, network, address string) (*Address, bool, error) {
	const q = `INSERT INTO crypto_addresses (user_id, asset_id, label, network, address, verified_at)
	           VALUES ($1,$2,$3,$4,$5, now())
	           ON CONFLICT (user_id, asset_id, address) WHERE is_active = true DO NOTHING
	           RETURNING id, user_id, asset_id, label, network, address, is_active, verified_at, created_at`
	var a Address
	err := r.db.QueryRow(ctx, q, userID, assetID, label, network, address).Scan(
		&a.ID, &a.UserID, &a.AssetID, &a.Label, &a.Network, &a.Address, &a.IsActive, &a.VerifiedAt, &a.CreatedAt)
	if err == pgx.ErrNoRows {
		// Already exists (active). Fetch and return dup=true.
		existing, e := r.GetActiveAddressByValue(ctx, userID, assetID, address)
		if e != nil {
			return nil, false, e
		}
		return existing, true, nil
	}
	if err != nil {
		return nil, false, fmt.Errorf("crypto: add address: %w", err)
	}
	return &a, false, nil
}

// GetActiveAddressByValue fetches an active address by its literal value.
func (r *Repository) GetActiveAddressByValue(ctx context.Context, userID, assetID, address string) (*Address, error) {
	const q = `SELECT id, user_id, asset_id, label, network, address, is_active, verified_at, created_at
	           FROM crypto_addresses
	           WHERE user_id=$1 AND asset_id=$2 AND address=$3 AND is_active=true`
	var a Address
	if err := r.db.QueryRow(ctx, q, userID, assetID, address).Scan(
		&a.ID, &a.UserID, &a.AssetID, &a.Label, &a.Network, &a.Address, &a.IsActive, &a.VerifiedAt, &a.CreatedAt); err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrAddressNotFound
		}
		return nil, err
	}
	return &a, nil
}

// GetAddress returns an active address by id scoped to its owner (object-level authZ).
func (r *Repository) GetAddress(ctx context.Context, userID, id string) (*Address, error) {
	const q = `SELECT a.id, a.user_id, a.asset_id, ast.symbol, a.label, a.network, a.address,
	                  a.is_active, a.verified_at, a.created_at
	           FROM crypto_addresses a JOIN crypto_assets ast ON ast.id = a.asset_id
	           WHERE a.id=$1 AND a.user_id=$2 AND a.is_active=true`
	var a Address
	if err := r.db.QueryRow(ctx, q, id, userID).Scan(
		&a.ID, &a.UserID, &a.AssetID, &a.Symbol, &a.Label, &a.Network, &a.Address,
		&a.IsActive, &a.VerifiedAt, &a.CreatedAt); err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrAddressNotFound
		}
		return nil, err
	}
	return &a, nil
}

// ListAddresses returns the caller's active addresses (optionally filtered by asset).
func (r *Repository) ListAddresses(ctx context.Context, userID, assetID string) ([]Address, error) {
	q := `SELECT a.id, a.user_id, a.asset_id, ast.symbol, a.label, a.network, a.address,
	             a.is_active, a.verified_at, a.created_at
	      FROM crypto_addresses a JOIN crypto_assets ast ON ast.id = a.asset_id
	      WHERE a.user_id=$1 AND a.is_active=true`
	args := []any{userID}
	if assetID != "" {
		q += ` AND a.asset_id=$2`
		args = append(args, assetID)
	}
	q += ` ORDER BY a.created_at DESC`
	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Address{}
	for rows.Next() {
		var a Address
		if err := rows.Scan(&a.ID, &a.UserID, &a.AssetID, &a.Symbol, &a.Label, &a.Network, &a.Address,
			&a.IsActive, &a.VerifiedAt, &a.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// DeleteAddress soft-deactivates an owned address. Returns ErrAddressNotFound if
// the caller does not own an active row with that id.
func (r *Repository) DeleteAddress(ctx context.Context, userID, id string) error {
	const q = `UPDATE crypto_addresses SET is_active=false
	           WHERE id=$1 AND user_id=$2 AND is_active=true`
	ct, err := r.db.Exec(ctx, q, id, userID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrAddressNotFound
	}
	return nil
}

// ── Deposit addresses ───────────────────────────────────────────────────────

// GetOrCreateDepositAddress returns the persisted deposit address for (user,asset),
// generating + persisting one via the supplied deriver on first request. The
// UNIQUE(user_id,asset_id) constraint keeps it stable across calls.
func (r *Repository) GetOrCreateDepositAddress(
	ctx context.Context, userID string, asset *Asset, network, provider string,
	derive func(userID, symbol, network string) (string, string),
) (*DepositAddress, error) {
	// Fast path: return an existing row.
	const sel = `SELECT network, address, memo, provider FROM crypto_deposit_addresses
	             WHERE user_id=$1 AND asset_id=$2`
	var d DepositAddress
	var memo *string
	err := r.db.QueryRow(ctx, sel, userID, asset.ID).Scan(&d.Network, &d.Address, &memo, &d.Provider)
	if err == nil {
		d.AssetID, d.Symbol = asset.ID, asset.Symbol
		if memo != nil {
			d.Memo = *memo
		}
		return &d, nil
	}
	if err != pgx.ErrNoRows {
		return nil, err
	}
	// Generate + persist (idempotent on the unique constraint).
	addr, m := derive(userID, asset.Symbol, network)
	const ins = `INSERT INTO crypto_deposit_addresses (user_id, asset_id, network, address, memo, provider)
	             VALUES ($1,$2,$3,$4,$5,$6)
	             ON CONFLICT (user_id, asset_id) DO UPDATE SET user_id=EXCLUDED.user_id
	             RETURNING network, address, memo, provider`
	var memoArg any
	if m != "" {
		memoArg = m
	}
	if err := r.db.QueryRow(ctx, ins, userID, asset.ID, network, addr, memoArg, provider).Scan(
		&d.Network, &d.Address, &memo, &d.Provider); err != nil {
		return nil, fmt.Errorf("crypto: deposit address: %w", err)
	}
	d.AssetID, d.Symbol = asset.ID, asset.Symbol
	if memo != nil {
		d.Memo = *memo
	}
	return &d, nil
}

// ── Withdrawal state machine ────────────────────────────────────────────────

// CreateWithdrawal atomically inserts the withdrawal row (status=requested) and
// parks the debited units by decrementing the holding projection (CHECK units>=0
// fail-closes an over-withdrawal). No minting: units leave crypto_holdings and are
// held in this row until a terminal state. ON CONFLICT on the idempotency key makes
// a replay a no-op (dup=true → holding untouched, existing row returned).
func (r *Repository) CreateWithdrawal(ctx context.Context, w Withdrawal) (string, bool, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return "", false, err
	}
	defer tx.Rollback(ctx)

	const ins = `INSERT INTO crypto_withdrawals
		(user_id, asset_id, address_id, status, units, network_fee_units, fee_kobo,
		 price_kobo, provider, idempotency_key, reference)
		VALUES ($1,$2,$3,'requested',$4,$5,$6,$7,$8,$9,$10)
		ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
		RETURNING id`
	var wid string
	err = tx.QueryRow(ctx, ins,
		w.UserID, w.AssetID, w.AddressID, w.Units, w.NetworkFeeUnits, w.FeeKobo,
		w.PriceKobo, w.Provider, w.IdempotencyKey(), w.Reference,
	).Scan(&wid)
	if err == pgx.ErrNoRows {
		if e := tx.QueryRow(ctx,
			`SELECT id FROM crypto_withdrawals WHERE idempotency_key=$1`, w.IdempotencyKey()).Scan(&wid); e != nil {
			return "", false, e
		}
		_ = tx.Commit(ctx)
		return wid, true, nil
	}
	if err != nil {
		return "", false, fmt.Errorf("crypto: insert withdrawal: %w", err)
	}

	// Park the units: decrement the holding via UPDATE (not upsert) so the negative
	// delta doesn't trip CHECK(units>=0) on the proposed insert tuple before it
	// applies. CHECK fail-closes a real over-withdrawal on the resulting row.
	const debit = `UPDATE crypto_holdings SET units = units - $3, updated_at=now()
		WHERE user_id=$1 AND asset_id=$2`
	ct, err := tx.Exec(ctx, debit, w.UserID, w.AssetID, w.Units)
	if err != nil {
		return "", false, fmt.Errorf("crypto: park withdrawal units: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return "", false, ErrInsufficient
	}

	// Record the opening transition (requested).
	const evt = `INSERT INTO crypto_withdrawal_events (withdrawal_id, from_status, to_status, actor_id, detail)
	             VALUES ($1, NULL, 'requested', $2, 'withdrawal requested; units parked')`
	if _, err := tx.Exec(ctx, evt, wid, w.UserID); err != nil {
		return "", false, err
	}

	if err := tx.Commit(ctx); err != nil {
		return "", false, err
	}
	return wid, false, nil
}

// TransitionWithdrawal moves an owned withdrawal from->to under a guarded update
// (WHERE status=from ensures the state machine is honoured even under concurrency)
// and appends a transition event. When returnUnits>0 (a failure) the parked units
// are returned to the holding in the SAME transaction (compensation, never mints —
// it restores what CreateWithdrawal parked). Provider fields are set when supplied.
func (r *Repository) TransitionWithdrawal(
	ctx context.Context, userID, id, from, to, actorID, detail, providerRef, txHash, failureReason string,
	returnUnits int64,
) (*Withdrawal, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	const upd = `UPDATE crypto_withdrawals
		SET status=$3,
		    provider_ref=COALESCE(NULLIF($4,''), provider_ref),
		    tx_hash=COALESCE(NULLIF($5,''), tx_hash),
		    failure_reason=COALESCE(NULLIF($6,''), failure_reason),
		    updated_at=now()
		WHERE id=$1 AND user_id=$2 AND status=$7`
	ct, err := tx.Exec(ctx, upd, id, userID, to, providerRef, txHash, failureReason, from)
	if err != nil {
		return nil, err
	}
	if ct.RowsAffected() == 0 {
		return nil, ErrInvalidTransition
	}

	// Return parked units on failure (compensation).
	if returnUnits > 0 {
		var assetID string
		if err := tx.QueryRow(ctx, `SELECT asset_id FROM crypto_withdrawals WHERE id=$1`, id).Scan(&assetID); err != nil {
			return nil, err
		}
		const credit = `INSERT INTO crypto_holdings (user_id, asset_id, units)
			VALUES ($1,$2,$3)
			ON CONFLICT (user_id, asset_id) DO UPDATE
			  SET units = crypto_holdings.units + EXCLUDED.units, updated_at=now()`
		if _, err := tx.Exec(ctx, credit, userID, assetID, returnUnits); err != nil {
			return nil, fmt.Errorf("crypto: return withdrawal units: %w", err)
		}
	}

	const evt = `INSERT INTO crypto_withdrawal_events (withdrawal_id, from_status, to_status, actor_id, detail)
	             VALUES ($1,$2,$3,$4,$5)`
	if _, err := tx.Exec(ctx, evt, id, from, to, nullStr(actorID), nullStr(detail)); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return r.GetWithdrawal(ctx, userID, id)
}

// WithdrawnKoboToday returns the caller's total fiat-marked withdrawal value for
// non-failed withdrawals created since UTC midnight (a projection of persisted rows,
// used only for the display-only daily-used figure — never a mutated counter).
func (r *Repository) WithdrawnKoboToday(ctx context.Context, userID string) (int64, error) {
	const q = `SELECT COALESCE(SUM((w.units * w.price_kobo) / GREATEST(ast.minor_unit_scale,1)), 0)
	           FROM crypto_withdrawals w
	           JOIN crypto_assets ast ON ast.id = w.asset_id
	           WHERE w.user_id=$1 AND w.status <> 'failed'
	             AND w.created_at >= date_trunc('day', now() AT TIME ZONE 'UTC')`
	var total int64
	if err := r.db.QueryRow(ctx, q, userID).Scan(&total); err != nil {
		return 0, err
	}
	return total, nil
}

// GetWithdrawal returns an owned withdrawal (object-level authZ) enriched with
// asset symbol + destination address.
func (r *Repository) GetWithdrawal(ctx context.Context, userID, id string) (*Withdrawal, error) {
	const q = `SELECT w.id, w.user_id, w.asset_id, ast.symbol, w.address_id, addr.address, addr.network,
	                  w.status, w.units, w.network_fee_units, w.fee_kobo, w.price_kobo,
	                  w.provider, w.provider_ref, w.tx_hash, w.failure_reason, w.reference,
	                  w.created_at, w.updated_at
	           FROM crypto_withdrawals w
	           JOIN crypto_assets ast ON ast.id = w.asset_id
	           JOIN crypto_addresses addr ON addr.id = w.address_id
	           WHERE w.id=$1 AND w.user_id=$2`
	return scanWithdrawal(r.db.QueryRow(ctx, q, id, userID))
}

// ListWithdrawals returns the caller's withdrawal history (newest first).
func (r *Repository) ListWithdrawals(ctx context.Context, userID string, limit, offset int) ([]Withdrawal, error) {
	const q = `SELECT w.id, w.user_id, w.asset_id, ast.symbol, w.address_id, addr.address, addr.network,
	                  w.status, w.units, w.network_fee_units, w.fee_kobo, w.price_kobo,
	                  w.provider, w.provider_ref, w.tx_hash, w.failure_reason, w.reference,
	                  w.created_at, w.updated_at
	           FROM crypto_withdrawals w
	           JOIN crypto_assets ast ON ast.id = w.asset_id
	           JOIN crypto_addresses addr ON addr.id = w.address_id
	           WHERE w.user_id=$1 ORDER BY w.created_at DESC LIMIT $2 OFFSET $3`
	rows, err := r.db.Query(ctx, q, userID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Withdrawal{}
	for rows.Next() {
		w, err := scanWithdrawalRows(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *w)
	}
	return out, rows.Err()
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanWithdrawal(row pgx.Row) (*Withdrawal, error) {
	w, err := scanWithdrawalRows(row)
	if err == pgx.ErrNoRows {
		return nil, ErrNotFound
	}
	return w, err
}

func scanWithdrawalRows(row rowScanner) (*Withdrawal, error) {
	var w Withdrawal
	var providerRef, txHash, failureReason, reference *string
	if err := row.Scan(
		&w.ID, &w.UserID, &w.AssetID, &w.Symbol, &w.AddressID, &w.Address, &w.Network,
		&w.Status, &w.Units, &w.NetworkFeeUnits, &w.FeeKobo, &w.PriceKobo,
		&w.Provider, &providerRef, &txHash, &failureReason, &reference,
		&w.CreatedAt, &w.UpdatedAt,
	); err != nil {
		return nil, err
	}
	if providerRef != nil {
		w.ProviderRef = *providerRef
	}
	if txHash != nil {
		w.TxHash = *txHash
	}
	if failureReason != nil {
		w.FailureReason = *failureReason
	}
	if reference != nil {
		w.Reference = *reference
	}
	return &w, nil
}

// touch keeps the time import used regardless of build tags.
var _ = time.Now
