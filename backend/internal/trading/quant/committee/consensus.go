package committee

import (
	"fmt"
	"math"
)

// Decide runs the deterministic consensus over a set of (already schema-validated)
// votes for one candidate. Gate order is fail-closed and veto-first:
//
//	1. HARD VETO — any hard-veto agent that vetoes (or whose output is invalid,
//	   fail-closed) kills the trade ABSOLUTELY, regardless of every other vote.
//	2. VOTERS    — there must be at least one valid voting agent (else no trade).
//	3. QUORUM    — weighted approval fraction of voting agents ≥ QuorumBps.
//	4. CONFIDENCE— weighted-mean confidence ≥ MinConfidenceBps.
//	5. SUPERVISOR— if required, a valid Supervisor must authorize.
//
// The first failing gate sets the Outcome; Approved requires every gate to pass.
// The full vote set is recorded in the Decision for explainability (§15).
func Decide(votes []Vote, cfg Config) Decision {
	d := Decision{Deliberation: votes}

	// 1. Hard-veto gate (absolute).
	for _, v := range votes {
		if v.Role != RoleHardVeto {
			continue
		}
		if !v.Valid {
			// A safety/risk agent we can't trust → fail closed (treat as veto).
			d.Vetoes = append(d.Vetoes, v.Agent)
		} else if v.Veto {
			d.Vetoes = append(d.Vetoes, v.Agent)
		}
	}
	if len(d.Vetoes) > 0 {
		d.Outcome, d.Approved = Vetoed, false
		d.Reason = fmt.Sprintf("hard veto by %v — absolute, cannot be overridden", d.Vetoes)
		return d
	}

	// 2/3. Weighted quorum among valid voting agents.
	var wApprove, wTotal, cWeighted, cTotalW int64
	var voters int
	for _, v := range votes {
		if v.Role != RoleVoting || !v.Valid {
			continue
		}
		voters++
		w := cfg.Weights[v.Agent]
		if w <= 0 {
			w = 1
		}
		wTotal += w
		if v.Approve {
			wApprove += w
		}
		cWeighted += w * int64(v.ConfidenceBps)
		cTotalW += w
	}
	if voters == 0 || wTotal == 0 {
		d.Outcome, d.Approved = NoVoters, false
		d.Reason = "no valid voting agents — default safe action (no trade)"
		return d
	}
	d.WeightedApprovalBps = Bps(math.Round(float64(wApprove) / float64(wTotal) * 10_000))
	if cTotalW > 0 {
		d.AggregateConfidenceBps = Bps(cWeighted / cTotalW)
	}
	if cfg.QuorumBps > 0 && d.WeightedApprovalBps < cfg.QuorumBps {
		d.Outcome, d.Approved = NoQuorum, false
		d.Reason = fmt.Sprintf("weighted approval %d bps < quorum %d bps → no trade", d.WeightedApprovalBps, cfg.QuorumBps)
		return d
	}

	// 4. Aggregate confidence.
	if cfg.MinConfidenceBps > 0 && d.AggregateConfidenceBps < cfg.MinConfidenceBps {
		d.Outcome, d.Approved = LowConfidence, false
		d.Reason = fmt.Sprintf("aggregate confidence %d bps < minimum %d bps → no trade", d.AggregateConfidenceBps, cfg.MinConfidenceBps)
		return d
	}

	// 5. Supervisor authorization.
	if cfg.RequireSupervisor {
		authorized := false
		for _, v := range votes {
			if v.Role == RoleSupervisor && v.Valid && v.Authorized {
				authorized = true
				break
			}
		}
		if !authorized {
			d.Outcome, d.Approved = NotAuthorized, false
			d.Reason = "supervisor did not authorize → no trade"
			return d
		}
	}

	d.Outcome, d.Approved = Approved, true
	d.Reason = fmt.Sprintf("approved: %d bps weighted approval, %d bps confidence, no vetoes", d.WeightedApprovalBps, d.AggregateConfidenceBps)
	return d
}
