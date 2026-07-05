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
const (
	WithdrawalRequested = "requested" // row created, holding units parked
	WithdrawalPending   = "pending"   // accepted for processing (pre-broadcast)
	WithdrawalBroadcast = "broadcast" // submitted to provider/network
	WithdrawalConfirmed = "confirmed" // on-chain confirmed; parked units burned
	WithdrawalFailed    = "failed"    // rejected/failed; parked units returned
)

// allowedWithdrawalTransitions is the guarded state machine. Any transition not
// listed here is rejected (never mutate status ad hoc).
var allowedWithdrawalTransitions = map[string]map[string]bool{
	WithdrawalRequested: {WithdrawalPending: true, WithdrawalFailed: true},
	WithdrawalPending:   {WithdrawalBroadcast: true, WithdrawalFailed: true},
	WithdrawalBroadcast: {WithdrawalConfirmed: true, WithdrawalFailed: true},
	WithdrawalConfirmed: {}, // terminal
	WithdrawalFailed:    {}, // terminal
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
