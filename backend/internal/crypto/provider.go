package crypto

import (
	"context"
	"hash/fnv"
)

// PriceProvider is the provider-agnostic price feed seam. The default is the
// deterministic MockPriceProvider (no network). A real adapter (e.g. an HTTP
// market-data feed) implements the same interface and is injected via Deps —
// mock-first, real last (matches the invest module convention).
type PriceProvider interface {
	// PriceKobo returns the NGN price in kobo per ONE WHOLE asset unit for the
	// given symbol. ok=false means the symbol is unknown to the provider.
	PriceKobo(ctx context.Context, symbol string) (priceKobo int64, ok bool)
	// Name identifies the provider for snapshots/audit.
	Name() string
}

// MockPriceProvider returns fixed/seeded deterministic prices. Known symbols use
// hard-coded reference prices; any other symbol is seeded deterministically from
// its name so tests and local runs are reproducible without a network call.
type MockPriceProvider struct {
	prices map[string]int64 // symbol -> NGN kobo per whole unit
}

// NewMockPriceProvider builds the default deterministic provider.
func NewMockPriceProvider() *MockPriceProvider {
	return &MockPriceProvider{
		prices: map[string]int64{
			// NGN kobo per 1 whole unit (illustrative, deterministic seeds).
			"BTC":  9000000000000, // ₦90,000,000.00
			"ETH":  450000000000,  // ₦4,500,000.00
			"USDT": 160000,        // ₦1,600.00
			"SOL":  25000000,      // ₦250,000.00
		},
	}
}

func (m *MockPriceProvider) Name() string { return "mock" }

func (m *MockPriceProvider) PriceKobo(_ context.Context, symbol string) (int64, bool) {
	if symbol == "" {
		return 0, false
	}
	if p, ok := m.prices[symbol]; ok {
		return p, true
	}
	// Deterministic seed for unknown symbols: stable across runs, no network.
	h := fnv.New32a()
	_, _ = h.Write([]byte(symbol))
	// Map the hash into a ₦100 – ₦1,000,000 band (kobo), step 100 kobo.
	band := int64(h.Sum32()%9_999_900) + 10_000 // 10,000..10,009,899 kobo
	return band * 100, true
}
