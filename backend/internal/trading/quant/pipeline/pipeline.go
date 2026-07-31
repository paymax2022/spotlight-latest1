// Package pipeline is the deterministic glue that runs a market snapshot through
// all four pillars of the AI-trading core, in order:
//
//	regime.Classify → signals.GenerateCandidates (regime-gated) → risk.Screen
//	(size + hard-veto) → committee.Decide (weighted quorum + absolute vetoes)
//
// Everything here is pure and deterministic; no LLM and no I/O. It never places an
// order or touches the fund — it returns an APPROVED, sized candidate (or a
// recorded rejection with the full reasoning trail) for the promotion ladder /
// paper execution to consume. Risk and Safety hold absolute vetoes at both the
// risk-screen and the committee stages; the default outcome is NO TRADE.
package pipeline

import (
	"spotlight/backend/internal/trading/quant/committee"
	"spotlight/backend/internal/trading/quant/regime"
	"spotlight/backend/internal/trading/quant/risk"
	"spotlight/backend/internal/trading/quant/signals"
)

// Inputs is one evaluation's full context.
type Inputs struct {
	Asset  string
	Prices []float64
	Returns []float64

	// Regime classification inputs.
	BaselineVolBps    regime.Bps
	LiquidityScoreBps regime.Bps
	RegimeConfig      regime.RegimeConfig

	// Risk state + config.
	State        risk.PortfolioState
	Limits       risk.Limits
	Ladder       risk.DrawdownLadderConfig
	Circuit      risk.CircuitInputs
	CircuitConfig risk.CircuitConfig
	Clusters     [][]string
	WithinWindow bool
	TargetVolBps risk.Bps // vol-target used to produce the raw pre-cap size

	// Committee config.
	Committee committee.Config

	// Strategy catalog (defaults to signals.DefaultCatalog when nil).
	Catalog []signals.Strategy
}

// Order is an APPROVED, sized candidate ready for the promotion ladder.
type Order struct {
	Strategy        string
	Asset           string
	Side            string
	NotionalKobo    int64
	StopDistanceBps int64
	ConfidenceBps   int64
}

// CandidateEval records one candidate's full journey through risk + committee.
type CandidateEval struct {
	Candidate signals.Candidate
	Risk      risk.Decision
	Committee committee.Decision
	Viable    bool
	SizedKobo int64
}

// Result is the pipeline outcome plus the complete reasoning trace (§15).
type Result struct {
	Regime    regime.RegimeState
	Evals     []CandidateEval
	Final     *Order // the chosen approved candidate, or nil for NO TRADE
	Approved  bool
	Reason    string
}

// Evaluate runs the full pipeline and returns the decision + trace.
func Evaluate(in Inputs) Result {
	rs := regime.Classify(regime.RegimeInputs{
		Prices: in.Prices, Returns: in.Returns,
		BaselineVolBps: in.BaselineVolBps, LiquidityScoreBps: in.LiquidityScoreBps,
	}, in.RegimeConfig)
	res := Result{Regime: rs}

	// Gate 1: the regime must permit new risk at all (§6).
	if !rs.Tradeable() {
		res.Reason = "regime not tradeable: " + string(rs.Regime)
		return res
	}

	catalog := in.Catalog
	if catalog == nil {
		catalog = signals.DefaultCatalog()
	}
	candidates := signals.GenerateCandidates(signals.Context{Asset: in.Asset, Prices: in.Prices, Regime: rs}, catalog)
	if len(candidates) == 0 {
		res.Reason = "no candidates generated in regime " + string(rs.Regime)
		return res
	}

	var best *CandidateEval
	for _, c := range candidates {
		ev := screenCandidate(in, rs, c)
		res.Evals = append(res.Evals, ev)
		if ev.Viable && (best == nil || ev.Candidate.ConfidenceBps > best.Candidate.ConfidenceBps) {
			b := ev
			best = &b
		}
	}

	if best == nil {
		res.Reason = "all candidates vetoed or sub-threshold — no trade"
		return res
	}
	res.Approved = true
	res.Final = &Order{
		Strategy: best.Candidate.Strategy, Asset: best.Candidate.Asset, Side: string(best.Candidate.Side),
		NotionalKobo: best.SizedKobo, StopDistanceBps: best.Candidate.StopDistanceBps, ConfidenceBps: best.Candidate.ConfidenceBps,
	}
	res.Reason = "approved by risk + committee"
	return res
}

// screenCandidate sizes one candidate through the risk gate, then runs the
// committee over deterministically-derived votes. A candidate is VIABLE only if
// BOTH the risk screen AND the committee approve (defense in depth).
func screenCandidate(in Inputs, rs regime.RegimeState, c signals.Candidate) CandidateEval {
	rawSize := risk.SizeVolTarget(in.State.EquityKobo, in.TargetVolBps, risk.Bps(rs.RealizedVolBps))
	rd := risk.Screen(risk.ScreenInputs{
		State: in.State, Limits: in.Limits, Ladder: in.Ladder,
		Circuit: in.Circuit, CircuitConfig: in.CircuitConfig,
		Trade:    risk.ProposedTrade{Asset: c.Asset, Side: risk.Side(c.Side), NotionalKobo: rawSize, ConfidenceBps: risk.Bps(c.ConfidenceBps)},
		Clusters: in.Clusters, WithinWindow: in.WithinWindow,
	})

	votes := deterministicVotes(rs, c, rd)
	cd := committee.Decide(votes, in.Committee)

	return CandidateEval{
		Candidate: c, Risk: rd, Committee: cd,
		Viable:    rd.Approved && cd.Approved,
		SizedKobo: rd.SizedKobo,
	}
}

// deterministicVotes maps the deterministic-core outputs into committee votes:
// Risk/Safety hard-vetoes come straight from the risk screen (a risk veto or a
// circuit trip is absolute); the Technical/Regime voting agents derive their
// ballot from the candidate's signal confidence and the regime's efficiency; the
// Supervisor re-checks the risk screen. LLM reasoners will ADD to / replace the
// voting agents later — but the veto and re-check stay deterministic.
func deterministicVotes(rs regime.RegimeState, c signals.Candidate, rd risk.Decision) []committee.Vote {
	riskVeto := !rd.Approved && len(rd.Vetoes) > 0
	safetyVeto := len(rd.CircuitTrips) > 0
	efficiencyBps := int64(rs.EfficiencyRatio * 10_000)

	return []committee.Vote{
		{Agent: "risk", Role: committee.RoleHardVeto, Veto: riskVeto, Valid: true, Rationale: "deterministic risk screen"},
		{Agent: "safety", Role: committee.RoleHardVeto, Veto: safetyVeto, Valid: true, Rationale: "circuit breakers"},
		{Agent: "technical", Role: committee.RoleVoting, Approve: c.ConfidenceBps > 0, ConfidenceBps: committee.Bps(c.ConfidenceBps), Valid: true, Rationale: "signal strength"},
		{Agent: "regime", Role: committee.RoleVoting, Approve: rs.Tradeable(), ConfidenceBps: committee.Bps(clampBps(efficiencyBps)), Valid: true, Rationale: "regime alignment"},
		{Agent: "supervisor", Role: committee.RoleSupervisor, Authorized: rd.Approved, Valid: true, Rationale: "deterministic re-check of the risk screen"},
	}
}

func clampBps(v int64) int64 {
	if v < 0 {
		return 0
	}
	if v > 10_000 {
		return 10_000
	}
	return v
}
