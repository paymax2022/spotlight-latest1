package stocks

import (
	"math"
	"time"
)

// ── Money helpers ────────────────────────────────────────────────────────────--
// Both NGN (kobo) and USD (cents) are 2-decimal minor units, mirroring the
// mobile mock's ngn()/usd() — Math.round(major * 100).

func minor(major float64) int64 { return int64(math.Round(major * 100)) }

func hoursAgo(h int) string {
	return time.Now().Add(-time.Duration(h) * time.Hour).UTC().Format(time.RFC3339)
}

func daysFromNow(d int) string {
	return time.Now().Add(time.Duration(d) * 24 * time.Hour).UTC().Format(time.RFC3339)
}

// ── Whitelisted assets (admin-controlled in production) ──────────────────────────
// Mirrors MOCK_STOCKS so live mode looks identical to mock mode.

func seedStocks() []Stock {
	ngn := func(a float64) Money { return Money{Amount: minor(a), Currency: "NGN"} }
	usd := func(a float64) Money { return Money{Amount: minor(a), Currency: "USD"} }
	return []Stock{
		{
			ID: "stk_dangcem", Type: "stock", Symbol: "DANGCEM", Name: "Dangote Cement Plc",
			Exchange: "NGX", Sector: "Industrial Goods", Currency: "NGN",
			IconColor: "#0051D5", RiskRating: "low", Status: "active",
			BuyEnabled: true, SellEnabled: true, MarketStatus: "open",
			Price: ngn(485.50), Change24hPct: 1.36, DayChange: ngn(6.50),
			Week52High: ngn(620.00), Week52Low: ngn(298.00),
			MarketCap: ngn(8_270_000_000_000), Volume: 1_240_500,
			Bid: ngn(485.00), Ask: ngn(486.00),
			Summary:        "Dangote Cement is the largest cement producer in sub-Saharan Africa, with operations across ten African countries.",
			RiskDisclosure: "Share prices can fall as well as rise. Past performance is not a guide to future returns.",
			FeeBps: 25, SettlementCycle: "T+3",
			MinOrderAmount: minor(1_000), MaxOrderAmount: minor(50_000_000), KycTierRequired: 2,
		},
		{
			ID: "stk_mtnn", Type: "stock", Symbol: "MTNN", Name: "MTN Nigeria Communications Plc",
			Exchange: "NGX", Sector: "Telecoms", Currency: "NGN",
			IconColor: "#EAB308", RiskRating: "medium", Status: "active",
			BuyEnabled: true, SellEnabled: true, MarketStatus: "open",
			Price: ngn(232.80), Change24hPct: -0.94, DayChange: ngn(-2.20),
			Week52High: ngn(280.00), Week52Low: ngn(168.00),
			MarketCap: ngn(4_870_000_000_000), Volume: 3_410_200,
			Bid: ngn(232.50), Ask: ngn(233.10),
			Summary:        "MTN Nigeria is the largest mobile network operator in Nigeria by subscribers, offering voice, data and fintech services.",
			RiskDisclosure: "Telecoms shares can be sensitive to regulation and currency moves, which can affect the price.",
			FeeBps: 25, SettlementCycle: "T+3",
			MinOrderAmount: minor(1_000), MaxOrderAmount: minor(40_000_000), KycTierRequired: 2,
		},
		{
			ID: "stk_gtco", Type: "stock", Symbol: "GTCO", Name: "Guaranty Trust Holding Co Plc",
			Exchange: "NGX", Sector: "Banking", Currency: "NGN",
			IconColor: "#EA7F00", RiskRating: "medium", Status: "active",
			BuyEnabled: true, SellEnabled: true, MarketStatus: "open",
			Price: ngn(58.95), Change24hPct: 2.17, DayChange: ngn(1.25),
			Week52High: ngn(72.00), Week52Low: ngn(38.10),
			MarketCap: ngn(1_730_000_000_000), Volume: 8_902_400,
			Bid: ngn(58.80), Ask: ngn(59.05),
			Summary:        "GTCO is the holding company for Guaranty Trust Bank, one of Nigeria's most profitable and well-capitalised banks.",
			RiskDisclosure: "Bank shares are exposed to interest-rate and credit cycles, which can move the price sharply.",
			FeeBps: 25, SettlementCycle: "T+3",
			MinOrderAmount: minor(1_000), MaxOrderAmount: minor(40_000_000), KycTierRequired: 2,
		},
		{
			ID: "stk_zenithbank", Type: "stock", Symbol: "ZENITHBANK", Name: "Zenith Bank Plc",
			Exchange: "NGX", Sector: "Banking", Currency: "NGN",
			IconColor: "#BA1A1A", RiskRating: "medium", Status: "active",
			BuyEnabled: true, SellEnabled: true, MarketStatus: "open",
			Price: ngn(41.20), Change24hPct: 0.49, DayChange: ngn(0.20),
			Week52High: ngn(49.50), Week52Low: ngn(28.00),
			MarketCap: ngn(1_290_000_000_000), Volume: 6_120_800,
			Bid: ngn(41.10), Ask: ngn(41.30),
			Summary:        "Zenith Bank is a tier-1 Nigerian commercial bank with a strong corporate and retail banking franchise.",
			RiskDisclosure: "Bank shares are exposed to interest-rate and credit cycles, which can move the price sharply.",
			FeeBps: 25, SettlementCycle: "T+3",
			MinOrderAmount: minor(1_000), MaxOrderAmount: minor(40_000_000), KycTierRequired: 2,
		},
		{
			ID: "stk_aradel", Type: "stock", Symbol: "ARADEL", Name: "Aradel Holdings Plc",
			Exchange: "NGX", Sector: "Oil & Gas", Currency: "NGN",
			IconColor: "#16A34A", RiskRating: "high", Status: "active",
			BuyEnabled: true, SellEnabled: true, MarketStatus: "open",
			Price: ngn(584.00), Change24hPct: 4.28, DayChange: ngn(24.00),
			Week52High: ngn(720.00), Week52Low: ngn(320.00),
			MarketCap: ngn(2_540_000_000_000), Volume: 412_900,
			Bid: ngn(583.00), Ask: ngn(585.50),
			Summary:        "Aradel Holdings is an integrated Nigerian energy company with upstream, refining and gas operations.",
			RiskDisclosure: "Energy shares are highly sensitive to oil prices and can be very volatile.",
			FeeBps: 30, SettlementCycle: "T+3",
			MinOrderAmount: minor(1_000), MaxOrderAmount: minor(20_000_000), KycTierRequired: 2,
		},
		{
			ID: "stk_nestle", Type: "stock", Symbol: "NESTLE", Name: "Nestlé Nigeria Plc",
			Exchange: "NGX", Sector: "Consumer Goods", Currency: "NGN",
			IconColor: "#340075", RiskRating: "low", Status: "paused",
			BuyEnabled: false, SellEnabled: false, MarketStatus: "closed",
			Price: ngn(935.00), Change24hPct: -0.32, DayChange: ngn(-3.00),
			Week52High: ngn(1_120.00), Week52Low: ngn(810.00),
			MarketCap: ngn(741_000_000_000), Volume: 86_300,
			Bid: ngn(934.00), Ask: ngn(936.00),
			Summary:        "Nestlé Nigeria manufactures food and beverage products including Maggi, Milo and Golden Morn.",
			RiskDisclosure: "Consumer-goods shares can be affected by input costs and consumer spending. This stock is temporarily paused on Paymax.",
			FeeBps: 25, SettlementCycle: "T+3",
			MinOrderAmount: minor(1_000), MaxOrderAmount: minor(20_000_000), KycTierRequired: 2,
		},
		{
			ID: "stk_aapl", Type: "stock", Symbol: "AAPL", Name: "Apple Inc.",
			Exchange: "NASDAQ", Sector: "Technology", Currency: "USD",
			IconColor: "#0B1C30", RiskRating: "medium", Status: "active",
			BuyEnabled: true, SellEnabled: true, MarketStatus: "closed",
			Price: usd(228.40), Change24hPct: 0.86, DayChange: usd(1.95),
			Week52High: usd(260.10), Week52Low: usd(164.08),
			MarketCap: usd(3_450_000_000_000), Volume: 41_200_000,
			Bid: usd(228.35), Ask: usd(228.45),
			Summary:        "Apple designs and sells consumer electronics, software and services including iPhone, Mac and the App Store.",
			RiskDisclosure: "US-listed shares carry currency risk for NGN-funded accounts in addition to normal market risk.",
			FeeBps: 20, SettlementCycle: "T+2",
			MinOrderAmount: minor(1), MaxOrderAmount: minor(200_000), KycTierRequired: 2,
		},
		{
			ID: "stk_tsla", Type: "stock", Symbol: "TSLA", Name: "Tesla, Inc.",
			Exchange: "NASDAQ", Sector: "Automotive", Currency: "USD",
			IconColor: "#BA1A1A", RiskRating: "high", Status: "active",
			BuyEnabled: true, SellEnabled: true, MarketStatus: "pre",
			Price: usd(412.70), Change24hPct: -2.41, DayChange: usd(-10.20),
			Week52High: usd(488.50), Week52Low: usd(182.00),
			MarketCap: usd(1_320_000_000_000), Volume: 88_900_000,
			Bid: usd(412.50), Ask: usd(412.90),
			Summary:        "Tesla designs and manufactures electric vehicles, battery energy storage and solar products.",
			RiskDisclosure: "Tesla is a higher-risk, high-volatility stock and its price can swing sharply within a single session.",
			FeeBps: 20, SettlementCycle: "T+2",
			MinOrderAmount: minor(1), MaxOrderAmount: minor(150_000), KycTierRequired: 2,
		},
		{
			ID: "stk_voo", Type: "stock", Symbol: "VOO", Name: "Vanguard S&P 500 ETF",
			Exchange: "NYSE", Sector: "ETF", Currency: "USD",
			IconColor: "#00453F", RiskRating: "low", Status: "active",
			BuyEnabled: true, SellEnabled: true, MarketStatus: "closed",
			Price: usd(548.10), Change24hPct: 0.41, DayChange: usd(2.25),
			Week52High: usd(560.00), Week52Low: usd(458.20),
			MarketCap: usd(520_000_000_000), Volume: 4_120_000,
			Bid: usd(548.00), Ask: usd(548.20),
			Summary:        "The Vanguard S&P 500 ETF tracks the 500 largest US companies, offering broad, low-cost market exposure.",
			RiskDisclosure: "ETFs spread risk across many companies but still fall when the broad market falls. Currency risk applies.",
			FeeBps: 15, SettlementCycle: "T+2",
			MinOrderAmount: minor(1), MaxOrderAmount: minor(200_000), KycTierRequired: 2,
		},
	}
}

// ── Holdings (portfolio positions) ──────────────────────────────────────────────
// Mirrors MOCK_POSITIONS' buildPosition: marketValue = round(price * qty),
// costBasis = round(avgCost * qty). DANGCEM(120 @410), GTCO(2400 @44.50),
// AAPL(18 @190.20).

func buildPosition(a Stock, quantity int64, avgCostMinor int64) StockPosition {
	marketValue := int64(math.Round(float64(a.Price.Amount) * float64(quantity)))
	costBasis := int64(math.Round(float64(avgCostMinor) * float64(quantity)))
	gain := marketValue - costBasis
	pct := 0.0
	if costBasis != 0 {
		pct = round2(float64(gain) / float64(costBasis) * 100)
	}
	return StockPosition{
		AssetID: a.ID, Symbol: a.Symbol, Name: a.Name,
		Exchange: a.Exchange, IconColor: a.IconColor,
		Quantity:           quantity,
		AverageCost:        Money{Amount: avgCostMinor, Currency: a.Currency},
		MarketValue:        Money{Amount: marketValue, Currency: a.Currency},
		CostBasis:          Money{Amount: costBasis, Currency: a.Currency},
		UnrealizedGainLoss: Money{Amount: gain, Currency: a.Currency},
		UnrealizedPct:      pct,
		Price:              a.Price,
		Change24hPct:       a.Change24hPct,
	}
}

func seedPositions(stocks []Stock) []StockPosition {
	byID := func(id string) Stock {
		for _, s := range stocks {
			if s.ID == id {
				return s
			}
		}
		return Stock{}
	}
	return []StockPosition{
		buildPosition(byID("stk_dangcem"), 120, minor(410.00)),
		buildPosition(byID("stk_gtco"), 2_400, minor(44.50)),
		buildPosition(byID("stk_aapl"), 18, minor(190.20)),
	}
}

// ── Order history ──────────────────────────────────────────────────────────────-
// Mirrors MOCK_ORDERS across the status machine.

func seedOrders() []StockOrder {
	ngn := func(a float64) Money { return Money{Amount: minor(a), Currency: "NGN"} }
	limit := func(m Money) *Money { return &m }
	return []StockOrder{
		{
			ID: "so_1", Reference: "PMX-ST-840192", AssetID: "stk_dangcem", Symbol: "DANGCEM",
			Name: "Dangote Cement Plc", Side: "buy", OrderType: "market", Status: "Filled",
			Quantity: 50, FilledQuantity: 50,
			Price: ngn(484.00), Gross: ngn(24_200.00),
			Fees: []Fee{
				{Type: "commission", Amount: ngn(60.50)},
				{Type: "provider_fee", Amount: ngn(24.20)},
			},
			Total: ngn(24_284.70), Provider: "mock-broker", ProviderReference: "BR-77120-AB",
			SettlementDate: daysFromNow(3), IdempotencyKey: "st-mock-1", CreatedAt: hoursAgo(6),
			StatusHistory: []StatusEvent{
				{Status: "Submitted", At: hoursAgo(6)},
				{Status: "AcceptedByProvider", At: hoursAgo(6)},
				{Status: "Filled", At: hoursAgo(6)},
			},
		},
		{
			ID: "so_2", Reference: "PMX-ST-839004", AssetID: "stk_gtco", Symbol: "GTCO",
			Name: "Guaranty Trust Holding Co Plc", Side: "buy", OrderType: "market", Status: "PendingSettlement",
			Quantity: 400, FilledQuantity: 400,
			Price: ngn(58.20), Gross: ngn(23_280.00),
			Fees: []Fee{
				{Type: "commission", Amount: ngn(58.20)},
				{Type: "provider_fee", Amount: ngn(23.28)},
			},
			Total: ngn(23_361.48), Provider: "mock-broker", ProviderReference: "BR-76551-CD",
			SettlementDate: daysFromNow(2), IdempotencyKey: "st-mock-2", CreatedAt: hoursAgo(20),
			StatusHistory: []StatusEvent{
				{Status: "Submitted", At: hoursAgo(20)},
				{Status: "AcceptedByProvider", At: hoursAgo(20)},
				{Status: "Filled", At: hoursAgo(19)},
				{Status: "PendingSettlement", At: hoursAgo(19)},
			},
		},
		{
			ID: "so_3", Reference: "PMX-ST-838221", AssetID: "stk_aradel", Symbol: "ARADEL",
			Name: "Aradel Holdings Plc", Side: "buy", OrderType: "limit", Status: "Submitted",
			Quantity: 20, FilledQuantity: 0,
			Price: ngn(584.00), LimitPrice: limit(ngn(560.00)), Gross: ngn(11_200.00),
			Fees: []Fee{
				{Type: "commission", Amount: ngn(33.60)},
				{Type: "provider_fee", Amount: ngn(11.20)},
			},
			Total: ngn(11_244.80), Provider: "mock-broker", ProviderReference: "BR-78003-EF",
			IdempotencyKey: "st-mock-3", CreatedAt: hoursAgo(2),
			StatusHistory: []StatusEvent{
				{Status: "AwaitingUserConfirmation", At: hoursAgo(2)},
				{Status: "Submitted", At: hoursAgo(2)},
			},
		},
		{
			ID: "so_4", Reference: "PMX-ST-835517", AssetID: "stk_gtco", Symbol: "GTCO",
			Name: "Guaranty Trust Holding Co Plc", Side: "sell", OrderType: "market", Status: "Settled",
			Quantity: 600, FilledQuantity: 600,
			Price: ngn(57.80), Gross: ngn(34_680.00),
			Fees: []Fee{
				{Type: "commission", Amount: ngn(86.70)},
				{Type: "provider_fee", Amount: ngn(34.68)},
			},
			Total: ngn(34_558.62), Provider: "mock-broker", ProviderReference: "BR-71220-GH",
			SettlementDate: hoursAgo(48), IdempotencyKey: "st-mock-4", CreatedAt: hoursAgo(96),
			StatusHistory: []StatusEvent{
				{Status: "Submitted", At: hoursAgo(96)},
				{Status: "Filled", At: hoursAgo(96)},
				{Status: "PendingSettlement", At: hoursAgo(95)},
				{Status: "Settled", At: hoursAgo(48)},
			},
		},
		{
			ID: "so_5", Reference: "PMX-ST-829884", AssetID: "stk_mtnn", Symbol: "MTNN",
			Name: "MTN Nigeria Communications Plc", Side: "buy", OrderType: "market", Status: "Cancelled",
			Quantity: 100, FilledQuantity: 0,
			Price: ngn(235.00), Gross: ngn(23_500.00),
			Fees: []Fee{
				{Type: "commission", Amount: ngn(58.75)},
				{Type: "provider_fee", Amount: ngn(23.50)},
			},
			Total: ngn(23_582.25), Provider: "mock-broker", ProviderReference: "BR-75110-IJ",
			IdempotencyKey: "st-mock-5", CreatedAt: hoursAgo(120),
			FailureReason:  "You cancelled this order before it was filled. No funds were debited.",
			StatusHistory: []StatusEvent{
				{Status: "Submitted", At: hoursAgo(120)},
				{Status: "CancelRequested", At: hoursAgo(119)},
				{Status: "Cancelled", At: hoursAgo(119)},
			},
		},
	}
}

// ── News / dividends / corporate actions / offers ────────────────────────────────

func seedNews() []News {
	return []News{
		{
			ID: "nw_1", Title: "Dangote Cement reports higher quarterly volumes across West Africa",
			Source: "BusinessDay", PublishedAt: hoursAgo(4),
			Summary: "The cement maker posted stronger sales as construction demand recovered across its key markets.",
		},
		{
			ID: "nw_2", Title: "GTCO declares interim dividend as half-year profit climbs",
			Source: "Nairametrics", PublishedAt: hoursAgo(26),
			Summary: "The holding company announced an interim payout following a rise in net interest income.",
		},
		{
			ID: "nw_3", Title: "NGX All-Share Index extends gains on banking rally",
			Source: "The Guardian", PublishedAt: hoursAgo(50),
			Summary: "Nigerian equities rose for a third straight session, led by tier-1 banking names.",
		},
	}
}

func seedDividends() []Dividend {
	ngn := func(a float64) Money { return Money{Amount: minor(a), Currency: "NGN"} }
	return []Dividend{
		{
			ID: "dv_1", Symbol: "GTCO", ExDate: daysFromNow(8), PayDate: daysFromNow(22),
			AmountPerShare: ngn(2.50), Status: "announced",
		},
		{
			ID: "dv_2", Symbol: "DANGCEM", ExDate: hoursAgo(30 * 24), PayDate: hoursAgo(10 * 24),
			AmountPerShare: ngn(30.00), Status: "paid",
		},
	}
}

func seedCorporateActions() []CorporateAction {
	return []CorporateAction{
		{
			ID: "ca_1", Symbol: "MTNN", Type: "agm", Title: "Annual General Meeting",
			Description: "MTN Nigeria will hold its AGM; holders of record on the ex-date are eligible to vote.",
			ExDate:      daysFromNow(14), Status: "upcoming",
		},
		{
			ID: "ca_2", Symbol: "AAPL", Type: "split", Title: "Stock split (historical)",
			Description: "Apple completed a 4-for-1 stock split, increasing the number of shares outstanding.",
			ExDate:      hoursAgo(400 * 24), Status: "completed",
		},
	}
}

func seedOffers() []PublicOffer {
	ngn := func(a float64) Money { return Money{Amount: minor(a), Currency: "NGN"} }
	return []PublicOffer{
		{
			ID: "of_1", Symbol: "GREENTECH", Name: "GreenTech Energy Plc", Kind: "ipo",
			PriceLow: ngn(18.00), PriceHigh: ngn(22.00),
			OpenDate: hoursAgo(2 * 24), CloseDate: daysFromNow(6), MinUnits: 1_000, Status: "open",
			Summary: "GreenTech Energy is raising primary capital to fund renewable-energy projects across Nigeria. Shares will list on the NGX.",
		},
		{
			ID: "of_2", Symbol: "ZENITHBANK", Name: "Zenith Bank Plc", Kind: "rights",
			PriceLow: ngn(36.00), PriceHigh: ngn(36.00),
			OpenDate: daysFromNow(3), CloseDate: daysFromNow(24), MinUnits: 100, Status: "upcoming",
			Summary: "Existing Zenith Bank shareholders may subscribe for additional shares at a discount under this rights issue.",
		},
	}
}
