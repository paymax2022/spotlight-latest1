package crypto

import (
	"errors"
	"fmt"
	"math/big"
	"time"
)

// RBAC permission slugs (seeded by migration 20260815001600_crypto.sql).
const (
	PermView  = "crypto.view"  // read catalogue / quotes / own portfolio
	PermTrade = "crypto.trade" // place buy/sell orders
	PermAdmin = "crypto.admin" // admin: catalogue + all-orders + config
)

// Units & money model (iron rule: integers in minor units, never floats):
//   - Cash legs are NGN kobo (int64).
//   - price_kobo is the NGN price in kobo per ONE WHOLE asset unit.
//   - Holdings are stored in integer asset minor units; MinorUnitScale is the
//     number of minor units per one whole asset unit (e.g. 1e8). A holding of
//     `units` minor units is worth: units * price_kobo / MinorUnitScale (kobo),
//     computed with integer arithmetic only.

// Asset is a tradable crypto asset in the admin-curated catalogue.
type Asset struct {
	ID             string    `json:"id"`
	Symbol         string    `json:"symbol"`
	Name           string    `json:"name"`
	MinorUnitScale int64     `json:"minor_unit_scale"`
	IsActive       bool      `json:"is_active"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

// Quote is a point-in-time price for an asset.
type Quote struct {
	AssetID   string    `json:"asset_id"`
	Symbol    string    `json:"symbol"`
	PriceKobo int64     `json:"price_kobo"` // NGN kobo per 1 whole unit
	Source    string    `json:"source"`
	AsOf      time.Time `json:"as_of"`
}

// Order is an immutable money-path record of a filled buy/sell.
type Order struct {
	ID        string    `json:"id"`
	UserID    string    `json:"user_id"`
	AssetID   string    `json:"asset_id"`
	Symbol    string    `json:"symbol,omitempty"`
	Side      string    `json:"side"` // buy|sell
	Status    string    `json:"status"`
	CashKobo  int64     `json:"cash_kobo"`
	Units     int64     `json:"units"` // asset minor units
	PriceKobo int64     `json:"price_kobo"`
	Reference string    `json:"reference,omitempty"`
	CreatedAt time.Time `json:"created_at"`

	idem string // idempotency key (not serialised; set by the service on a fill)
}

// IdempotencyKey returns the order's idempotency key (used by the repository to
// enforce the unique partial index and detect replays).
func (o Order) IdempotencyKey() string { return o.idem }

// Holding is a per-user, per-asset position projection (asset minor units).
type Holding struct {
	AssetID   string    `json:"asset_id"`
	Symbol    string    `json:"symbol"`
	Units     int64     `json:"units"`      // asset minor units
	ValueKobo int64     `json:"value_kobo"` // marked at latest quote (kobo)
	UpdatedAt time.Time `json:"updated_at"`
}

// unitsForCash converts a NGN cash amount (kobo) to asset minor units at the
// given price, using integer arithmetic only (truncates — never over-credits the
// buyer). priceKobo is per ONE WHOLE unit; scale is minor units per whole unit.
func unitsForCash(cashKobo, priceKobo, scale int64) int64 {
	if priceKobo <= 0 || scale <= 0 {
		return 0
	}
	// units = cashKobo * scale / priceKobo — big.Int intermediate so the
	// cashKobo*scale product cannot silently overflow int64. Fail closed
	// (return 0) on absurd magnitudes rather than wrapping to a wrong value.
	r := new(big.Int).Mul(big.NewInt(cashKobo), big.NewInt(scale))
	r.Quo(r, big.NewInt(priceKobo))
	if !r.IsInt64() {
		return 0
	}
	return r.Int64()
}

// cashForUnits converts asset minor units to a NGN cash amount (kobo) at the
// given price, using integer arithmetic only (truncates).
func cashForUnits(units, priceKobo, scale int64) int64 {
	if scale <= 0 {
		return 0
	}
	// cash = units * priceKobo / scale — big.Int intermediate so units*priceKobo
	// cannot silently overflow int64. Fail closed (return 0) on absurd magnitudes.
	r := new(big.Int).Mul(big.NewInt(units), big.NewInt(priceKobo))
	r.Quo(r, big.NewInt(scale))
	if !r.IsInt64() {
		return 0
	}
	return r.Int64()
}

// Sentinel errors.
var (
	ErrNotFound       = fmt.Errorf("crypto: not found")
	ErrForbidden      = fmt.Errorf("crypto: forbidden")
	ErrAssetInactive  = fmt.Errorf("crypto: asset is not tradable")
	ErrInsufficient   = fmt.Errorf("crypto: insufficient holdings")
	ErrAmountTooSmall = fmt.Errorf("crypto: amount too small for a whole minor unit")
	ErrBadRequest     = fmt.Errorf("crypto: invalid request")
)

// This file defines the admin-oversight view models that back the crypto admin
// console (frontend-admin/app/admin/crypto/{withdrawals,swaps,addresses,
// reconciliation}). They are thin projections over the existing crypto tables —
// no new persisted state. Fields the schema does not yet back (review_status,
// screening_result, aml_flags, value_kobo, drift) are DERIVED here from columns
// that DO exist, so the console renders truthfully off real rows. Money is always
// integer minor units (kobo for cash; asset minor units for holdings).

// AdminWithdrawal is a withdrawal enriched for the AML review queue: it adds the
// server-computed fiat value (units × price_kobo / minor_unit_scale) that the
// console shows, plus a lightweight AML flag set derived from the row itself. The
// authoritative state machine lives on the member path; the admin queue only drives
// the requested→pending (approve) / requested→failed (reject) transitions.
type AdminWithdrawal struct {
	ID              string    `json:"id"`
	UserID          string    `json:"user_id"`
	AssetID         string    `json:"asset_id"`
	Symbol          string    `json:"symbol"`
	AddressID       string    `json:"address_id"`
	Address         string    `json:"address,omitempty"`
	Network         string    `json:"network,omitempty"`
	Status          string    `json:"status"`
	Units           int64     `json:"units"`
	NetworkFeeUnits int64     `json:"network_fee_units"`
	FeeKobo         int64     `json:"fee_kobo"`
	PriceKobo       int64     `json:"price_kobo"`
	ValueKobo       int64     `json:"value_kobo"` // units × price_kobo / minor_unit_scale
	Provider        string    `json:"provider"`
	ProviderRef     string    `json:"provider_ref,omitempty"`
	TxHash          string    `json:"tx_hash,omitempty"`
	FailureReason   string    `json:"failure_reason,omitempty"`
	Reference       string    `json:"reference,omitempty"`
	AmlFlags        []string  `json:"aml_flags"`
	AmlScore        int       `json:"aml_score"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

// AdminAddress is an allow-list entry enriched with a derived review verdict. The
// crypto_addresses table has no dedicated review column yet, so review_status is
// derived from (is_active, verified_at):
//
//	is_active=true                      → approved (usable as a withdrawal target)
//	is_active=false AND verified_at NULL → pending  (awaiting compliance review)
//	is_active=false AND verified_at set  → rejected (reviewed and blocked)
//
// TODO(crypto-admin): if the product needs a first-class address review workflow
// (distinct "pending" vs "auto-active on add"), add a review_status column in an
// additive migration and stop deriving. Today AddAddress activates on insert, so
// most rows read as "approved"; the derivation keeps the console honest without
// schema change.
type AdminAddress struct {
	ID              string     `json:"id"`
	UserID          string     `json:"user_id"`
	AssetID         string     `json:"asset_id"`
	Symbol          string     `json:"symbol,omitempty"`
	Label           string     `json:"label"`
	Network         string     `json:"network"`
	Address         string     `json:"address"`
	IsActive        bool       `json:"is_active"`
	ReviewStatus    string     `json:"review_status"`
	ScreeningResult string     `json:"screening_result,omitempty"`
	VerifiedAt      *time.Time `json:"verified_at,omitempty"`
	CreatedAt       time.Time  `json:"created_at"`
}

// Admin address review verdicts (derived; mirror the frontend union).
const (
	AddressReviewPending  = "pending"
	AddressReviewApproved = "approved"
	AddressReviewRejected = "rejected"
)

// deriveAddressReview maps (is_active, verified_at) → a review verdict.
func deriveAddressReview(isActive bool, verifiedAt *time.Time) string {
	if isActive {
		return AddressReviewApproved
	}
	if verifiedAt != nil {
		return AddressReviewRejected
	}
	return AddressReviewPending
}

// Reconciliation per-asset statuses.
//   - ok      : a custody feed exists AND onchain_units == ledger_units.
//   - drift   : a custody feed exists AND onchain_units != ledger_units (a break).
//   - no_feed : no custody row stored for this asset yet — reported distinctly so a
//     missing feed is never mistaken for a healthy "ok", and NOT counted
//     as a break.
const (
	ReconStatusOK     = "ok"
	ReconStatusDrift  = "drift"
	ReconStatusNoFeed = "no_feed"
)

// ReconRow is one asset's on-chain-vs-ledger drift line. ledger_units is the sum
// of the holding projections PLUS units parked in non-terminal withdrawals (both
// are "owed" on-chain). onchain_units is the STORED custodian-reported balance from
// crypto_onchain_balances (fed by the custody-webhook seam). When no custody row
// exists the status is "no_feed" (onchain_units 0, drift 0, not a break); when it
// exists, drift = onchain_units − ledger_units and any non-zero drift is a break.
// onchain_source / onchain_as_of carry the custody provenance for the console.
type ReconRow struct {
	AssetID        string     `json:"asset_id"`
	Symbol         string     `json:"symbol"`
	MinorUnitScale int64      `json:"minor_unit_scale"`
	LedgerUnits    int64      `json:"ledger_units"`
	OnchainUnits   int64      `json:"onchain_units"`
	DriftUnits     int64      `json:"drift_units"`
	PriceKobo      int64      `json:"price_kobo"`
	Status         string     `json:"status"` // ok|drift|no_feed
	OnchainSource  string     `json:"onchain_source,omitempty"`
	OnchainAsOf    *time.Time `json:"onchain_as_of,omitempty"`
	LastCheckedAt  time.Time  `json:"last_checked_at"`
}

// ReconSummary is the reconciliation response envelope (matches the frontend
// CryptoReconSummary: {rows, breaks, as_of}).
type ReconSummary struct {
	Rows   []ReconRow `json:"rows"`
	Breaks int        `json:"breaks"`
	AsOf   time.Time  `json:"as_of"`
}

// DefaultSwapSpreadBps — Default spread applied to swaps when the caller does not (cannot) override it.
// Basis points: 50 bps = 0.50%. The spread is retained to paymax_revenue and is
// never minted — the buy leg receives cash net of the spread.
const DefaultSwapSpreadBps = 50

// Withdrawal gate defaults (advisory display values for the eligibility/quote
// previews; the state machine still enforces the whitelist + holdings at fill).
const (
	DefaultWithdrawDailyLimitKobo = 500_000_000 // ₦5,000,000/day soft limit (display)
	DefaultWithdrawReviewMinKobo  = 50_000_000  // ₦500,000 manual-review threshold (display)
	DefaultWithdrawFeeKobo        = 15_000      // ₦150 flat processing fee (display default)
)

// SwapQuote is a pre-trade, display-only estimate for an asset→asset swap. The
// server re-prices at execution time; the quote is advisory (matches the buy/sell
// convention). Amounts are integer minor units per asset; spread/fee are NGN kobo.
type SwapQuote struct {
	FromAssetID   string    `json:"from_asset_id"`
	FromSymbol    string    `json:"from_symbol"`
	ToAssetID     string    `json:"to_asset_id"`
	ToSymbol      string    `json:"to_symbol"`
	FromUnits     int64     `json:"from_units"`
	ToUnits       int64     `json:"to_units"`
	FromPriceKobo int64     `json:"from_price_kobo"`
	ToPriceKobo   int64     `json:"to_price_kobo"`
	CashKobo      int64     `json:"cash_kobo"`   // indicative sell-leg value
	SpreadKobo    int64     `json:"spread_kobo"` // fee retained to paymax_revenue
	SpreadBps     int       `json:"spread_bps"`
	Source        string    `json:"source"`
	AsOf          time.Time `json:"as_of"`
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

// Withdrawal statuses (persisted in crypto_withdrawals.status).
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
	ErrSameAsset         = errors.New("crypto: swap source and destination assets must differ")
	ErrAddressNotFound   = errors.New("crypto: withdrawal address not found or not owned")
	ErrAddressExists     = errors.New("crypto: address already saved")
	ErrInvalidAddress    = errors.New("crypto: invalid destination address")
	ErrInvalidTransition = errors.New("crypto: illegal withdrawal state transition")
	ErrWithdrawTooSmall  = errors.New("crypto: withdrawal amount does not clear the network fee")
)
