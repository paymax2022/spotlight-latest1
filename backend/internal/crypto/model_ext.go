package crypto

import (
	"fmt"
	"time"
)

// ── Swap ────────────────────────────────────────────────────────────────────
// Default spread applied to swaps when the caller does not (cannot) override it.
// Basis points: 50 bps = 0.50%. The spread is retained to paymax_revenue and is
// never minted — the buy leg receives cash net of the spread.
const DefaultSwapSpreadBps = 50

// Withdrawal gate defaults (advisory display values for the eligibility/quote
// previews; the state machine still enforces the whitelist + holdings at fill).
const (
	DefaultWithdrawDailyLimitKobo = 500_000_000 // ₦5,000,000/day soft limit (display)
	DefaultWithdrawReviewMinKobo  = 50_000_000   // ₦500,000 manual-review threshold (display)
	DefaultWithdrawFeeKobo        = 15_000       // ₦150 flat processing fee (display default)
)

// SwapQuote is a pre-trade, display-only estimate for an asset→asset swap. The
// server re-prices at execution time; the quote is advisory (matches the buy/sell
// convention). Amounts are integer minor units per asset; spread/fee are NGN kobo.
type SwapQuote struct {
	FromAssetID  string    `json:"from_asset_id"`
	FromSymbol   string    `json:"from_symbol"`
	ToAssetID    string    `json:"to_asset_id"`
	ToSymbol     string    `json:"to_symbol"`
	FromUnits    int64     `json:"from_units"`
	ToUnits      int64     `json:"to_units"`
	FromPriceKobo int64    `json:"from_price_kobo"`
	ToPriceKobo   int64    `json:"to_price_kobo"`
	CashKobo     int64     `json:"cash_kobo"`   // indicative sell-leg value
	SpreadKobo   int64     `json:"spread_kobo"` // fee retained to paymax_revenue
	SpreadBps    int       `json:"spread_bps"`
	Source       string    `json:"source"`
	AsOf         time.Time `json:"as_of"`
}

// SwapOrder is an immutable record of a filled two-leg swap.
type SwapOrder struct {
	ID            string    `json:"id"`
	UserID        string    `json:"user_id"`
	FromAssetID   string    `json:"from_asset_id"`
	FromSymbol    string    `json:"from_symbol,omitempty"`
	ToAssetID     string    `json:"to_asset_id"`
	ToSymbol      string    `json:"to_symbol,omitempty"`
	Status        string    `json:"status"`
	FromUnits     int64     `json:"from_units"`
	ToUnits       int64     `json:"to_units"`
	FromPriceKobo int64     `json:"from_price_kobo"`
	ToPriceKobo   int64     `json:"to_price_kobo"`
	CashKobo      int64     `json:"cash_kobo"`
	SpreadKobo    int64     `json:"spread_kobo"`
	SpreadBps     int       `json:"spread_bps"`
	Reference     string    `json:"reference,omitempty"`
	CreatedAt     time.Time `json:"created_at"`

	idem string
}

func (o SwapOrder) IdempotencyKey() string { return o.idem }

// ── Address book ────────────────────────────────────────────────────────────

// Address is a saved, whitelisted withdrawal destination (allow-list entry).
type Address struct {
	ID         string     `json:"id"`
	UserID     string     `json:"user_id"`
	AssetID    string     `json:"asset_id"`
	Symbol     string     `json:"symbol,omitempty"`
	Label      string     `json:"label"`
	Network    string     `json:"network"`
	Address    string     `json:"address"`
	IsActive   bool       `json:"is_active"`
	VerifiedAt *time.Time `json:"verified_at,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
}

// DepositAddress is a persisted per-user, per-asset deposit destination.
type DepositAddress struct {
	AssetID  string `json:"asset_id"`
	Symbol   string `json:"symbol"`
	Network  string `json:"network"`
	Address  string `json:"address"`
	Memo     string `json:"memo,omitempty"`
	Provider string `json:"provider"`
}

// ── Withdrawal state machine ────────────────────────────────────────────────

// Withdrawal statuses (persisted in crypto_withdrawals.status).
//
// AML GATE: the member create path parks the units and STOPS at pending_review —
// it never calls the provider. Money can only leave AFTER a compliance officer
// approves (pending_review → approved), which is the point the broadcast fires.
// Reject (pending_review → failed) returns the parked units. No provider dispatch
// happens on any path before `approved`.
const (
	WithdrawalRequested     = "requested"      // row created, holding units parked
	WithdrawalPendingReview = "pending_review" // parked/held, awaiting admin AML review
	WithdrawalApproved      = "approved"       // AML-approved; cleared to broadcast
	WithdrawalBroadcast     = "broadcast"      // submitted to provider/network
	WithdrawalConfirmed     = "confirmed"      // on-chain confirmed; parked units burned
	WithdrawalFailed        = "failed"         // rejected/failed; parked units returned
)

// allowedWithdrawalTransitions is the guarded state machine. Any transition not
// listed here is rejected (never mutate status ad hoc). The AML review gate
// (pending_review) sits BEFORE any provider dispatch: the member create path can
// only reach pending_review; the admin approve path drives pending_review→approved
// and then approved→broadcast.
var allowedWithdrawalTransitions = map[string]map[string]bool{
	WithdrawalRequested:     {WithdrawalPendingReview: true, WithdrawalFailed: true},
	WithdrawalPendingReview: {WithdrawalApproved: true, WithdrawalFailed: true},
	WithdrawalApproved:      {WithdrawalBroadcast: true, WithdrawalFailed: true},
	WithdrawalBroadcast:     {WithdrawalConfirmed: true, WithdrawalFailed: true},
	WithdrawalConfirmed:     {}, // terminal
	WithdrawalFailed:        {}, // terminal
}

func canTransitionWithdrawal(from, to string) bool {
	next, ok := allowedWithdrawalTransitions[from]
	if !ok {
		return false
	}
	return next[to]
}

// Withdrawal is the persisted withdrawal record + its current state.
type Withdrawal struct {
	ID              string    `json:"id"`
	UserID          string    `json:"user_id"`
	AssetID         string    `json:"asset_id"`
	Symbol          string    `json:"symbol,omitempty"`
	AddressID       string    `json:"address_id"`
	Address         string    `json:"address,omitempty"`
	Network         string    `json:"network,omitempty"`
	Status          string    `json:"status"`
	Units           int64     `json:"units"`
	NetworkFeeUnits int64     `json:"network_fee_units"`
	FeeKobo         int64     `json:"fee_kobo"`
	PriceKobo       int64     `json:"price_kobo"`
	Provider        string    `json:"provider"`
	ProviderRef     string    `json:"provider_ref,omitempty"`
	TxHash          string    `json:"tx_hash,omitempty"`
	FailureReason   string    `json:"failure_reason,omitempty"`
	Reference       string    `json:"reference,omitempty"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`

	idem string
}

func (w Withdrawal) IdempotencyKey() string { return w.idem }

// Sentinel errors specific to the extended crypto money paths.
var (
	ErrSameAsset          = fmt.Errorf("crypto: swap source and destination assets must differ")
	ErrAddressNotFound    = fmt.Errorf("crypto: withdrawal address not found or not owned")
	ErrAddressExists      = fmt.Errorf("crypto: address already saved")
	ErrInvalidAddress     = fmt.Errorf("crypto: invalid destination address")
	ErrInvalidTransition  = fmt.Errorf("crypto: illegal withdrawal state transition")
	ErrWithdrawTooSmall   = fmt.Errorf("crypto: withdrawal amount does not clear the network fee")
)
