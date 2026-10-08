package committee

import (
	"fmt"
	"math"
)

// Decide runs the deterministic consensus over a set of (already schema-validated)
// votes for one candidate. Gate order is fail-closed and veto-first:
//  1. HARD VETO — any hard-veto agent that vetoes (or whose output is invalid,
//     fail-closed) kills the trade ABSOLUTELY, regardless of every other vote.
//  2. VOTERS    — there must be at least one valid voting agent (else no trade).
//  3. QUORUM    — weighted approval fraction of voting agents ≥ QuorumBps.
//  4. CONFIDENCE— weighted-mean confidence ≥ MinConfidenceBps.
//  5. SUPERVISOR— if required, a valid Supervisor must authorize.
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

// The schema boundary (§4.3). LLM agents emit free-form text; before any of it
// reaches the deterministic Decide, it is parsed into a typed Vote and VALIDATED:
// scores/confidence bounded to [0,10000], a known role required, and — crucially —
// an invalid vote is marked Valid=false so it can NEVER count as an approval. A
// malformed or out-of-range output collapses to the safe default (do nothing),
// exactly as an unavailable agent would.

// RawVote is the untyped shape an agent (LLM or adapter) produces. Fields may be
// out of range or nonsensical — Validate is what makes it safe.
type RawVote struct {
	Agent         string
	Role          string
	Approve       bool
	Veto          bool
	ScoreBps      int64
	ConfidenceBps int64
	Authorized    bool
	Rationale     string
}

// knownRole maps a raw role string to a Role, ok=false if unrecognized.
func knownRole(s string) (Role, bool) {
	switch Role(s) {
	case RoleAdvisory, RoleVoting, RoleHardVeto, RoleSupervisor:
		return Role(s), true
	default:
		return "", false
	}
}

// Validate turns a RawVote into a bounded, typed Vote. It sets Valid=false and
// STRIPS any approval/authorization when the input is malformed or out of range,
// so a bad agent output degrades to a non-approving abstention (fail-closed). A
// hard-veto agent's invalid output is left Valid=false, which Decide treats as a
// fail-closed veto.
func Validate(r RawVote) Vote {
	v := Vote{
		Agent: r.Agent, Approve: r.Approve, Veto: r.Veto, Authorized: r.Authorized,
		Rationale: r.Rationale, Valid: true,
	}
	if r.Agent == "" {
		v.Valid = false
	}
	role, ok := knownRole(r.Role)
	if !ok {
		v.Valid = false
	} else {
		v.Role = role
	}
	// Bounds: scores/confidence must be within [0,10000]. Out of range ⇒ invalid.
	if r.ScoreBps < 0 || r.ScoreBps > 10_000 || r.ConfidenceBps < 0 || r.ConfidenceBps > 10_000 {
		v.Valid = false
	} else {
		v.ScoreBps = Bps(r.ScoreBps)
		v.ConfidenceBps = Bps(r.ConfidenceBps)
	}
	// An invalid vote can never approve or authorize.
	if !v.Valid {
		v.Approve = false
		v.Authorized = false
		v.ScoreBps = 0
		v.ConfidenceBps = 0
	}
	return v
}

// ValidateAll validates a batch of raw agent outputs.
func ValidateAll(raws []RawVote) []Vote {
	out := make([]Vote, 0, len(raws))
	for _, r := range raws {
		out = append(out, Validate(r))
	}
	return out
}

// Bps is a rate in basis points.
type Bps int64

func (b Bps) Frac() float64 { return float64(b) / 10_000.0 }

// Role fixes an agent's AUTHORITY (§5). Only these three levels exist.
type Role string

const (
	// RoleAdvisory — Advisory agents inform but do not vote (e.g. Market Intelligence, Regime).
	RoleAdvisory Role = "advisory"
	// RoleVoting — Voting agents cast a weighted approve/reject (Technical, Macro, Sentiment…).
	RoleVoting Role = "voting"
	// RoleHardVeto — HardVeto agents hold an absolute kill switch (Risk, Portfolio, Safety).
	RoleHardVeto Role = "hard_veto"
	// RoleSupervisor — Supervisor authorizes a cleared candidate; it cannot override a veto.
	RoleSupervisor Role = "supervisor"
)

// Vote is one agent's contribution over a single candidate. Produced by an agent
// (deterministic or LLM-behind-schema) and VALIDATED before it reaches Decide.
type Vote struct {
	Agent string
	Role  Role
	// Approve is the voting agent's ballot (ignored for advisory agents).
	Approve bool
	// Veto, set by a HardVeto agent, is absolute.
	Veto bool
	// ScoreBps is the agent's directional/quality score 0..10000 (bounded).
	ScoreBps Bps
	// ConfidenceBps is the agent's own confidence 0..10000 (bounded).
	ConfidenceBps Bps
	// Authorized is the Supervisor's sign-off (ignored for other roles).
	Authorized bool
	// Rationale is the human-readable evidence, for the deliberation record (§15).
	Rationale string
	// Valid is false when the agent's raw output failed schema validation; an
	// invalid vote never counts as an approval (fail-closed).
	Valid bool
}

// Config parameterizes the decision. Weights are per-agent voting weights (a
// missing agent defaults to weight 1). All fail-closed.
type Config struct {
	Weights           map[string]int64 // voting weight per agent name (default 1)
	QuorumBps         Bps              // required weighted-approval fraction (e.g. 6000 = 60%)
	MinConfidenceBps  Bps              // user's minimum aggregate confidence to trade
	RequireSupervisor bool             // whether a Supervisor authorization is required
}

// Outcome is the terminal decision.
type Outcome string

const (
	Approved      Outcome = "approved"
	Vetoed        Outcome = "vetoed"    // a hard veto fired
	NoQuorum      Outcome = "no_quorum" // votes below the quorum threshold
	LowConfidence Outcome = "low_confidence"
	NotAuthorized Outcome = "not_authorized" // supervisor did not authorize
	NoVoters      Outcome = "no_voters"      // no valid voting agents → safe default
)

// Decision is the committee verdict plus the full, auditable deliberation.
type Decision struct {
	Outcome                Outcome
	Approved               bool
	Vetoes                 []string // agents that vetoed (with reasons in the record)
	WeightedApprovalBps    Bps      // achieved weighted approval fraction
	AggregateConfidenceBps Bps
	Deliberation           []Vote // every vote as considered (for §15 explainability)
	Reason                 string
}
