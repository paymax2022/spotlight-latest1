package invest

import (
	"context"
	"crypto/sha1"
	"encoding/binary"
	"fmt"
	"strings"
	"time"
)

// ─────────────────────────────────────────────────────────────────────────────
// Provider adapter interfaces (the spine — architecture.md).
//
// Business logic depends ONLY on these interfaces, never a provider SDK.
// Mock implementations ship first; real broker / market-data adapters are wired
// later behind the same contracts after sandbox validation.
// ─────────────────────────────────────────────────────────────────────────────

// Quote is a point-in-time price snapshot from the market-data adapter.
type Quote struct {
	Symbol        string    `json:"symbol"`
	PriceKobo     int64     `json:"price_kobo"`
	PrevCloseKobo int64     `json:"prev_close_kobo"`
	DayChangeKobo int64     `json:"day_change_kobo"`
	DayChangePct  float64   `json:"day_change_pct"`
	High52Kobo    int64     `json:"high_52w_kobo"`
	Low52Kobo     int64     `json:"low_52w_kobo"`
	Volume        int64     `json:"volume"`
	MarketStatus  string    `json:"market_status"` // open|closed|pre|post
	DataStatus    string    `json:"data_status"`   // delayed|real_time
	AsOf          time.Time `json:"as_of"`
}

// Candle is one OHLC bar for charts.
type Candle struct {
	T         int64 `json:"t"` // unix seconds
	OpenKobo  int64 `json:"o"`
	HighKobo  int64 `json:"h"`
	LowKobo   int64 `json:"l"`
	CloseKobo int64 `json:"c"`
	Volume    int64 `json:"v"`
}

// BrokerOrderResult is the normalized broker response to an order submission.
type BrokerOrderResult struct {
	ProviderReference string
	Accepted          bool
	ExecutedPriceKobo int64
	FilledQuantity    float64
	Status            string // accepted|filled|partially_filled|rejected
	Reason            string
}

// MarketDataAdapter — see architecture.md.
type MarketDataAdapter interface {
	Name() string
	GetQuote(ctx context.Context, providerSymbol string) (Quote, error)
	GetHistorical(ctx context.Context, providerSymbol, rng string) ([]Candle, error)
	GetMarketStatus(ctx context.Context) (string, error)
}

// BrokerAdapter — see architecture.md (subset needed for the trading MVP).
type BrokerAdapter interface {
	Name() string
	SubmitBuyOrder(ctx context.Context, o Order, refQuote Quote) (BrokerOrderResult, error)
	SubmitSellOrder(ctx context.Context, o Order, refQuote Quote) (BrokerOrderResult, error)
	CancelOrder(ctx context.Context, providerReference string) error
}

// PublicOfferAdapter — see architecture.md.
type PublicOfferAdapter interface {
	Name() string
	SubmitApplication(ctx context.Context, offer PublicOffer, userID string, amountKobo int64, idem string) (string, error)
}

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic mock market-data adapter.
//
// Prices are derived deterministically from the symbol so dev/CI is stable and
// reproducible (no external calls, no randomness across restarts). Treat the
// data as "delayed" — every market-data status is clearly labelled.
// ─────────────────────────────────────────────────────────────────────────────

type MockMarketData struct {
	// marketOpen lets tests/admin force market state; nil → derive from clock.
	forceStatus string
}

func NewMockMarketData() *MockMarketData { return &MockMarketData{} }

func (m *MockMarketData) Name() string { return "mock-market-data" }

// seedFor maps a symbol to a stable pseudo price band.
func seedFor(symbol string) int64 {
	h := sha1.Sum([]byte(strings.ToUpper(symbol)))
	n := binary.BigEndian.Uint32(h[:4])
	// Base price between ₦50.00 and ₦1,050.00 (in kobo).
	return int64(5_000 + (n % 100_000))
}

func (m *MockMarketData) GetQuote(ctx context.Context, providerSymbol string) (Quote, error) {
	base := seedFor(providerSymbol)
	// Intraday wobble derived from the current hour so values move but stay stable
	// within an hour (deterministic, no RNG).
	hour := time.Now().UTC().Hour()
	wobble := int64((hour%7)-3) * (base / 200) // ±~1.5%
	price := base + wobble
	if price <= 0 {
		price = base
	}
	prev := base
	change := price - prev
	var pct float64
	if prev != 0 {
		pct = float64(change) / float64(prev) * 100
	}
	return Quote{
		Symbol:        providerSymbol,
		PriceKobo:     price,
		PrevCloseKobo: prev,
		DayChangeKobo: change,
		DayChangePct:  pct,
		High52Kobo:    base + base/4,
		Low52Kobo:     base - base/4,
		Volume:        int64(100_000 + seedFor("vol:"+providerSymbol)%900_000),
		MarketStatus:  m.status(),
		DataStatus:    "delayed",
		AsOf:          time.Now().UTC(),
	}, nil
}

func (m *MockMarketData) GetHistorical(ctx context.Context, providerSymbol, rng string) ([]Candle, error) {
	base := seedFor(providerSymbol)
	n := 30
	switch rng {
	case "1d":
		n = 24
	case "1w":
		n = 7
	case "1m":
		n = 30
	case "3m":
		n = 90
	case "1y":
		n = 252
	}
	out := make([]Candle, 0, n)
	now := time.Now().UTC()
	for i := n - 1; i >= 0; i-- {
		t := now.AddDate(0, 0, -i)
		// Deterministic drift based on day index.
		drift := int64((i%11)-5) * (base / 100)
		c := base + drift
		o := c - base/200
		hi := c + base/100
		lo := c - base/100
		out = append(out, Candle{
			T: t.Unix(), OpenKobo: o, HighKobo: hi, LowKobo: lo, CloseKobo: c,
			Volume: int64(50_000 + (seedFor(providerSymbol)+int64(i))%500_000),
		})
	}
	return out, nil
}

func (m *MockMarketData) GetMarketStatus(ctx context.Context) (string, error) {
	return m.status(), nil
}

// status derives NGX-like hours (Mon–Fri, 10:00–14:30 WAT ≈ 09:00–13:30 UTC).
func (m *MockMarketData) status() string {
	if m.forceStatus != "" {
		return m.forceStatus
	}
	now := time.Now().UTC()
	if now.Weekday() == time.Saturday || now.Weekday() == time.Sunday {
		return "closed"
	}
	mins := now.Hour()*60 + now.Minute()
	if mins >= 9*60 && mins <= 13*60+30 {
		return "open"
	}
	return "closed"
}

// SetForceStatus is used by admin/tests to override market state.
func (m *MockMarketData) SetForceStatus(s string) { m.forceStatus = s }

// ─────────────────────────────────────────────────────────────────────────────
// Mock broker adapter.
//
// Synchronously "accepts and fills" market orders at the reference quote price
// and returns a unique provider reference. Limit orders fill only when the limit
// is marketable vs the reference price, otherwise they are accepted (resting).
// This keeps the order state machine + settlement path exercisable end-to-end.
// ─────────────────────────────────────────────────────────────────────────────

type MockBroker struct{}

func NewMockBroker() *MockBroker { return &MockBroker{} }

func (b *MockBroker) Name() string { return "mock-broker" }

func providerRef(prefix string) string {
	return fmt.Sprintf("%s_%d", prefix, time.Now().UnixNano())
}

func (b *MockBroker) SubmitBuyOrder(ctx context.Context, o Order, q Quote) (BrokerOrderResult, error) {
	px := q.PriceKobo
	if o.OrderType == TypeLimit {
		if o.LimitPriceKobo < px {
			// Not marketable — accepted but resting (no immediate fill).
			return BrokerOrderResult{ProviderReference: providerRef("mbk"), Accepted: true, Status: "accepted"}, nil
		}
		px = o.LimitPriceKobo
	}
	qty := o.Quantity
	if qty == 0 && o.AmountKobo > 0 && px > 0 {
		qty = float64(o.AmountKobo) / float64(px)
	}
	return BrokerOrderResult{
		ProviderReference: providerRef("mbk"),
		Accepted:          true,
		ExecutedPriceKobo: px,
		FilledQuantity:    qty,
		Status:            "filled",
	}, nil
}

func (b *MockBroker) SubmitSellOrder(ctx context.Context, o Order, q Quote) (BrokerOrderResult, error) {
	px := q.PriceKobo
	if o.OrderType == TypeLimit {
		if o.LimitPriceKobo > px {
			return BrokerOrderResult{ProviderReference: providerRef("msk"), Accepted: true, Status: "accepted"}, nil
		}
		px = o.LimitPriceKobo
	}
	return BrokerOrderResult{
		ProviderReference: providerRef("msk"),
		Accepted:          true,
		ExecutedPriceKobo: px,
		FilledQuantity:    o.Quantity,
		Status:            "filled",
	}, nil
}

func (b *MockBroker) CancelOrder(ctx context.Context, providerReference string) error {
	return nil
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock public-offer adapter.
// ─────────────────────────────────────────────────────────────────────────────

type MockPublicOffer struct{}

func NewMockPublicOffer() *MockPublicOffer { return &MockPublicOffer{} }

func (p *MockPublicOffer) Name() string { return "mock-public-offer" }

func (p *MockPublicOffer) SubmitApplication(ctx context.Context, offer PublicOffer, userID string, amountKobo int64, idem string) (string, error) {
	return providerRef("mpo"), nil
}
