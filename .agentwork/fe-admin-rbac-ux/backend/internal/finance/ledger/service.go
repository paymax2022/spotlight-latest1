package ledger

import (
	"context"
	"fmt"

	redisPkg "spotlight/backend/internal/platform/redis"

	goredis "github.com/redis/go-redis/v9"
)

// Service is the high-level ledger API consumed by other finance modules.
type Service struct {
	repo  *Repository
	redis *goredis.Client // optional; nil means no idempotency cache
}

func NewService(repo *Repository, redis *goredis.Client) *Service {
	return &Service{repo: repo, redis: redis}
}

// GetOrCreateUserWallet returns (or creates) the user_wallet ledger account.
func (s *Service) GetOrCreateUserWallet(ctx context.Context, userID string) (*Account, error) {
	return s.repo.GetOrCreateAccount(ctx, &userID, AccountUserWallet)
}

// GetOrCreateStandingAccount returns (or creates) a system-level standing account
// (no user_id). These are singletons keyed by type.
func (s *Service) GetOrCreateStandingAccount(ctx context.Context, accountType AccountType) (*Account, error) {
	return s.repo.GetOrCreateAccount(ctx, nil, accountType)
}

// GetBalance returns the current wallet balance for a user in kobo.
func (s *Service) GetBalance(ctx context.Context, userID string) (int64, error) {
	acc, err := s.GetOrCreateUserWallet(ctx, userID)
	if err != nil {
		return 0, err
	}
	return s.repo.GetBalance(ctx, acc.ID)
}

// Credit posts a CREDIT journal entry to the user's wallet (money in).
// The counterpart debit is posted to the specified standing account.
// idempotencyKey must be globally unique per event.
func (s *Service) Credit(ctx context.Context, userID, reference, idempotencyKey, debitAccountID string, amountKobo int64) error {
	if amountKobo <= 0 {
		return fmt.Errorf("ledger: credit amount must be positive, got %d", amountKobo)
	}

	// Fast duplicate check via Redis (falls back to DB unique constraint).
	if s.redis != nil {
		ok, _, err := redisPkg.AcquireLock(ctx, s.redis, "idem:"+idempotencyKey, 0)
		if err == nil && !ok {
			return ErrDuplicate
		}
	}

	acc, err := s.GetOrCreateUserWallet(ctx, userID)
	if err != nil {
		return err
	}
	return s.repo.PostJournal(ctx, JournalEntry{
		Reference:       reference,
		IdempotencyKey:  idempotencyKey,
		AmountKobo:      amountKobo,
		DebitAccountID:  debitAccountID,
		CreditAccountID: acc.ID,
	})
}

// Debit posts a DEBIT journal entry from the user's wallet (money out).
// Fails with ErrInsufficientFunds if balance < amountKobo.
func (s *Service) Debit(ctx context.Context, userID, reference, idempotencyKey, creditAccountID string, amountKobo int64) error {
	if amountKobo <= 0 {
		return fmt.Errorf("ledger: debit amount must be positive, got %d", amountKobo)
	}

	if s.redis != nil {
		ok, _, err := redisPkg.AcquireLock(ctx, s.redis, "idem:"+idempotencyKey, 0)
		if err == nil && !ok {
			return ErrDuplicate
		}
	}

	acc, err := s.GetOrCreateUserWallet(ctx, userID)
	if err != nil {
		return err
	}

	balance, err := s.repo.GetBalance(ctx, acc.ID)
	if err != nil {
		return err
	}
	if balance < amountKobo {
		return ErrInsufficientFunds
	}

	return s.repo.PostJournal(ctx, JournalEntry{
		Reference:       reference,
		IdempotencyKey:  idempotencyKey,
		AmountKobo:      amountKobo,
		DebitAccountID:  acc.ID,
		CreditAccountID: creditAccountID,
	})
}

// ListTransactions returns paginated ledger entries for a user.
func (s *Service) ListTransactions(ctx context.Context, userID string, limit, offset int) ([]Entry, error) {
	acc, err := s.GetOrCreateUserWallet(ctx, userID)
	if err != nil {
		return nil, err
	}
	return s.repo.ListEntries(ctx, acc.ID, limit, offset)
}

// Sentinel errors.
var (
	ErrInsufficientFunds = fmt.Errorf("ledger: insufficient funds")
	ErrDuplicate         = fmt.Errorf("ledger: duplicate idempotency key")
)
