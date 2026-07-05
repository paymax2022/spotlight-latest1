package crypto

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository owns all SQL for the crypto module. Holdings are a projection moved
// only through the order/ledger flow; the cash leg lives in the finance ledger.
type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

// ── Assets ────────────────────────────────────────────────────────────────────

// ListAssets returns catalogue assets. activeOnly filters to tradable ones.
func (r *Repository) ListAssets(ctx context.Context, activeOnly bool) ([]Asset, error) {
	q := `SELECT id, symbol, name, minor_unit_scale, is_active, created_at, updated_at
	      FROM crypto_assets`
	if activeOnly {
		q += ` WHERE is_active = true`
	}
	q += ` ORDER BY symbol ASC`
	rows, err := r.db.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Asset{}
	for rows.Next() {
		var a Asset
		if err := rows.Scan(&a.ID, &a.Symbol, &a.Name, &a.MinorUnitScale, &a.IsActive, &a.CreatedAt, &a.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// GetAsset returns a single asset by id.
func (r *Repository) GetAsset(ctx context.Context, id string) (*Asset, error) {
	const q = `SELECT id, symbol, name, minor_unit_scale, is_active, created_at, updated_at
	           FROM crypto_assets WHERE id=$1`
	var a Asset
	if err := r.db.QueryRow(ctx, q, id).Scan(&a.ID, &a.Symbol, &a.Name, &a.MinorUnitScale, &a.IsActive, &a.CreatedAt, &a.UpdatedAt); err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &a, nil
}

// UpsertAsset creates or updates a catalogue asset (admin config). Keyed on symbol.
func (r *Repository) UpsertAsset(ctx context.Context, symbol, name string, minorUnitScale int64, isActive bool) (*Asset, error) {
	const q = `INSERT INTO crypto_assets (symbol, name, minor_unit_scale, is_active)
	           VALUES ($1,$2,$3,$4)
	           ON CONFLICT (symbol) DO UPDATE
	             SET name=EXCLUDED.name, minor_unit_scale=EXCLUDED.minor_unit_scale,
	                 is_active=EXCLUDED.is_active, updated_at=now()
	           RETURNING id, symbol, name, minor_unit_scale, is_active, created_at, updated_at`
	var a Asset
	if err := r.db.QueryRow(ctx, q, symbol, name, minorUnitScale, isActive).Scan(
		&a.ID, &a.Symbol, &a.Name, &a.MinorUnitScale, &a.IsActive, &a.CreatedAt, &a.UpdatedAt); err != nil {
		return nil, fmt.Errorf("crypto: upsert asset: %w", err)
	}
	return &a, nil
}

// ── Price snapshots ──────────────────────────────────────────────────────────

// InsertSnapshot records a quote used for a fill (audit trail).
func (r *Repository) InsertSnapshot(ctx context.Context, assetID string, priceKobo int64, source string) error {
	const q = `INSERT INTO crypto_price_snapshots (asset_id, price_kobo, source) VALUES ($1,$2,$3)`
	_, err := r.db.Exec(ctx, q, assetID, priceKobo, source)
	return err
}

// PricePoint is one row of an asset's price history (chart series).
type PricePoint struct {
	PriceKobo int64  `json:"price_kobo"`
	Source    string `json:"source"`
	AsOf      string `json:"as_of"`
}

// PriceHistory returns recorded price snapshots for an asset, newest first,
// bounded by limit. Backed by crypto_price_snapshots (populated on every fill).
func (r *Repository) PriceHistory(ctx context.Context, assetID string, limit int) ([]PricePoint, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	const q = `SELECT price_kobo, source, created_at
	           FROM crypto_price_snapshots WHERE asset_id=$1
	           ORDER BY created_at DESC LIMIT $2`
	rows, err := r.db.Query(ctx, q, assetID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PricePoint{}
	for rows.Next() {
		var p PricePoint
		var asOf time.Time
		if err := rows.Scan(&p.PriceKobo, &p.Source, &asOf); err != nil {
			return nil, err
		}
		p.AsOf = asOf.UTC().Format(time.RFC3339)
		out = append(out, p)
	}
	return out, rows.Err()
}

// GetOrder returns a single order by id scoped to the owning user (object-level
// authZ): a caller can only read their own transaction.
func (r *Repository) GetOrder(ctx context.Context, userID, orderID string) (*Order, error) {
	const q = `SELECT o.id, o.user_id, o.asset_id, a.symbol, o.side, o.status,
	                  o.cash_kobo, o.units, o.price_kobo, o.reference, o.created_at
	           FROM crypto_orders o JOIN crypto_assets a ON a.id = o.asset_id
	           WHERE o.id=$1 AND o.user_id=$2`
	var o Order
	var ref *string
	if err := r.db.QueryRow(ctx, q, orderID, userID).Scan(&o.ID, &o.UserID, &o.AssetID, &o.Symbol,
		&o.Side, &o.Status, &o.CashKobo, &o.Units, &o.PriceKobo, &ref, &o.CreatedAt); err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrNotFound
		}
		return nil, err
	}
	if ref != nil {
		o.Reference = *ref
	}
	return &o, nil
}

// ── Orders + holdings (money path) ───────────────────────────────────────────

// HoldingUnits returns the user's current minor-unit position for an asset.
func (r *Repository) HoldingUnits(ctx context.Context, userID, assetID string) (int64, error) {
	const q = `SELECT COALESCE(units,0) FROM crypto_holdings WHERE user_id=$1 AND asset_id=$2`
	var units int64
	err := r.db.QueryRow(ctx, q, userID, assetID).Scan(&units)
	if err == pgx.ErrNoRows {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	return units, nil
}

// RecordFill atomically writes the order row and moves the holding projection by
// deltaUnits (positive on buy, negative on sell). The cash leg is posted to the
// finance ledger by the caller; this is the asset-unit side of the same balanced
// movement. ON CONFLICT (idempotency_key) makes a replay a no-op (returns the
// existing order id via the duplicate signal).
func (r *Repository) RecordFill(ctx context.Context, o Order, deltaUnits int64) (string, bool, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return "", false, err
	}
	defer tx.Rollback(ctx)

	const insOrder = `INSERT INTO crypto_orders
		(user_id, asset_id, side, status, cash_kobo, units, price_kobo, idempotency_key, reference)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		ON CONFLICT (idempotency_key) DO NOTHING
		RETURNING id`
	var orderID string
	err = tx.QueryRow(ctx, insOrder,
		o.UserID, o.AssetID, o.Side, "filled", o.CashKobo, o.Units, o.PriceKobo, o.IdempotencyKey(), o.Reference,
	).Scan(&orderID)
	if err == pgx.ErrNoRows {
		// Duplicate idempotency key → replay; fetch the existing order id.
		if e := tx.QueryRow(ctx,
			`SELECT id FROM crypto_orders WHERE idempotency_key=$1`, o.IdempotencyKey()).Scan(&orderID); e != nil {
			return "", false, e
		}
		_ = tx.Commit(ctx)
		return orderID, true, nil // duplicate=true: caller must NOT re-post ledger
	}
	if err != nil {
		return "", false, fmt.Errorf("crypto: insert order: %w", err)
	}

	// Move the holding projection. CHECK (units >= 0) fail-closes an oversell.
	const upHolding = `INSERT INTO crypto_holdings (user_id, asset_id, units)
		VALUES ($1,$2,$3)
		ON CONFLICT (user_id, asset_id) DO UPDATE
		  SET units = crypto_holdings.units + EXCLUDED.units, updated_at=now()`
	if _, err := tx.Exec(ctx, upHolding, o.UserID, o.AssetID, deltaUnits); err != nil {
		return "", false, fmt.Errorf("crypto: move holding: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return "", false, err
	}
	return orderID, false, nil
}

// Holdings returns the user's non-zero positions.
func (r *Repository) Holdings(ctx context.Context, userID string) ([]Holding, error) {
	const q = `SELECT h.asset_id, a.symbol, h.units, h.updated_at
	           FROM crypto_holdings h JOIN crypto_assets a ON a.id = h.asset_id
	           WHERE h.user_id=$1 AND h.units > 0
	           ORDER BY a.symbol ASC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Holding{}
	for rows.Next() {
		var h Holding
		if err := rows.Scan(&h.AssetID, &h.Symbol, &h.Units, &h.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, h)
	}
	return out, rows.Err()
}

// OrdersForUser returns the user's order history (newest first).
func (r *Repository) OrdersForUser(ctx context.Context, userID string, limit, offset int) ([]Order, error) {
	const q = `SELECT o.id, o.user_id, o.asset_id, a.symbol, o.side, o.status,
	                  o.cash_kobo, o.units, o.price_kobo, o.reference, o.created_at
	           FROM crypto_orders o JOIN crypto_assets a ON a.id = o.asset_id
	           WHERE o.user_id=$1 ORDER BY o.created_at DESC LIMIT $2 OFFSET $3`
	return r.scanOrders(ctx, q, userID, limit, offset)
}

// AllOrders returns every order (admin oversight, newest first).
func (r *Repository) AllOrders(ctx context.Context, limit, offset int) ([]Order, error) {
	const q = `SELECT o.id, o.user_id, o.asset_id, a.symbol, o.side, o.status,
	                  o.cash_kobo, o.units, o.price_kobo, o.reference, o.created_at
	           FROM crypto_orders o JOIN crypto_assets a ON a.id = o.asset_id
	           ORDER BY o.created_at DESC LIMIT $1 OFFSET $2`
	return r.scanOrders(ctx, q, limit, offset)
}

func (r *Repository) scanOrders(ctx context.Context, q string, args ...any) ([]Order, error) {
	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Order{}
	for rows.Next() {
		var o Order
		var ref *string
		if err := rows.Scan(&o.ID, &o.UserID, &o.AssetID, &o.Symbol, &o.Side, &o.Status,
			&o.CashKobo, &o.Units, &o.PriceKobo, &ref, &o.CreatedAt); err != nil {
			return nil, err
		}
		if ref != nil {
			o.Reference = *ref
		}
		out = append(out, o)
	}
	return out, rows.Err()
}
