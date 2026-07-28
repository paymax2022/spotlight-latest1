package stocks

import (
	"math"
	"time"
)

// ── Fee config (server-authoritative; mirrors stocks.constants.ts) ───────────────
// The per-asset feeBps takes priority over the default; the provider fee is a
// flat default markup. These mirror PAYMAX_FEE_BPS / PROVIDER_FEE_BPS.

const (
	DefaultFeeBps  = 25 // 0.25% Paymax commission (default, when asset.feeBps == 0)
	ProviderFeeBps = 10 // 0.10% broker/provider fee
)

// round mirrors JS Math.round (half away from zero for positives via float64).
func round(f float64) int64 { return int64(math.Round(f)) }

// round2 mirrors `+(x).toFixed(2)` — round to 2 decimal places.
func round2(f float64) float64 { return math.Round(f*100) / 100 }

// ── Estimate engine ──────────────────────────────────────────────────────────--
// Ported 1:1 from stockFormatters.buildEstimate so the client's live preview and
// the server's executed order agree to the minor unit.
//
//	gross = quantity * (limitPrice ?? estPrice)
//	fees  = commission (asset.feeBps) + provider fee, both in bps of gross
//	total = buy: gross + fees / sell: max(0, gross - fees)
func BuildEstimate(s Stock, side, orderType string, quantity int64, limitPrice int64) OrderEstimate {
	currency := s.Currency
	estUnit := s.Price.Amount

	unit := estUnit
	if orderType == "limit" && limitPrice > 0 {
		unit = limitPrice
	}

	grossMinor := round(float64(unit) * float64(quantity))

	feeBps := s.FeeBps
	if feeBps == 0 {
		feeBps = DefaultFeeBps
	}
	commission := round(float64(grossMinor) * float64(feeBps) / 10_000)
	providerFee := round(float64(grossMinor) * float64(ProviderFeeBps) / 10_000)

	fees := []Fee{
		{Type: "commission", Amount: Money{Amount: commission, Currency: currency}},
		{Type: "provider_fee", Amount: Money{Amount: providerFee, Currency: currency}},
	}
	feeSum := commission + providerFee

	var totalMinor int64
	if side == "buy" {
		totalMinor = grossMinor + feeSum
	} else {
		totalMinor = grossMinor - feeSum
		if totalMinor < 0 {
			totalMinor = 0
		}
	}

	var limit *Money
	if orderType == "limit" && limitPrice > 0 {
		limit = &Money{Amount: limitPrice, Currency: currency}
	}

	return OrderEstimate{
		Side:            side,
		OrderType:       orderType,
		Symbol:          s.Symbol,
		AssetID:         s.ID,
		Quantity:        quantity,
		EstPrice:        Money{Amount: estUnit, Currency: currency},
		LimitPrice:      limit,
		Gross:           Money{Amount: grossMinor, Currency: currency},
		Fees:            fees,
		Total:           Money{Amount: totalMinor, Currency: currency},
		SettlementCycle: s.SettlementCycle,
	}
}

// ── Chart (deterministic mock generator) ─────────────────────────────────────────
// Ported 1:1 from stockFormatters.chartFor. Ranges: 1D/1W/1M/3M/1Y.

func Chart(s Stock, rng string) []Candle {
	points := map[string]int{"1D": 24, "1W": 28, "1M": 30, "3M": 26, "1Y": 52}[rng]
	if points == 0 {
		points = 24
	}
	stepMs := map[string]int64{
		"1D": 3_600_000,
		"1W": 6 * 3_600_000,
		"1M": 86_400_000,
		"3M": 3 * 86_400_000,
		"1Y": 7 * 86_400_000,
	}[rng]
	if stepMs == 0 {
		stepMs = 3_600_000
	}

	base := float64(s.Price.Amount)
	seed := charSum(s.Symbol + rng)
	amp := 0.012 // low
	switch s.RiskRating {
	case "high":
		amp = 0.05
	case "medium":
		amp = 0.03
	}

	out := make([]Candle, 0, points)
	now := time.Now()
	for i := 0; i < points; i++ {
		wobble := math.Sin(float64(seed+i)/3)*amp + math.Cos(float64(seed+i)/6)*amp*0.6
		drift := (s.Change24hPct / 100) * (float64(i) / float64(points))
		price := round(base * (1 + wobble + drift - amp/2))
		if price < 1 {
			price = 1
		}
		t := now.Add(-time.Duration(int64(points-i)*stepMs) * time.Millisecond).UTC().Format(time.RFC3339)
		out = append(out, Candle{T: t, Price: price})
	}
	return out
}

func charSum(s string) int {
	sum := 0
	for _, c := range s {
		sum += int(c)
	}
	return sum
}
