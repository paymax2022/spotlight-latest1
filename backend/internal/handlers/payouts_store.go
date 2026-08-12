package handlers

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PayoutsStore provides data access for payout operations.
type PayoutsStore struct {
	db *pgxpool.Pool
}

// NewPayoutsStore creates a new payouts store.
func NewPayoutsStore(db *pgxpool.Pool) *PayoutsStore {
	return &PayoutsStore{db: db}
}

// PayoutEligibility represents user's payout eligibility.
type PayoutEligibility struct {
	UserID            string `json:"userId"`
	Tier              int    `json:"tier"`
	Eligible          bool   `json:"eligible"`
	MinimumBalanceKobo int64  `json:"minimumBalanceKobo"`
	CurrentBalanceKobo int64  `json:"currentBalanceKobo"`
	RequiredDocuments  []string `json:"requiredDocuments"`
	Message           string `json:"message"`
}

// GetPayoutEligibility checks if user can request a payout.
func (s *PayoutsStore) GetPayoutEligibility(ctx context.Context, userID string) (*PayoutEligibility, error) {
	// Tier comes from user_profiles.kyc_tier — the same source finance/tiers
	// enforces against — so the eligibility preview cannot disagree with the
	// fail-closed gate that actually blocks the debit.
	row := s.db.QueryRow(ctx, `
		SELECT
			p.id::text,
			COALESCE(p.kyc_tier, 0) AS tier,
			COALESCE(p.kyc_tier, 0) >= 2 AS eligible,
			CASE COALESCE(p.kyc_tier, 0)
				WHEN 2 THEN 100000
				WHEN 3 THEN 50000
				ELSE 1000000
			END AS minimum_balance_kobo,
			(
				SELECT COALESCE(SUM(
					CASE WHEN le.type IN ('CREDIT', 'REVERSAL_DEBIT')
					     THEN le.amount_kobo ELSE -le.amount_kobo END
				), 0)
				FROM ledger_entries le
				JOIN ledger_accounts la ON la.id = le.account_id
				WHERE la.user_id = p.id AND la.type = 'user_wallet'
			) AS current_balance_kobo
		FROM user_profiles p
		WHERE p.id = $1
	`, userID)

	var elig PayoutEligibility
	err := row.Scan(&elig.UserID, &elig.Tier, &elig.Eligible,
		&elig.MinimumBalanceKobo, &elig.CurrentBalanceKobo)
	if errors.Is(err, pgx.ErrNoRows) {
		return &PayoutEligibility{
			UserID:   userID,
			Tier:     0,
			Eligible: false,
			Message:  "KYC Tier 2 or higher required for payouts",
		}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("query payout eligibility: %w", err)
	}

	// Check balance requirement
	if elig.Eligible && elig.CurrentBalanceKobo < elig.MinimumBalanceKobo {
		elig.Eligible = false
		elig.Message = fmt.Sprintf("Minimum balance %d kobo required", elig.MinimumBalanceKobo)
	} else if elig.Tier < 2 {
		elig.Message = "KYC Tier 2 or higher required for payouts"
	} else {
		elig.Message = "Eligible for payout"
	}

	return &elig, nil
}

// PayoutRequest represents a payout request.
type PayoutRequest struct {
	ID              string `json:"id"`
	Reference       string `json:"reference"`
	UserID          string `json:"userId"`
	AmountKobo      int64  `json:"amountKobo"`
	Status          string `json:"status"` // pending, processing, completed, failed
	BankName        string `json:"bankName"`
	AccountNumber   string `json:"accountNumber"`
	AccountName     string `json:"accountName"`
	CreatedAt       string `json:"createdAt"`
	CompletedAt     sql.NullString `json:"completedAt"`
}

// RequestPayout creates a new payout request.
func (s *PayoutsStore) RequestPayout(ctx context.Context, userID string, amountKobo int64, bankName string, accountNumber string, accountName string, reference string, idemKey string) (*PayoutRequest, error) {
	row := s.db.QueryRow(ctx, `
		INSERT INTO payouts (
			id, user_id, reference, amount_kobo, status,
			bank_name, account_number, account_name,
			idempotency_key, created_at
		) VALUES (
			gen_random_uuid(), $1, $2, $3, 'pending',
			$4, $5, $6, $7, NOW()
		)
		RETURNING id, reference, user_id, amount_kobo, status,
		          bank_name, account_number, account_name,
		          created_at::text, completed_at::text
	`, userID, reference, amountKobo, bankName, accountNumber, accountName, idemKey)

	var payout PayoutRequest
	err := row.Scan(&payout.ID, &payout.Reference, &payout.UserID, &payout.AmountKobo,
		&payout.Status, &payout.BankName, &payout.AccountNumber, &payout.AccountName,
		&payout.CreatedAt, &payout.CompletedAt)
	if err != nil {
		return nil, fmt.Errorf("request payout: %w", err)
	}

	return &payout, nil
}

// GetPayoutHistory retrieves user's payout history (paginated).
func (s *PayoutsStore) GetPayoutHistory(ctx context.Context, userID string, limit int, offset int) ([]PayoutRequest, int64, error) {
	// Get total count
	var total int64
	err := s.db.QueryRow(ctx, `
		SELECT COUNT(*) FROM payouts WHERE user_id = $1
	`, userID).Scan(&total)
	if err != nil {
		return nil, 0, fmt.Errorf("count payouts: %w", err)
	}

	// Get paginated results
	rows, err := s.db.Query(ctx, `
		SELECT
			id, reference, user_id, amount_kobo, status,
			COALESCE(bank_name, '') as bank_name,
			COALESCE(account_number, '') as account_number,
			COALESCE(account_name, '') as account_name,
			created_at::text, completed_at::text
		FROM payouts
		WHERE user_id = $1
		ORDER BY created_at DESC
		LIMIT $2 OFFSET $3
	`, userID, limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("query payouts: %w", err)
	}
	defer rows.Close()

	var payouts []PayoutRequest
	for rows.Next() {
		var p PayoutRequest
		if err := rows.Scan(&p.ID, &p.Reference, &p.UserID, &p.AmountKobo,
			&p.Status, &p.BankName, &p.AccountNumber, &p.AccountName,
			&p.CreatedAt, &p.CompletedAt); err != nil {
			return nil, 0, fmt.Errorf("scan payout: %w", err)
		}
		payouts = append(payouts, p)
	}

	return payouts, total, rows.Err()
}
