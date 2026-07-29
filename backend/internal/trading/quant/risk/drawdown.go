package risk

import "math"

// Drawdown ladder (§8): staged de-risking as the peak-to-trough drawdown deepens —
// reduce size, then hedge, then flatten, then halt. Pure and monotonic: a deeper
// drawdown never returns a less-defensive action.

// DrawdownLadderConfig is the ascending set of drawdown thresholds (bps of peak
// equity) at which each defensive stage engages. They must be non-decreasing;
// a zero threshold disables that rung.
type DrawdownLadderConfig struct {
	ReduceAtBps Bps
	HedgeAtBps  Bps
	FlatAtBps   Bps
	HaltAtBps   Bps
}

// CurrentDrawdownBps is (peak − equity)/peak in bps (0 when at/above peak). A
// non-positive peak fails closed to the max drawdown (10000 bps = 100%).
func CurrentDrawdownBps(st PortfolioState) Bps {
	if st.PeakEquityKobo <= 0 {
		return 10_000
	}
	if st.EquityKobo >= st.PeakEquityKobo {
		return 0
	}
	dd := float64(st.PeakEquityKobo-st.EquityKobo) / float64(st.PeakEquityKobo) * 10_000
	return Bps(math.Ceil(dd)) // round the drawdown UP (more defensive)
}

// DrawdownLadder maps the current drawdown to a defensive action. The deepest
// engaged rung wins. Thresholds that are 0 are skipped.
func DrawdownLadder(ddBps Bps, cfg DrawdownLadderConfig) DrawdownAction {
	switch {
	case cfg.HaltAtBps > 0 && ddBps >= cfg.HaltAtBps:
		return ActHalt
	case cfg.FlatAtBps > 0 && ddBps >= cfg.FlatAtBps:
		return ActFlat
	case cfg.HedgeAtBps > 0 && ddBps >= cfg.HedgeAtBps:
		return ActHedge
	case cfg.ReduceAtBps > 0 && ddBps >= cfg.ReduceAtBps:
		return ActReduce
	default:
		return ActNormal
	}
}

// AllowsNewRisk reports whether a defensive action still permits opening new
// directional risk. Only Normal and Reduce do; Hedge/Flatten/Halt do not.
func AllowsNewRisk(a DrawdownAction) bool {
	return a == ActNormal || a == ActReduce
}

// SizeMultiplierBps returns the fraction (bps) of a normally-sized position that
// the current defensive action permits: full at Normal, trimmed at Reduce, none
// otherwise. Used to scale sizing down in a drawdown without a separate branch.
func SizeMultiplierBps(a DrawdownAction, reduceToBps Bps) Bps {
	switch a {
	case ActNormal:
		return 10_000
	case ActReduce:
		if reduceToBps <= 0 || reduceToBps > 10_000 {
			return 5_000 // default: half size while reducing
		}
		return reduceToBps
	default:
		return 0 // hedge / flatten / halt: no new size
	}
}
