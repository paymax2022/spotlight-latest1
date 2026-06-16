package wallet

import (
	"context"
	"fmt"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
)

// Service exposes wallet operations to handlers.
// It delegates all money mutations to the ledger service.
type Service struct {
	ledger *ledger.Service
	tiers  *tiers.Service
}

func NewService(ledger *ledger.Service, tiers *tiers.Service) *Service {
	return &Service{ledger: ledger, tiers: tiers}
}

// GetBalance returns the current wallet balance.
func (s *Service) GetBalance(ctx context.Context, userID string) (*BalanceResponse, error) {
	balKobo, err := s.ledger.GetBalance(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("wallet: get balance: %w", err)
	}
	return &BalanceResponse{
		UserID:       userID,
		BalanceKobo:  balKobo,
		BalanceNaira: float64(balKobo) / 100,
	}, nil
}

// Credit credits the user's wallet. Called by webhook handlers when a Paystack
// charge succeeds. The standing account for the source is providerClearing.
func (s *Service) Credit(ctx context.Context, userID, reference, idempotencyKey string, amountKobo int64) error {
	acc, err := s.ledger.GetOrCreateUserWallet(ctx, userID)
	if err != nil {
		return err
	}
	// Standing provider clearing account (no user_id) — get its ID.
	clearingAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
	if err != nil {
		return err
	}
	_ = acc
	return s.ledger.Credit(ctx, userID, reference, idempotencyKey, clearingAcc.ID, amountKobo)
}

// Debit debits the user's wallet. Enforces tier limits before posting.
func (s *Service) Debit(ctx context.Context, userID, reference, idempotencyKey, creditAccountID string, amountKobo int64) error {
	if err := s.tiers.EnforceWalletDebitLimit(ctx, userID, amountKobo); err != nil {
		return err
	}
	return s.ledger.Debit(ctx, userID, reference, idempotencyKey, creditAccountID, amountKobo)
}

// VoteDebit debits the user's wallet and credits the platform commission account.
// Used by the vote bridge to charge for paid votes without an external payment provider.
func (s *Service) VoteDebit(ctx context.Context, userID, reference, idempotencyKey string, amountKobo int64) error {
	commissionAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountCommission)
	if err != nil {
		return fmt.Errorf("wallet: resolve commission account: %w", err)
	}
	return s.Debit(ctx, userID, reference, idempotencyKey, commissionAcc.ID, amountKobo)
}

// ListTransactions returns paginated ledger entries as user-facing transactions.
func (s *Service) ListTransactions(ctx context.Context, userID string, limit, offset int) (*TransactionsResponse, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	entries, err := s.ledger.ListTransactions(ctx, userID, limit, offset)
	if err != nil {
		return nil, err
	}
	txns := make([]Transaction, len(entries))
	for i, e := range entries {
		txType := "debit"
		if e.Type == ledger.EntryCredit || e.Type == ledger.EntryReversalDebit {
			txType = "credit"
		}
		txns[i] = Transaction{
			ID:         e.ID,
			Type:       txType,
			AmountKobo: e.AmountKobo,
			Reference:  e.Reference,
			CreatedAt:  e.CreatedAt,
		}
	}
	return &TransactionsResponse{
		Transactions: txns,
		Limit:        limit,
		Offset:       offset,
	}, nil
}
