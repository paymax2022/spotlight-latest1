package stocks

import (
	"sort"
	"sync"

	"paymax/crypto-backend/internal/engine"
)

// Service is the process-wide, in-memory state for the stocks surface: a
// whitelisted catalogue, holdings, orders, market data and an idempotency cache.
// Every method locks for the whole call and returns JSON-ready value types. Swap
// the slices for Postgres/Redis behind the same method set.
type Service struct {
	mu sync.Mutex

	stocks    []Stock
	positions []StockPosition
	orders    []StockOrder
	news      []News
	dividends []Dividend
	actions   []CorporateAction
	offers    []PublicOffer

	idem   map[string]StockOrder
	broker Broker // execution venue seam (defaults to MockBroker)
}

// Illustrative investable balances for buy pre-checks (mirrors stocks.api.ts).
// The portfolio always reports the NGN balance; USD buys check the USD balance.
const (
	investableNGNMinor = 125_000_000 // ₦1,250,000.00
	investableUSDMinor = 200_000     // $2,000.00
)

// NewService seeds a Service from the mock fixtures so live mode matches mock.
func NewService() *Service {
	stocks := seedStocks()
	return &Service{
		stocks:    stocks,
		positions: seedPositions(stocks),
		orders:    seedOrders(),
		news:      seedNews(),
		dividends: seedDividends(),
		actions:   seedCorporateActions(),
		offers:    seedOffers(),
		idem:      map[string]StockOrder{},
		broker:    MockBroker{},
	}
}

// WithBroker injects a custom execution venue (e.g. an Alpaca adapter) in place of
// the default MockBroker, returning the Service for chaining. A nil broker is
// ignored so the default is never removed.
func (s *Service) WithBroker(b Broker) *Service {
	if b != nil {
		s.mu.Lock()
		s.broker = b
		s.mu.Unlock()
	}
	return s
}

// ── Assets / market data ─────────────────────────────────────────────────────--

// Assets returns a copy of the whitelisted catalogue.
func (s *Service) Assets() []Stock {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]Stock(nil), s.stocks...)
}

// Asset resolves a stock by id or symbol.
func (s *Service) Asset(symbol string) (Stock, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.findAsset(symbol)
}

func (s *Service) findAsset(key string) (Stock, bool) {
	for _, a := range s.stocks {
		if a.ID == key || a.Symbol == key {
			return a, true
		}
	}
	return Stock{}, false
}

// Chart returns the deterministic price history for a stock + range.
func (s *Service) Chart(symbol, rng string) ([]Candle, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	a, ok := s.findAsset(symbol)
	if !ok {
		return nil, false
	}
	return Chart(a, rng), true
}

// News returns the market headlines (not symbol-filtered; mirrors the mock).
func (s *Service) News(symbol string) []News {
	s.mu.Lock()
	defer s.mu.Unlock()
	_ = symbol
	return append([]News(nil), s.news...)
}

// Dividends returns the dividends for a symbol.
func (s *Service) Dividends(symbol string) []Dividend {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := []Dividend{}
	for _, d := range s.dividends {
		if d.Symbol == symbol {
			out = append(out, d)
		}
	}
	return out
}

// CorporateActions returns the corporate actions for a symbol.
func (s *Service) CorporateActions(symbol string) []CorporateAction {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := []CorporateAction{}
	for _, c := range s.actions {
		if c.Symbol == symbol {
			out = append(out, c)
		}
	}
	return out
}

// ── Portfolio / positions ────────────────────────────────────────────────────--

// Positions returns the computed holdings.
func (s *Service) Positions() []StockPosition {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]StockPosition(nil), s.positions...)
}

// Portfolio aggregates the holdings into the portfolio summary (mirrors
// stocks.api.ts getPortfolio: everything based in NGN, fixed investable balance).
func (s *Service) Portfolio() StockPortfolio {
	s.mu.Lock()
	defer s.mu.Unlock()
	positions := append([]StockPosition(nil), s.positions...)
	var totalValue, totalCost, day int64
	for _, p := range positions {
		totalValue += p.MarketValue.Amount
		totalCost += p.CostBasis.Amount
		day += round(float64(p.MarketValue.Amount) * p.Change24hPct / 100)
	}
	gain := totalValue - totalCost
	gainPct := 0.0
	if totalCost != 0 {
		gainPct = round2(float64(gain) / float64(totalCost) * 100)
	}
	prev := totalValue - day
	dayPct := 0.0
	if prev != 0 {
		dayPct = round2(float64(day) / float64(prev) * 100)
	}
	return StockPortfolio{
		BaseCurrency:      "NGN",
		TotalValue:        Money{Amount: totalValue, Currency: "NGN"},
		TotalCostBasis:    Money{Amount: totalCost, Currency: "NGN"},
		TotalGainLoss:     Money{Amount: gain, Currency: "NGN"},
		TotalGainLossPct:  gainPct,
		DayChange:         Money{Amount: day, Currency: "NGN"},
		DayChangePct:      dayPct,
		InvestableBalance: Money{Amount: investableNGNMinor, Currency: "NGN"},
		Positions:         positions,
	}
}

// ── Place order ──────────────────────────────────────────────────────────────--

// PlaceOrder runs the pre-trade checks then records a Filled (market) or
// Submitted (limit) order. Mirrors stocks.api.ts placeOrder + the iron rules:
// idempotency-keyed, server-authoritative estimate, typed pre-trade errors.
func (s *Service) PlaceOrder(d OrderDraft, idempotencyKey string) (StockOrder, *StockError) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if idempotencyKey != "" {
		if o, ok := s.idem[idempotencyKey]; ok {
			return o, nil
		}
	}

	asset, ok := s.findAsset(d.AssetID)
	if !ok {
		asset, ok = s.findAsset(d.Symbol)
	}
	if !ok {
		return StockOrder{}, &StockError{Type: "not_found", Message: "Stock not found"}
	}

	est := BuildEstimate(asset, d.Side, d.OrderType, d.Quantity, d.LimitPrice)

	// Pre-trade checks (server-authoritative).
	if d.OrderType == "market" && asset.MarketStatus == "closed" {
		return StockOrder{}, &StockError{
			Type:    "market_closed",
			Message: "The market is closed, so this market order cannot be filled right now. Try a limit order or come back when the market opens.",
		}
	}
	investable := investableNGNMinor
	if asset.Currency != "NGN" {
		investable = investableUSDMinor
	}
	if d.Side == "buy" && est.Total.Amount > int64(investable) {
		return StockOrder{}, &StockError{
			Type:    "insufficient_balance",
			Message: "You don't have enough available balance to place this order. Add funds and try again.",
		}
	}
	if est.Gross.Amount < asset.MinOrderAmount || est.Gross.Amount > asset.MaxOrderAmount {
		return StockOrder{}, &StockError{
			Type:    "limit_exceeded",
			Message: "This order is outside the allowed limits for this stock. Adjust the quantity and try again.",
		}
	}

	now := engine.Now()
	// Execution venue decides the resulting order state (mock fills instantly; a
	// real broker returns "accepted" and drives fills via webhooks). Pre-trade
	// checks above and persistence below are unchanged.
	fill := s.broker.Place(BrokerRequest{
		Symbol:          asset.Symbol,
		Side:            d.Side,
		OrderType:       d.OrderType,
		Quantity:        d.Quantity,
		SettlementCycle: asset.SettlementCycle,
	})
	status := fill.Status
	filledQuantity := fill.FilledQuantity
	settlementDate := fill.SettlementDate
	statusHistory := fill.History
	provider := fill.Provider
	if provider == "" {
		provider = "mock-broker"
	}

	// Executed/indicative price: limit price for limit orders, else est price.
	price := est.EstPrice
	if d.OrderType == "limit" && est.LimitPrice != nil {
		price = *est.LimitPrice
	}

	order := StockOrder{
		ID:                engine.NewID("so"),
		Reference:         engine.NewRef("PMX-ST"),
		AssetID:           asset.ID,
		Symbol:            asset.Symbol,
		Name:              asset.Name,
		Side:              d.Side,
		OrderType:         d.OrderType,
		Status:            status,
		Quantity:          d.Quantity,
		FilledQuantity:    filledQuantity,
		Price:             price,
		LimitPrice:        est.LimitPrice,
		Gross:             est.Gross,
		Fees:              est.Fees,
		Total:             est.Total,
		Provider:          provider,
		ProviderReference: engine.NewRef("BR") + "-XY",
		SettlementDate:    settlementDate,
		IdempotencyKey:    idempotencyKey,
		CreatedAt:         now,
		StatusHistory:     statusHistory,
	}

	s.orders = append(s.orders, order)
	if idempotencyKey != "" {
		s.idem[idempotencyKey] = order
	}
	return order, nil
}

// ── Orders ───────────────────────────────────────────────────────────────────--

// Orders returns the order history newest-first, optionally filtered by side.
func (s *Service) Orders(side string) []StockOrder {
	s.mu.Lock()
	defer s.mu.Unlock()
	list := append([]StockOrder(nil), s.orders...)
	sort.SliceStable(list, func(i, j int) bool { return list[i].CreatedAt > list[j].CreatedAt })
	out := make([]StockOrder, 0, len(list))
	for _, o := range list {
		if side != "" && o.Side != side {
			continue
		}
		out = append(out, o)
	}
	return out
}

// Order returns one order by id or reference.
func (s *Service) Order(id string) (StockOrder, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, o := range s.orders {
		if o.ID == id || o.Reference == id {
			return o, true
		}
	}
	return StockOrder{}, false
}

// cancellable reports whether an order is still in a pre-fill/in-flight state.
func cancellable(status string) bool {
	switch status {
	case "Draft", "AwaitingUserConfirmation", "Submitted", "AcceptedByProvider", "PartiallyFilled":
		return true
	default:
		return false
	}
}

// CancelOrder requests + applies a cancellation. Mirrors stocks.api.ts cancelOrder:
// appends CancelRequested + Cancelled and sets the cancellation note. Returns
// (_, false) if the order is missing or no longer cancellable.
func (s *Service) CancelOrder(id string) (StockOrder, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.orders {
		o := &s.orders[i]
		if o.ID != id && o.Reference != id {
			continue
		}
		if !cancellable(o.Status) {
			return *o, false
		}
		now := engine.Now()
		o.StatusHistory = append(o.StatusHistory,
			StatusEvent{Status: "CancelRequested", At: now},
			StatusEvent{Status: "Cancelled", At: now},
		)
		o.Status = "Cancelled"
		o.FailureReason = "You cancelled this order. No funds were debited."
		return *o, true
	}
	return StockOrder{}, false
}

// ── Public offers ────────────────────────────────────────────────────────────--

// PublicOffers returns the open/upcoming IPO + rights offers.
func (s *Service) PublicOffers() []PublicOffer {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]PublicOffer(nil), s.offers...)
}

// PublicOffer resolves an offer by id or symbol.
func (s *Service) PublicOffer(id string) (PublicOffer, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.findOffer(id)
}

func (s *Service) findOffer(key string) (PublicOffer, bool) {
	for _, o := range s.offers {
		if o.ID == key || o.Symbol == key {
			return o, true
		}
	}
	return PublicOffer{}, false
}

// ApplyToOffer applies to an IPO / rights issue, building a Submitted order.
// Mirrors stocks.api.ts applyToOffer: offer must be open, units >= minUnits;
// gross = priceHigh * units, no fees. Idempotency-keyed.
func (s *Service) ApplyToOffer(id string, units int64, idempotencyKey string) (StockOrder, *StockError) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if idempotencyKey != "" {
		if o, ok := s.idem[idempotencyKey]; ok {
			return o, nil
		}
	}

	offer, ok := s.findOffer(id)
	if !ok {
		return StockOrder{}, &StockError{Type: "not_found", Message: "Offer not found"}
	}
	if offer.Status != "open" {
		return StockOrder{}, &StockError{Type: "limit_exceeded", Message: "This offer is not currently open for applications."}
	}
	if units < offer.MinUnits {
		return StockOrder{}, &StockError{Type: "limit_exceeded", Message: "This order is below the minimum application for this offer."}
	}

	unitPrice := offer.PriceHigh.Amount
	gross := round(float64(unitPrice) * float64(units))
	now := engine.Now()
	high := offer.PriceHigh

	order := StockOrder{
		ID:                engine.NewID("so_offer"),
		Reference:         engine.NewRef("PMX-OF"),
		AssetID:           "offer_" + offer.ID,
		Symbol:            offer.Symbol,
		Name:              offer.Name,
		Side:              "buy",
		OrderType:         "limit",
		Status:            "Submitted",
		Quantity:          units,
		FilledQuantity:    0,
		Price:             high,
		LimitPrice:        &high,
		Gross:             Money{Amount: gross, Currency: offer.PriceHigh.Currency},
		Fees:              []Fee{},
		Total:             Money{Amount: gross, Currency: offer.PriceHigh.Currency},
		Provider:          "mock-registrar",
		ProviderReference: engine.NewRef("RG") + "-OF",
		IdempotencyKey:    idempotencyKey,
		CreatedAt:         now,
		StatusHistory: []StatusEvent{
			{Status: "AwaitingUserConfirmation", At: now},
			{Status: "Submitted", At: now},
		},
	}

	s.orders = append(s.orders, order)
	if idempotencyKey != "" {
		s.idem[idempotencyKey] = order
	}
	return order, nil
}
