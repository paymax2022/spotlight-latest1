package crypto

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// This file extends Repository with the ADMIN-oversight read paths and the two
// admin-scoped state transitions (withdrawal + address decisions). Unlike the
// member repo methods these are NOT scoped by user_id — the caller is gated by
// RBAC crypto.admin upstream. All reads are thin SELECTs; the two writers reuse
// the existing guarded state machines (WHERE status=from) so the transition rules
// are honoured even under concurrency.

// ── Withdrawals (admin) ──────────────────────────────────────────────────────

// AdminListWithdrawals returns withdrawals across all users (newest first),
// optionally filtered by status, enriched with the fiat value the console shows.
func (r *Repository) AdminListWithdrawals(ctx context.Context, status string, limit, offset int) ([]AdminWithdrawal, error) {
	q := `SELECT w.id, w.user_id, w.asset_id, ast.symbol, w.address_id, addr.address, addr.network,
	             w.status, w.units, w.network_fee_units, w.fee_kobo, w.price_kobo,
	             ast.minor_unit_scale, w.provider, w.provider_ref, w.tx_hash, w.failure_reason,
	             w.reference, w.created_at, w.updated_at
	      FROM crypto_withdrawals w
	      JOIN crypto_assets ast ON ast.id = w.asset_id
	      JOIN crypto_addresses addr ON addr.id = w.address_id`
	args := []any{}
	if status != "" {
		q += ` WHERE w.status = $1`
		args = append(args, status)
	}
	// Order first, then paginate. Positional params shift by 1 when status is set.
	if status != "" {
		q += ` ORDER BY w.created_at DESC LIMIT $2 OFFSET $3`
		args = append(args, limit, offset)
	} else {
		q += ` ORDER BY w.created_at DESC LIMIT $1 OFFSET $2`
		args = append(args, limit, offset)
	}
	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AdminWithdrawal{}
	for rows.Next() {
		w, err := scanAdminWithdrawal(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *w)
	}
	return out, rows.Err()
}

// AdminGetWithdrawal returns a single withdrawal by id (no user scope).
func (r *Repository) AdminGetWithdrawal(ctx context.Context, id string) (*AdminWithdrawal, error) {
	const q = `SELECT w.id, w.user_id, w.asset_id, ast.symbol, w.address_id, addr.address, addr.network,
	                  w.status, w.units, w.network_fee_units, w.fee_kobo, w.price_kobo,
	                  ast.minor_unit_scale, w.provider, w.provider_ref, w.tx_hash, w.failure_reason,
	                  w.reference, w.created_at, w.updated_at
	           FROM crypto_withdrawals w
	           JOIN crypto_assets ast ON ast.id = w.asset_id
	           JOIN crypto_addresses addr ON addr.id = w.address_id
	           WHERE w.id=$1`
	w, err := scanAdminWithdrawal(r.db.QueryRow(ctx, q, id))
	if err == pgx.ErrNoRows {
		return nil, ErrNotFound
	}
	return w, err
}

// AdminTransitionWithdrawal moves a withdrawal from->to under the guarded update
// (WHERE status=from) WITHOUT a user scope — the caller is an authorised admin. It
// mirrors the member TransitionWithdrawal: it appends a transition event and, when
// returnUnits>0 (a reject), returns the parked units to the owner's holding in the
// SAME transaction (compensation, never mints). The owning user_id is read from the
// row so the units go back to the right holder. Idempotent: a repeated decision hits
// WHERE status=from with 0 rows and returns ErrInvalidTransition.
func (r *Repository) AdminTransitionWithdrawal(
	ctx context.Context, id, from, to, actorID, detail, failureReason string, returnUnits int64,
) (*AdminWithdrawal, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	const upd = `UPDATE crypto_withdrawals
		SET status=$2,
		    failure_reason=COALESCE(NULLIF($3,''), failure_reason),
		    updated_at=now()
		WHERE id=$1 AND status=$4
		RETURNING user_id, asset_id`
	var ownerID, assetID string
	if err := tx.QueryRow(ctx, upd, id, to, failureReason, from).Scan(&ownerID, &assetID); err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrInvalidTransition
		}
		return nil, err
	}

	// Return parked units on a reject (compensation — restores what CreateWithdrawal
	// parked; never mints).
	if returnUnits > 0 {
		const credit = `INSERT INTO crypto_holdings (user_id, asset_id, units)
			VALUES ($1,$2,$3)
			ON CONFLICT (user_id, asset_id) DO UPDATE
			  SET units = crypto_holdings.units + EXCLUDED.units, updated_at=now()`
		if _, err := tx.Exec(ctx, credit, ownerID, assetID, returnUnits); err != nil {
			return nil, fmt.Errorf("crypto: admin return withdrawal units: %w", err)
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
	return r.AdminGetWithdrawal(ctx, id)
}

func scanAdminWithdrawal(row rowScanner) (*AdminWithdrawal, error) {
	var w AdminWithdrawal
	var scale int64
	var providerRef, txHash, failureReason, reference *string
	if err := row.Scan(
		&w.ID, &w.UserID, &w.AssetID, &w.Symbol, &w.AddressID, &w.Address, &w.Network,
		&w.Status, &w.Units, &w.NetworkFeeUnits, &w.FeeKobo, &w.PriceKobo,
		&scale, &w.Provider, &providerRef, &txHash, &failureReason, &reference,
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
	w.ValueKobo = cashForUnits(w.Units, w.PriceKobo, scale)
	w.AmlFlags, w.AmlScore = deriveAmlSignals(w.ValueKobo, w.Status)
	return &w, nil
}

// deriveAmlSignals produces a lightweight, deterministic AML flag set + 0-100 score
// from the row itself (no external screening integration in this build). It is
// advisory display data for the review queue — the compliance officer's decision is
// the control, not this heuristic. TODO(crypto-admin): replace with a real screening
// provider verdict (persisted) when custody/screening is integrated.
func deriveAmlSignals(valueKobo int64, status string) ([]string, int) {
	flags := []string{}
	score := 0
	if valueKobo >= DefaultWithdrawReviewMinKobo {
		flags = append(flags, "amount_threshold")
		score += 40
	}
	if valueKobo >= DefaultWithdrawDailyLimitKobo {
		flags = append(flags, "high_value")
		score += 30
	}
	if status == WithdrawalRequested {
		// Still awaiting review — nudge visibility.
		score += 10
	}
	if score > 100 {
		score = 100
	}
	return flags, score
}

// ── Swaps (admin) ────────────────────────────────────────────────────────────

// AdminListSwaps returns swaps across all users (newest first).
func (r *Repository) AdminListSwaps(ctx context.Context, limit, offset int) ([]SwapOrder, error) {
	const q = `SELECT s.id, s.user_id, s.from_asset_id, fa.symbol, s.to_asset_id, ta.symbol,
	                  s.status, s.from_units, s.to_units, s.from_price_kobo, s.to_price_kobo,
	                  s.cash_kobo, s.spread_kobo, s.spread_bps, s.reference, s.created_at
	           FROM crypto_swap_orders s
	           JOIN crypto_assets fa ON fa.id = s.from_asset_id
	           JOIN crypto_assets ta ON ta.id = s.to_asset_id
	           ORDER BY s.created_at DESC LIMIT $1 OFFSET $2`
	rows, err := r.db.Query(ctx, q, limit, offset)
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

// ── Addresses (admin) ────────────────────────────────────────────────────────

// AdminListAddresses returns allow-list entries across all users (newest first).
// It includes inactive rows (pending/rejected) so the review queue is complete.
// review filters by the DERIVED verdict (pending|approved|rejected) — translated to
// a WHERE clause over (is_active, verified_at) since there is no review column yet.
func (r *Repository) AdminListAddresses(ctx context.Context, review string, limit, offset int) ([]AdminAddress, error) {
	q := `SELECT a.id, a.user_id, a.asset_id, ast.symbol, a.label, a.network, a.address,
	             a.is_active, a.verified_at, a.created_at
	      FROM crypto_addresses a JOIN crypto_assets ast ON ast.id = a.asset_id`
	switch review {
	case AddressReviewApproved:
		q += ` WHERE a.is_active = true`
	case AddressReviewPending:
		q += ` WHERE a.is_active = false AND a.verified_at IS NULL`
	case AddressReviewRejected:
		q += ` WHERE a.is_active = false AND a.verified_at IS NOT NULL`
	}
	q += ` ORDER BY a.created_at DESC LIMIT $1 OFFSET $2`
	rows, err := r.db.Query(ctx, q, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AdminAddress{}
	for rows.Next() {
		var a AdminAddress
		if err := rows.Scan(&a.ID, &a.UserID, &a.AssetID, &a.Symbol, &a.Label, &a.Network, &a.Address,
			&a.IsActive, &a.VerifiedAt, &a.CreatedAt); err != nil {
			return nil, err
		}
		a.ReviewStatus = deriveAddressReview(a.IsActive, a.VerifiedAt)
		out = append(out, a)
	}
	return out, rows.Err()
}

// AdminGetAddress returns a single allow-list entry by id (no user scope).
func (r *Repository) AdminGetAddress(ctx context.Context, id string) (*AdminAddress, error) {
	const q = `SELECT a.id, a.user_id, a.asset_id, ast.symbol, a.label, a.network, a.address,
	                  a.is_active, a.verified_at, a.created_at
	           FROM crypto_addresses a JOIN crypto_assets ast ON ast.id = a.asset_id
	           WHERE a.id=$1`
	var a AdminAddress
	if err := r.db.QueryRow(ctx, q, id).Scan(&a.ID, &a.UserID, &a.AssetID, &a.Symbol, &a.Label,
		&a.Network, &a.Address, &a.IsActive, &a.VerifiedAt, &a.CreatedAt); err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrAddressNotFound
		}
		return nil, err
	}
	a.ReviewStatus = deriveAddressReview(a.IsActive, a.VerifiedAt)
	return &a, nil
}

// AdminDecideAddress approves (is_active=true, verified_at=now) or rejects
// (is_active=false, verified_at=now — marks reviewed-and-blocked) an allow-list
// entry. Setting verified_at on both branches lets deriveAddressReview distinguish a
// reviewed-reject (verified_at set, inactive) from an un-reviewed pending row
// (verified_at NULL, inactive). Idempotent: re-applying the same verdict is a safe
// UPDATE to the same values.
func (r *Repository) AdminDecideAddress(ctx context.Context, id string, approve bool) (*AdminAddress, error) {
	const q = `UPDATE crypto_addresses
		SET is_active=$2, verified_at=now()
		WHERE id=$1
		RETURNING id`
	var got string
	if err := r.db.QueryRow(ctx, q, id, approve).Scan(&got); err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrAddressNotFound
		}
		return nil, err
	}
	return r.AdminGetAddress(ctx, id)
}

// ── Reconciliation (admin) ───────────────────────────────────────────────────

// AdminHeldUnitsByAsset returns, per asset, the total units the platform owes on
// custody: the sum of all holding projections PLUS units parked in non-terminal
// withdrawals (requested/pending/broadcast). Confirmed withdrawals have left custody
// (units burned); failed ones returned their units to holdings, so both are excluded.
// This is the "ledger side" of the reconciliation — the on-chain side is not yet
// integrated (see AdminReconciliation TODO).
func (r *Repository) AdminHeldUnitsByAsset(ctx context.Context) (map[string]int64, error) {
	held := map[string]int64{}
	const holdingsQ = `SELECT asset_id, COALESCE(SUM(units),0)
	                   FROM crypto_holdings GROUP BY asset_id`
	rows, err := r.db.Query(ctx, holdingsQ)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var assetID string
		var units int64
		if err := rows.Scan(&assetID, &units); err != nil {
			return nil, err
		}
		held[assetID] += units
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Units parked in non-terminal withdrawals are still owed on-chain.
	const parkedQ = `SELECT asset_id, COALESCE(SUM(units),0)
	                 FROM crypto_withdrawals
	                 WHERE status IN ('requested','pending','broadcast')
	                 GROUP BY asset_id`
	prows, err := r.db.Query(ctx, parkedQ)
	if err != nil {
		return nil, err
	}
	defer prows.Close()
	for prows.Next() {
		var assetID string
		var units int64
		if err := prows.Scan(&assetID, &units); err != nil {
			return nil, err
		}
		held[assetID] += units
	}
	return held, prows.Err()
}

// touchAdminTime keeps the time import referenced even under build-tag pruning.
var _ = time.Now
