package signals

import (
	"fmt"

	"spotlight/backend/internal/trading/quant/regime"
)

// Context is the point-in-time input a strategy sees: the asset, its price prefix
// (oldest→newest, up to and including "now"), and the classified regime. A
// strategy must read ONLY these — no globals, no clock, no future data.
type Context struct {
	Asset  string
	Prices []float64
	Regime regime.RegimeState
}

// Strategy is a rule-based candidate generator that declares the regimes it is
// valid in (§6). It emits candidates only; it never sizes or orders.
type Strategy interface {
	Name() string
	ValidRegimes() []regime.Regime
	Generate(ctx Context) []Candidate
}

// GenerateCandidates runs every ELIGIBLE strategy and returns their candidates.
// Eligibility is doubly gated: the regime must be tradeable AND the strategy must
// declare the current regime valid. A non-tradeable regime (Unknown/Crisis/
// Illiquid) yields NOTHING — fail-closed.
func GenerateCandidates(ctx Context, catalog []Strategy) []Candidate {
	if !ctx.Regime.Tradeable() {
		return nil
	}
	var out []Candidate
	for _, s := range catalog {
		if !regimeAllowed(ctx.Regime.Regime, s.ValidRegimes()) {
			continue
		}
		out = append(out, s.Generate(ctx)...)
	}
	return out
}

func regimeAllowed(r regime.Regime, valid []regime.Regime) bool {
	for _, v := range valid {
		if v == r {
			return true
		}
	}
	return false
}

// ── Trend following (valid in Trending) ──────────────────────────────────────
// Long when the fast EMA is above the slow EMA and the regime trend is up (and
// RSI is not blow-off overbought); symmetric short. Confidence scales with the
// EMA separation; stop is a multiple of ATR.
type TrendFollow struct {
	FastN, SlowN, RSIN, ATRMult int
	SepScale                    float64 // EMA-separation (as a fraction) that saturates confidence
}

func NewTrendFollow() TrendFollow {
	return TrendFollow{FastN: 10, SlowN: 30, RSIN: 14, ATRMult: 2, SepScale: 0.05}
}
func (TrendFollow) Name() string                    { return "trend_follow" }
func (TrendFollow) ValidRegimes() []regime.Regime   { return []regime.Regime{regime.Trending} }
func (s TrendFollow) Generate(ctx Context) []Candidate {
	p := ctx.Prices
	if len(p) < s.SlowN+1 {
		return nil
	}
	fast, slow := EMA(p, s.FastN), EMA(p, s.SlowN)
	if slow == 0 {
		return nil
	}
	sep := (fast - slow) / slow
	rsi := RSI(p, s.RSIN)
	stop := ATRBps(p, s.RSIN) * int64(s.ATRMult)
	up := ctx.Regime.Trend == regime.TrendUp
	down := ctx.Regime.Trend == regime.TrendDown

	if fast > slow && up && rsi < 80 {
		return []Candidate{{
			Strategy: s.Name(), Asset: ctx.Asset, Side: Long,
			ConfidenceBps: confFromMagnitude(sep, s.SepScale), StopDistanceBps: stop,
			Rationale: []string{"fast EMA above slow EMA", "regime trend up", fmt.Sprintf("RSI %.0f (not blow-off)", rsi)},
		}}
	}
	if fast < slow && down && rsi > 20 {
		return []Candidate{{
			Strategy: s.Name(), Asset: ctx.Asset, Side: Short,
			ConfidenceBps: confFromMagnitude(-sep, s.SepScale), StopDistanceBps: stop,
			Rationale: []string{"fast EMA below slow EMA", "regime trend down", fmt.Sprintf("RSI %.0f", rsi)},
		}}
	}
	return nil
}

// ── Mean reversion (valid in Ranging) ─────────────────────────────────────────
// Long when price is oversold (z-score below −threshold); short when overbought.
// Confidence scales with the z-score magnitude.
type MeanReversion struct {
	N, ATRMult int
	ZThreshold float64
	ZScale     float64
}

func NewMeanReversion() MeanReversion {
	return MeanReversion{N: 20, ATRMult: 2, ZThreshold: 1.5, ZScale: 3.0}
}
func (MeanReversion) Name() string                  { return "mean_reversion" }
func (MeanReversion) ValidRegimes() []regime.Regime { return []regime.Regime{regime.Ranging} }
func (s MeanReversion) Generate(ctx Context) []Candidate {
	p := ctx.Prices
	if len(p) < s.N+1 {
		return nil
	}
	z := ZScore(p, s.N)
	stop := ATRBps(p, s.N) * int64(s.ATRMult)
	if z <= -s.ZThreshold {
		return []Candidate{{
			Strategy: s.Name(), Asset: ctx.Asset, Side: Long,
			ConfidenceBps: confFromMagnitude(-z, s.ZScale), StopDistanceBps: stop,
			Rationale: []string{fmt.Sprintf("z-score %.2f (oversold)", z), "range regime"},
		}}
	}
	if z >= s.ZThreshold {
		return []Candidate{{
			Strategy: s.Name(), Asset: ctx.Asset, Side: Short,
			ConfidenceBps: confFromMagnitude(z, s.ZScale), StopDistanceBps: stop,
			Rationale: []string{fmt.Sprintf("z-score %.2f (overbought)", z), "range regime"},
		}}
	}
	return nil
}

// ── Breakout (valid in Trending or HighVol) ───────────────────────────────────
// Long when price closes above the prior N-period high by a buffer; short below
// the prior N-period low. Confidence scales with how far beyond the level.
type Breakout struct {
	N, ATRMult int
	BufferBps  int64
	MagScale   float64 // fractional break beyond the level that saturates confidence
}

func NewBreakout() Breakout {
	return Breakout{N: 20, ATRMult: 2, BufferBps: 10, MagScale: 0.03}
}
func (Breakout) Name() string { return "breakout" }
func (Breakout) ValidRegimes() []regime.Regime {
	return []regime.Regime{regime.Trending, regime.HighVol}
}
func (s Breakout) Generate(ctx Context) []Candidate {
	p := ctx.Prices
	if len(p) < s.N+2 {
		return nil
	}
	last := p[len(p)-1]
	hh := HighestHigh(p, s.N, true) // prior N high (excludes current)
	ll := LowestLow(p, s.N, true)
	buf := float64(s.BufferBps) / 10_000
	stop := ATRBps(p, s.N) * int64(s.ATRMult)

	if hh > 0 && last > hh*(1+buf) {
		return []Candidate{{
			Strategy: s.Name(), Asset: ctx.Asset, Side: Long,
			ConfidenceBps: confFromMagnitude((last-hh)/hh, s.MagScale), StopDistanceBps: stop,
			Rationale: []string{fmt.Sprintf("broke above %d-period high", s.N), "trend/high-vol regime"},
		}}
	}
	if ll > 0 && last < ll*(1-buf) {
		return []Candidate{{
			Strategy: s.Name(), Asset: ctx.Asset, Side: Short,
			ConfidenceBps: confFromMagnitude((ll-last)/ll, s.MagScale), StopDistanceBps: stop,
			Rationale: []string{fmt.Sprintf("broke below %d-period low", s.N), "trend/high-vol regime"},
		}}
	}
	return nil
}

// DefaultCatalog is the starter strategy set (each independently regime-tagged).
func DefaultCatalog() []Strategy {
	return []Strategy{NewTrendFollow(), NewMeanReversion(), NewBreakout()}
}
