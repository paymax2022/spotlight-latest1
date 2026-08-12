package tiers

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Service enforces per-tier wallet limits.
type Service struct {
	db *pgxpool.Pool
}

func NewService(db *pgxpool.Pool) *Service {
	return &Service{db: db}
}

// GetUserTier fetches the user's current KYC tier from user_profiles.
func (s *Service) GetUserTier(ctx context.Context, userID string) (Tier, error) {
	const q = `SELECT COALESCE(kyc_tier, 0) FROM user_profiles WHERE id = $1`
	var t int
	err := s.db.QueryRow(ctx, q, userID).Scan(&t)
	if err != nil {
		// Fail closed — if we can't determine tier, block the operation.
		return Tier0, fmt.Errorf("tiers: get tier for user %s: %w", userID, err)
	}
	return Tier(t), nil
}

// getDailyDebited returns the total kobo debited from the user's wallet today.
func (s *Service) getDailyDebited(ctx context.Context, userID string) (int64, error) {
	const q = `
		SELECT COALESCE(SUM(le.amount_kobo), 0)
		FROM ledger_entries le
		JOIN ledger_accounts la ON la.id = le.account_id
		WHERE la.user_id = $1
		  AND la.type = 'user_wallet'
		  AND le.type = 'DEBIT'
		  AND le.created_at >= $2`
	startOfDay := time.Now().UTC().Truncate(24 * time.Hour)
	var total int64
	err := s.db.QueryRow(ctx, q, userID, startOfDay).Scan(&total)
	return total, err
}

// Usage summarises a user's tier and how much of today's debit allowance is left.
type Usage struct {
	Tier            Tier
	DailyLimitKobo  int64 // 0 = unlimited (Tier3) or disabled (Tier0); check Tier to disambiguate
	DailyUsedKobo   int64
	RemainingKobo   int64 // -1 when unlimited
	WalletDisabled  bool
}

// GetUsage returns the user's tier alongside today's debit usage. Read-only —
// callers that are about to move money must still call EnforceWalletDebitLimit,
// which is the fail-closed gate.
func (s *Service) GetUsage(ctx context.Context, userID string) (Usage, error) {
	tier, err := s.GetUserTier(ctx, userID)
	if err != nil {
		return Usage{}, err
	}
	cfg := GetConfig(tier)

	used, err := s.getDailyDebited(ctx, userID)
	if err != nil {
		return Usage{}, fmt.Errorf("tiers: get daily debited: %w", err)
	}

	u := Usage{
		Tier:           tier,
		DailyLimitKobo: cfg.DailyDebitLimitKobo,
		DailyUsedKobo:  used,
		WalletDisabled: cfg.DailyDebitLimitKobo == 0 && tier == Tier0,
	}
	switch {
	case u.WalletDisabled:
		u.RemainingKobo = 0
	case cfg.DailyDebitLimitKobo == 0:
		u.RemainingKobo = -1 // unlimited
	default:
		u.RemainingKobo = cfg.DailyDebitLimitKobo - used
		if u.RemainingKobo < 0 {
			u.RemainingKobo = 0
		}
	}
	return u, nil
}

// EnforceWalletDebitLimit checks tier limits before a wallet debit.
// Fail-closed: any DB error blocks the operation.
func (s *Service) EnforceWalletDebitLimit(ctx context.Context, userID string, amountKobo int64) error {
	tier, err := s.GetUserTier(ctx, userID)
	if err != nil {
		return fmt.Errorf("tiers: enforce limit (fail closed): %w", err)
	}
	cfg := GetConfig(tier)

	if cfg.DailyDebitLimitKobo == 0 && tier == Tier0 {
		return ErrWalletDisabled
	}
	if cfg.DailyDebitLimitKobo == 0 {
		return nil // unlimited
	}

	debited, err := s.getDailyDebited(ctx, userID)
	if err != nil {
		// Fail closed.
		return fmt.Errorf("tiers: get daily debited (fail closed): %w", err)
	}
	if debited+amountKobo > cfg.DailyDebitLimitKobo {
		return ErrDailyLimitExceeded
	}
	return nil
}
