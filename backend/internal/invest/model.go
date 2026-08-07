// Package invest implements the Paymax stock-trading module ("Paymax Invest").
//
// It ships inside the existing Paymax super app and reuses the platform's auth,
// pgx pool, Redis idempotency cache, and feature-flag conventions. The package
// follows the same shape as the other finance modules: model / provider /
// repository / ledger / service / handler / routes.
//
// Iron rules enforced here (see docs/prd/stock/CLAUDE.md):
//   - No trade without KYC + suitability + accepted active terms + eligibility.
//   - No order from client-side calc only — server-side pre-check is mandatory.
//   - Every order uses an idempotency key and carries a provider reference.
//   - No wallet change without double-entry ledger records.
//   - Failed buy releases locked cash; failed sell releases locked shares.
//   - All money is integer minor units (kobo). Never floats for money.
package invest

import "time"

// ─────────────────────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────────────────────

// ProfileStatus mirrors the onboarding state machine in compliance.md.
type ProfileStatus string

const (
	ProfileNotStarted     ProfileStatus = "not_started"
	ProfileStarted        ProfileStatus = "started"
	ProfileKYCRequired    ProfileStatus = "kyc_required"
	ProfileKYCPending     ProfileStatus = "kyc_pending"
	ProfileKYCRejected    ProfileStatus = "kyc_rejected"
	ProfileTermsRequired  ProfileStatus = "terms_required"
	ProfileSuitabilityReq ProfileStatus = "suitability_required"
	ProfileApproved       ProfileStatus = "approved"
	ProfileRestricted     ProfileStatus = "restricted"
	ProfileSuspended      ProfileStatus = "suspended"
)

// RiskCategory drives product eligibility (compliance.md).
type RiskCategory string

const (
	RiskConservative RiskCategory = "conservative"
	RiskBalanced     RiskCategory = "balanced"
	RiskGrowth       RiskCategory = "growth"
	RiskAggressive   RiskCategory = "aggressive"
	RiskRestricted   RiskCategory = "restricted"
)

// OrderSide / OrderType.
type OrderSide string
type OrderType string

const (
	SideBuy  OrderSide = "buy"
	SideSell OrderSide = "sell"

	TypeMarket OrderType = "market"
	TypeLimit  OrderType = "limit"
)

// OrderStatus is the full order state machine (data-model.md).
type OrderStatus string

const (
	StatusDraft             OrderStatus = "Draft"
	StatusPendingReview     OrderStatus = "PendingReview"
	StatusAwaitingConfirm   OrderStatus = "AwaitingConfirmation"
	StatusCashLocked        OrderStatus = "CashLocked"
	StatusSubmitted         OrderStatus = "Submitted"
	StatusAccepted          OrderStatus = "Accepted"
	StatusPartiallyFilled   OrderStatus = "PartiallyFilled"
	StatusFilled            OrderStatus = "Filled"
	StatusPendingSettlement OrderStatus = "PendingSettlement"
	StatusSettled           OrderStatus = "Settled"
	StatusCancelRequested   OrderStatus = "CancelRequested"
	StatusCancelled         OrderStatus = "Cancelled"
	StatusRejected          OrderStatus = "Rejected"
	StatusFailed            OrderStatus = "Failed"
	StatusReversalPending   OrderStatus = "ReversalPending"
	StatusReversed          OrderStatus = "Reversed"
	StatusComplianceHold    OrderStatus = "ComplianceHold"
)

// orderTransitions defines the only legal status transitions. Any move not in
// this table is rejected by the service — the state machine is fail-closed.
var orderTransitions = map[OrderStatus]map[OrderStatus]bool{
	StatusDraft:             {StatusPendingReview: true, StatusCancelled: true},
	StatusPendingReview:     {StatusAwaitingConfirm: true, StatusRejected: true, StatusComplianceHold: true},
	StatusAwaitingConfirm:   {StatusCashLocked: true, StatusCancelled: true, StatusRejected: true},
	StatusCashLocked:        {StatusSubmitted: true, StatusFailed: true, StatusCancelled: true},
	StatusSubmitted:         {StatusAccepted: true, StatusRejected: true, StatusFailed: true, StatusCancelRequested: true},
	StatusAccepted:          {StatusPartiallyFilled: true, StatusFilled: true, StatusRejected: true, StatusFailed: true, StatusCancelRequested: true},
	StatusPartiallyFilled:   {StatusFilled: true, StatusPendingSettlement: true, StatusFailed: true, StatusCancelRequested: true},
	StatusFilled:            {StatusPendingSettlement: true},
	StatusPendingSettlement: {StatusSettled: true, StatusReversalPending: true},
	StatusSettled:           {},
	StatusCancelRequested:   {StatusCancelled: true, StatusFilled: true, StatusPartiallyFilled: true},
	StatusCancelled:         {},
	StatusRejected:          {},
	StatusFailed:            {StatusReversalPending: true},
	StatusReversalPending:   {StatusReversed: true},
	StatusReversed:          {},
	StatusComplianceHold:    {StatusAwaitingConfirm: true, StatusRejected: true, StatusCancelled: true},
}

// CanTransition reports whether moving from→to is a legal order transition.
func CanTransition(from, to OrderStatus) bool {
	nexts, ok := orderTransitions[from]
	if !ok {
		return false
	}
	return nexts[to]
}

// IsTerminal reports whether an order can no longer change state.
func IsTerminal(s OrderStatus) bool {
	switch s {
	case StatusSettled, StatusCancelled, StatusRejected, StatusReversed:
		return true
	}
	return false
}

// ─────────────────────────────────────────────────────────────────────────────
// Entities
// ─────────────────────────────────────────────────────────────────────────────

type Profile struct {
	ID                   string        `json:"id"`
	UserID               string        `json:"user_id"`
	KYCTier              int           `json:"kyc_tier"`
	SuitabilityProfileID *string       `json:"suitability_profile_id,omitempty"`
	RiskCategory         RiskCategory  `json:"risk_category"`
	Country              string        `json:"country"`
	ResidencyCountry     string        `json:"residency_country"`
	InvestmentEnabled    bool          `json:"investment_enabled"`
	StockTradingEnabled  bool          `json:"stock_trading_enabled"`
	PublicOfferEnabled   bool          `json:"public_offer_enabled"`
	RightsIssueEnabled   bool          `json:"rights_issue_enabled"`
	Status               ProfileStatus `json:"status"`
	CreatedAt            time.Time     `json:"created_at"`
	UpdatedAt            time.Time     `json:"updated_at"`
}

type Account struct {
	ID                  string    `json:"id"`
	UserID              string    `json:"user_id"`
	AccountNumber       string    `json:"account_number"`
	BrokerProviderID    *string   `json:"broker_provider_id,omitempty"`
	BrokerAccountID     *string   `json:"broker_account_id,omitempty"`
	CSCSNumber          *string   `json:"cscs_number,omitempty"`
	ClearingHouseNumber *string   `json:"clearing_house_number,omitempty"`
	BaseCurrency        string    `json:"base_currency"`
	Status              string    `json:"status"`
	CreatedAt           time.Time `json:"created_at"`
}

type StockAsset struct {
	ID                  string `json:"id"`
	Symbol              string `json:"symbol"`
	Name                string `json:"name"`
	Exchange            string `json:"exchange"`
	Sector              string `json:"sector"`
	Board               string `json:"board"`
	ISIN                string `json:"isin"`
	AssetClass          string `json:"asset_class"`
	Status              string `json:"status"`
	BuyEnabled          bool   `json:"buy_enabled"`
	SellEnabled         bool   `json:"sell_enabled"`
	RiskRating          string `json:"risk_rating"`
	MinimumOrderAmount  int64  `json:"minimum_order_amount"` // kobo
	MaximumOrderAmount  int64  `json:"maximum_order_amount"` // kobo; 0 = uncapped
	KYCTierRequired     int    `json:"kyc_tier_required"`
	CountryAvailability string `json:"country_availability"`
	ProviderSymbol      string `json:"provider_symbol"`
	LogoURL             string `json:"logo_url"`
	Description         string `json:"description"`
	SettlementDays      int    `json:"settlement_days"`
}

// StockWithQuote enriches a StockAsset with live (mock) market data.
type StockWithQuote struct {
	StockAsset
	Quote Quote `json:"quote"`
}

type Order struct {
	ID                 string      `json:"id"`
	UserID             string      `json:"user_id"`
	StockAssetID       string      `json:"stock_asset_id"`
	Symbol             string      `json:"symbol"`
	Side               OrderSide   `json:"side"`
	OrderType          OrderType   `json:"order_type"`
	AmountKobo         int64       `json:"amount_kobo"`
	Quantity           float64     `json:"quantity"`
	LimitPriceKobo     int64       `json:"limit_price_kobo"`
	EstimatedPriceKobo int64       `json:"estimated_price_kobo"`
	ExecutedPriceKobo  int64       `json:"executed_price_kobo"`
	FilledQuantity     float64     `json:"filled_quantity"`
	FeesKobo           int64       `json:"fees_kobo"`
	TotalAmountKobo    int64       `json:"total_amount_kobo"`
	LockedCashKobo     int64       `json:"locked_cash_kobo"`
	LockedQuantity     float64     `json:"locked_quantity"`
	Status             OrderStatus `json:"status"`
	Provider           string      `json:"provider"`
	ProviderReference  string      `json:"provider_reference"`
	IdempotencyKey     string      `json:"idempotency_key"`
	FailureReason      string      `json:"failure_reason,omitempty"`
	SettlementDueAt    *time.Time  `json:"settlement_due_at,omitempty"`
	SubmittedAt        *time.Time  `json:"submitted_at,omitempty"`
	FilledAt           *time.Time  `json:"filled_at,omitempty"`
	SettledAt          *time.Time  `json:"settled_at,omitempty"`
	CreatedAt          time.Time   `json:"created_at"`
	UpdatedAt          time.Time   `json:"updated_at"`

	// investmentAccountID is set internally before insert; not serialized.
	investmentAccountID string
}

type Position struct {
	ID               string  `json:"id"`
	UserID           string  `json:"user_id"`
	StockAssetID     string  `json:"stock_asset_id"`
	Symbol           string  `json:"symbol"`
	Quantity         float64 `json:"quantity"`
	LockedQuantity   float64 `json:"locked_quantity"`
	AvailableQty     float64 `json:"available_quantity"`
	AverageCostKobo  int64   `json:"average_cost_kobo"`
	RealizedGainKobo int64   `json:"realized_gain_kobo"`
	// Derived (filled by service using market data):
	CurrentPriceKobo   int64     `json:"current_price_kobo"`
	MarketValueKobo    int64     `json:"market_value_kobo"`
	UnrealizedGainKobo int64     `json:"unrealized_gain_kobo"`
	UpdatedAt          time.Time `json:"updated_at"`
}

type Watchlist struct {
	ID        string          `json:"id"`
	UserID    string          `json:"user_id"`
	Name      string          `json:"name"`
	IsDefault bool            `json:"is_default"`
	Items     []WatchlistItem `json:"items,omitempty"`
	CreatedAt time.Time       `json:"created_at"`
}

type WatchlistItem struct {
	ID           string    `json:"id"`
	StockAssetID string    `json:"stock_asset_id"`
	Symbol       string    `json:"symbol"`
	CreatedAt    time.Time `json:"created_at"`
}

type PriceAlert struct {
	ID              string     `json:"id"`
	UserID          string     `json:"user_id"`
	StockAssetID    string     `json:"stock_asset_id"`
	Symbol          string     `json:"symbol"`
	Condition       string     `json:"condition"`
	TargetPriceKobo int64      `json:"target_price_kobo"`
	Status          string     `json:"status"`
	TriggeredAt     *time.Time `json:"triggered_at,omitempty"`
	CreatedAt       time.Time  `json:"created_at"`
}

type Dividend struct {
	ID                 string  `json:"id"`
	StockAssetID       string  `json:"stock_asset_id"`
	Symbol             string  `json:"symbol"`
	AmountPerShareKobo int64   `json:"amount_per_share_kobo"`
	Currency           string  `json:"currency"`
	ExDate             *string `json:"ex_date,omitempty"`
	RecordDate         *string `json:"record_date,omitempty"`
	PaymentDate        *string `json:"payment_date,omitempty"`
	Status             string  `json:"status"`
	Source             string  `json:"source,omitempty"`
}

type CorporateAction struct {
	ID            string  `json:"id"`
	StockAssetID  string  `json:"stock_asset_id"`
	Symbol        string  `json:"symbol"`
	Type          string  `json:"type"`
	Title         string  `json:"title"`
	Description   string  `json:"description,omitempty"`
	EffectiveDate *string `json:"effective_date,omitempty"`
	RecordDate    *string `json:"record_date,omitempty"`
	PaymentDate   *string `json:"payment_date,omitempty"`
	Status        string  `json:"status"`
	Source        string  `json:"source,omitempty"`
}

type PublicOffer struct {
	ID             string  `json:"id"`
	IssuerName     string  `json:"issuer_name"`
	Symbol         string  `json:"symbol"`
	OfferPriceKobo int64   `json:"offer_price_kobo"`
	MinimumSubKobo int64   `json:"minimum_subscription_kobo"`
	OpeningDate    *string `json:"opening_date,omitempty"`
	ClosingDate    *string `json:"closing_date,omitempty"`
	ProspectusURL  string  `json:"prospectus_url,omitempty"`
	Status         string  `json:"status"`
}

type PublicOfferApplication struct {
	ID            string    `json:"id"`
	PublicOfferID string    `json:"public_offer_id"`
	UserID        string    `json:"user_id"`
	AmountKobo    int64     `json:"amount_kobo"`
	Status        string    `json:"status"`
	AllottedKobo  int64     `json:"allotted_kobo"`
	RefundKobo    int64     `json:"refund_kobo"`
	CreatedAt     time.Time `json:"created_at"`
}

type RightsIssue struct {
	ID                string  `json:"id"`
	IssuerName        string  `json:"issuer_name"`
	Symbol            string  `json:"symbol"`
	Ratio             string  `json:"ratio"`
	OfferPriceKobo    int64   `json:"offer_price_kobo"`
	QualificationDate *string `json:"qualification_date,omitempty"`
	OpeningDate       *string `json:"opening_date,omitempty"`
	ClosingDate       *string `json:"closing_date,omitempty"`
	Status            string  `json:"status"`
}

type RightsIssueApplication struct {
	ID            string    `json:"id"`
	RightsIssueID string    `json:"rights_issue_id"`
	UserID        string    `json:"user_id"`
	AcceptedUnits float64   `json:"accepted_units"`
	AmountKobo    int64     `json:"amount_kobo"`
	Status        string    `json:"status"`
	CreatedAt     time.Time `json:"created_at"`
}

type Agreement struct {
	Key      string `json:"key"`
	Title    string `json:"title"`
	Version  string `json:"version"`
	BodyURL  string `json:"body_url,omitempty"`
	IsActive bool   `json:"is_active"`
	Accepted bool   `json:"accepted"`
}

// WalletView is the projected investment-wallet snapshot (data-model.md balances).
type WalletView struct {
	Currency              string `json:"currency"`
	AvailableCashKobo     int64  `json:"available_cash_kobo"`
	LockedCashKobo        int64  `json:"locked_cash_kobo"`
	PendingSettlementKobo int64  `json:"pending_settlement_kobo"`
	InvestedValueKobo     int64  `json:"invested_value_kobo"`
	TotalPortfolioKobo    int64  `json:"total_portfolio_value_kobo"`
	WithdrawableCashKobo  int64  `json:"withdrawable_cash_kobo"`
}

// PortfolioView aggregates holdings + cash for the invest home / portfolio tab.
type PortfolioView struct {
	TotalValueKobo        int64      `json:"total_value_kobo"`
	CashBalanceKobo       int64      `json:"cash_balance_kobo"`
	InvestedValueKobo     int64      `json:"invested_value_kobo"`
	PendingSettlementKobo int64      `json:"pending_settlement_kobo"`
	TotalGainKobo         int64      `json:"total_gain_kobo"`
	TodayGainKobo         int64      `json:"today_gain_kobo"`
	Positions             []Position `json:"positions"`
}

// ─────────────────────────────────────────────────────────────────────────────
// Fee engine (admin-configurable; never hard-coded in the client)
// ─────────────────────────────────────────────────────────────────────────────

// FeeSchedule is the server-side fee model. Defaults below are placeholders the
// admin fee-config surface overrides; the client must read fees from the server.
type FeeSchedule struct {
	CommissionBPS int   `json:"commission_bps"` // e.g. 150 = 1.50%
	MinFeeKobo    int64 `json:"min_fee_kobo"`   // floor per trade
}

// DefaultFeeSchedule is used until an admin config row exists.
func DefaultFeeSchedule() FeeSchedule {
	return FeeSchedule{CommissionBPS: 150, MinFeeKobo: 10_000} // 1.5%, ₦100 min
}

// FeeFor computes the fee (kobo) for a notional value (kobo). Integer math only.
func (f FeeSchedule) FeeFor(notionalKobo int64) int64 {
	if notionalKobo <= 0 {
		return 0
	}
	fee := notionalKobo * int64(f.CommissionBPS) / 10_000
	if fee < f.MinFeeKobo {
		fee = f.MinFeeKobo
	}
	return fee
}

// ─────────────────────────────────────────────────────────────────────────────
// Request DTOs
// ─────────────────────────────────────────────────────────────────────────────

type BuyOrderRequest struct {
	Symbol         string    `json:"symbol" binding:"required"`
	OrderType      OrderType `json:"order_type"`
	AmountKobo     int64     `json:"amount_kobo"`            // buy-by-amount (preferred for beginners)
	Quantity       float64   `json:"quantity"`               // buy-by-quantity (optional)
	LimitPriceKobo int64     `json:"limit_price_kobo"`       // required for limit orders
	PIN            string    `json:"pin" binding:"required"` // confirmation factor
}

type SellOrderRequest struct {
	Symbol         string    `json:"symbol" binding:"required"`
	OrderType      OrderType `json:"order_type"`
	Quantity       float64   `json:"quantity" binding:"required"`
	LimitPriceKobo int64     `json:"limit_price_kobo"`
	PIN            string    `json:"pin" binding:"required"`
}

type DepositRequest struct {
	AmountKobo int64  `json:"amount_kobo" binding:"required"`
	Source     string `json:"source"` // paymax_wallet (default)
}

type WithdrawRequest struct {
	AmountKobo  int64  `json:"amount_kobo" binding:"required"`
	Destination string `json:"destination"` // paymax_wallet (default)
}

// SuitabilitySubmitRequest carries questionnaire answers keyed by question id.
type SuitabilitySubmitRequest struct {
	Answers map[string]int `json:"answers" binding:"required"`
}

// Receipt is returned after an order is confirmed (every trade-confirmation
// screen must show estimate, fees, total, settlement timeline).
type Receipt struct {
	Order          Order  `json:"order"`
	RiskDisclosure string `json:"risk_disclosure"`
	SettlementNote string `json:"settlement_note"`
}
