package reasoner

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"spotlight/backend/internal/trading/quant/committee"
)

// The explanation narrator (§15). It turns a committee Decision into a
// human-readable "why" for the audit trail / user disclosure. It is the ONE place
// an LLM writes free prose in this system, and it is safe precisely because its
// output is TERMINAL: it is displayed, never parsed back into any decision. The
// narrator may not invent numbers — it explains only the structured record it is
// given — and on any failure it degrades to a truthful, deterministic summary
// built from that same record (never fabricated).

// ExplanationInput is the structured decision record the narrator explains. It is
// assembled from the committee Decision + surrounding context by the caller.
type ExplanationInput struct {
	Asset       string   `json:"asset"`
	Regime      string   `json:"regime"`
	Outcome     string   `json:"outcome"`   // committee.Outcome (approved / vetoed / no_quorum / …)
	Approved    bool     `json:"approved"`
	Reason      string   `json:"reason"`    // the deterministic one-line reason
	Vetoes      []string `json:"vetoes"`    // agents that vetoed (if any)
	AgentNotes  []string `json:"agent_notes"` // per-agent rationales from the deliberation
}

// FromDecision assembles an ExplanationInput from a committee Decision. Only
// VALID votes' rationales are surfaced (an invalid/abstaining vote carries no
// meaningful note).
func FromDecision(asset, regime string, d committee.Decision) ExplanationInput {
	in := ExplanationInput{
		Asset: asset, Regime: regime,
		Outcome: string(d.Outcome), Approved: d.Approved, Reason: d.Reason, Vetoes: d.Vetoes,
	}
	for _, v := range d.Deliberation {
		if v.Valid && v.Rationale != "" {
			in.AgentNotes = append(in.AgentNotes, string(v.Role)+"/"+v.Agent+": "+v.Rationale)
		}
	}
	return in
}

// Narrator writes the human-readable explanation.
type Narrator struct {
	gen jsonGen
}

// NewNarrator builds a narrator over an llm client. A nil/disabled client makes
// Explain always return the deterministic fallback — which is a first-class,
// truthful output, not an error state.
func NewNarrator(gen jsonGen) *Narrator { return &Narrator{gen: gen} }

// narratorOut is the tiny JSON shape the model returns (JSON so it composes with
// the repo's GenerateJSON contract, which requires valid JSON output).
type narratorOut struct {
	Explanation string `json:"explanation"`
}

// Explain returns a plain-language explanation of the decision. It ALWAYS returns
// a non-empty, truthful string: on any LLM failure (or when disabled) it returns a
// deterministic summary derived solely from the structured record, plus the error
// for logging. The returned text is for display only and must never be fed back
// into a decision.
func (n *Narrator) Explain(ctx context.Context, in ExplanationInput) (string, error) {
	fallback := deterministicSummary(in)
	if n.gen == nil || !n.gen.Enabled() {
		return fallback, nil
	}
	userPrompt, err := json.Marshal(in)
	if err != nil {
		return fallback, err
	}
	raw, err := n.gen.GenerateJSON(ctx, narratorSystemPrompt, string(userPrompt))
	if err != nil {
		return fallback, err
	}
	var out narratorOut
	if err := json.Unmarshal(raw, &out); err != nil {
		return fallback, err
	}
	if strings.TrimSpace(out.Explanation) == "" {
		return fallback, nil
	}
	return strings.TrimSpace(out.Explanation), nil
}

// deterministicSummary is the truthful, no-LLM explanation. It states only what the
// structured record contains.
func deterministicSummary(in ExplanationInput) string {
	var b strings.Builder
	verdict := "NO TRADE"
	if in.Approved {
		verdict = "APPROVED"
	}
	fmt.Fprintf(&b, "%s — %s %s in a %s regime.", verdict, in.Asset, "trade", in.Regime)
	if in.Reason != "" {
		fmt.Fprintf(&b, " Reason: %s.", in.Reason)
	}
	if len(in.Vetoes) > 0 {
		fmt.Fprintf(&b, " Hard vetoes: %s.", strings.Join(in.Vetoes, ", "))
	}
	return b.String()
}

const narratorSystemPrompt = `You explain a trading committee's decision to a human reader for an audit record.
You are given a structured JSON record of the decision. Write a short, plain-language
explanation of WHY the committee reached this outcome.

HARD RULES:
- Return ONLY a single JSON object: {"explanation": "..."}.
- Use ONLY facts present in the provided record. Do NOT invent numbers, prices, sizes, or reasons.
- If the outcome was not "approved", clearly state why the trade was blocked, citing the reason and any vetoes.
- Be concise (2-4 sentences), neutral, and non-promotional. Never imply a guaranteed return.`
