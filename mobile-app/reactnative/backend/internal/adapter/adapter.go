// Package adapter defines the provider-adapter seam (docs/crypto/architecture.md
// → "the spine"). Business logic depends on these interfaces, never on a provider
// SDK, so providers are swappable. Mock implementations ship first; real ones
// (Fireblocks/Bitt/Alpaca/…) drop in later behind the same contracts.
package adapter

import (
	"paymax/crypto-backend/internal/domain"
	"paymax/crypto-backend/internal/engine"
	"paymax/crypto-backend/internal/store"
)

// MarketData serves prices, asset metadata and charts.
type MarketData interface {
	Assets() []domain.Asset
	Asset(key string) (domain.Asset, bool)
	Chart(symbol, rng string) ([]domain.CandlePoint, bool)
}

// Liquidity prices and (with the ledger) fills buy/sell/swap orders.
type Liquidity interface {
	Quote(assetKey, side, basis string, amount int64, currency string, lock bool) (domain.Quote, bool)
	SwapQuote(fromKey, toKey string, fromAmount int64) (domain.SwapQuote, bool)
}

// Custody issues deposit addresses, estimates network fees and screens addresses.
type Custody interface {
	DepositAddress(symbol, networkID string) (domain.DepositAddress, bool)
	WithdrawalQuote(assetKey, networkID string, amount int64) (domain.WithdrawalQuote, bool)
	ScreenAddress(address string) domain.AddressScreening
}

// ── Mock implementations ──────────────────────────────────────────────────────

// MockMarketData is backed by the asset catalogue + deterministic charts. It
// depends on store.Repository, not the concrete store, so it works against any
// storage engine.
type MockMarketData struct{ S store.Repository }

func (m MockMarketData) Assets() []domain.Asset                { return m.S.Assets() }
func (m MockMarketData) Asset(key string) (domain.Asset, bool) { return m.S.Asset(key) }

func (m MockMarketData) Chart(symbol, rng string) ([]domain.CandlePoint, bool) {
	a, ok := m.S.Asset(symbol)
	if !ok {
		return nil, false
	}
	return engine.Chart(a, rng), true
}

// MockLiquidity prices via the shared engine so the client preview matches.
type MockLiquidity struct{ S store.Repository }

func (m MockLiquidity) Quote(assetKey, side, basis string, amount int64, currency string, lock bool) (domain.Quote, bool) {
	a, ok := m.S.Asset(assetKey)
	if !ok {
		return domain.Quote{}, false
	}
	return engine.BuildQuote(a, side, basis, amount, currency, lock), true
}

func (m MockLiquidity) SwapQuote(fromKey, toKey string, fromAmount int64) (domain.SwapQuote, bool) {
	from, ok1 := m.S.Asset(fromKey)
	to, ok2 := m.S.Asset(toKey)
	if !ok1 || !ok2 {
		return domain.SwapQuote{}, false
	}
	return engine.BuildSwapQuote(from, to, fromAmount), true
}

// MockCustody issues deterministic addresses and a simple screening heuristic.
type MockCustody struct{ S store.Repository }

func (m MockCustody) network(a domain.Asset, networkID string) domain.Network {
	for _, n := range a.SupportedNetworks {
		if n.ID == networkID {
			return n
		}
	}
	return a.SupportedNetworks[0]
}

func (m MockCustody) DepositAddress(symbol, networkID string) (domain.DepositAddress, bool) {
	a, ok := m.S.Asset(symbol)
	if !ok {
		return domain.DepositAddress{}, false
	}
	return engine.DepositAddressFor(a, m.network(a, networkID)), true
}

func (m MockCustody) WithdrawalQuote(assetKey, networkID string, amount int64) (domain.WithdrawalQuote, bool) {
	a, ok := m.S.Asset(assetKey)
	if !ok {
		return domain.WithdrawalQuote{}, false
	}
	return engine.WithdrawalQuoteFor(a, m.network(a, networkID), amount), true
}

func (m MockCustody) ScreenAddress(address string) domain.AddressScreening {
	clean := ""
	for _, c := range address {
		if c != ' ' {
			clean += string(c)
		}
	}
	if len(clean) < 12 {
		return domain.AddressScreening{Risk: "flagged", Reason: "This address failed validation. Check you copied the full address."}
	}
	return domain.AddressScreening{Risk: "clear"}
}
