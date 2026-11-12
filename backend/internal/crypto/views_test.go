package crypto

import (
	"context"
	"math/big"
	"testing"
	"time"
)

func TestDecimalsFor(t *testing.T) {
	for _, tc := range []struct {
		scale int64
		want  int
	}{
		{100_000_000, 8}, // BTC satoshis
		{1_000_000, 6},   // USDT
		{1_000, 3},
		{1, 0},
		{0, 0},
		{-5, 0},
		{1500, 0}, // not a power of ten: precision is unknown, never guessed
	} {
		if got := decimalsFor(tc.scale); got != tc.want {
			t.Errorf("decimalsFor(%d) = %d, want %d", tc.scale, got, tc.want)
		}
	}
}

func TestMinBuyKoboIsTheCostOfOneMinorUnitRoundedUp(t *testing.T) {
	// BTC at ₦110,511,835 per whole unit: one satoshi costs 110.511835 kobo, and
	// 110 kobo would convert to zero units and be refused. The floor is the ceiling.
	if got := minBuyKobo(11_051_183_500, 100_000_000); got != 111 {
		t.Errorf("minBuyKobo(BTC) = %d kobo, want 111", got)
	}
	if got := minBuyKobo(137_734, 1_000_000); got != 1 {
		t.Errorf("minBuyKobo(USDT) = %d kobo, want 1", got)
	}
	if got := minBuyKobo(0, 100_000_000); got != 0 {
		t.Errorf("minBuyKobo with no price = %d, want 0 (unpriced assets are unbuyable)", got)
	}
	if got := minBuyKobo(11_051_183_500, 0); got != 0 {
		t.Errorf("minBuyKobo with no scale = %d, want 0", got)
	}
}

// feedPrice is a MarketFeed with a fixed book, so views are testable without a network.
type feedPrice struct {
	book   map[string]MarketSnapshot
	source string
}

func (f feedPrice) PriceKobo(_ context.Context, symbol string) (int64, bool) {
	m, ok := f.book[symbol]
	return m.PriceKobo, ok
}
func (f feedPrice) Name() string { return f.source }
func (f feedPrice) Markets(_ context.Context) (map[string]MarketSnapshot, error) {
	return f.book, nil
}

func TestAssetViewsOfPricesOnlyWhatTheFeedQuotes(t *testing.T) {
	now := time.Now().UTC()
	s := &Service{
		price: feedPrice{source: "quidax-test", book: map[string]MarketSnapshot{
			"BTC": {PriceKobo: 11_051_183_500, OpenKobo: 10_716_521_200, HighKobo: 11_180_657_900, LowKobo: 10_477_780_500, VolumeKobo: 11_952_588_100, AsOf: now},
		}},
		withdraw: NewMockWithdrawalProvider(),
	}
	views := s.AssetViewsOf(context.Background(), []Asset{
		{ID: "a1", Symbol: "USDC", Name: "USD Coin", MinorUnitScale: 1_000_000, IsActive: true},
		{ID: "a2", Symbol: "BTC", Name: "Bitcoin", MinorUnitScale: 100_000_000, IsActive: true},
	})

	if views[0].Symbol != "BTC" || views[1].Symbol != "USDC" {
		t.Fatalf("views must sort by symbol, got %s, %s", views[0].Symbol, views[1].Symbol)
	}
	btc, usdc := views[0], views[1]
	if btc.PriceKobo != 11_051_183_500 || btc.Open24hKobo != 10_716_521_200 || btc.Volume24hKobo != 11_952_588_100 {
		t.Errorf("BTC view lost market context: %+v", btc)
	}
	if btc.PriceSource != "quidax-test" || !btc.PriceAsOf.Equal(now) {
		t.Errorf("BTC view must carry the feed label and its own timestamp, got %q %v", btc.PriceSource, btc.PriceAsOf)
	}
	if !btc.BuyEnabled || !btc.SellEnabled {
		t.Error("a priced, active asset must be tradable")
	}
	if btc.Decimals != 8 || btc.MinBuyKobo != 111 {
		t.Errorf("BTC view decimals/min = %d/%d, want 8/111", btc.Decimals, btc.MinBuyKobo)
	}
	if usdc.PriceKobo != 0 || usdc.BuyEnabled || usdc.SellEnabled || usdc.MinBuyKobo != 0 {
		t.Errorf("an unquoted asset must show no price and no trading: %+v", usdc)
	}
	if usdc.Decimals != 6 {
		t.Errorf("USDC decimals = %d, want 6 (scale is known even without a price)", usdc.Decimals)
	}
	// Deposits need a custody provider to allocate an address; withdrawals need a
	// live broadcast adapter. Neither exists for a mock, so both must read false.
	for _, v := range views {
		if v.DepositEnabled {
			t.Errorf("%s: deposits must not be advertised without a custody address source", v.Symbol)
		}
		if v.WithdrawEnabled {
			t.Errorf("%s: withdrawals must not be advertised over a mock broadcaster", v.Symbol)
		}
		if v.KycTierRequired != 1 {
			t.Errorf("%s: kyc tier = %d, want 1 (the gate the money path enforces)", v.Symbol, v.KycTierRequired)
		}
	}
}

func TestWithdrawEnabledOnlyForALiveBroadcaster(t *testing.T) {
	s := &Service{price: feedPrice{source: "quidax-test"}, withdraw: NewMockWithdrawalProvider()}
	if s.AssetViewsOf(context.Background(), []Asset{{ID: "a", Symbol: "BTC", MinorUnitScale: 1}})[0].WithdrawEnabled {
		t.Fatal("a mock broadcaster must never report withdraw_enabled")
	}
	s2 := &Service{price: feedPrice{source: "quidax-live"}, withdraw: quidaxLiveName{}}
	if !s2.AssetViewsOf(context.Background(), []Asset{{ID: "a", Symbol: "BTC", MinorUnitScale: 1}})[0].WithdrawEnabled {
		t.Fatal("a quidax broadcaster must report withdraw_enabled")
	}
}

// quidaxLiveName is a WithdrawalProvider stand-in whose only behaviour of interest
// is its Name(); Broadcast is never called by the read path.
type quidaxLiveName struct{}

func (quidaxLiveName) Broadcast(_ context.Context, _ BroadcastRequest) (BroadcastRequestResult, error) {
	panic("the read path must not broadcast")
}
func (quidaxLiveName) Name() string { return "quidax-live" }

func TestAvgCostSurvivesAPartialSell(t *testing.T) {
	c := &avgCost{cashInKobo: new(big.Int).SetInt64(0)}
	c.unitsIn = 100_000_000 // 1 BTC
	c.cashInKobo.Add(c.cashInKobo, big.NewInt(11_051_183_500))

	if got := c.avgPerWholeUnit(100_000_000); got != 11_051_183_500 {
		t.Errorf("avg per whole BTC = %d kobo, want 11051183500", got)
	}
	if got := c.basisKobo(100_000_000); got != 11_051_183_500 {
		t.Errorf("full basis = %d, want 11051183500", got)
	}

	c.consume(40_000_000) // sell 0.4 BTC at the running average
	if got := c.basisKobo(60_000_000); got != 6_630_710_100 {
		t.Errorf("basis for the 0.6 BTC left = %d, want 6630710100", got)
	}
	if got := c.avgPerWholeUnit(100_000_000); got != 11_051_183_500 {
		t.Errorf("the average must not move on a sell, got %d", got)
	}
}

func TestAvgCostHandlesSubKoboUnitPrices(t *testing.T) {
	// 1 satoshi costs 110.511835 kobo: integer kobo per minor unit would be 110 and
	// the whole basis of a small holding would round away. Micro-kobo keeps it.
	c := &avgCost{unitsIn: 1, cashInKobo: big.NewInt(111)}
	if got := c.basisKobo(1000); got != 111_000 {
		t.Errorf("basis for 1000 satoshis = %d, want 111000", got)
	}
	if got := c.avgPerMinorUnit().Int64(); got != 111_000_000 {
		t.Errorf("avg per minor unit = %d micro-kobo, want 111000000", got)
	}
}
