// Package committee is the DETERMINISTIC consensus mechanism of the investment
// committee (§5). The LLM reasoning agents only PRODUCE votes/scores; this package
// decides. Nothing here calls an LLM, and no vote can emit an order, size, price,
// or risk number — a vote is a bounded score + an approve/veto flag over a
// candidate the deterministic core already sized and risk-screened.
//
// Iron rules encoded here:
//   - A HARD VETO (Risk, Portfolio-breach, Safety) is ABSOLUTE — it kills the
//     trade regardless of every other vote. Consensus cannot override a veto.
//   - A candidate proceeds only if it clears the veto gate AND a weighted quorum
//     of voting agents approves AND aggregate confidence ≥ the user minimum AND
//     the Supervisor authorizes. Anything less → NO TRADE (the safe default).
//   - Malformed / out-of-range agent output is rejected at the schema boundary and
//     treated as a non-approving abstention — never as an approval.
//   - The entire deliberation is recorded for explainability (§15).
package committee

// Bps is a rate in basis points.
type Bps int64

func (b Bps) Frac() float64 { return float64(b) / 10_000.0 }

// Role fixes an agent's AUTHORITY (§5). Only these three levels exist.
type Role string

const (
	// Advisory agents inform but do not vote (e.g. Market Intelligence, Regime).
	RoleAdvisory Role = "advisory"
	// Voting agents cast a weighted approve/reject (Technical, Macro, Sentiment…).
	RoleVoting Role = "voting"
	// HardVeto agents hold an absolute kill switch (Risk, Portfolio, Safety).
	RoleHardVeto Role = "hard_veto"
	// Supervisor authorizes a cleared candidate; it cannot override a veto.
	RoleSupervisor Role = "supervisor"
)

// Vote is one agent's contribution over a single candidate. Produced by an agent
// (deterministic or LLM-behind-schema) and VALIDATED before it reaches Decide.
type Vote struct {
	Agent         string
	Role          Role
	// Approve is the voting agent's ballot (ignored for advisory agents).
	Approve       bool
	// Veto, set by a HardVeto agent, is absolute.
	Veto          bool
	// ScoreBps is the agent's directional/quality score 0..10000 (bounded).
	ScoreBps      Bps
	// ConfidenceBps is the agent's own confidence 0..10000 (bounded).
	ConfidenceBps Bps
	// Authorized is the Supervisor's sign-off (ignored for other roles).
	Authorized    bool
	// Rationale is the human-readable evidence, for the deliberation record (§15).
	Rationale     string
	// Valid is false when the agent's raw output failed schema validation; an
	// invalid vote never counts as an approval (fail-closed).
	Valid         bool
}

// Config parameterizes the decision. Weights are per-agent voting weights (a
// missing agent defaults to weight 1). All fail-closed.
type Config struct {
	Weights          map[string]int64 // voting weight per agent name (default 1)
	QuorumBps        Bps              // required weighted-approval fraction (e.g. 6000 = 60%)
	MinConfidenceBps Bps              // user's minimum aggregate confidence to trade
	RequireSupervisor bool            // whether a Supervisor authorization is required
}

// Outcome is the terminal decision.
type Outcome string

const (
	Approved   Outcome = "approved"
	Vetoed     Outcome = "vetoed"      // a hard veto fired
	NoQuorum   Outcome = "no_quorum"   // votes below the quorum threshold
	LowConfidence Outcome = "low_confidence"
	NotAuthorized Outcome = "not_authorized" // supervisor did not authorize
	NoVoters   Outcome = "no_voters"   // no valid voting agents → safe default
)

// Decision is the committee verdict plus the full, auditable deliberation.
type Decision struct {
	Outcome         Outcome
	Approved        bool
	Vetoes          []string // agents that vetoed (with reasons in the record)
	WeightedApprovalBps Bps  // achieved weighted approval fraction
	AggregateConfidenceBps Bps
	Deliberation    []Vote   // every vote as considered (for §15 explainability)
	Reason          string
}
