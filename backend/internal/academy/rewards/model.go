// Package rewards is the Spotlight Academy real-value sub-package.
//
// GOLDEN RULES (money path — enforced here, never relaxed):
//  1. NO reward is credited without a FUNDED RewardPool. The pool balance check
//     (funded_minor - spent_minor >= amount) is performed atomically under a
//     SELECT ... FOR UPDATE row lock so two concurrent credits can never overspend.
//  2. Per-user AND per-campaign caps are enforced BEFORE any credit, by summing
//     this user's / this campaign's prior credits from the reward ledger.
//  3. An anti-fraud gate (velocity / attempt-quality) runs before credit — a
//     low-effort or abusive event is rejected and earns nothing.
//  4. Every credit is an IDEMPOTENT, APPEND-ONLY academy_reward_ledger_entries row
//     keyed by idempotency_key (unique index). Re-submitting the same key returns
//     the original entry with NO second credit.
//  5. Balances are DERIVED by summation over the ledger — never stored/mutated.
//  6. Value lives on the PAYMAX WALLET LEDGER (finance/ledger). There is NO shadow
//     ledger: academy_reward_ledger_entries is the audit trail; the value movement
//     is a finance/ledger.Credit from the sponsor/pool account to the user wallet,
//     written with the SAME idempotency key.
//  7. Reward issuance is a guarded state machine:
//     triggered → eligibility_checked → credited | rejected.
//
// SEPARATION: this package is the ONLY academy place that moves money. The sibling
// `gamification` package handles engagement (XP/streaks/badges/leaderboards) and
// shares no service, balance, or credit path with rewards.
package rewards

import (
	"context"
	"time"
)

// ── Injected collaborators (faked in tests, real in wiring) ─────────────────────

// WalletCredit is the narrow seam onto finance/ledger.Service. The real
// ledger.Service.Credit satisfies this; tests inject a fake to assert exactly one
// value movement per reward. amountMinor is in minor units (kobo).
type WalletCredit interface {
	Credit(ctx context.Context, userID, reference, idemKey, debitAccountID string, amountMinor int64) error
}

// FraudCheck is the anti-fraud gate (velocity / attempt-quality). Default
// implementation (DefaultFraudCheck) approves everything; production injects a
// real velocity/quality scorer. Returning (false, reason) rejects the reward.
type FraudCheck interface {
	OK(ctx context.Context, userID, sourceEvent string) (ok bool, reason string)
}

// DefaultFraudCheck approves all events (safe default for wiring without a scorer).
type DefaultFraudCheck struct{}

func (DefaultFraudCheck) OK(ctx context.Context, userID, sourceEvent string) (bool, string) {
	return true, ""
}

// Notifier is an optional audit/notify hook fired after a successful credit or a
// rejection. nil-safe via NopNotifier.
type Notifier interface {
	RewardIssued(ctx context.Context, e LedgerEntry)
	RewardRejected(ctx context.Context, userID, poolID, reason string)
}

// NopNotifier is the default no-op notifier.
type NopNotifier struct{}

func (NopNotifier) RewardIssued(ctx context.Context, e LedgerEntry)              {}
func (NopNotifier) RewardRejected(ctx context.Context, userID, poolID, reason string) {}

// ── Domain types (mirror migration columns exactly) ─────────────────────────────

// EntryType mirrors academy_reward_ledger_entries.type CHECK.
type EntryType string

const (
	EntryCredit     EntryType = "credit"
	EntryRedemption EntryType = "redemption"
	EntryReversal   EntryType = "reversal"
)

// PoolStatus mirrors academy_reward_pools.status CHECK.
type PoolStatus string

const (
	PoolDraft     PoolStatus = "draft"
	PoolActive    PoolStatus = "active"
	PoolExhausted PoolStatus = "exhausted"
	PoolClosed    PoolStatus = "closed"
)

// IssueState is the reward issuance state machine (docs state-machines §3).
type IssueState string

const (
	StateTriggered         IssueState = "triggered"
	StateEligibilityChecked IssueState = "eligibility_checked"
	StateCredited          IssueState = "credited"
	StateRejected          IssueState = "rejected"
)

// RewardPool mirrors public.academy_reward_pools.
type RewardPool struct {
	ID                  string     `json:"id"`
	SponsorID           *string    `json:"sponsor_id,omitempty"`
	CampaignID          *string    `json:"campaign_id,omitempty"`
	Name                string     `json:"name"`
	Currency            string     `json:"currency"`
	FundedMinor         int64      `json:"funded_minor"`
	SpentMinor          int64      `json:"spent_minor"`
	PerUserCapMinor     int64      `json:"per_user_cap_minor"`     // 0 = no cap
	PerCampaignCapMinor int64      `json:"per_campaign_cap_minor"` // 0 = no cap
	ConversionRate      float64    `json:"conversion_rate"`
	Status              PoolStatus `json:"status"`
	CreatedAt           time.Time  `json:"created_at"`
}

// Available returns the spendable pool balance in minor units (derived).
func (p RewardPool) Available() int64 { return p.FundedMinor - p.SpentMinor }

// LedgerEntry mirrors public.academy_reward_ledger_entries (the audit trail).
type LedgerEntry struct {
	ID             string    `json:"id"`
	UserID         string    `json:"user_id"`
	PoolID         *string   `json:"pool_id,omitempty"`
	Type           EntryType `json:"type"`
	AmountMinor    int64     `json:"amount_minor"`
	Points         int       `json:"points"`
	Reason         *string   `json:"reason,omitempty"`
	SourceEvent    *string   `json:"source_event,omitempty"`
	WalletRef      *string   `json:"wallet_ref,omitempty"`
	IdempotencyKey string    `json:"idempotency_key"`
	CreatedAt      time.Time `json:"created_at"`
}

// CatalogItem mirrors public.academy_redemption_catalog.
type CatalogItem struct {
	ID         string `json:"id"`
	SKU        string `json:"sku"`
	Name       string `json:"name"`
	Kind       string `json:"kind"` // wallet|airtime|data|voucher
	CostPoints int    `json:"cost_points"`
	ValueMinor int64  `json:"value_minor"`
	Status     string `json:"status"`
}

// Redemption mirrors public.academy_redemptions.
type Redemption struct {
	ID             string    `json:"id"`
	UserID         string    `json:"user_id"`
	SKU            string    `json:"sku"`
	PointsSpent    int       `json:"points_spent"`
	ValueMinor     int64     `json:"value_minor"`
	State          string    `json:"state"` // requested|fulfilled|failed|reversed
	IdempotencyKey string    `json:"idempotency_key"`
	CreatedAt      time.Time `json:"created_at"`
}

// ── Inputs / results ────────────────────────────────────────────────────────────

// IssueInput is the request to issue a sponsor-funded reward.
type IssueInput struct {
	UserID         string
	PoolID         string
	Points         int    // optional informational points value
	AmountMinor    int64  // value to credit (minor units); if 0, derived from Points*conversion_rate
	Reason         string
	SourceEvent    string // e.g. "mock_completed:attempt123"
	IdempotencyKey string
}

// IssueResult is the outcome of IssueReward.
type IssueResult struct {
	State     IssueState   `json:"state"`
	Entry     *LedgerEntry `json:"entry,omitempty"`
	Reason    string       `json:"reason,omitempty"` // stable snake_case code when rejected
	Duplicate bool         `json:"duplicate"`        // true when idempotency replay
}

// Rejection reason codes (stable; logged + audited).
const (
	ReasonPoolNotFound   = "pool_not_found"
	ReasonPoolInactive   = "pool_inactive"
	ReasonPoolExhausted  = "pool_exhausted"
	ReasonPerUserCap     = "per_user_cap_exceeded"
	ReasonPerCampaignCap = "per_campaign_cap_exceeded"
	ReasonFraud          = "anti_fraud_block"
	ReasonInvalidAmount  = "invalid_amount"
)

// RedeemInput is a points→reward catalog redemption request.
type RedeemInput struct {
	UserID         string
	SKU            string
	IdempotencyKey string
}

// ── Admin request DTOs ──────────────────────────────────────────────────────────

type CreatePoolRequest struct {
	SponsorID           *string  `json:"sponsor_id,omitempty"`
	CampaignID          *string  `json:"campaign_id,omitempty"`
	Name                string   `json:"name" binding:"required"`
	Currency            string   `json:"currency"`
	PerUserCapMinor     int64    `json:"per_user_cap_minor"`
	PerCampaignCapMinor int64    `json:"per_campaign_cap_minor"`
	ConversionRate      *float64 `json:"conversion_rate,omitempty"`
}

type FundPoolRequest struct {
	AmountMinor    int64  `json:"amount_minor" binding:"required"`
	IdempotencyKey string `json:"idempotency_key" binding:"required"`
}

type UpsertCatalogRequest struct {
	SKU        string `json:"sku" binding:"required"`
	Name       string `json:"name" binding:"required"`
	Kind       string `json:"kind" binding:"required"`
	CostPoints int    `json:"cost_points" binding:"required"`
	ValueMinor int64  `json:"value_minor"`
	Status     string `json:"status"`
}
