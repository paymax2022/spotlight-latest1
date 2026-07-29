package validate

import "fmt"

// The promotion gate (§11/§12): a strategy is promoted toward capital ONLY if it
// clears every predefined threshold on OUT-OF-SAMPLE, cost-inclusive, multiple-
// testing-corrected, robustness-tested metrics. Thresholds MUST be set before
// testing (not fitted afterward). The default posture is REJECT.

// PromotionThresholds are the bars, fixed before validation. A zero on a numeric
// bar means "not required".
type PromotionThresholds struct {
	MinDeflatedSharpe   float64 // e.g. 0.95 — the DSR must clear this (multiple-testing corrected)
	MinOOSSharpeBps     int64   // out-of-sample annualized Sharpe floor (bps, 12000 = 1.2)
	MaxDrawdownBps      int64   // OOS max drawdown ceiling
	MinProfitFactorBps  int64   // e.g. 12500 = 1.25
	MinTrades           int     // a minimum sample so the stats mean something
	RequirePositiveMCP5 bool    // the Monte-Carlo 5th-percentile return must be > 0
}

// EvaluationInputs are the measured, out-of-sample results fed to the gate.
type EvaluationInputs struct {
	DeflatedSharpe float64
	OOSSharpeBps   int64
	MaxDrawdownBps int64
	ProfitFactorBps int64
	NumTrades      int
	MonteCarloReturnP5 float64
}

// Verdict is the gate decision plus the reasons for any rejection (for the audit
// trail — a rejection is as important to record as a pass).
type Verdict struct {
	Pass    bool
	Reasons []string
}

// Evaluate applies the thresholds. It returns Pass only if EVERY required bar is
// cleared; otherwise it lists exactly which bars failed. Fail-closed: missing/
// zeroed inputs against a required bar are failures.
func Evaluate(in EvaluationInputs, thr PromotionThresholds) Verdict {
	var reasons []string

	if thr.MinDeflatedSharpe > 0 && in.DeflatedSharpe < thr.MinDeflatedSharpe {
		reasons = append(reasons, fmt.Sprintf("deflated Sharpe %.3f < %.3f (likely overfit / multiple-testing noise)", in.DeflatedSharpe, thr.MinDeflatedSharpe))
	}
	if thr.MinOOSSharpeBps > 0 && in.OOSSharpeBps < thr.MinOOSSharpeBps {
		reasons = append(reasons, fmt.Sprintf("OOS Sharpe %d < %d bps", in.OOSSharpeBps, thr.MinOOSSharpeBps))
	}
	if thr.MaxDrawdownBps > 0 && in.MaxDrawdownBps > thr.MaxDrawdownBps {
		reasons = append(reasons, fmt.Sprintf("OOS max drawdown %d > %d bps", in.MaxDrawdownBps, thr.MaxDrawdownBps))
	}
	if thr.MinProfitFactorBps > 0 && in.ProfitFactorBps < thr.MinProfitFactorBps {
		reasons = append(reasons, fmt.Sprintf("profit factor %d < %d bps", in.ProfitFactorBps, thr.MinProfitFactorBps))
	}
	if thr.MinTrades > 0 && in.NumTrades < thr.MinTrades {
		reasons = append(reasons, fmt.Sprintf("only %d trades < %d required (insufficient sample)", in.NumTrades, thr.MinTrades))
	}
	if thr.RequirePositiveMCP5 && in.MonteCarloReturnP5 <= 0 {
		reasons = append(reasons, fmt.Sprintf("Monte-Carlo 5th-pctile return %.4f <= 0 (fragile to trade ordering/resampling)", in.MonteCarloReturnP5))
	}

	return Verdict{Pass: len(reasons) == 0, Reasons: reasons}
}
