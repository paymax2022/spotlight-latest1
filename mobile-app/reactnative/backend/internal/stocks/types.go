// Package stocks is the self-contained equities/ETF surface for Paymax Invest.
// It mirrors the crypto module's shape (Asset · Order · Position · Portfolio) and
// matches the mobile contract in src/features/stocks/* exactly: camelCase JSON,
// integer minor-unit money, and the same buildEstimate fee math + chartFor
// generator so the client's preview and the server's executed numbers agree.
//
// IRON RULES (same as crypto):
//   - Money is integer MINOR UNITS (kobo/cents). Never floats on the wire.
//   - Fees, limits and availability are server-config — the client renders what
//     the asset/estimate payload says (never hard-coded).
//   - Every order mutation carries an Idempotency-Key.
package stocks

// ── Money primitives ───────────────────────────────────────────────────────────

// Money is the canonical fiat money object — integer minor units + ISO-4217.
type Money struct {
	Amount   int64  `json:"amount"`   // integer, minor units (e.g. 105000 = ₦1,050.00)
	Currency string `json:"currency"` // "NGN" | "USD"
}

// ── Asset (admin-whitelisted, server-driven config) ─────────────────────────────

// Stock is a tradable stock / ETF. Every control is admin-set / server-driven;
// the client treats it as read-only config. Mirrors StockAsset.
type Stock struct {
	ID       string `json:"id"`
	Type     string `json:"type"` // always "stock"
	Symbol   string `json:"symbol"`
	Name     string `json:"name"`
	Exchange string `json:"exchange"` // "NGX" | "NASDAQ" | "NYSE"
	Sector   string `json:"sector"`
	Currency string `json:"currency"` // "NGN" | "USD"
	IconColor string `json:"iconColor"`
	RiskRating string `json:"riskRating"` // "low" | "medium" | "high"
	Status     string `json:"status"`     // "active" | "paused" | "delisted"
	// Capability flags.
	BuyEnabled   bool   `json:"buyEnabled"`
	SellEnabled  bool   `json:"sellEnabled"`
	MarketStatus string `json:"marketStatus"` // "open" | "closed" | "pre" | "post"
	// Pricing snapshot (display only; execution price comes from estimate/fill).
	Price        Money   `json:"price"`
	Change24hPct float64 `json:"change24hPct"`
	DayChange    Money   `json:"dayChange"`
	Week52High   Money   `json:"week52High"`
	Week52Low    Money   `json:"week52Low"`
	MarketCap    Money   `json:"marketCap"`
	Volume       int64   `json:"volume"`
	Bid          Money   `json:"bid"`
	Ask          Money   `json:"ask"`
	Summary        string `json:"summary"`
	RiskDisclosure string `json:"riskDisclosure"`
	// Fees / settlement / limits — server-config.
	FeeBps          int64  `json:"feeBps"`          // commission in basis points
	SettlementCycle string `json:"settlementCycle"` // "T+3" (NGX) / "T+2" (US)
	MinOrderAmount  int64  `json:"minOrderAmount"`  // minor units of the settlement fiat
	MaxOrderAmount  int64  `json:"maxOrderAmount"`
	KycTierRequired int64  `json:"kycTierRequired"`
}

// Candle is one point of indicative price history.
type Candle struct {
	T     string `json:"t"`     // ISO timestamp
	Price int64  `json:"price"` // indicative price (settlement fiat, minor units)
}

// ── News / dividends / corporate actions ────────────────────────────────────────

// News is a market headline tied to the equities surface (mirrors StockNews).
type News struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Source      string `json:"source"`
	PublishedAt string `json:"publishedAt"` // ISO
	Summary     string `json:"summary"`
}

// Dividend is an announced / paid distribution.
type Dividend struct {
	ID             string `json:"id"`
	Symbol         string `json:"symbol"`
	ExDate         string `json:"exDate"`  // ISO
	PayDate        string `json:"payDate"` // ISO
	AmountPerShare Money  `json:"amountPerShare"`
	Status         string `json:"status"` // "announced" | "paid"
}

// CorporateAction is a split / bonus / AGM event.
type CorporateAction struct {
	ID          string `json:"id"`
	Symbol      string `json:"symbol"`
	Type        string `json:"type"` // "split" | "bonus" | "agm" …
	Title       string `json:"title"`
	Description string `json:"description"`
	ExDate      string `json:"exDate"` // ISO
	Status      string `json:"status"`
}

// ── Fees / order estimate ───────────────────────────────────────────────────────

// Fee is one itemised line of an estimate/order, in settlement fiat.
type Fee struct {
	Type   string `json:"type"`
	Amount Money  `json:"amount"`
}

// OrderEstimate is the pre-trade preview; the API executes the same math.
type OrderEstimate struct {
	Side       string `json:"side"`
	OrderType  string `json:"orderType"`
	Symbol     string `json:"symbol"`
	AssetID    string `json:"assetId"`
	Quantity   int64  `json:"quantity"` // whole shares
	EstPrice   Money  `json:"estPrice"` // indicative price per share
	LimitPrice *Money `json:"limitPrice,omitempty"`
	Gross      Money  `json:"gross"` // qty * (limit ?? est) price
	Fees       []Fee  `json:"fees"`
	Total      Money  `json:"total"` // buy: gross + fees / sell: gross - fees
	SettlementCycle string `json:"settlementCycle"`
}

// ── Order (server-authoritative result) ─────────────────────────────────────────

// StatusEvent is one transition in an order's lifecycle.
type StatusEvent struct {
	Status string `json:"status"`
	At     string `json:"at"`
}

// StockOrder is the server-authoritative result of a placed order.
type StockOrder struct {
	ID                string        `json:"id"`
	Reference         string        `json:"reference"` // "PMX-ST-123456" — user-facing
	AssetID           string        `json:"assetId"`
	Symbol            string        `json:"symbol"`
	Name              string        `json:"name"`
	Side              string        `json:"side"`
	OrderType         string        `json:"orderType"`
	Status            string        `json:"status"`
	Quantity          int64         `json:"quantity"`
	FilledQuantity    int64         `json:"filledQuantity"`
	Price             Money         `json:"price"` // executed / indicative price per share
	LimitPrice        *Money        `json:"limitPrice,omitempty"`
	Gross             Money         `json:"gross"`
	Fees              []Fee         `json:"fees"`
	Total             Money         `json:"total"`
	Provider          string        `json:"provider"`
	ProviderReference string        `json:"providerReference"`
	SettlementDate    string        `json:"settlementDate,omitempty"` // ISO
	IdempotencyKey    string        `json:"idempotencyKey"`
	FailureReason     string        `json:"failureReason,omitempty"`
	CreatedAt         string        `json:"createdAt"`
	StatusHistory     []StatusEvent `json:"statusHistory"`
}

// ── Portfolio / positions ───────────────────────────────────────────────────────

// StockPosition is one computed holding.
type StockPosition struct {
	AssetID            string  `json:"assetId"`
	Symbol             string  `json:"symbol"`
	Name               string  `json:"name"`
	Exchange           string  `json:"exchange"`
	IconColor          string  `json:"iconColor"`
	Quantity           int64   `json:"quantity"` // shares held
	AverageCost        Money   `json:"averageCost"`
	MarketValue        Money   `json:"marketValue"`
	CostBasis          Money   `json:"costBasis"`
	UnrealizedGainLoss Money   `json:"unrealizedGainLoss"`
	UnrealizedPct      float64 `json:"unrealizedPct"`
	Price              Money   `json:"price"`
	Change24hPct       float64 `json:"change24hPct"`
}

// StockPortfolio is the aggregate equities portfolio.
type StockPortfolio struct {
	BaseCurrency      string          `json:"baseCurrency"`
	TotalValue        Money           `json:"totalValue"`
	TotalCostBasis    Money           `json:"totalCostBasis"`
	TotalGainLoss     Money           `json:"totalGainLoss"`
	TotalGainLossPct  float64         `json:"totalGainLossPct"`
	DayChange         Money           `json:"dayChange"`
	DayChangePct      float64         `json:"dayChangePct"`
	InvestableBalance Money           `json:"investableBalance"`
	Positions         []StockPosition `json:"positions"`
}

// ── Public offers (IPO / rights issues) ──────────────────────────────────────────

// PublicOffer is an IPO or rights issue the user can apply to.
type PublicOffer struct {
	ID        string `json:"id"`
	Symbol    string `json:"symbol"`
	Name      string `json:"name"`
	Kind      string `json:"kind"` // "ipo" | "rights"
	PriceLow  Money  `json:"priceLow"`
	PriceHigh Money  `json:"priceHigh"`
	OpenDate  string `json:"openDate"`  // ISO
	CloseDate string `json:"closeDate"` // ISO
	MinUnits  int64  `json:"minUnits"`
	Status    string `json:"status"` // "open" | "upcoming" | "closed"
	Summary   string `json:"summary"`
}

// ── Draft the screens build before hitting a mutation ────────────────────────────

// OrderDraft is the client-built request for placing an order.
type OrderDraft struct {
	AssetID    string `json:"assetId"`
	Symbol     string `json:"symbol"`
	Side       string `json:"side"`
	OrderType  string `json:"orderType"`
	Quantity   int64  `json:"quantity"`             // whole shares
	LimitPrice int64  `json:"limitPrice,omitempty"` // fiat minor units per share (limit orders)
}

// ── Typed errors ─────────────────────────────────────────────────────────────────

// StockError is a typed pre-trade/execution failure. It maps to the client error
// envelope `{ type, message }`; the mobile layer surfaces `message` and keys
// special-case paths off `type` (e.g. "market_closed").
type StockError struct {
	Type    string `json:"type"`
	Message string `json:"message"`
}

func (e *StockError) Error() string { return e.Message }
