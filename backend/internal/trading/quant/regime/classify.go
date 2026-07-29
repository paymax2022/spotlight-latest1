package regime

import "math"

// Classify maps validated point-in-time inputs to a RegimeState, deterministically.
// Priority (most-defensive first): Unknown → Crisis → Illiquid → Trending →
// HighVol → Ranging. A Crisis or Illiquid or Unknown regime makes every strategy
// ineligible downstream (§6). Volatility is judged RELATIVE to BaselineVolBps; with
// no baseline the vol state is Normal (we don't infer a crisis we can't measure).
func Classify(in RegimeInputs, cfg RegimeConfig) RegimeState {
	rs := RegimeState{Regime: Unknown, Trend: TrendNone, Vol: VolNormal}

	// Fail-closed: need enough return samples and matching prices.
	if cfg.MinSamples < 2 {
		cfg.MinSamples = 2
	}
	if len(in.Returns) < cfg.MinSamples || len(in.Prices) < cfg.MinSamples {
		return rs // Unknown
	}

	// Volatility state (relative to baseline).
	rvol := RealizedVolBps(in.Returns)
	rs.RealizedVolBps = rvol
	if rvol == 0 {
		return rs // degenerate (flat) series → Unknown
	}
	baseline := in.BaselineVolBps
	if baseline <= 0 {
		baseline = rvol // no baseline → ratio 1.0 (vol judged Normal)
	}
	ratioBps := Bps(math.Round(float64(rvol) / float64(baseline) * 10_000))
	rs.VolRatioBps = ratioBps
	switch {
	case cfg.CrisisVolRatioBps > 0 && ratioBps >= cfg.CrisisVolRatioBps:
		rs.Vol = VolCrisis
	case cfg.HighVolRatioBps > 0 && ratioBps >= cfg.HighVolRatioBps:
		rs.Vol = VolHigh
	case cfg.LowVolRatioBps > 0 && ratioBps <= cfg.LowVolRatioBps:
		rs.Vol = VolLow
	default:
		rs.Vol = VolNormal
	}

	// Trend state.
	er := EfficiencyRatio(in.Prices)
	slope := TrendSlope(in.Prices)
	rs.EfficiencyRatio = er
	rs.Slope = slope
	if Bps(math.Round(er*10_000)) >= cfg.TrendEffRatioMinBps {
		switch {
		case slope > 0:
			rs.Trend = TrendUp
		case slope < 0:
			rs.Trend = TrendDown
		default:
			rs.Trend = TrendNone
		}
	}

	// Liquidity.
	rs.Illiquid = cfg.IlliquidBelowBps > 0 && in.LiquidityScoreBps < cfg.IlliquidBelowBps

	// Primary label by priority (most-defensive wins).
	switch {
	case rs.Vol == VolCrisis:
		rs.Regime = Crisis
	case rs.Illiquid:
		rs.Regime = Illiquid
	case rs.Trend != TrendNone:
		rs.Regime = Trending
	case rs.Vol == VolHigh:
		rs.Regime = HighVol
	default:
		rs.Regime = Ranging
	}
	return rs
}

// Tradeable reports whether the regime permits opening new positions at all.
// Unknown / Crisis / Illiquid are never tradeable (defensive only).
func (rs RegimeState) Tradeable() bool {
	switch rs.Regime {
	case Trending, Ranging, HighVol:
		return true
	default:
		return false
	}
}

// EligibleStrategies returns the strategies whose declared valid regimes include
// the current regime — the ONLY switch that turns a strategy on (§6). A non-
// tradeable regime yields none, regardless of declarations (fail-closed).
func EligibleStrategies(rs RegimeState, catalog []StrategyDecl) []StrategyDecl {
	if !rs.Tradeable() {
		return nil
	}
	var out []StrategyDecl
	for _, s := range catalog {
		for _, r := range s.ValidRegimes {
			if r == rs.Regime {
				out = append(out, s)
				break
			}
		}
	}
	return out
}
