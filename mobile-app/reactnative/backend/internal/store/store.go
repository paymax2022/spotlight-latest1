// Package store is the in-memory state for the crypto service: assets, holdings,
// transactions, quotes, watchlist, alerts, addresses, a double-entry ledger and
// an idempotency cache. Swap it for Postgres/Redis behind the same methods.
package store

import (
	"math"
	"sort"
	"sync"
	"time"

	"paymax/crypto-backend/internal/domain"
	"paymax/crypto-backend/internal/engine"
)

func ngn(major float64) int64 { return int64(math.Round(major * 100)) }

// posState is the minimal stored holding; the Position DTO is computed on read.
type posState struct {
	AssetID        string
	QtyMinor       int64
	CostBasisMinor int64
}

// Store is the process-wide state guard.
type Store struct {
	mu sync.Mutex

	assets     []domain.Asset
	positions  []posState
	txns       []domain.TxDetail
	watch      map[string]bool
	alerts     []domain.PriceAlert
	addresses  []domain.Address
	ledger     []domain.LedgerEntry
	quotes     map[string]domain.Quote
	swapQuotes map[string]domain.SwapQuote
	idem       map[string]any

	investableMinor int64
}

// New builds a Store seeded with demo data mirroring the mobile mock fixtures.
func New() *Store {
	s := &Store{
		watch:           map[string]bool{"ast_btc": true, "ast_sol": true},
		quotes:          map[string]domain.Quote{},
		swapQuotes:      map[string]domain.SwapQuote{},
		idem:            map[string]any{},
		investableMinor: ngn(842_500),
	}
	s.seedAssets()
	s.seedPositions()
	s.seedTxns()
	s.seedAlerts()
	s.seedAddresses()
	return s
}

// ── Seed ──────────────────────────────────────────────────────────────────────

func (s *Store) seedAssets() {
	s.assets = []domain.Asset{
		{
			ID: "ast_btc", Type: "crypto", Symbol: "BTC", Name: "Bitcoin", Decimals: 8,
			IconColor: "#F7931A", RiskRating: "medium", Status: "active",
			BuyEnabled: true, SellEnabled: true, DepositEnabled: true, WithdrawalEnabled: true,
			MinOrderAmount: ngn(1_000), MaxOrderAmount: ngn(50_000_000),
			Price: domain.Money{Amount: ngn(98_420_000), Currency: "NGN"}, Change24hPct: 2.41,
			MarketCap: domain.Money{Amount: ngn(1_940_000_000_000_000), Currency: "NGN"},
			Volume24h: domain.Money{Amount: ngn(48_200_000_000_000), Currency: "NGN"},
			SupportedNetworks: []domain.Network{{ID: "bitcoin", Name: "Bitcoin", Confirmations: 2}},
			Description:       "Bitcoin is the first and largest cryptocurrency by market value. It runs on a decentralised network and is often used as a long-term store of value.",
			RiskDisclosure:    "Bitcoin is volatile and its price can move sharply in either direction within a single day.",
			KycTierRequired:   2,
		},
		{
			ID: "ast_eth", Type: "crypto", Symbol: "ETH", Name: "Ethereum", Decimals: 8,
			IconColor: "#627EEA", RiskRating: "medium", Status: "active",
			BuyEnabled: true, SellEnabled: true, DepositEnabled: true, WithdrawalEnabled: true,
			MinOrderAmount: ngn(1_000), MaxOrderAmount: ngn(30_000_000),
			Price: domain.Money{Amount: ngn(5_280_000), Currency: "NGN"}, Change24hPct: -1.18,
			MarketCap: domain.Money{Amount: ngn(640_000_000_000_000), Currency: "NGN"},
			Volume24h: domain.Money{Amount: ngn(22_400_000_000_000), Currency: "NGN"},
			SupportedNetworks: []domain.Network{
				{ID: "ethereum", Name: "Ethereum (ERC-20)", Confirmations: 12},
				{ID: "base", Name: "Base", Confirmations: 30},
			},
			Description:     "Ethereum is a programmable blockchain that powers smart contracts and most of the decentralised-app ecosystem.",
			RiskDisclosure:  "Ethereum is volatile. Network upgrades and demand shifts can cause sharp price swings.",
			KycTierRequired: 2,
		},
		{
			ID: "ast_usdt", Type: "crypto", Symbol: "USDT", Name: "Tether USD", Decimals: 6,
			IconColor: "#26A17B", RiskRating: "low", Status: "active",
			BuyEnabled: true, SellEnabled: true, DepositEnabled: true, WithdrawalEnabled: true,
			MinOrderAmount: ngn(1_000), MaxOrderAmount: ngn(20_000_000),
			Price: domain.Money{Amount: ngn(1_605), Currency: "NGN"}, Change24hPct: 0.05,
			MarketCap: domain.Money{Amount: ngn(180_000_000_000_000), Currency: "NGN"},
			Volume24h: domain.Money{Amount: ngn(70_000_000_000_000), Currency: "NGN"},
			SupportedNetworks: []domain.Network{
				{ID: "tron", Name: "Tron (TRC-20)", Confirmations: 20},
				{ID: "ethereum", Name: "Ethereum (ERC-20)", Confirmations: 12},
			},
			Description:     "Tether (USDT) is a stablecoin designed to track the US dollar 1:1. It is widely used to hold value in dollars and to move between assets.",
			RiskDisclosure:  "Stablecoins aim to hold a fixed value but can de-peg. They are not the same as a bank deposit and are not guaranteed.",
			KycTierRequired: 1,
		},
		{
			ID: "ast_usdc", Type: "crypto", Symbol: "USDC", Name: "USD Coin", Decimals: 6,
			IconColor: "#2775CA", RiskRating: "low", Status: "active",
			BuyEnabled: true, SellEnabled: true, DepositEnabled: true, WithdrawalEnabled: true,
			MinOrderAmount: ngn(1_000), MaxOrderAmount: ngn(20_000_000),
			Price: domain.Money{Amount: ngn(1_604), Currency: "NGN"}, Change24hPct: 0.02,
			MarketCap: domain.Money{Amount: ngn(56_000_000_000_000), Currency: "NGN"},
			Volume24h: domain.Money{Amount: ngn(12_000_000_000_000), Currency: "NGN"},
			SupportedNetworks: []domain.Network{
				{ID: "ethereum", Name: "Ethereum (ERC-20)", Confirmations: 12},
				{ID: "base", Name: "Base", Confirmations: 30},
			},
			Description:     "USD Coin (USDC) is a fully-reserved stablecoin pegged to the US dollar, issued by regulated financial institutions.",
			RiskDisclosure:  "Stablecoins aim to hold a fixed value but can de-peg. They are not a bank deposit and are not guaranteed.",
			KycTierRequired: 1,
		},
		{
			ID: "ast_sol", Type: "crypto", Symbol: "SOL", Name: "Solana", Decimals: 8,
			IconColor: "#9945FF", RiskRating: "high", Status: "active",
			BuyEnabled: true, SellEnabled: true, DepositEnabled: true, WithdrawalEnabled: true,
			MinOrderAmount: ngn(1_000), MaxOrderAmount: ngn(10_000_000),
			Price: domain.Money{Amount: ngn(238_500), Currency: "NGN"}, Change24hPct: 5.83,
			MarketCap: domain.Money{Amount: ngn(112_000_000_000_000), Currency: "NGN"},
			Volume24h: domain.Money{Amount: ngn(9_400_000_000_000), Currency: "NGN"},
			SupportedNetworks: []domain.Network{{ID: "solana", Name: "Solana", Confirmations: 32}},
			Description:       "Solana is a high-throughput blockchain known for fast, low-cost transactions and a growing app ecosystem.",
			RiskDisclosure:    "Solana is a higher-risk asset with large price swings and periods of network congestion.",
			KycTierRequired:   2,
		},
		{
			ID: "ast_xrp", Type: "crypto", Symbol: "XRP", Name: "XRP", Decimals: 6,
			IconColor: "#23292F", RiskRating: "high", Status: "paused",
			BuyEnabled: false, SellEnabled: false, DepositEnabled: false, WithdrawalEnabled: false,
			MinOrderAmount: ngn(1_000), MaxOrderAmount: ngn(10_000_000),
			Price: domain.Money{Amount: ngn(3_640), Currency: "NGN"}, Change24hPct: -0.74,
			MarketCap: domain.Money{Amount: ngn(205_000_000_000_000), Currency: "NGN"},
			Volume24h: domain.Money{Amount: ngn(6_200_000_000_000), Currency: "NGN"},
			SupportedNetworks: []domain.Network{{ID: "xrpl", Name: "XRP Ledger", Confirmations: 1}},
			Description:       "XRP is the native asset of the XRP Ledger, designed for fast, low-cost cross-border value transfer.",
			RiskDisclosure:    "XRP is a higher-risk asset and is temporarily paused for trading on Paymax.",
			KycTierRequired:   2,
		},
	}
}

func (s *Store) seedPositions() {
	s.positions = []posState{
		{AssetID: "ast_btc", QtyMinor: 1_820_000, CostBasisMinor: ngn(1_676_220)},
		{AssetID: "ast_eth", QtyMinor: 94_000_000, CostBasisMinor: ngn(5_132_400)},
		{AssetID: "ast_usdt", QtyMinor: 1_250_000_000, CostBasisMinor: ngn(1_997_500)},
	}
}

func hoursAgo(h int) string {
	return time.Now().Add(-time.Duration(h) * time.Hour).UTC().Format(time.RFC3339)
}

func (s *Store) seedTxns() {
	s.txns = []domain.TxDetail{
		{
			TxSummary: domain.TxSummary{
				ID: "cx_1", Reference: "PMX-CR-840192", Side: "buy", Symbol: "BTC",
				AssetName: "Bitcoin", IconColor: "#F7931A", Status: "Filled",
				Fiat: domain.Money{Amount: ngn(500_000), Currency: "NGN"},
				Crypto: domain.CryptoAmount{Amount: int64(math.Round(0.00508 * 1e8)), Symbol: "BTC"},
				CreatedAt: hoursAgo(5),
			},
			AllInRate: domain.Money{Amount: ngn(98_900_000), Currency: "NGN"},
			Fees: []domain.Fee{
				{Type: "spread", Amount: domain.Money{Amount: ngn(2_450), Currency: "NGN"}},
				{Type: "paymax_fee", Amount: domain.Money{Amount: ngn(4_500), Currency: "NGN"}},
				{Type: "provider_fee", Amount: domain.Money{Amount: ngn(1_000), Currency: "NGN"}},
			},
			TotalFiat: domain.Money{Amount: ngn(505_500), Currency: "NGN"},
			Provider:  "mock-liquidity", ProviderReference: "LP-77120-AB",
			LiquidityProvider: "mock-liquidity", CustodyProvider: "mock-custody",
			StatusHistory: []domain.StatusEvent{
				{Status: "QuoteAccepted", At: hoursAgo(5)},
				{Status: "Processing", At: hoursAgo(5)},
				{Status: "Filled", At: hoursAgo(5)},
			},
		},
		{
			TxSummary: domain.TxSummary{
				ID: "cx_2", Reference: "PMX-CR-839004", Side: "buy", Symbol: "USDT",
				AssetName: "Tether USD", IconColor: "#26A17B", Status: "Filled",
				Fiat: domain.Money{Amount: ngn(200_000), Currency: "NGN"},
				Crypto: domain.CryptoAmount{Amount: int64(math.Round(124.6 * 1e6)), Symbol: "USDT"},
				CreatedAt: hoursAgo(28),
			},
			AllInRate: domain.Money{Amount: ngn(1_605), Currency: "NGN"},
			Fees: []domain.Fee{
				{Type: "paymax_fee", Amount: domain.Money{Amount: ngn(1_800), Currency: "NGN"}},
				{Type: "provider_fee", Amount: domain.Money{Amount: ngn(400), Currency: "NGN"}},
			},
			TotalFiat: domain.Money{Amount: ngn(202_200), Currency: "NGN"},
			Provider:  "mock-liquidity", ProviderReference: "LP-76551-CD",
			LiquidityProvider: "mock-liquidity", CustodyProvider: "mock-custody",
			StatusHistory: []domain.StatusEvent{
				{Status: "QuoteAccepted", At: hoursAgo(28)},
				{Status: "Filled", At: hoursAgo(28)},
			},
		},
		{
			TxSummary: domain.TxSummary{
				ID: "cx_3", Reference: "PMX-CR-835517", Side: "sell", Symbol: "ETH",
				AssetName: "Ethereum", IconColor: "#627EEA", Status: "Processing",
				Fiat: domain.Money{Amount: ngn(310_000), Currency: "NGN"},
				Crypto: domain.CryptoAmount{Amount: int64(math.Round(0.0588 * 1e8)), Symbol: "ETH"},
				CreatedAt: hoursAgo(1),
			},
			AllInRate: domain.Money{Amount: ngn(5_270_000), Currency: "NGN"},
			Fees: []domain.Fee{
				{Type: "paymax_fee", Amount: domain.Money{Amount: ngn(2_790), Currency: "NGN"}},
				{Type: "provider_fee", Amount: domain.Money{Amount: ngn(620), Currency: "NGN"}},
			},
			TotalFiat: domain.Money{Amount: ngn(303_790), Currency: "NGN"},
			Provider:  "mock-liquidity", ProviderReference: "LP-78003-EF",
			LiquidityProvider: "mock-liquidity", CustodyProvider: "mock-custody",
			StatusHistory: []domain.StatusEvent{
				{Status: "QuoteAccepted", At: hoursAgo(1)},
				{Status: "Processing", At: hoursAgo(1)},
			},
		},
	}
}

func (s *Store) seedAlerts() {
	s.alerts = []domain.PriceAlert{
		{
			ID: "al_1", AssetID: "ast_btc", Symbol: "BTC", IconColor: "#F7931A",
			Condition: "above", TargetPrice: domain.Money{Amount: ngn(100_000_000), Currency: "NGN"},
			Status: "active", TriggeredAt: nil, CreatedAt: hoursAgo(36),
		},
		{
			ID: "al_2", AssetID: "ast_eth", Symbol: "ETH", IconColor: "#627EEA",
			Condition: "below", TargetPrice: domain.Money{Amount: ngn(5_000_000), Currency: "NGN"},
			Status: "active", TriggeredAt: nil, CreatedAt: hoursAgo(8),
		},
	}
}

func (s *Store) seedAddresses() {
	s.addresses = []domain.Address{
		{
			ID: "addr_1", Label: "My Ledger", Symbol: "BTC",
			NetworkID: "bitcoin", NetworkName: "Bitcoin",
			Address: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
			Whitelisted: true, Screened: true, AddedAt: hoursAgo(216),
		},
		{
			ID: "addr_2", Label: "Binance USDT", Symbol: "USDT",
			NetworkID: "tron", NetworkName: "Tron (TRC-20)",
			Address: "TJ8s3sB1kY7Yb9aQ2cZx4pN6mWvL1rGq5d",
			Whitelisted: true, Screened: true, AddedAt: hoursAgo(72),
		},
	}
}

// ── Assets ────────────────────────────────────────────────────────────────────

// Assets returns a copy of the whitelisted assets.
func (s *Store) Assets() []domain.Asset {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]domain.Asset(nil), s.assets...)
}

// Asset resolves an asset by id or symbol.
func (s *Store) Asset(key string) (domain.Asset, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.findAsset(key)
}

func (s *Store) findAsset(key string) (domain.Asset, bool) {
	for _, a := range s.assets {
		if a.ID == key || a.Symbol == key {
			return a, true
		}
	}
	return domain.Asset{}, false
}

// ── Quotes ────────────────────────────────────────────────────────────────────

func (s *Store) PutQuote(q domain.Quote) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.quotes[q.ID] = q
}

func (s *Store) GetQuote(id string) (domain.Quote, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	q, ok := s.quotes[id]
	return q, ok
}

func (s *Store) PutSwapQuote(q domain.SwapQuote) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.swapQuotes[q.ID] = q
}

func (s *Store) GetSwapQuote(id string) (domain.SwapQuote, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	q, ok := s.swapQuotes[id]
	return q, ok
}

// ── Idempotency ───────────────────────────────────────────────────────────────

func (s *Store) Idempotent(key string) (any, bool) {
	if key == "" {
		return nil, false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	v, ok := s.idem[key]
	return v, ok
}

func (s *Store) SaveIdempotent(key string, v any) {
	if key == "" {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.idem[key] = v
}

// ── Positions / portfolio ─────────────────────────────────────────────────────

func (s *Store) position(assetID string) (*posState, int) {
	for i := range s.positions {
		if s.positions[i].AssetID == assetID {
			return &s.positions[i], i
		}
	}
	return nil, -1
}

func (s *Store) buildPosition(p posState) domain.Position {
	a, _ := s.findAsset(p.AssetID)
	unit := math.Pow(10, float64(a.Decimals))
	coins := float64(p.QtyMinor) / unit
	marketValue := int64(math.Round(coins * float64(a.Price.Amount)))
	avg := int64(0)
	if coins > 0 {
		avg = int64(math.Round(float64(p.CostBasisMinor) / coins))
	}
	unrl := marketValue - p.CostBasisMinor
	pct := 0.0
	if p.CostBasisMinor > 0 {
		pct = math.Round((float64(unrl)/float64(p.CostBasisMinor)*100)*100) / 100
	}
	return domain.Position{
		AssetID: a.ID, Symbol: a.Symbol, Name: a.Name, IconColor: a.IconColor, RiskRating: a.RiskRating,
		Quantity:           domain.CryptoAmount{Amount: p.QtyMinor, Symbol: a.Symbol},
		AverageCost:        domain.Money{Amount: avg, Currency: "NGN"},
		MarketValue:        domain.Money{Amount: marketValue, Currency: "NGN"},
		CostBasis:          domain.Money{Amount: p.CostBasisMinor, Currency: "NGN"},
		UnrealizedGainLoss: domain.Money{Amount: unrl, Currency: "NGN"},
		UnrealizedPct:      pct,
		Price:              a.Price,
		Change24hPct:       a.Change24hPct,
	}
}

// Positions returns the computed crypto holdings.
func (s *Store) Positions() []domain.Position {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]domain.Position, 0, len(s.positions))
	for _, p := range s.positions {
		if p.QtyMinor > 0 {
			out = append(out, s.buildPosition(p))
		}
	}
	return out
}

// Portfolio returns the aggregate crypto portfolio.
func (s *Store) Portfolio() domain.Portfolio {
	s.mu.Lock()
	defer s.mu.Unlock()
	positions := make([]domain.Position, 0, len(s.positions))
	var totalValue, totalCost, day int64
	for _, p := range s.positions {
		if p.QtyMinor <= 0 {
			continue
		}
		dto := s.buildPosition(p)
		positions = append(positions, dto)
		totalValue += dto.MarketValue.Amount
		totalCost += dto.CostBasis.Amount
		day += int64(math.Round(float64(dto.MarketValue.Amount) * dto.Change24hPct / 100))
	}
	gain := totalValue - totalCost
	gainPct := 0.0
	if totalCost > 0 {
		gainPct = math.Round((float64(gain)/float64(totalCost)*100)*100) / 100
	}
	prev := totalValue - day
	dayPct := 0.0
	if prev > 0 {
		dayPct = math.Round((float64(day)/float64(prev)*100)*100) / 100
	}
	return domain.Portfolio{
		BaseCurrency:      "NGN",
		TotalValue:        domain.Money{Amount: totalValue, Currency: "NGN"},
		TotalCostBasis:    domain.Money{Amount: totalCost, Currency: "NGN"},
		TotalGainLoss:     domain.Money{Amount: gain, Currency: "NGN"},
		TotalGainLossPct:  gainPct,
		DayChange:         domain.Money{Amount: day, Currency: "NGN"},
		DayChangePct:      dayPct,
		InvestableBalance: domain.Money{Amount: s.investableMinor, Currency: "NGN"},
		Positions:         positions,
	}
}

// ── Transactions ──────────────────────────────────────────────────────────────

// Transactions returns history summaries, newest first, optionally by side.
func (s *Store) Transactions(side string) []domain.TxSummary {
	s.mu.Lock()
	defer s.mu.Unlock()
	list := append([]domain.TxDetail(nil), s.txns...)
	sort.Slice(list, func(i, j int) bool { return list[i].CreatedAt > list[j].CreatedAt })
	out := make([]domain.TxSummary, 0, len(list))
	for _, t := range list {
		if side != "" && t.Side != side {
			continue
		}
		out = append(out, t.TxSummary)
	}
	return out
}

// Transaction returns one full receipt by id or reference.
func (s *Store) Transaction(id string) (domain.TxDetail, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, t := range s.txns {
		if t.ID == id || t.Reference == id {
			return t, true
		}
	}
	return domain.TxDetail{}, false
}

// ── Watchlist ─────────────────────────────────────────────────────────────────

func (s *Store) Watchlist() []domain.Asset {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := []domain.Asset{}
	for _, a := range s.assets {
		if s.watch[a.ID] {
			out = append(out, a)
		}
	}
	return out
}

func (s *Store) AddWatch(assetID string)    { s.mu.Lock(); s.watch[assetID] = true; s.mu.Unlock() }
func (s *Store) RemoveWatch(assetID string) { s.mu.Lock(); delete(s.watch, assetID); s.mu.Unlock() }

// ── Alerts ────────────────────────────────────────────────────────────────────

func (s *Store) Alerts() []domain.PriceAlert {
	s.mu.Lock()
	defer s.mu.Unlock()
	list := append([]domain.PriceAlert(nil), s.alerts...)
	sort.Slice(list, func(i, j int) bool { return list[i].CreatedAt > list[j].CreatedAt })
	return list
}

func (s *Store) CreateAlert(assetID, condition string, target int64, currency string) (domain.PriceAlert, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	a, ok := s.findAsset(assetID)
	if !ok {
		return domain.PriceAlert{}, false
	}
	al := domain.PriceAlert{
		ID: engine.NewID("al"), AssetID: a.ID, Symbol: a.Symbol, IconColor: a.IconColor,
		Condition: condition, TargetPrice: domain.Money{Amount: target, Currency: currency},
		Status: "active", TriggeredAt: nil, CreatedAt: engine.Now(),
	}
	s.alerts = append([]domain.PriceAlert{al}, s.alerts...)
	return al, true
}

func (s *Store) DeleteAlert(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := s.alerts[:0]
	for _, a := range s.alerts {
		if a.ID != id {
			out = append(out, a)
		}
	}
	s.alerts = out
}

// ── Addresses ─────────────────────────────────────────────────────────────────

func (s *Store) Addresses(symbol string) []domain.Address {
	s.mu.Lock()
	defer s.mu.Unlock()
	list := []domain.Address{}
	for _, a := range s.addresses {
		if symbol == "" || a.Symbol == symbol {
			list = append(list, a)
		}
	}
	sort.Slice(list, func(i, j int) bool { return list[i].AddedAt > list[j].AddedAt })
	return list
}

func (s *Store) AddAddress(label, symbol, networkID, address string) (domain.Address, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	a, ok := s.findAsset(symbol)
	if !ok {
		return domain.Address{}, false
	}
	net := a.SupportedNetworks[0]
	for _, n := range a.SupportedNetworks {
		if n.ID == networkID {
			net = n
		}
	}
	if label == "" {
		label = "Saved address"
	}
	addr := domain.Address{
		ID: engine.NewID("addr"), Label: label, Symbol: symbol,
		NetworkID: net.ID, NetworkName: net.Name, Address: address,
		Whitelisted: true, Screened: true, AddedAt: engine.Now(),
	}
	s.addresses = append([]domain.Address{addr}, s.addresses...)
	return addr, true
}

func (s *Store) DeleteAddress(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := s.addresses[:0]
	for _, a := range s.addresses {
		if a.ID != id {
			out = append(out, a)
		}
	}
	s.addresses = out
}

func (s *Store) AddressByID(id string) (domain.Address, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, a := range s.addresses {
		if a.ID == id {
			return a, true
		}
	}
	return domain.Address{}, false
}

// ── Ledger ────────────────────────────────────────────────────────────────────

func (s *Store) appendLedger(txID, debit, credit string, amount int64, currency, typ, ref, provRef string) {
	s.ledger = append(s.ledger, domain.LedgerEntry{
		ID: engine.NewID("le"), TransactionID: txID, DebitAccount: debit, CreditAccount: credit,
		Amount: amount, Currency: currency, Type: typ, Reference: ref, ProviderReference: provRef,
		CreatedAt: engine.Now(),
	})
}

// ── Execution (buy / sell / swap) — updates positions + ledger + history ──────

// ExecuteBuy fills a buy: debit cash, credit crypto, post the ledger + history.
func (s *Store) ExecuteBuy(q domain.Quote) (domain.Order, *ExecError) {
	s.mu.Lock()
	defer s.mu.Unlock()
	a, ok := s.findAsset(q.AssetID)
	if !ok {
		return domain.Order{}, &ExecError{Type: "asset_unavailable", Message: "Asset not found."}
	}
	if a.Status != "active" || !a.BuyEnabled {
		return domain.Order{}, &ExecError{Type: "asset_unavailable", Message: "This asset is not available to buy."}
	}
	if q.TotalFiat.Amount < a.MinOrderAmount || q.TotalFiat.Amount > a.MaxOrderAmount {
		return domain.Order{}, &ExecError{Type: "limit_exceeded", Message: "Order is outside the allowed limits."}
	}
	if q.TotalFiat.Amount > s.investableMinor {
		return domain.Order{}, &ExecError{Type: "insufficient_balance", Message: "Not enough investable cash."}
	}

	// Ledger lock + move (double entry), then position update.
	txID := engine.NewID("cx")
	ref := engine.NewRef("PMX-CR")
	provRef := engine.NewRef("LP") + "-XY"

	s.investableMinor -= q.TotalFiat.Amount
	if p, _ := s.position(a.ID); p != nil {
		p.QtyMinor += q.Crypto.Amount
		p.CostBasisMinor += q.Fiat.Amount
	} else {
		s.positions = append(s.positions, posState{AssetID: a.ID, QtyMinor: q.Crypto.Amount, CostBasisMinor: q.Fiat.Amount})
	}
	s.appendLedger(txID, "user_cash", "user_crypto:"+a.Symbol, q.TotalFiat.Amount, "NGN", "buy", ref, provRef)

	order := domain.Order{
		ID: engine.NewID("co"), Reference: ref, AssetID: a.ID, Symbol: a.Symbol, Side: "buy",
		Status: "Filled", Fiat: q.Fiat, Crypto: q.Crypto, AllInRate: q.AllInRate, Fees: q.Fees,
		TotalFiat: q.TotalFiat, Provider: q.LiquidityProvider, ProviderReference: provRef,
		TransactionID: txID, CreatedAt: engine.Now(),
	}
	s.recordTx(order, a.Name)
	return order, nil
}

// ExecuteSell fills a sell: credit cash, debit crypto, post the ledger + history.
func (s *Store) ExecuteSell(q domain.Quote) (domain.Order, *ExecError) {
	s.mu.Lock()
	defer s.mu.Unlock()
	a, ok := s.findAsset(q.AssetID)
	if !ok {
		return domain.Order{}, &ExecError{Type: "asset_unavailable", Message: "Asset not found."}
	}
	if a.Status != "active" || !a.SellEnabled {
		return domain.Order{}, &ExecError{Type: "asset_unavailable", Message: "This asset is not available to sell."}
	}
	p, _ := s.position(a.ID)
	if p == nil || p.QtyMinor < q.Crypto.Amount {
		return domain.Order{}, &ExecError{Type: "insufficient_balance", Message: "You don't hold enough of this asset."}
	}

	txID := engine.NewID("cx")
	ref := engine.NewRef("PMX-CR")
	provRef := engine.NewRef("LP") + "-XY"

	// Reduce holding + cost basis proportionally; credit cash.
	frac := float64(q.Crypto.Amount) / float64(p.QtyMinor)
	p.CostBasisMinor -= int64(math.Round(float64(p.CostBasisMinor) * frac))
	p.QtyMinor -= q.Crypto.Amount
	s.investableMinor += q.TotalFiat.Amount
	s.appendLedger(txID, "user_crypto:"+a.Symbol, "user_cash", q.TotalFiat.Amount, "NGN", "sell", ref, provRef)

	order := domain.Order{
		ID: engine.NewID("co"), Reference: ref, AssetID: a.ID, Symbol: a.Symbol, Side: "sell",
		Status: "Filled", Fiat: q.Fiat, Crypto: q.Crypto, AllInRate: q.AllInRate, Fees: q.Fees,
		TotalFiat: q.TotalFiat, Provider: q.LiquidityProvider, ProviderReference: provRef,
		TransactionID: txID, CreatedAt: engine.Now(),
	}
	s.recordTx(order, a.Name)
	return order, nil
}

// ExecuteSwap fills a crypto-to-crypto swap (sell-leg + buy-leg + ledger).
func (s *Store) ExecuteSwap(q domain.SwapQuote) (domain.SwapResult, *ExecError) {
	s.mu.Lock()
	defer s.mu.Unlock()
	from, ok1 := s.findAsset(q.FromAssetID)
	to, ok2 := s.findAsset(q.ToAssetID)
	if !ok1 || !ok2 {
		return domain.SwapResult{}, &ExecError{Type: "asset_unavailable", Message: "Asset not found."}
	}
	p, _ := s.position(from.ID)
	if p == nil || p.QtyMinor < q.From.Amount {
		return domain.SwapResult{}, &ExecError{Type: "insufficient_balance", Message: "You don't hold enough to swap."}
	}

	txID := engine.NewID("cx")
	ref := engine.NewRef("PMX-SW")
	provRef := engine.NewRef("LP") + "-SW"

	frac := float64(q.From.Amount) / float64(p.QtyMinor)
	movedCost := int64(math.Round(float64(p.CostBasisMinor) * frac))
	p.CostBasisMinor -= movedCost
	p.QtyMinor -= q.From.Amount

	if tp, _ := s.position(to.ID); tp != nil {
		tp.QtyMinor += q.To.Amount
		tp.CostBasisMinor += q.FiatValue.Amount
	} else {
		s.positions = append(s.positions, posState{AssetID: to.ID, QtyMinor: q.To.Amount, CostBasisMinor: q.FiatValue.Amount})
	}
	s.appendLedger(txID, "user_crypto:"+from.Symbol, "user_crypto:"+to.Symbol, q.FiatValue.Amount, "NGN", "swap", ref, provRef)

	res := domain.SwapResult{
		ID: engine.NewID("so"), Reference: ref, FromSymbol: from.Symbol, ToSymbol: to.Symbol,
		Status: "Filled", From: q.From, To: q.To, Fee: q.Fee, Provider: q.LiquidityProvider,
		ProviderReference: provRef, TransactionID: txID, CreatedAt: engine.Now(),
	}
	// History row for the swap (recorded against the `to` asset for display).
	s.txns = append(s.txns, domain.TxDetail{
		TxSummary: domain.TxSummary{
			ID: txID, Reference: ref, Side: "buy", Symbol: to.Symbol, AssetName: to.Name,
			IconColor: to.IconColor, Status: "Filled", Fiat: q.FiatValue, Crypto: q.To, CreatedAt: res.CreatedAt,
		},
		AllInRate: to.Price, Fees: []domain.Fee{{Type: "spread", Amount: q.Fee}}, TotalFiat: q.FiatValue,
		Provider: q.LiquidityProvider, ProviderReference: provRef,
		LiquidityProvider: q.LiquidityProvider, CustodyProvider: "mock-custody",
		StatusHistory: []domain.StatusEvent{{Status: "QuoteAccepted", At: res.CreatedAt}, {Status: "Filled", At: res.CreatedAt}},
	})
	return res, nil
}

// recordTx appends an order to the unified history (caller holds the lock).
func (s *Store) recordTx(o domain.Order, assetName string) {
	a, _ := s.findAsset(o.AssetID)
	s.txns = append(s.txns, domain.TxDetail{
		TxSummary: domain.TxSummary{
			ID: o.TransactionID, Reference: o.Reference, Side: o.Side, Symbol: o.Symbol,
			AssetName: assetName, IconColor: a.IconColor, Status: o.Status,
			Fiat: o.Fiat, Crypto: o.Crypto, CreatedAt: o.CreatedAt,
		},
		AllInRate: o.AllInRate, Fees: o.Fees, TotalFiat: o.TotalFiat,
		Provider: o.Provider, ProviderReference: o.ProviderReference,
		LiquidityProvider: "mock-liquidity", CustodyProvider: "mock-custody",
		StatusHistory: []domain.StatusEvent{
			{Status: "QuoteAccepted", At: o.CreatedAt},
			{Status: "Processing", At: o.CreatedAt},
			{Status: "Filled", At: o.CreatedAt},
		},
	})
}

// ExecError is a typed execution failure (maps to the client error envelope).
type ExecError struct {
	Type    string
	Message string
}

func (e *ExecError) Error() string { return e.Message }
