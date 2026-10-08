package risk

import (
	"fmt"
	"math"
	"slices"
)

// gate.go composes the primitives into the single risk-veto pipeline every
// candidate passes through before it can become an order (§7 RISK validation).
// It is deterministic and fail-closed: the default outcome is NO TRADE. The
// upstream committee can only pick among Approved candidates or reject — it can
// never turn a vetoed candidate into an order.

// Decision is the risk verdict for one candidate.
type Decision struct {
	Approved     bool
	Action       DrawdownAction // the current defensive posture
	SizedKobo    int64          // the final, capped, risk-scaled size (0 if not approved)
	Vetoes       []Breach       // non-empty ⇒ blocked
	CircuitTrips []Breach       // tripped circuit breakers (also block)
}

// ScreenInputs bundle everything the pipeline needs. The caller supplies the
// candidate's RAW proposed notional (from the strategy/sizing layer), and the
// pipeline down-scales it for the drawdown posture + confidence, applies hard
// caps + reduce-before-increase, then runs the limit veto on the FINAL size.
type ScreenInputs struct {
	State               PortfolioState
	Limits              Limits
	Ladder              DrawdownLadderConfig
	Circuit             CircuitInputs
	CircuitConfig       CircuitConfig
	Trade               ProposedTrade // Asset/Side/ConfidenceBps; NotionalKobo = raw proposed size
	Clusters            [][]string
	WithinWindow        bool
	CurrentExposureKobo int64 // this asset's current notional (for reduce-before-increase)
	UncertaintyRising   bool
	ReduceSizeToBps     Bps // size multiplier while in Reduce (0 ⇒ default 50%)
}

// Screen runs the full pipeline. Order of operations is deliberately defensive:
// circuit breakers → drawdown posture → risk-scale the size down → caps →
// reduce-before-increase → hard limit veto. Any veto or trip ⇒ Approved=false,
func Screen(in ScreenInputs) Decision {
	d := Decision{Action: ActNormal}

	// 1. Circuit breakers halt everything in this scope.
	if trips := EvalCircuitBreakers(in.Circuit, in.CircuitConfig); len(trips) > 0 {
		d.CircuitTrips = trips
		return d
	}

	// 2. Drawdown posture. Hedge/Flatten/Halt forbid new risk outright.
	d.Action = DrawdownLadder(CurrentDrawdownBps(in.State), in.Ladder)
	if !AllowsNewRisk(d.Action) {
		d.Vetoes = []Breach{{Code: "DEFENSIVE_MODE", Detail: "drawdown posture forbids new risk: " + string(d.Action)}}
		return d
	}

	// 3. Risk-scale the raw size: drawdown multiplier, then confidence.
	size := in.Trade.NotionalKobo
	if mult := SizeMultiplierBps(d.Action, in.ReduceSizeToBps); mult < 10_000 {
		size = floorKobo(float64(size) * mult.Frac())
	}
	size = ConfidenceScale(size, in.Trade.ConfidenceBps, in.Limits.MinConfidenceBps)

	// 4. Hard caps (per-position, equity-fraction, leverage headroom).
	size = ApplyCaps(size, CapsFromLimits(in.Limits, in.State))

	// 5. Reduce-before-increase: no adds while uncertainty rises.
	size = ReduceBeforeIncrease(in.CurrentExposureKobo, size, in.UncertaintyRising)

	if size <= 0 {
		d.Vetoes = []Breach{{Code: "SIZED_TO_ZERO", Detail: "risk scaling / caps reduced the position to zero"}}
		return d
	}

	// 6. Final hard-limit veto on the FULLY-SIZED trade.
	final := in.Trade
	final.NotionalKobo = size
	vetoes := CheckLimits(in.State, in.Limits, TradeContext{Trade: final, WithinTradingWindow: in.WithinWindow, Clusters: in.Clusters})
	if len(vetoes) > 0 {
		d.Vetoes = vetoes
		return d
	}

	d.Approved = true
	d.SizedKobo = size
	return d
}

// Circuit breakers (§8): trip on abnormal loss rate, abnormal fills/slippage, data
// anomalies, or a volatility spike. A tripped breaker forces defensive mode / halt
// upstream — it is a HARD signal, evaluated deterministically. Breakers exist at
// strategy/asset/venue/global scope; this evaluates one scope's inputs against its
// config and returns every tripped breaker.

// CircuitInputs are the observed conditions for one scope over the recent window.
type CircuitInputs struct {
	ConsecutiveLosses   int  // consecutive losing trades
	RecentLossRateBps   Bps  // fraction of recent trades that lost (bps)
	ObservedSlippageBps Bps  // realized slippage on recent fills
	VolSpikeRatioBps    Bps  // current vol / baseline vol (10000 = 1.0x)
	DataStale           bool // price/feature feed is stale or failed validation
	PriceAnomaly        bool // a bad-print / sanity-check failure was seen
}

// CircuitConfig are the trip thresholds. A zero threshold disables that breaker
// (except the boolean data/price breakers, which always trip when true).
type CircuitConfig struct {
	MaxConsecutiveLosses int
	MaxLossRateBps       Bps
	MaxSlippageBps       Bps
	MaxVolSpikeBps       Bps
}

// EvalCircuitBreakers returns every tripped breaker for the given inputs. A
// non-empty result means new trading in this scope must stop and defensive mode
// engages. Data/price anomalies ALWAYS trip (fail-closed: never trade on suspect
// data, §9).
func EvalCircuitBreakers(in CircuitInputs, cfg CircuitConfig) []Breach {
	var b []Breach
	if in.DataStale {
		b = append(b, Breach{Code: "DATA_STALE", Detail: "market data stale or failed validation"})
	}
	if in.PriceAnomaly {
		b = append(b, Breach{Code: "PRICE_ANOMALY", Detail: "price sanity check failed (bad print / outlier)"})
	}
	if cfg.MaxConsecutiveLosses > 0 && in.ConsecutiveLosses >= cfg.MaxConsecutiveLosses {
		b = append(b, breach("CONSECUTIVE_LOSSES", int64(in.ConsecutiveLosses), int64(cfg.MaxConsecutiveLosses)))
	}
	if cfg.MaxLossRateBps > 0 && in.RecentLossRateBps >= cfg.MaxLossRateBps {
		b = append(b, breach("LOSS_RATE", int64(in.RecentLossRateBps), int64(cfg.MaxLossRateBps)))
	}
	if cfg.MaxSlippageBps > 0 && in.ObservedSlippageBps >= cfg.MaxSlippageBps {
		b = append(b, breach("ABNORMAL_SLIPPAGE", int64(in.ObservedSlippageBps), int64(cfg.MaxSlippageBps)))
	}
	if cfg.MaxVolSpikeBps > 0 && in.VolSpikeRatioBps >= cfg.MaxVolSpikeBps {
		b = append(b, breach("VOL_SPIKE", int64(in.VolSpikeRatioBps), int64(cfg.MaxVolSpikeBps)))
	}
	return b
}

// Tripped reports whether any breaker fired.
func Tripped(breaches []Breach) bool { return len(breaches) > 0 }

// String renders a breach for logs / explanations.
func (b Breach) String() string { return fmt.Sprintf("%s(%s)", b.Code, b.Detail) }

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

// Hard limit checks (§8) — the RISK VETO. CheckLimits returns every breach a
// proposed trade would cause against the fund's limits and current state. A
// NON-EMPTY result is an ABSOLUTE block: it is never a soft warning and cannot be
// overridden by consensus (§5). Fails CLOSED: bad equity or an unknown-risk input
// is itself a breach.

// ProposedTrade is a candidate the sizing layer produced, presented to the veto.
type ProposedTrade struct {
	Asset         string
	Side          Side
	NotionalKobo  int64
	ConfidenceBps Bps
}

// TradeContext carries the non-position inputs the veto needs: the proposed trade,
// whether the current time is inside the allowed trading window (computed by the
// caller so this package stays clock-free), and the correlated-asset clusters the
// correlated-risk guard evaluates.
type TradeContext struct {
	Trade               ProposedTrade
	WithinTradingWindow bool
	Clusters            [][]string // e.g. [][]string{{"BTC","ETH"},{"EURUSD","GBPUSD"}}
}

// CheckLimits returns all violated hard limits for opening tc.Trade on top of st.
// Empty slice == cleared. The proposed trade's notional is included in the
// forward-looking exposure/leverage/position-count checks.
func CheckLimits(st PortfolioState, lim Limits, tc TradeContext) []Breach {
	var b []Breach
	t := tc.Trade

	// Fail-closed preconditions.
	if st.EquityKobo <= 0 {
		return []Breach{{Code: "NO_EQUITY", Detail: "equity is non-positive — trading blocked"}}
	}
	if t.NotionalKobo < 0 {
		b = append(b, Breach{Code: "BAD_SIZE", Detail: "proposed notional is negative"})
	}

	// Realized loss windows (a loss is negative realized P&L).
	if lim.MaxDailyLossKobo > 0 && -st.RealizedTodayKobo >= lim.MaxDailyLossKobo {
		b = append(b, breach("MAX_DAILY_LOSS", -st.RealizedTodayKobo, lim.MaxDailyLossKobo))
	}
	if lim.MaxWeeklyLossKobo > 0 && -st.RealizedWeekKobo >= lim.MaxWeeklyLossKobo {
		b = append(b, breach("MAX_WEEKLY_LOSS", -st.RealizedWeekKobo, lim.MaxWeeklyLossKobo))
	}
	if lim.MaxMonthlyLossKobo > 0 && -st.RealizedMonthKobo >= lim.MaxMonthlyLossKobo {
		b = append(b, breach("MAX_MONTHLY_LOSS", -st.RealizedMonthKobo, lim.MaxMonthlyLossKobo))
	}

	// Drawdown.
	if lim.MaxDrawdownBps > 0 {
		if dd := CurrentDrawdownBps(st); dd >= lim.MaxDrawdownBps {
			b = append(b, breach("MAX_DRAWDOWN", int64(dd), int64(lim.MaxDrawdownBps)))
		}
	}

	// Position count (the new position adds one).
	if lim.MaxOpenPositions > 0 && st.OpenPositionCount+1 > lim.MaxOpenPositions {
		b = append(b, breach("MAX_OPEN_POSITIONS", int64(st.OpenPositionCount+1), int64(lim.MaxOpenPositions)))
	}

	// Single-position caps.
	if lim.MaxPositionKobo > 0 && t.NotionalKobo > lim.MaxPositionKobo {
		b = append(b, breach("MAX_POSITION_SIZE", t.NotionalKobo, lim.MaxPositionKobo))
	}
	if lim.MaxPositionFracBps > 0 {
		capKobo := floorKobo(float64(st.EquityKobo) * lim.MaxPositionFracBps.Frac())
		if t.NotionalKobo > capKobo {
			b = append(b, breach("MAX_POSITION_FRACTION", t.NotionalKobo, capKobo))
		}
	}

	// Forward gross leverage (existing gross + new notional).
	if lim.MaxGrossLeverageBps > 0 {
		fwdGross := GrossExposureKobo(st) + t.NotionalKobo
		fwdLevBps := Bps(ceilKobo(float64(fwdGross) / float64(st.EquityKobo) * 10_000))
		if fwdLevBps > lim.MaxGrossLeverageBps {
			b = append(b, breach("MAX_GROSS_LEVERAGE", int64(fwdLevBps), int64(lim.MaxGrossLeverageBps)))
		}
	}

	// Correlated-cluster exposure (existing cluster exposure + new notional if the
	// asset is in that cluster) vs the correlated-fraction cap.
	if lim.MaxCorrelatedFracBps > 0 {
		capKobo := floorKobo(float64(st.EquityKobo) * lim.MaxCorrelatedFracBps.Frac())
		for _, cluster := range tc.Clusters {
			if !slices.Contains(cluster, t.Asset) {
				continue
			}
			fwd := ClusterExposureKobo(st, cluster) + t.NotionalKobo
			if fwd > capKobo {
				b = append(b, breach("MAX_CORRELATED_EXPOSURE", fwd, capKobo))
				break
			}
		}
	}

	// Minimum confidence.
	if lim.MinConfidenceBps > 0 && t.ConfidenceBps < lim.MinConfidenceBps {
		b = append(b, breach("MIN_CONFIDENCE", int64(t.ConfidenceBps), int64(lim.MinConfidenceBps)))
	}

	// Allowed-asset allowlist (when set).
	if len(lim.AllowedAssets) > 0 && !slices.Contains(lim.AllowedAssets, t.Asset) {
		b = append(b, Breach{Code: "ASSET_NOT_ALLOWED", Detail: fmt.Sprintf("asset %q is not in the allowed set", t.Asset)})
	}

	// Trading window.
	if !tc.WithinTradingWindow {
		b = append(b, Breach{Code: "OUTSIDE_TRADING_HOURS", Detail: "current time is outside the allowed trading window"})
	}

	return b
}

func breach(code string, got, limit int64) Breach {
	return Breach{Code: code, Detail: fmt.Sprintf("%s: %d exceeds limit %d", code, got, limit)}
}
