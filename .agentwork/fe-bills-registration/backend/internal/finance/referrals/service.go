package referrals

import (
	"context"
	"crypto/rand"
	"encoding/hex"
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
	const q = `SELECT code, created_at FROM referral_codes WHERE user_id = $1`
	var c Code
	c.UserID = userID
	err := s.db.QueryRow(ctx, q, userID).Scan(&c.Code, &c.CreatedAt)
	if err == nil {
		return &c, nil
	}
	// Generate a new code.
	code, err := generateCode()
	if err != nil {
		return nil, fmt.Errorf("referrals: generate code: %w", err)
	}
	const insert = `
		INSERT INTO referral_codes (user_id, code)
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
func (s *Service) ResolveCodeToReferrer(ctx context.Context, code string) (string, error) {
	const q = `SELECT user_id FROM referral_codes WHERE code = $1`
	var referrerID string
	if err := s.db.QueryRow(ctx, q, code).Scan(&referrerID); err != nil {
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

func generateCode() (string, error) {
	b := make([]byte, 4)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
