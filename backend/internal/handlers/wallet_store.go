package handlers

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// WalletStore provides read-only projections over the ledger for the Connect
// wallet endpoints. All money MUTATIONS go through finance/wallet.Service so
// they post balanced double-entry journals — never write ledger_entries here.
type WalletStore struct {
	db *pgxpool.Pool
}

// NewWalletStore creates a new wallet store.
func NewWalletStore(db *pgxpool.Pool) *WalletStore {
	return &WalletStore{db: db}
}

// Transaction is one ledger entry against the user's wallet account.
type Transaction struct {
	ID          string `json:"id"`
	Type        string `json:"type"` // "credit" or "debit" (user-facing direction)
	AmountKobo  int64  `json:"amountKobo"`
	Currency    string `json:"currency"`
	Reference   string `json:"reference"`
	Description string `json:"description"`
	CreatedAt   string `json:"createdAt"`
}

// direction maps a ledger entry type to the user-facing credit/debit direction.
// A REVERSAL_DEBIT restores funds, so it reads as a credit to the user.
func direction(entryType string) string {
	switch entryType {
	case "CREDIT", "REVERSAL_DEBIT":
		return "credit"
	default:
		return "debit"
	}
}

// CountTransactions returns the number of ledger entries against the user's wallet.
func (s *WalletStore) CountTransactions(ctx context.Context, userID string) (int64, error) {
	var total int64
	err := s.db.QueryRow(ctx, `
		SELECT COUNT(*)
		FROM ledger_entries le
		JOIN ledger_accounts la ON la.id = le.account_id
		WHERE la.user_id = $1 AND la.type = 'user_wallet'
	`, userID).Scan(&total)
	if err != nil {
		return 0, fmt.Errorf("count transactions: %w", err)
	}
	return total, nil
}

// GetTransaction retrieves a single wallet ledger entry, scoped to the owner.
func (s *WalletStore) GetTransaction(ctx context.Context, userID string, txnID string) (*Transaction, error) {
	row := s.db.QueryRow(ctx, `
		SELECT le.id::text, le.type, le.amount_kobo, le.reference,
		       COALESCE(le.description, ''), le.created_at::text
		FROM ledger_entries le
		JOIN ledger_accounts la ON la.id = le.account_id
		WHERE le.id = $1 AND la.user_id = $2 AND la.type = 'user_wallet'
	`, txnID, userID)

	var t Transaction
	var entryType string
	err := row.Scan(&t.ID, &entryType, &t.AmountKobo, &t.Reference,
		&t.Description, &t.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil // Not found
	}
	if err != nil {
		return nil, fmt.Errorf("query transaction: %w", err)
	}

	t.Type = direction(entryType)
	t.Currency = "NGN"
	return &t, nil
}
