// Package domain holds the data contract shared by every Paymax Invest · Crypto
// service. The JSON shapes here mirror the mobile TypeScript types exactly
// (camelCase, integer minor-unit money) so the same payloads round-trip between
// the Go backend and the React Native client.
package domain

// ── Money primitives ─────────────────────────────────────────────────────────

// Money is an integer minor-unit fiat amount (kobo/cents) + ISO-4217 currency.
type Money struct {
	Amount   int64  `json:"amount"`
	Currency string `json:"currency"`
}

// CryptoAmount is an integer base-unit crypto amount (10**decimals per coin).
type CryptoAmount struct {
	Amount int64  `json:"amount"`
	Symbol string `json:"symbol"`
}

// Network is a supported settlement network for an asset.
type Network struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	Confirmations int    `json:"confirmations"`
}

// ── Asset ────────────────────────────────────────────────────────────────────

// Asset is an admin-whitelisted tradable crypto asset. Every control is
// server-config: the client renders, it never decides availability.
type Asset struct {
	ID                string    `json:"id"`
	Type              string    `json:"type"`
	Symbol            string    `json:"symbol"`
	Name              string    `json:"name"`
	Decimals          int       `json:"decimals"`
	IconColor         string    `json:"iconColor"`
	RiskRating        string    `json:"riskRating"`
	Status            string    `json:"status"`
	BuyEnabled        bool      `json:"buyEnabled"`
	SellEnabled       bool      `json:"sellEnabled"`
	DepositEnabled    bool      `json:"depositEnabled"`
	WithdrawalEnabled bool      `json:"withdrawalEnabled"`
	MinOrderAmount    int64     `json:"minOrderAmount"`
	MaxOrderAmount    int64     `json:"maxOrderAmount"`
	Price             Money     `json:"price"`
	Change24hPct      float64   `json:"change24hPct"`
	MarketCap         Money     `json:"marketCap"`
	Volume24h         Money     `json:"volume24h"`
	SupportedNetworks []Network `json:"supportedNetworks"`
	Description       string    `json:"description"`
	RiskDisclosure    string    `json:"riskDisclosure"`
	KycTierRequired   int       `json:"kycTierRequired"`
}

// CandlePoint is one price-history sample.
type CandlePoint struct {
	T     string `json:"t"`
	Price int64  `json:"price"`
}

// ── Quotes / orders ──────────────────────────────────────────────────────────

// Fee is one itemised charge in settlement fiat (transparency: never hidden).
type Fee struct {
	Type   string `json:"type"`
	Amount Money  `json:"amount"`
}

// Quote is an executable buy/sell quote. Execution runs against ID before
// ExpiresAt; past that the client must re-quote.
type Quote struct {
	ID                string       `json:"id"`
	AssetID           string       `json:"assetId"`
	Symbol            string       `json:"symbol"`
	Side              string       `json:"side"`
	Status            string       `json:"status"`
	Basis             string       `json:"basis"`
	Fiat              Money        `json:"fiat"`
	Crypto            CryptoAmount `json:"crypto"`
	Rate              Money        `json:"rate"`
	AllInRate         Money        `json:"allInRate"`
	SpreadPct         float64      `json:"spreadPct"`
	Fees              []Fee        `json:"fees"`
	TotalFiat         Money        `json:"totalFiat"`
	LiquidityProvider string       `json:"liquidityProvider"`
	CustodyProvider   string       `json:"custodyProvider"`
	RiskScore         int          `json:"riskScore"`
	ExpiresAt         string       `json:"expiresAt"`
}

// StatusEvent is one transition in a transaction's history.
type StatusEvent struct {
	Status string `json:"status"`
	At     string `json:"at"`
}

// Order is the result of a buy/sell execution (server-authoritative).
type Order struct {
	ID                string       `json:"id"`
	Reference         string       `json:"reference"`
	AssetID           string       `json:"assetId"`
	Symbol            string       `json:"symbol"`
	Side              string       `json:"side"`
	Status            string       `json:"status"`
	Fiat              Money        `json:"fiat"`
	Crypto            CryptoAmount `json:"crypto"`
	AllInRate         Money        `json:"allInRate"`
	Fees              []Fee        `json:"fees"`
	TotalFiat         Money        `json:"totalFiat"`
	Provider          string       `json:"provider"`
	ProviderReference string       `json:"providerReference"`
	IdempotencyKey    string       `json:"idempotencyKey"`
	TransactionID     string       `json:"transactionId"`
	FailureReason     string       `json:"failureReason,omitempty"`
	CreatedAt         string       `json:"createdAt"`
}

// ── Transactions ─────────────────────────────────────────────────────────────

// TxSummary is the unified history row (embedded into TxDetail).
type TxSummary struct {
	ID        string       `json:"id"`
	Reference string       `json:"reference"`
	Side      string       `json:"side"`
	Symbol    string       `json:"symbol"`
	AssetName string       `json:"assetName"`
	IconColor string       `json:"iconColor"`
	Status    string       `json:"status"`
	Fiat      Money        `json:"fiat"`
	Crypto    CryptoAmount `json:"crypto"`
	CreatedAt string       `json:"createdAt"`
}

// TxDetail is the full receipt (extends TxSummary).
type TxDetail struct {
	TxSummary
	AllInRate         Money         `json:"allInRate"`
	Fees              []Fee         `json:"fees"`
	TotalFiat         Money         `json:"totalFiat"`
	Provider          string        `json:"provider"`
	ProviderReference string        `json:"providerReference"`
	LiquidityProvider string        `json:"liquidityProvider"`
	CustodyProvider   string        `json:"custodyProvider"`
	StatusHistory     []StatusEvent `json:"statusHistory"`
	FailureReason     string        `json:"failureReason,omitempty"`
}

// ── Portfolio ────────────────────────────────────────────────────────────────

// Position is a single crypto holding with computed performance.
type Position struct {
	AssetID            string       `json:"assetId"`
	Symbol             string       `json:"symbol"`
	Name               string       `json:"name"`
	IconColor          string       `json:"iconColor"`
	RiskRating         string       `json:"riskRating"`
	Quantity           CryptoAmount `json:"quantity"`
	AverageCost        Money        `json:"averageCost"`
	MarketValue        Money        `json:"marketValue"`
	CostBasis          Money        `json:"costBasis"`
	UnrealizedGainLoss Money        `json:"unrealizedGainLoss"`
	UnrealizedPct      float64      `json:"unrealizedPct"`
	Price              Money        `json:"price"`
	Change24hPct       float64      `json:"change24hPct"`
}

// Portfolio is the crypto portfolio aggregate.
type Portfolio struct {
	BaseCurrency      string     `json:"baseCurrency"`
	TotalValue        Money      `json:"totalValue"`
	TotalCostBasis    Money      `json:"totalCostBasis"`
	TotalGainLoss     Money      `json:"totalGainLoss"`
	TotalGainLossPct  float64    `json:"totalGainLossPct"`
	DayChange         Money      `json:"dayChange"`
	DayChangePct      float64    `json:"dayChangePct"`
	InvestableBalance Money      `json:"investableBalance"`
	Positions         []Position `json:"positions"`
}

// ── Eligibility ──────────────────────────────────────────────────────────────

// Eligibility is the trading gate (KYC + suitability + agreements + product).
type Eligibility struct {
	State         string `json:"state"`
	KycTier       int    `json:"kycTier"`
	CryptoEnabled bool   `json:"cryptoEnabled"`
	Message       string `json:"message"`
	CtaRoute      string `json:"ctaRoute,omitempty"`
}

// ── Watchlist / alerts ───────────────────────────────────────────────────────

// PriceAlert is a price-threshold notification.
type PriceAlert struct {
	ID          string  `json:"id"`
	AssetID     string  `json:"assetId"`
	Symbol      string  `json:"symbol"`
	IconColor   string  `json:"iconColor"`
	Condition   string  `json:"condition"`
	TargetPrice Money   `json:"targetPrice"`
	Status      string  `json:"status"`
	TriggeredAt *string `json:"triggeredAt"`
	CreatedAt   string  `json:"createdAt"`
}

// ── Withdrawal address book ──────────────────────────────────────────────────

// Address is a whitelisted withdrawal destination.
type Address struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Symbol      string `json:"symbol"`
	NetworkID   string `json:"networkId"`
	NetworkName string `json:"networkName"`
	Address     string `json:"address"`
	Whitelisted bool   `json:"whitelisted"`
	Screened    bool   `json:"screened"`
	AddedAt     string `json:"addedAt"`
}

// AddressScreening is the AML/sanctions screening outcome.
type AddressScreening struct {
	Risk   string `json:"risk"`
	Reason string `json:"reason,omitempty"`
}

// ── Withdrawal ───────────────────────────────────────────────────────────────

// WithdrawalEligibility gates the withdrawal flow.
type WithdrawalEligibility struct {
	Gate                  string `json:"gate"`
	KycTier               int    `json:"kycTier"`
	ManualReviewOnly      bool   `json:"manualReviewOnly"`
	DailyLimit            Money  `json:"dailyLimit"`
	DailyUsed             Money  `json:"dailyUsed"`
	ManualReviewThreshold Money  `json:"manualReviewThreshold"`
	CoolingEndsAt         string `json:"coolingEndsAt,omitempty"`
	Message               string `json:"message"`
}

// WithdrawalQuote previews a withdrawal (network fee is the headline line).
type WithdrawalQuote struct {
	Symbol               string       `json:"symbol"`
	NetworkID            string       `json:"networkId"`
	NetworkName          string       `json:"networkName"`
	Amount               CryptoAmount `json:"amount"`
	NetworkFee           CryptoAmount `json:"networkFee"`
	PaymaxFee            Money        `json:"paymaxFee"`
	ReceiveAmount        CryptoAmount `json:"receiveAmount"`
	FiatValue            Money        `json:"fiatValue"`
	RequiresManualReview bool         `json:"requiresManualReview"`
	ExpiresAt            string       `json:"expiresAt"`
}

// WithdrawalResult is the (manual-review) outcome of a withdrawal request.
type WithdrawalResult struct {
	ID                 string       `json:"id"`
	Reference          string       `json:"reference"`
	Symbol             string       `json:"symbol"`
	Status             string       `json:"status"`
	Amount             CryptoAmount `json:"amount"`
	NetworkFee         CryptoAmount `json:"networkFee"`
	Address            string       `json:"address"`
	NetworkName        string       `json:"networkName"`
	ProviderReference  string       `json:"providerReference"`
	IdempotencyKey     string       `json:"idempotencyKey"`
	EstimatedReviewMin int          `json:"estimatedReviewMins"`
	CreatedAt          string       `json:"createdAt"`
	FailureReason      string       `json:"failureReason,omitempty"`
}

// ── Deposit ──────────────────────────────────────────────────────────────────

// DepositAddress is a custody deposit address for one asset on one network.
type DepositAddress struct {
	Symbol          string       `json:"symbol"`
	NetworkID       string       `json:"networkId"`
	NetworkName     string       `json:"networkName"`
	Address         string       `json:"address"`
	Memo            string       `json:"memo,omitempty"`
	MinDeposit      CryptoAmount `json:"minDeposit"`
	Confirmations   int          `json:"confirmations"`
	CustodyProvider string       `json:"custodyProvider"`
}

// ── Swap ─────────────────────────────────────────────────────────────────────

// SwapQuote is an executable crypto-to-crypto quote.
type SwapQuote struct {
	ID                string       `json:"id"`
	FromAssetID       string       `json:"fromAssetId"`
	ToAssetID         string       `json:"toAssetId"`
	From              CryptoAmount `json:"from"`
	To                CryptoAmount `json:"to"`
	Rate              float64      `json:"rate"`
	SpreadPct         float64      `json:"spreadPct"`
	Fee               Money        `json:"fee"`
	FiatValue         Money        `json:"fiatValue"`
	LiquidityProvider string       `json:"liquidityProvider"`
	ExpiresAt         string       `json:"expiresAt"`
}

// SwapResult is the outcome of a swap execution.
type SwapResult struct {
	ID                string       `json:"id"`
	Reference         string       `json:"reference"`
	FromSymbol        string       `json:"fromSymbol"`
	ToSymbol          string       `json:"toSymbol"`
	Status            string       `json:"status"`
	From              CryptoAmount `json:"from"`
	To                CryptoAmount `json:"to"`
	Fee               Money        `json:"fee"`
	Provider          string       `json:"provider"`
	ProviderReference string       `json:"providerReference"`
	IdempotencyKey    string       `json:"idempotencyKey"`
	TransactionID     string       `json:"transactionId"`
	FailureReason     string       `json:"failureReason,omitempty"`
	CreatedAt         string       `json:"createdAt"`
}

// ── Ledger (double-entry; balances never trust provider alone) ───────────────

// LedgerEntry is one double-entry record. Every balance movement writes one.
type LedgerEntry struct {
	ID                string `json:"id"`
	TransactionID     string `json:"transactionId"`
	DebitAccount      string `json:"debitAccount"`
	CreditAccount     string `json:"creditAccount"`
	Amount            int64  `json:"amount"`
	Currency          string `json:"currency"`
	Type              string `json:"type"`
	Reference         string `json:"reference"`
	ProviderReference string `json:"providerReference"`
	CreatedAt         string `json:"createdAt"`
}
