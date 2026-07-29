package risk

// gate.go composes the primitives into the single risk-veto pipeline every
// candidate passes through before it can become an order (§7 RISK validation).
// It is deterministic and fail-closed: the default outcome is NO TRADE. The
// upstream committee can only pick among Approved candidates or reject — it can
// never turn a vetoed candidate into an order.

// Decision is the risk verdict for one candidate.
type Decision struct {
	Approved      bool
	Action        DrawdownAction // the current defensive posture
	SizedKobo     int64          // the final, capped, risk-scaled size (0 if not approved)
	Vetoes        []Breach       // non-empty ⇒ blocked
	CircuitTrips  []Breach       // tripped circuit breakers (also block)
}

// ScreenInputs bundle everything the pipeline needs. The caller supplies the
// candidate's RAW proposed notional (from the strategy/sizing layer), and the
// pipeline down-scales it for the drawdown posture + confidence, applies hard
// caps + reduce-before-increase, then runs the limit veto on the FINAL size.
type ScreenInputs struct {
	State           PortfolioState
	Limits          Limits
	Ladder          DrawdownLadderConfig
	Circuit         CircuitInputs
	CircuitConfig   CircuitConfig
	Trade           ProposedTrade // Asset/Side/ConfidenceBps; NotionalKobo = raw proposed size
	Clusters        [][]string
	WithinWindow    bool
	CurrentExposureKobo int64 // this asset's current notional (for reduce-before-increase)
	UncertaintyRising   bool
	ReduceSizeToBps     Bps   // size multiplier while in Reduce (0 ⇒ default 50%)
}

// Screen runs the full pipeline. Order of operations is deliberately defensive:
// circuit breakers → drawdown posture → risk-scale the size down → caps →
// reduce-before-increase → hard limit veto. Any veto or trip ⇒ Approved=false,
// SizedKobo=0.
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
