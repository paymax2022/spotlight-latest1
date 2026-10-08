package tiers

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Service enforces per-tier wallet limits.
type Service struct {
	db *pgxpool.Pool
	// checkoutAllowance enables the Tier-0 checkout spend allowance (ADR-043).
	// Off by default — see WithCheckoutAllowance in this file. It affects ONLY
	// EnforceCheckoutDebitLimit; EnforceWalletDebitLimit is never relaxed.
	checkoutAllowance bool
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
	Tier           Tier
	DailyLimitKobo int64 // 0 = unlimited (Tier3) or disabled (Tier0); check Tier to disambiguate
	DailyUsedKobo  int64
	RemainingKobo  int64 // -1 when unlimited
	WalletDisabled bool

	// Checkout allowance (ADR-043): a Tier-0 account may still spend a capped
	// amount ON PURCHASES. Reported separately because it is not
	// interchangeable with daily debit allowance — transfers and withdrawals
	// still see WalletDisabled and refuse.
	CheckoutEnabled       bool  // the allowance applies to this caller
	CheckoutAllowanceKobo int64 // rolling-window cap
	CheckoutRemainingKobo int64 // cap − spend in the window, floored at 0
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
		u.RemainingKobo = max(cfg.DailyDebitLimitKobo-used, 0)
	}

	// Reported so a client pre-check agrees with EnforceCheckoutDebitLimit —
	// otherwise the checkout sheet reads WalletDisabled and refuses a rail the
	// server would have accepted.
	if u.WalletDisabled && s.checkoutAllowance {
		spent, err := s.debitedSince(ctx, userID, time.Now().UTC().Add(-checkoutWindow))
		if err != nil {
			return Usage{}, fmt.Errorf("tiers: get checkout window spend: %w", err)
		}
		u.CheckoutEnabled = true
		u.CheckoutAllowanceKobo = CheckoutAllowanceKobo
		u.CheckoutRemainingKobo = max(CheckoutAllowanceKobo-spent, 0)
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
		return fmt.Errorf("tiers: get daily debited (fail closed): %w", err)
	}
	if debited+amountKobo > cfg.DailyDebitLimitKobo {
		return ErrDailyLimitExceeded
	}
	return nil
}

// ── Checkout spend allowance for unverified accounts (ADR-043) ───────────────
// ADR-042 lets Tier 0 fund a wallet by card for a purchase in flight; without a
// matching spend-side allowance that customer is charged, credited, then blocked
// at escrow — holding money they cannot spend or (Tier 0) withdraw.
// EnforceCheckoutDebitLimit is a SEPARATE method, not a relaxation of
// EnforceWalletDebitLimit, so strict-gate call sites cannot inherit the weaker
// rule by accident. Deliberately excluded: any cash-out path (merchant
// withdrawals, wallet/bank transfers) and investment purchases (fractionalre)
// — ADR-042's justification is that Tier 0 cannot get value back out.
//
// These constants MIRROR the top-up side in
// frontend-web/src/server/wallet/topup-gate.ts — they are COMPLIANCE
// parameters; change them together.
const (
	CheckoutMaxSingleKobo int64 = 1_000_000 // ₦10,000 per purchase
	CheckoutAllowanceKobo int64 = 2_000_000 // ₦20,000 per rolling 24h
)

// checkoutWindow matches the top-up gate's rolling window, so the amount a
// customer may be funded and the amount they may spend are measured the same way.
const checkoutWindow = 24 * time.Hour

// ErrCheckoutAllowanceExceeded is returned when an unverified account's capped
// checkout allowance would be exceeded. Distinct from ErrDailyLimitExceeded so
// handlers can tell "verify to raise your limit" from "you hit today's cap".
var ErrCheckoutAllowanceExceeded = errors.New("tiers: checkout allowance exceeded for an unverified account — complete KYC to raise it")

// WithCheckoutAllowance enables the Tier-0 checkout allowance, from
// FEATURE_CHECKOUT_TOPUP_TIER0 — the SAME flag as the top-up gate, so the funding
// side and the spending side can never be switched on independently and strand a
// customer between them.
// Default off: a Service built without this call refuses Tier-0 spends exactly as
// before, so an unwired call site is stricter, never looser.
func (s *Service) WithCheckoutAllowance(enabled bool) *Service {
	s.checkoutAllowance = enabled
	return s
}

// EnforceCheckoutDebitLimit gates a wallet debit that pays for a purchase the
// customer is completing now.
// Tier 1+ is unchanged — it delegates to EnforceWalletDebitLimit verbatim. Only
// Tier 0 differs, and only when the allowance is enabled.
// Fail-closed: any error reading the tier or the spend history blocks the debit.
func (s *Service) EnforceCheckoutDebitLimit(ctx context.Context, userID string, amountKobo int64) error {
	tier, err := s.GetUserTier(ctx, userID)
	if err != nil {
		return fmt.Errorf("tiers: enforce checkout limit (fail closed): %w", err)
	}
	// Tier 1+ delegates to the strict gate so the two can never drift.
	if tier != Tier0 {
		return s.EnforceWalletDebitLimit(ctx, userID, amountKobo)
	}
	// Cheap refusals first, so an oversized request costs no history read.
	if err := checkoutDecision(s.checkoutAllowance, amountKobo, 0); err != nil {
		return err
	}

	used, err := s.debitedSince(ctx, userID, time.Now().UTC().Add(-checkoutWindow))
	if err != nil {
		return fmt.Errorf("tiers: get checkout window spend (fail closed): %w", err)
	}
	return checkoutDecision(s.checkoutAllowance, amountKobo, used)
}

// checkoutDecision is the whole Tier-0 rule with the DB reads resolved by the
// caller — kept as a real function so tests exercise THIS code rather than a
// re-implementation.
func checkoutDecision(enabled bool, amountKobo, usedKobo int64) error {
	if !enabled {
		return ErrWalletDisabled
	}
	if amountKobo <= 0 {
		return fmt.Errorf("tiers: checkout amount must be positive, got %d", amountKobo)
	}
	if amountKobo > CheckoutMaxSingleKobo {
		return ErrCheckoutAllowanceExceeded
	}
	// used + THIS amount, so the debit that crosses the cap is the one refused
	// rather than the one after it.
	if usedKobo+amountKobo > CheckoutAllowanceKobo {
		return ErrCheckoutAllowanceExceeded
	}
	return nil
}

// debitedSince totals wallet debits in a rolling window. getDailyDebited measures
// from midnight UTC, which would let a Tier-0 account spend a full allowance either
// side of midnight; the rolling window keeps the spend cap aligned with the funding
// cap that authorised it.
func (s *Service) debitedSince(ctx context.Context, userID string, since time.Time) (int64, error) {
	const q = `
		SELECT COALESCE(SUM(le.amount_kobo), 0)
		FROM ledger_entries le
		JOIN ledger_accounts la ON la.id = le.account_id
		WHERE la.user_id = $1
		  AND la.type = 'user_wallet'
		  AND le.type = 'DEBIT'
		  AND le.created_at >= $2`
	var total int64
	err := s.db.QueryRow(ctx, q, userID, since).Scan(&total)
	return total, err
}

// Tier levels mirror the KYC tier model in ADR-001.
type Tier int

const (
	Tier0 Tier = 0 // unverified — wallet disabled
	Tier1 Tier = 1 // BVN verified
	Tier2 Tier = 2 // ID verified
	Tier3 Tier = 3 // full KYC
)

// TierConfig holds the daily and per-transaction limits for a tier.
type TierConfig struct {
	Tier                Tier
	DailyDebitLimitKobo int64 // 0 = disabled (Tier 0)
	MaxBalanceKobo      int64
}

var tierConfigs = map[Tier]TierConfig{
	Tier0: {Tier: Tier0, DailyDebitLimitKobo: 0, MaxBalanceKobo: 0},
	Tier1: {Tier: Tier1, DailyDebitLimitKobo: 5_000_000, MaxBalanceKobo: 30_000_000},   // ₦50k/day, ₦300k balance
	Tier2: {Tier: Tier2, DailyDebitLimitKobo: 20_000_000, MaxBalanceKobo: 500_000_000}, // ₦200k/day, ₦5M balance
	Tier3: {Tier: Tier3, DailyDebitLimitKobo: 0, MaxBalanceKobo: 0},                    // unlimited
}

// ErrWalletDisabled is returned for Tier0 users.
var ErrWalletDisabled = errors.New("tiers: wallet disabled for tier 0 — complete KYC to activate")

// ErrDailyLimitExceeded is returned when the daily debit limit is hit.
var ErrDailyLimitExceeded = errors.New("tiers: daily debit limit exceeded")

// GetConfig returns the TierConfig for a given tier level.
func GetConfig(t Tier) TierConfig {
	if cfg, ok := tierConfigs[t]; ok {
		return cfg
	}
	return tierConfigs[Tier0]
}
