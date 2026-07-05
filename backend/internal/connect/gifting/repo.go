package connectgifting

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository handles connect_gifts + connect_gift_catalog reads/writes over a
// pgx pool. All queries are parameterized; the gift insert is append-only
// (immutable transfer record — corrections are new rows, never UPDATE/DELETE).
type Repository struct {
	db *pgxpool.Pool
}

// NewRepository builds a gifting repository.
func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

const giftColumns = `id, sender_id, recipient_id, gift_code, amount_kobo, message,
	status, ledger_ref, created_at`

// GetCatalogItem resolves an active catalogue gift by code (server-side price
// source). Returns ErrGiftNotFound if missing or inactive.
func (r *Repository) GetCatalogItem(ctx context.Context, code string) (*CatalogItem, error) {
	const q = `SELECT id, code, name, icon_ref, amount_kobo, active
		FROM connect_gift_catalog WHERE code = $1 AND active = true`
	var ci CatalogItem
	if err := r.db.QueryRow(ctx, q, code).Scan(
		&ci.ID, &ci.Code, &ci.Name, &ci.IconRef, &ci.AmountKobo, &ci.Active,
	); err != nil {
		return nil, ErrGiftNotFound
	}
	return &ci, nil
}

// ListCatalog returns the active backend-owned gift catalogue.
func (r *Repository) ListCatalog(ctx context.Context) ([]CatalogItem, error) {
	const q = `SELECT id, code, name, icon_ref, amount_kobo, active
		FROM connect_gift_catalog WHERE active = true ORDER BY amount_kobo`
	rows, err := r.db.Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("gifting: list catalog: %w", err)
	}
	defer rows.Close()
	var out []CatalogItem
	for rows.Next() {
		var ci CatalogItem
		if err := rows.Scan(&ci.ID, &ci.Code, &ci.Name, &ci.IconRef, &ci.AmountKobo, &ci.Active); err != nil {
			return nil, err
		}
		out = append(out, ci)
	}
	return out, rows.Err()
}

// InsertGift records the immutable gift row after a successful ledger transfer.
func (r *Repository) InsertGift(ctx context.Context, g *Gift) (*Gift, error) {
	const ins = `INSERT INTO connect_gifts
		(sender_id, recipient_id, gift_code, amount_kobo, message, status, idempotency_key, ledger_ref)
		VALUES ($1,$2,$3,$4,$5,'sent',$6,$7)
		RETURNING ` + giftColumns
	out := &Gift{}
	if err := r.db.QueryRow(ctx, ins,
		g.SenderID, g.RecipientID, g.GiftCode, g.AmountKobo, g.Message, g.IdempotencyKey, g.LedgerRef,
	).Scan(
		&out.ID, &out.SenderID, &out.RecipientID, &out.GiftCode, &out.AmountKobo,
		&out.Message, &out.Status, &out.LedgerRef, &out.CreatedAt,
	); err != nil {
		return nil, fmt.Errorf("gifting: insert gift: %w", err)
	}
	return out, nil
}

// ListSent returns gifts sent by a user, newest first.
func (r *Repository) ListSent(ctx context.Context, userID string, limit int) ([]Gift, error) {
	return r.listByColumn(ctx, "sender_id", userID, limit)
}

// ListReceived returns gifts received by a user, newest first.
func (r *Repository) ListReceived(ctx context.Context, userID string, limit int) ([]Gift, error) {
	return r.listByColumn(ctx, "recipient_id", userID, limit)
}

// listByColumn is the shared list query. The column name is a fixed internal
// constant (never user input), so it is safe to interpolate; all values stay
// parameterized.
func (r *Repository) listByColumn(ctx context.Context, column, userID string, limit int) ([]Gift, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	q := `SELECT ` + giftColumns + ` FROM connect_gifts WHERE ` + column +
		` = $1 ORDER BY created_at DESC LIMIT $2`
	rows, err := r.db.Query(ctx, q, userID, limit)
	if err != nil {
		return nil, fmt.Errorf("gifting: list gifts: %w", err)
	}
	defer rows.Close()
	var out []Gift
	for rows.Next() {
		var g Gift
		if err := rows.Scan(
			&g.ID, &g.SenderID, &g.RecipientID, &g.GiftCode, &g.AmountKobo,
			&g.Message, &g.Status, &g.LedgerRef, &g.CreatedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, rows.Err()
}
