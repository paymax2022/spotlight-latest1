package referrals

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
	"spotlight/backend/internal/finance/ledger"
)

// Service manages referral codes and reward processing.
type Service struct {
	db     *pgxpool.Pool
	ledger *ledger.Service
}

func NewService(db *pgxpool.Pool, ledger *ledger.Service) *Service {
	return &Service{db: db, ledger: ledger}
}

// GetOrCreateCode returns the user's referral code, creating one if needed.
func (s *Service) GetOrCreateCode(ctx context.Context, userID string) (*Code, error) {
	const q = `SELECT code, created_at FROM finance_referral_codes WHERE user_id = $1`
	var c Code
	c.UserID = userID
	err := s.db.QueryRow(ctx, q, userID).Scan(&c.Code, &c.CreatedAt)
	if err == nil {
		return &c, nil
	}
	// Generate a new code. GenerateCode() (code.go) is the SAME generator System
	// B's referral_links uses — REF-004: this used to be a locally-defined
	// 8-char lowercase hex generator, incompatible with both referral_links'
	// format and the frontend's SPOT-XXXXXX format, even though all three wrote
	// into/read from finance_referral_codes-shaped data. One alphabet, one
	// length, one case, regardless of which stack issues the code.
	code, err := GenerateCode()
	if err != nil {
		return nil, fmt.Errorf("referrals: generate code: %w", err)
	}
	const insert = `
		INSERT INTO finance_referral_codes (user_id, code)
		VALUES ($1, $2)
		ON CONFLICT (user_id) DO NOTHING
		RETURNING code, created_at`
	if err := s.db.QueryRow(ctx, insert, userID, code).Scan(&c.Code, &c.CreatedAt); err != nil {
		// Race — fetch.
		return s.GetOrCreateCode(ctx, userID)
	}
	return &c, nil
}

// GetSummary returns the referral summary for a user.
func (s *Service) GetSummary(ctx context.Context, userID string) (*Summary, error) {
	code, err := s.GetOrCreateCode(ctx, userID)
	if err != nil {
		return nil, err
	}
	const q = `
		SELECT COUNT(*), COALESCE(SUM(amount_kobo), 0)
		FROM referral_events
		WHERE referrer_id = $1`
	var count int
	var earned int64
	if err := s.db.QueryRow(ctx, q, userID).Scan(&count, &earned); err != nil {
		return nil, fmt.Errorf("referrals: get summary: %w", err)
	}
	return &Summary{
		Code:            code.Code,
		TotalReferrals:  count,
		TotalEarnedKobo: earned,
	}, nil
}

// ResolveCodeToReferrer returns the user ID that owns a referral code.
//
// REF-008: the comparison is case-INSENSITIVE. Codes generated before this fix
// may be stored in any case (the old generator here emitted lowercase hex; the
// frontend generator emitted uppercase), and normalizeCode() in
// internal/referral/attribution upper-cases whatever the caller typed before
// resolving — a case-sensitive comparison would make every lowercase legacy
// code permanently unresolvable. Matching on UPPER(code) keeps every
// already-issued code (whatever case it happens to be stored in) resolvable,
// while new codes (see GenerateCode) are uppercase-only going forward.
func (s *Service) ResolveCodeToReferrer(ctx context.Context, code string) (string, error) {
	const q = `SELECT user_id FROM finance_referral_codes WHERE UPPER(code) = UPPER($1)`
	normalized := NormalizeCode(code)
	var referrerID string
	if err := s.db.QueryRow(ctx, q, normalized).Scan(&referrerID); err != nil {
		return "", fmt.Errorf("referrals: resolve code %q: %w", code, err)
	}
	return referrerID, nil
}

// ProcessReward credits the referrer and records the event.
// Idempotent: UNIQUE(referrer_id, referred_id) prevents double-reward.
func (s *Service) ProcessReward(ctx context.Context, referrerID, referredID string) error {
	if referrerID == referredID {
		return fmt.Errorf("referrals: self-referral blocked")
	}

	idempotencyKey := fmt.Sprintf("referral:reward:%s:%s", referrerID, referredID)

	// Check duplicate.
	var existing string
	const checkDup = `SELECT id FROM referral_events WHERE referrer_id=$1 AND referred_id=$2 LIMIT 1`
	_ = s.db.QueryRow(ctx, checkDup, referrerID, referredID).Scan(&existing)
	if existing != "" {
		return nil // already processed
	}

	// Credit referrer via ledger.
	rewardAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountReferralReward)
	if err != nil {
		return err
	}
	if err := s.ledger.Credit(ctx, referrerID, "referral:reward:"+referredID, idempotencyKey, rewardAcc.ID, RewardAmountKobo); err != nil {
		if err == ledger.ErrDuplicate {
			return nil
		}
		return fmt.Errorf("referrals: credit reward: %w", err)
	}

	// Record referral event.
	const insert = `
		INSERT INTO referral_events (referrer_id, referred_id, amount_kobo)
		VALUES ($1, $2, $3)
		ON CONFLICT (referrer_id, referred_id) DO NOTHING`
	_, err = s.db.Exec(ctx, insert, referrerID, referredID, RewardAmountKobo)
	return err
}
