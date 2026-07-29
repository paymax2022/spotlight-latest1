package risk

import "math"

// Sizing (§8): size by volatility target and/or fractional-Kelly, then apply hard
// caps, confidence scaling, and reduce-before-increase. Every function fails
// CLOSED (returns 0) on invalid input, and every kobo result rounds DOWN so the
// engine can never over-size. Size shrinks in high-vol / low-confidence regimes.

// SizeVolTarget returns the position notional (kobo) whose expected volatility
// equals targetVolBps of equity, given the instrument's own annualized vol. A
// more volatile instrument gets a smaller notional. instrumentVolBps <= 0 is
// "unknown" and fails closed (0 — never guess a size on unknown risk).
func SizeVolTarget(equityKobo int64, targetVolBps, instrumentVolBps Bps) int64 {
	if equityKobo <= 0 || targetVolBps <= 0 || instrumentVolBps <= 0 {
		return 0
	}
	// notional = equity * targetVol / instrumentVol
	notional := float64(equityKobo) * targetVolBps.Frac() / instrumentVolBps.Frac()
	return floorKobo(notional)
}

// KellyFraction is the full-Kelly optimal fraction for a bet with win probability
// winProb (0..1) and payoff ratio b (win size / loss size). f* = (p(b+1)-1)/b.
// Returns 0 for a non-positive-edge or malformed bet (fail closed). Clamped to
// [0,1] — full Kelly never implies leverage here.
func KellyFraction(winProb, payoffRatio float64) float64 {
	if !finite(winProb) || !finite(payoffRatio) || winProb <= 0 || winProb >= 1 || payoffRatio <= 0 {
		return 0
	}
	f := (winProb*(payoffRatio+1) - 1) / payoffRatio
	if f <= 0 {
		return 0 // no edge → no bet
	}
	return clamp01(f)
}

// FractionalKelly returns the notional (kobo) from a FRACTION of full Kelly
// (kellyFraction, e.g. 0.25 for quarter-Kelly) with a hard fraction ceiling
// (maxFracBps of equity). Fractional Kelly is standard practice — full Kelly is
// too aggressive and assumes perfectly known edge. kellyFraction is clamped to
// [0,1]; a non-positive Kelly edge yields 0.
func FractionalKelly(equityKobo int64, winProb, payoffRatio, kellyFraction float64, maxFracBps Bps) int64 {
	if equityKobo <= 0 {
		return 0
	}
	kf := KellyFraction(winProb, payoffRatio)
	if kf <= 0 {
		return 0
	}
	frac := kf * clamp01(kellyFraction)
	if maxFracBps > 0 {
		frac = math.Min(frac, maxFracBps.Frac())
	}
	return floorKobo(float64(equityKobo) * frac)
}

// ConfidenceScale scales a proposed size by aggregate confidence: linearly from
// minConfidence (→ 0) to full confidence (→ full size). Below minConfidence the
// trade is refused (0). This makes low-confidence regimes automatically smaller.
// minConfidenceBps == 0 means "no floor" and confidence still scales the size.
func ConfidenceScale(sizeKobo int64, confidenceBps, minConfidenceBps Bps) int64 {
	if sizeKobo <= 0 || confidenceBps <= 0 {
		return 0
	}
	if minConfidenceBps > 0 && confidenceBps < minConfidenceBps {
		return 0 // below the user's minimum confidence → no trade
	}
	c := clamp01(confidenceBps.Frac())
	return floorKobo(float64(sizeKobo) * c)
}

// ApplyCaps returns the largest notional that respects every BINDING cap in
// SizeCaps (a 0 cap is not binding). This is the hard ceiling — a proposed size
// can only be reduced here, never increased.
func ApplyCaps(proposedKobo int64, caps SizeCaps) int64 {
	if proposedKobo <= 0 {
		return 0
	}
	out := proposedKobo
	for _, cap := range []int64{caps.MaxPositionKobo, caps.MaxByEquityFracKobo, caps.MaxByLeverageKobo} {
		if cap > 0 && cap < out {
			out = cap
		}
	}
	if out < 0 {
		return 0
	}
	return out
}

// CapsFromLimits precomputes the per-position SizeCaps from the fund's limits and
// current state: the absolute cap, the equity-fraction cap, and the remaining
// headroom under the gross-leverage cap (so a new position can't push gross
// leverage past MaxGrossLeverage).
func CapsFromLimits(lim Limits, st PortfolioState) SizeCaps {
	var caps SizeCaps
	caps.MaxPositionKobo = lim.MaxPositionKobo
	if lim.MaxPositionFracBps > 0 && st.EquityKobo > 0 {
		caps.MaxByEquityFracKobo = floorKobo(float64(st.EquityKobo) * lim.MaxPositionFracBps.Frac())
	}
	if lim.MaxGrossLeverageBps > 0 && st.EquityKobo > 0 {
		maxGross := floorKobo(float64(st.EquityKobo) * lim.MaxGrossLeverageBps.Frac())
		headroom := maxGross - GrossExposureKobo(st)
		if headroom < 0 {
			headroom = 0
		}
		caps.MaxByLeverageKobo = headroom
	}
	return caps
}

// ReduceBeforeIncrease encodes the "reduce exposure before adding on uncertainty"
// rule (§8 / original Rule 5): when uncertainty is rising, an increase is refused
// — the position may only stay flat or shrink. Returns the permitted notional.
func ReduceBeforeIncrease(currentKobo, proposedKobo int64, uncertaintyRising bool) int64 {
	if proposedKobo < 0 {
		return 0
	}
	if uncertaintyRising && proposedKobo > currentKobo {
		return currentKobo // no adds while uncertainty rises
	}
	return proposedKobo
}

// ── helpers ────────────────────────────────────────────────────────────────
func floorKobo(v float64) int64 {
	if !finite(v) || v <= 0 {
		return 0
	}
	return int64(math.Floor(v))
}
func ceilKobo(v float64) int64 {
	if !finite(v) || v <= 0 {
		return 0
	}
	return int64(math.Ceil(v))
}
func finite(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) }
func clamp01(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}
