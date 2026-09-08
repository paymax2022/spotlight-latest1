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

// GetAccountBalance returns the current projected balance (kobo) for an already
// resolved ledger account ID. ADDITIVE read accessor — it exposes the repository's
// pool-based balance projection (never a stored column) for callers that hold a
// resolved account ID (e.g. a standing account) rather than a user id. Read-only;
// like Repository.GetBalance it takes no lock and MUST NOT be used as the
// sufficiency gate for a debit (use Debit/DebitWithBalanceCheck for that).
func (s *Service) GetAccountBalance(ctx context.Context, accountID string) (int64, error) {
	return s.repo.GetBalance(ctx, accountID)
}

// Posted reports whether the balanced pair for baseIdempotencyKey has been durably
// written. It checks the CREDIT side (":credit"), which every posting — Credit,
// Debit, and PostJournal — always writes. Redis-independent (reads the ledger of
// record), so a caller can use it to decide crash-recovery/compensation after a
// process death without trusting the optional Redis idempotency cache. Pass the
// SAME base key you passed to Credit/Debit/PostJournal (the ":credit" suffix is
// applied here).
func (s *Service) Posted(ctx context.Context, baseIdempotencyKey string) (bool, error) {
	return s.repo.EntryExists(ctx, baseIdempotencyKey+":credit")
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
//
// TOCTOU-safe: the balance sufficiency check and the balanced insert now run inside
// ONE transaction under the wallet's advisory lock (see
// Repository.DebitWithBalanceCheck). Previously GetBalance and PostJournal ran on
// separate pooled connections with no lock, so two concurrent debits could both
// read the pre-debit balance, both pass the check, and together overdraw the wallet.
// The Redis fast-path below is preserved as the cheap common-case dedup; the DB
// unique idempotency_key (with ON CONFLICT in the repo) remains the durable fallback
// when Redis is unavailable. Public signature is UNCHANGED — no caller edits needed.
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

	// Check + insert as one atomic, wallet-serialised unit. userID is the advisory
	// lock key (the wallet being drawn down), and acc.ID is the debited account.
	return s.repo.DebitWithBalanceCheck(ctx, userID, JournalEntry{
		Reference:       reference,
		IdempotencyKey:  idempotencyKey,
		AmountKobo:      amountKobo,
		DebitAccountID:  acc.ID,
		CreditAccountID: creditAccountID,
	}, amountKobo)
}

// PostJournal posts a balanced entry between two existing account IDs.
// Use for non-wallet postings such as offline-payment approval
// (DR provider_clearing → CR settlement) where no user wallet is involved.
func (s *Service) PostJournal(ctx context.Context, j JournalEntry) error {
	if s.redis != nil {
		ok, _, err := redisPkg.AcquireLock(ctx, s.redis, "idem:"+j.IdempotencyKey, 0)
		if err == nil && !ok {
			return ErrDuplicate
		}
	}
	return s.repo.PostJournal(ctx, j)
}

// PostReversal posts a balanced REVERSAL_DEBIT / REVERSAL_CREDIT correction.
// restoreAccountID is credited back (REVERSAL_DEBIT, +balance); releaseAccountID
// has its hold drained (REVERSAL_CREDIT). Use for failed/reversed payouts where
// funds were parked in a suspense account and must return to the user wallet.
// Idempotency is enforced by the ledger unique constraint (and Redis fast-path),
// so a duplicate webhook is a safe no-op.
func (s *Service) PostReversal(ctx context.Context, restoreAccountID, releaseAccountID string, amountKobo int64, reference, idempotencyKey string) error {
	if amountKobo <= 0 {
		return fmt.Errorf("ledger: reversal amount must be positive, got %d", amountKobo)
	}
	if s.redis != nil {
		ok, _, err := redisPkg.AcquireLock(ctx, s.redis, "idem:"+idempotencyKey, 0)
		if err == nil && !ok {
			return ErrDuplicate
		}
	}
	return s.repo.PostReversalPair(ctx, restoreAccountID, releaseAccountID, amountKobo, reference, idempotencyKey)
}

// GetBalanceAcrossPots returns a user's balance summed over every pot they hold
// ('user_wallet' and the Next.js wallet's 'wallet'). Reporting-only — read-only
// and unlocked, so it must never gate a debit.
func (s *Service) GetBalanceAcrossPots(ctx context.Context, userID string) (int64, error) {
	return s.repo.GetBalanceAcrossUserPots(ctx, userID)
}

// ListTransactionsAcrossPots returns a user's ledger entries from every pot they
// hold, newest first. Reporting-only counterpart to ListTransactions.
func (s *Service) ListTransactionsAcrossPots(ctx context.Context, userID string, limit, offset int) ([]Entry, error) {
	return s.repo.ListEntriesAcrossUserPots(ctx, userID, limit, offset)
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
