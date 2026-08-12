package handlers

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// WalletStore provides data access for wallet operations.
type WalletStore struct {
	db *pgxpool.Pool
}

// NewWalletStore creates a new wallet store.
func NewWalletStore(db *pgxpool.Pool) *WalletStore {
	return &WalletStore{db: db}
}

// WalletSummary represents user's wallet overview.
type WalletSummary struct {
	UserID       string `json:"userId"`
	BalanceKobo  int64  `json:"balanceKobo"`
	Currency     string `json:"currency"`
	Tier         int    `json:"tier"`
	DailySpent   int64  `json:"dailySpent"`
	DailyLimit   int64  `json:"dailyLimit"`
	MonthlySpent int64  `json:"monthlySpent"`
	MonthlyLimit int64  `json:"monthlyLimit"`
}

// GetWalletSummary retrieves user's wallet balance and tier info.
func (s *WalletStore) GetWalletSummary(ctx context.Context, userID string) (*WalletSummary, error) {
	row := s.db.QueryRow(ctx, `
		SELECT
			$1 as user_id,
			COALESCE(
				(SELECT COALESCE(SUM(amount_kobo), 0)
				 FROM ledger_entries
				 WHERE ledger_entries.user_id = $1
				 AND type = 'credit'
				 MINUS
				 SELECT COALESCE(SUM(amount_kobo), 0)
				 FROM ledger_entries
				 WHERE ledger_entries.user_id = $1
				 AND type = 'debit'
				),
				0
			) as balance_kobo,
			'NGN' as currency,
			COALESCE(k.tier, 0) as tier,
			COALESCE(
				(SELECT COALESCE(SUM(amount_kobo), 0)
				 FROM ledger_entries
				 WHERE ledger_entries.user_id = $1
				 AND type = 'debit'
				 AND DATE(created_at) = DATE(NOW())
				),
				0
			) as daily_spent,
			CASE COALESCE(k.tier, 0)
				WHEN 1 THEN 500000  -- 5,000 NGN
				WHEN 2 THEN 2000000 -- 20,000 NGN
				WHEN 3 THEN 10000000 -- 100,000 NGN
				ELSE 100000 -- 1,000 NGN (Tier 0)
			END as daily_limit,
			COALESCE(
				(SELECT COALESCE(SUM(amount_kobo), 0)
				 FROM ledger_entries
				 WHERE ledger_entries.user_id = $1
				 AND type = 'debit'
				 AND DATE_TRUNC('month', created_at) = DATE_TRUNC('month', NOW())
				),
				0
			) as monthly_spent,
			CASE COALESCE(k.tier, 0)
				WHEN 1 THEN 10000000 -- 100,000 NGN
				WHEN 2 THEN 50000000 -- 500,000 NGN
				WHEN 3 THEN 500000000 -- 5,000,000 NGN
				ELSE 1000000 -- 10,000 NGN (Tier 0)
			END as monthly_limit
		FROM kyc_profiles k WHERE k.user_id = $1
	`, userID)

	var ws WalletSummary
	err := row.Scan(&ws.UserID, &ws.BalanceKobo, &ws.Currency, &ws.Tier,
		&ws.DailySpent, &ws.DailyLimit, &ws.MonthlySpent, &ws.MonthlyLimit)
	if err == sql.ErrNoRows {
		// New user: return zero balance
		return &WalletSummary{
			UserID:       userID,
			BalanceKobo:  0,
			Currency:     "NGN",
			Tier:         0,
			DailySpent:   0,
			DailyLimit:   100000,
			MonthlySpent: 0,
			MonthlyLimit: 1000000,
		}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("query wallet summary: %w", err)
	}

	return &ws, nil
}

// Transaction represents a wallet transaction (credit or debit).
type Transaction struct {
	ID          string `json:"id"`
	UserID      string `json:"userId"`
	Type        string `json:"type"` // "credit" or "debit"
	AmountKobo  int64  `json:"amountKobo"`
	Currency    string `json:"currency"`
	Reference   string `json:"reference"`
	Description string `json:"description"`
	CreatedAt   string `json:"createdAt"`
}

// GetTransactionHistory retrieves paginated transaction history.
func (s *WalletStore) GetTransactionHistory(ctx context.Context, userID string, limit int, offset int) ([]Transaction, int64, error) {
	// Get total count
	var total int64
	err := s.db.QueryRow(ctx, `
		SELECT COUNT(*) FROM ledger_entries WHERE user_id = $1
	`, userID).Scan(&total)
	if err != nil {
		return nil, 0, fmt.Errorf("count transactions: %w", err)
	}

	// Get paginated results
	rows, err := s.db.Query(ctx, `
		SELECT
			id, user_id, type, amount_kobo, 'NGN' as currency,
			reference, COALESCE(description, '') as description,
			created_at::text
		FROM ledger_entries
		WHERE user_id = $1
		ORDER BY created_at DESC
		LIMIT $2 OFFSET $3
	`, userID, limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("query transactions: %w", err)
	}
	defer rows.Close()

	var transactions []Transaction
	for rows.Next() {
		var t Transaction
		if err := rows.Scan(&t.ID, &t.UserID, &t.Type, &t.AmountKobo,
			&t.Currency, &t.Reference, &t.Description, &t.CreatedAt); err != nil {
			return nil, 0, fmt.Errorf("scan transaction: %w", err)
		}
		transactions = append(transactions, t)
	}

	return transactions, total, rows.Err()
}

// GetTransaction retrieves a single transaction by ID.
func (s *WalletStore) GetTransaction(ctx context.Context, userID string, txnID string) (*Transaction, error) {
	row := s.db.QueryRow(ctx, `
		SELECT
			id, user_id, type, amount_kobo, 'NGN' as currency,
			reference, COALESCE(description, '') as description,
			created_at::text
		FROM ledger_entries
		WHERE id = $1 AND user_id = $2
	`, txnID, userID)

	var t Transaction
	err := row.Scan(&t.ID, &t.UserID, &t.Type, &t.AmountKobo,
		&t.Currency, &t.Reference, &t.Description, &t.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil // Not found
	}
	if err != nil {
		return nil, fmt.Errorf("query transaction: %w", err)
	}

	return &t, nil
}

// RecordFunding records a wallet funding transaction.
func (s *WalletStore) RecordFunding(ctx context.Context, userID string, reference string, amount int64, idemKey string) (*Transaction, error) {
	row := s.db.QueryRow(ctx, `
		INSERT INTO ledger_entries (
			id, user_id, type, amount_kobo, reference, description,
			idempotency_key, created_at
		) VALUES (
			gen_random_uuid(), $1, 'credit', $2, $3, 'Wallet funding', $4, NOW()
		)
		RETURNING id, user_id, type, amount_kobo, 'NGN' as currency,
		          reference, description, created_at::text
	`, userID, amount, reference, idemKey)

	var t Transaction
	err := row.Scan(&t.ID, &t.UserID, &t.Type, &t.AmountKobo,
		&t.Currency, &t.Reference, &t.Description, &t.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("record funding: %w", err)
	}

	return &t, nil
}
