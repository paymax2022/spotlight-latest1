// Package reasoner is the LLM layer of the investment committee (§5/§4.2) — and it
// is deliberately the LEAST-privileged part of the whole system. An LLM reasoner
// does exactly one thing: read a candidate the deterministic core already SIZED and
// RISK-SCREENED, and emit a bounded vote (approve/veto + a 0..10000 confidence +
// a rationale). It CANNOT emit an order, a size, a price, or a risk number, and its
// output never reaches money directly — every vote flows through the deterministic
// committee.Validate → committee.Decide, which bounds it, can discard it, and
// enforces absolute hard vetoes regardless of what any LLM says (§4.3).
//
// Fail-closed by construction: on ANY failure (no API key, network error, malformed
// or out-of-range output) the reasoner emits an intentionally-INVALID RawVote.
// committee.Validate then marks it Valid=false, and committee.Decide routes that
// safely on its own — a voting agent abstains, a hard-veto agent VETOES, a
// supervisor withholds authorization. No fabricated content is ever produced.
package reasoner

import (
	"context"
	"encoding/json"
	"fmt"

	"spotlight/backend/internal/trading/quant/committee"
)

// jsonGen is the minimal LLM capability this package needs — satisfied by
// *llm.Client (integrations/llm). Abstracted so the reasoner is testable without a
// live model and stays decoupled from the transport.
type jsonGen interface {
	GenerateJSON(ctx context.Context, systemPrompt, userPrompt string) (json.RawMessage, error)
	Enabled() bool
}

// Brief is the STRUCTURED, deterministic-core view an agent votes on. It is built
// from regime/signals/risk outputs — never from raw market data the LLM could
// re-interpret into a number. Notably it carries the ALREADY-DECIDED size and the
// risk verdict; the agent's job is judgement over evidence, not computation.
type Brief struct {
	Asset          string   `json:"asset"`
	Side           string   `json:"side"`
	Regime         string   `json:"regime"`
	SizedKobo      int64    `json:"sized_kobo"`       // decided by the risk engine, shown for context only
	StopDistanceBps int64   `json:"stop_distance_bps"`
	SignalConfidenceBps int64 `json:"signal_confidence_bps"`
	RiskApproved   bool     `json:"risk_approved"`
	RiskVetoes     []string `json:"risk_vetoes"`
	Evidence       []string `json:"evidence"` // the candidate's rationale lines
}

// Reasoner produces one agent's vote over a Brief. Implementations must be
// fail-closed: they never return an error that would block the pipeline — a
// failure is expressed as an invalid RawVote (which the committee handles).
type Reasoner interface {
	Vote(ctx context.Context, b Brief) committee.RawVote
}

// LLMReasoner is an agent backed by a language model. It carries its committee
// ROLE so that a failure fails closed in the role-appropriate direction (a
// hard-veto agent that can't be reached becomes a veto, not an approval).
type LLMReasoner struct {
	gen   jsonGen
	name  string
	role  committee.Role
	brief string // extra role-specific guidance appended to the system prompt
}

// New builds an LLM-backed reasoner. The caller supplies an *llm.Client already
// configured with an API key + model (this package is model-agnostic). name and
// role must match how the committee expects this agent.
func New(gen jsonGen, name string, role committee.Role, roleGuidance string) *LLMReasoner {
	return &LLMReasoner{gen: gen, name: name, role: role, brief: roleGuidance}
}

// llmVote is the constrained JSON shape the model is told to return. Deliberately
// tiny: a ballot, a bounded confidence, an optional veto flag, and prose. No size,
// price, quantity, or asset field exists — the model cannot express one.
type llmVote struct {
	Approve       bool   `json:"approve"`
	Veto          bool   `json:"veto"`
	ConfidenceBps int64  `json:"confidence_bps"`
	Rationale     string `json:"rationale"`
}

// Vote asks the model for a ballot on the brief and returns a RawVote for the
// committee. Any failure yields an INVALID RawVote (ScoreBps = -1), which
// committee.Validate rejects and committee.Decide fails closed by role.
func (r *LLMReasoner) Vote(ctx context.Context, b Brief) committee.RawVote {
	if r.gen == nil || !r.gen.Enabled() {
		return r.failClosed("llm not configured")
	}
	userPrompt, err := json.Marshal(b)
	if err != nil {
		return r.failClosed("marshal brief")
	}
	raw, err := r.gen.GenerateJSON(ctx, r.systemPrompt(), string(userPrompt))
	if err != nil {
		return r.failClosed("llm error: " + err.Error())
	}
	var v llmVote
	if err := json.Unmarshal(raw, &v); err != nil {
		return r.failClosed("unparseable vote")
	}
	// Hand the model's numbers to committee.Validate UNCHANGED — out-of-range
	// values are rejected there, not clamped here, so a model that returns 99999
	// confidence has its whole vote discarded rather than silently trusted.
	return committee.RawVote{
		Agent:         r.name,
		Role:          string(r.role),
		Approve:       v.Approve,
		Veto:          v.Veto,
		Authorized:    v.Approve && r.role == committee.RoleSupervisor,
		ConfidenceBps: v.ConfidenceBps,
		ScoreBps:      v.ConfidenceBps, // the model expresses one bounded number
		Rationale:     v.Rationale,
	}
}

// failClosed emits a vote guaranteed to be rejected by committee.Validate
// (ScoreBps = -1 is out of [0,10000]). The role is preserved so Decide routes the
// rejection correctly: voting → abstain, hard-veto → veto, supervisor → withhold.
func (r *LLMReasoner) failClosed(reason string) committee.RawVote {
	return committee.RawVote{
		Agent:     r.name,
		Role:      string(r.role),
		ScoreBps:  -1,
		Rationale: "fail-closed: " + reason,
	}
}

func (r *LLMReasoner) systemPrompt() string {
	return fmt.Sprintf(`You are the %q agent on an automated trading committee. You are given a
candidate trade that has ALREADY been sized and risk-screened by a deterministic
engine. Your ONLY job is to judge the evidence and cast a bounded vote.

HARD RULES:
- Return ONLY a single JSON object, nothing else.
- Schema: {"approve": bool, "veto": bool, "confidence_bps": integer 0-10000, "rationale": string}.
- You may NOT propose or change a size, price, quantity, or stop — those are fixed. Do not mention numbers you were not given.
- confidence_bps MUST be an integer in [0,10000]. Any value outside that range causes your ENTIRE vote to be discarded.
- If you are unsure or the evidence is weak, vote approve=false with low confidence. When in doubt, do not approve.
- %s

Base your vote strictly on the provided structured brief.`, r.name, r.brief)
}
