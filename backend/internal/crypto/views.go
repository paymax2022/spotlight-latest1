package crypto

import (
	"context"
	"fmt"
	"math/big"
	"sort"
	"strings"
	"time"

	"spotlight/backend/internal/finance/tiers"
)

// This file is the READ side of crypto: everything a member sees about markets,
// holdings and portfolio totals. It exists because the raw tables carry only the
// money-path facts (asset rows, holding units, fills) while the app renders market
// context (price, 24h window, P&L) next to them. Each view field therefore has
// exactly one source: the ticker book, the holding projection, or the fill history.
// A field with no source is left zero and the app says "unavailable" — the views
// never estimate.

// costBasisScale is the fixed-point factor for the moving-average cost per MINOR
// asset unit, in micro-kobo. Cost per unit is routinely far below one kobo (one
// satoshi of BTC at ₦110M is ~11 kopeks), so integer kobo would round the whole
// basis to zero. Micro-kobo keeps six decimal places of a kobo, and every derived
// amount is divided back to kobo before it leaves the server.
const costBasisScale = int64(1_000_000)

// AssetView is one catalogue asset as the member app renders it: the catalogue row,
// its live market context, and the capability flags that describe what the server
// will actually let this user do with it right now.
type AssetView struct {
	ID             string    `json:"id"`
	Symbol         string    `json:"symbol"`
	Name           string    `json:"name"`
	Decimals       int       `json:"decimals"`
	MinorUnitScale int64     `json:"minor_unit_scale"`
	IsActive       bool      `json:"is_active"`
	PriceKobo      int64     `json:"price_kobo"`
	PriceSource    string    `json:"price_source"`
	PriceAsOf      time.Time `json:"price_as_of"`
	Open24hKobo    int64     `json:"open_24h_kobo"`
	High24hKobo    int64     `json:"high_24h_kobo"`
	Low24hKobo     int64     `json:"low_24h_kobo"`
	Volume24hKobo  int64     `json:"volume_24h_kobo"`
	// MinBuyKobo is the smallest cash leg the server accepts: Buy converts cash to
	// units with integer division, so anything below the price of one minor unit
	// buys zero units and is refused (ErrAmountTooSmall). Not an admin-set floor —
	// there is no per-asset limit column — so it moves with the price.
	MinBuyKobo      int64 `json:"min_buy_kobo"`
	BuyEnabled      bool  `json:"buy_enabled"`
	SellEnabled     bool  `json:"sell_enabled"`
	WithdrawEnabled bool  `json:"withdraw_enabled"`
	DepositEnabled  bool  `json:"deposit_enabled"`
	KycTierRequired int   `json:"kyc_tier_required"`
}

// decimalsFor derives base-unit precision from the minor-unit scale (1e8 → 8). The
// catalogue stores the scale, not the precision, and the two must never disagree —
// so a scale that is not a power of ten reports 0 rather than a rounded guess.
func decimalsFor(scale int64) int {
	if scale <= 0 {
		return 0
	}
	d := 0
	for p := int64(1); p < scale; p *= 10 {
		d++
		if p > scale/10 {
			return 0
		}
	}
	return d
}

// providerIsLive reports whether an injected adapter actually talks to the
// exchange. Both price and broadcast seams carry a Name() that starts with the
// provider label when configured ("quidax-test"/"quidax-live") and "mock" when
// not, so a mock can never be presented to a member as a live capability.
func providerIsLive(name string) bool {
	return strings.HasPrefix(strings.ToLower(strings.TrimSpace(name)), "quidax")
}

// AssetViews builds the member market list: catalogue rows in symbol order, each
// marked with the cached ticker book. Assets the feed does not quote come back with
// price_kobo 0 and trading disabled, which is the truth — not a hidden row.
func (s *Service) AssetViews(ctx context.Context) ([]AssetView, error) {
	assets, err := s.repo.ListAssets(ctx, true)
	if err != nil {
		return nil, err
	}
	return s.AssetViewsOf(ctx, assets), nil
}

// AssetViewFor returns one asset's view by id or symbol (ErrNotFound when unknown).
func (s *Service) AssetViewFor(ctx context.Context, ref string) (*AssetView, error) {
	a, err := s.assetByRef(ctx, ref)
	if err != nil {
		return nil, err
	}
	views := s.AssetViewsOf(ctx, []Asset{*a})
	return &views[0], nil
}

// AssetViewsOf marks a caller-chosen set of catalogue rows (the list, a watchlist,
// an alert's asset) with the same ticker book, so every surface quotes identically.
func (s *Service) AssetViewsOf(ctx context.Context, assets []Asset) []AssetView {
	book := s.Markets(ctx)
	live := providerIsLive(s.withdraw.Name())
	out := make([]AssetView, 0, len(assets))
	for _, a := range assets {
		snap, known := book[strings.ToUpper(a.Symbol)]
		v := AssetView{
			ID: a.ID, Symbol: a.Symbol, Name: a.Name,
			Decimals: decimalsFor(a.MinorUnitScale), MinorUnitScale: a.MinorUnitScale,
			IsActive:        a.IsActive,
			DepositEnabled:  false, // no custody provider allocates addresses on this plane yet
			KycTierRequired: int(tiers.Tier1),
			WithdrawEnabled: live,
		}
		if known && snap.PriceKobo > 0 {
			v.PriceKobo = snap.PriceKobo
			v.PriceSource = s.price.Name()
			v.PriceAsOf = snap.AsOf
			v.Open24hKobo = snap.OpenKobo
			v.High24hKobo = snap.HighKobo
			v.Low24hKobo = snap.LowKobo
			v.Volume24hKobo = snap.VolumeKobo
			v.MinBuyKobo = minBuyKobo(snap.PriceKobo, a.MinorUnitScale)
			v.BuyEnabled = a.IsActive
			v.SellEnabled = a.IsActive
		}
		out = append(out, v)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Symbol < out[j].Symbol })
	return out
}

// minBuyKobo is the cash needed for one minor unit at priceKobo, rounded UP so the
// integer conversion in unitsForCash cannot land on zero units.
func minBuyKobo(priceKobo, scale int64) int64 {
	if priceKobo <= 0 || scale <= 0 {
		return 0
	}
	q := new(big.Int).Quo(big.NewInt(priceKobo), big.NewInt(scale))
	if new(big.Int).Mod(big.NewInt(priceKobo), big.NewInt(scale)).Sign() > 0 {
		q.Add(q, big.NewInt(1))
	}
	if !q.IsInt64() {
		return 0
	}
	return q.Int64()
}

// PositionView is one holding marked to market, with its average-cost basis.
type PositionView struct {
	AssetID        string    `json:"asset_id"`
	Symbol         string    `json:"symbol"`
	Name           string    `json:"name"`
	Units          int64     `json:"units"`
	MinorUnitScale int64     `json:"minor_unit_scale"`
	PriceKobo      int64     `json:"price_kobo"`
	PriceSource    string    `json:"price_source"`
	PriceAsOf      time.Time `json:"price_as_of"`
	Open24hKobo    int64     `json:"open_24h_kobo"`
	ValueKobo      int64     `json:"value_kobo"`
	CostBasisKobo  int64     `json:"cost_basis_kobo"`
	AvgCostKobo    int64     `json:"avg_cost_kobo"` // per ONE whole unit, micro-kobo precision lost on divide
	GainKobo       int64     `json:"gain_kobo"`
	DayChangeKobo  int64     `json:"day_change_kobo"`
	HasCostBasis   bool      `json:"has_cost_basis"` // false = no fills recorded, so P&L is unknown, not zero
}

// PortfolioView is the member's crypto position summary. Money is NGN kobo.
type PortfolioView struct {
	BaseCurrency   string         `json:"base_currency"`
	TotalValueKobo int64          `json:"total_value_kobo"`
	TotalCostKobo  int64          `json:"total_cost_kobo"`
	TotalGainKobo  int64          `json:"total_gain_kobo"`
	DayChangeKobo  int64          `json:"day_change_kobo"`
	InvestableKobo int64          `json:"investable_kobo"`
	HasCostBasis   bool           `json:"has_cost_basis"`
	Positions      []PositionView `json:"positions"`
}

// PositionViews marks the caller's holdings to market and attaches the moving-average
// cost basis derived from their fills. Holdings of assets the feed does not quote are
// still returned, priced at 0 with value 0 — an unpriced holding is visible, not dropped.
func (s *Service) PositionViews(ctx context.Context, userID string) ([]PositionView, error) {
	holdings, err := s.repo.Holdings(ctx, userID)
	if err != nil {
		return nil, err
	}
	assets, err := s.repo.ListAssets(ctx, false)
	if err != nil {
		return nil, err
	}
	byID := make(map[string]Asset, len(assets))
	for _, a := range assets {
		byID[a.ID] = a
	}
	cost, err := s.costBasis(ctx, userID)
	if err != nil {
		return nil, err
	}
	book := s.Markets(ctx)

	out := make([]PositionView, 0, len(holdings))
	for _, h := range holdings {
		a := byID[h.AssetID]
		pv := PositionView{
			AssetID: h.AssetID, Symbol: h.Symbol, Name: a.Name,
			Units: h.Units, MinorUnitScale: a.MinorUnitScale,
		}
		if snap, ok := book[strings.ToUpper(h.Symbol)]; ok && snap.PriceKobo > 0 {
			pv.PriceKobo = snap.PriceKobo
			pv.PriceSource = s.price.Name()
			pv.PriceAsOf = snap.AsOf
			pv.Open24hKobo = snap.OpenKobo
			pv.ValueKobo = cashForUnits(h.Units, snap.PriceKobo, a.MinorUnitScale)
			if snap.OpenKobo > 0 {
				pv.DayChangeKobo = pv.ValueKobo - cashForUnits(h.Units, snap.OpenKobo, a.MinorUnitScale)
			}
		}
		if c, ok := cost[h.AssetID]; ok && c.unitsIn > 0 {
			pv.HasCostBasis = true
			pv.CostBasisKobo = c.basisKobo(h.Units)
			pv.AvgCostKobo = c.avgPerWholeUnit(a.MinorUnitScale)
			if pv.PriceKobo > 0 {
				pv.GainKobo = pv.ValueKobo - pv.CostBasisKobo
			}
		}
		out = append(out, pv)
	}
	return out, nil
}

// PortfolioView totals the caller's positions and adds the cash they could deploy
// (the finance ledger wallet balance — the same wallet a buy debits).
func (s *Service) PortfolioView(ctx context.Context, userID string) (*PortfolioView, error) {
	positions, err := s.PositionViews(ctx, userID)
	if err != nil {
		return nil, err
	}
	pv := &PortfolioView{BaseCurrency: "NGN", Positions: positions}
	for _, p := range positions {
		pv.TotalValueKobo += p.ValueKobo
		pv.DayChangeKobo += p.DayChangeKobo
		if p.HasCostBasis {
			pv.HasCostBasis = true
			pv.TotalCostKobo += p.CostBasisKobo
		}
	}
	if pv.HasCostBasis && pv.TotalValueKobo > 0 {
		pv.TotalGainKobo = pv.TotalValueKobo - pv.TotalCostKobo
	}
	if bal, err := s.led.GetBalance(ctx, userID); err == nil {
		pv.InvestableKobo = bal
	}
	return pv, nil
}

// avgCost is the per-asset moving average of acquisition cost, in micro-kobo per
// MINOR asset unit, plus the units that produced it.
type avgCost struct {
	unitsIn    int64
	cashInKobo *big.Int
}

// consume applies an outflow at the current average, shrinking both sides so the
// remaining basis tracks the units still held.
func (c *avgCost) consume(units int64) {
	if units <= 0 || c.unitsIn <= 0 {
		return
	}
	avg := c.avgPerMinorUnit()
	removed := new(big.Int).Mul(avg, big.NewInt(units))
	removed.Quo(removed, big.NewInt(costBasisScale))
	c.cashInKobo.Sub(c.cashInKobo, removed)
	if c.cashInKobo.Sign() < 0 {
		c.cashInKobo.SetInt64(0)
	}
	c.unitsIn -= units
}

func (c *avgCost) avgPerMinorUnit() *big.Int {
	if c.unitsIn <= 0 {
		return big.NewInt(0)
	}
	avg := new(big.Int).Mul(c.cashInKobo, big.NewInt(costBasisScale))
	return avg.Quo(avg, big.NewInt(c.unitsIn))
}

// basisKobo is the cost attached to `held` units at the running average.
func (c *avgCost) basisKobo(held int64) int64 {
	if held <= 0 || c.unitsIn <= 0 {
		return 0
	}
	r := new(big.Int).Mul(c.avgPerMinorUnit(), big.NewInt(held))
	r.Quo(r, big.NewInt(costBasisScale))
	if !r.IsInt64() {
		return 0
	}
	return r.Int64()
}

// avgPerWholeUnit restates the average as kobo per one whole asset unit, for display.
func (c *avgCost) avgPerWholeUnit(scale int64) int64 {
	if scale <= 0 {
		return 0
	}
	r := new(big.Int).Mul(c.avgPerMinorUnit(), big.NewInt(scale))
	r.Quo(r, big.NewInt(costBasisScale))
	if !r.IsInt64() {
		return 0
	}
	return r.Int64()
}

// fillEvent is one unit-flow against a holding, in chronological order.
type fillEvent struct {
	assetID  string
	dir      string // "in" adds units, "out" removes them
	units    int64
	cashKobo int64
	at       time.Time
}

// assetByRef resolves a URL ref — an asset uuid OR a ticker symbol — to a catalogue
// row. The read routes are addressed by symbol from the app (/assets/BTC/chart), and
// repo.GetAsset binds $1 to a uuid column, so an unconverted symbol fails as a DB
// type error rather than a miss. Only read paths use this: the money paths take an
// asset_id in the body and keep their own inactive-asset refusal (ErrAssetInactive),
// which a symbol lookup that filters on is_active would otherwise replace with 404.
func (s *Service) assetByRef(ctx context.Context, ref string) (*Asset, error) {
	if a, err := s.repo.GetAsset(ctx, ref); err == nil {
		return a, nil
	}
	id, err := s.ResolveActiveAsset(ctx, ref)
	if err != nil {
		return nil, ErrNotFound
	}
	return s.repo.GetAsset(ctx, id)
}

// costBasis replays the caller's fills per asset at their average cost. Buys and
// sells set the two directions; a swap is the same shape on both sides (from_units
// leave at their indicative cash value, to_units enter for the same cash), so the
// basis of a swapped-in position is what the member gave up for it — not the price
// of an unrelated market leg.
func (s *Service) costBasis(ctx context.Context, userID string) (map[string]*avgCost, error) {
	if s.db == nil {
		return map[string]*avgCost{}, nil
	}
	rows, err := s.db.Query(ctx, `
		SELECT asset_id::text, CASE WHEN side = 'buy' THEN 'in' ELSE 'out' END, units, cash_kobo, created_at
		FROM public.crypto_orders WHERE user_id = $1 AND status = 'filled'
		UNION ALL
		SELECT to_asset_id::text, 'in', to_units, cash_kobo, created_at
		FROM public.crypto_swap_orders WHERE user_id = $1 AND status = 'filled'
		UNION ALL
		SELECT from_asset_id::text, 'out', from_units, cash_kobo, created_at
		FROM public.crypto_swap_orders WHERE user_id = $1 AND status = 'filled'
		ORDER BY 1, 5`, userID)
	if err != nil {
		return nil, fmt.Errorf("crypto: cost basis fills: %w", err)
	}
	defer rows.Close()

	var events []fillEvent
	for rows.Next() {
		var e fillEvent
		if err := rows.Scan(&e.assetID, &e.dir, &e.units, &e.cashKobo, &e.at); err != nil {
			return nil, fmt.Errorf("crypto: cost basis scan: %w", err)
		}
		events = append(events, e)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	sort.SliceStable(events, func(i, j int) bool { return events[i].at.Before(events[j].at) })

	out := map[string]*avgCost{}
	for _, e := range events {
		c, ok := out[e.assetID]
		if !ok {
			c = &avgCost{cashInKobo: big.NewInt(0)}
			out[e.assetID] = c
		}
		switch {
		case e.dir == "in" && e.units > 0:
			c.unitsIn += e.units
			c.cashInKobo.Add(c.cashInKobo, big.NewInt(e.cashKobo))
		case e.dir == "out":
			c.consume(e.units)
		}
	}
	return out, nil
}
