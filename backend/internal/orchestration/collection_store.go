package orchestration

// collection_store.go — read path for the FX collections / virtual-accounts
// vertical (mobile src/features/fx/api/fx.api.ts getVirtualAccounts/getCollections).
//
// Virtual accounts already PERSIST to orch_collections (repository.go
// SaveCollection, written by the real CreateCollection handler). This store adds
// the object-scoped LIST reads that were previously empty stubs. No new table is
// created for virtual accounts — we reuse orch_collections, which keys on
// customer_id (= the business/tenant id, the authenticated customer).
//
// Collection EVENTS (inbound credits into a virtual account) have no persistence
// yet — no provider collection feed is wired — so ListCollectionEvents returns an
// empty (non-nil) slice. When the inbound webhook lands, back this with a table
// and normalize provider events into it.
//
// A nil store makes the handlers fall back to the empty-slice stubs.

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// CollectionMoney is the { amount, currency } money object (minor units),
// mirroring the mobile Money shape embedded in a CollectionEvent.
type CollectionMoney struct {
	Amount   int64  `json:"amount"`
	Currency string `json:"currency"`
}

// CollectionEvent mirrors the mobile CollectionEvent contract.
type CollectionEvent struct {
	ID               string          `json:"id"`
	VirtualAccountID string          `json:"virtualAccountId"`
	Amount           CollectionMoney `json:"amount"`
	SenderName       *string         `json:"senderName"`
	Reference        *string         `json:"reference"`
	CreatedAt        string          `json:"createdAt"`
}

// CollectionStore reads the collections / virtual-accounts persistence.
type CollectionStore interface {
	ListVirtualAccounts(ctx context.Context, business string) ([]VirtualAccount, error)
	ListCollectionEvents(ctx context.Context, business string) ([]CollectionEvent, error)
}

// sqlCollectionStore is the Postgres-backed implementation.
type sqlCollectionStore struct {
	db *pgxpool.Pool
}

// NewCollectionStore returns a Postgres-backed collections store.
func NewCollectionStore(db *pgxpool.Pool) CollectionStore { return &sqlCollectionStore{db: db} }

// ListVirtualAccounts lists the business's virtual accounts from orch_collections
// (object-scoped by customer_id = business/tenant id).
func (s *sqlCollectionStore) ListVirtualAccounts(ctx context.Context, business string) ([]VirtualAccount, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id, currency, type, provider, status, details, created_at
		FROM orch_collections WHERE customer_id=$1
		ORDER BY created_at DESC`, business)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]VirtualAccount, 0)
	for rows.Next() {
		var va VirtualAccount
		var details []byte
		var created time.Time
		if err := rows.Scan(&va.ID, &va.Currency, &va.Type, &va.Provider, &va.Status, &details, &created); err != nil {
			return nil, err
		}
		va.CreatedAt = created
		if len(details) > 0 {
			_ = json.Unmarshal(details, &va.Details)
		}
		if va.Details == nil {
			va.Details = map[string]interface{}{}
		}
		out = append(out, va)
	}
	return out, rows.Err()
}

// ListCollectionEvents returns inbound collection credits. Not yet persisted (no
// provider collection feed wired) → empty non-nil slice so the screen renders.
func (s *sqlCollectionStore) ListCollectionEvents(ctx context.Context, business string) ([]CollectionEvent, error) {
	return make([]CollectionEvent, 0), nil
}
