package reasoner

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"spotlight/backend/internal/trading/quant/committee"
)

// fakeGen is a scripted jsonGen for testing without a live model.
type fakeGen struct {
	enabled bool
	out     string
	err     error
}

func (f fakeGen) Enabled() bool { return f.enabled }
func (f fakeGen) GenerateJSON(_ context.Context, _, _ string) (json.RawMessage, error) {
	if f.err != nil {
		return nil, f.err
	}
	return json.RawMessage(f.out), nil
}

func brief() Brief {
	return Brief{Asset: "BTC", Side: "long", Regime: "ranging", SizedKobo: 5_000_000,
		SignalConfidenceBps: 8000, RiskApproved: true, Evidence: []string{"z-score oversold"}}
}

// A well-formed model vote parses into a valid, bounded RawVote.
func TestVote_WellFormed(t *testing.T) {
	r := New(fakeGen{enabled: true, out: `{"approve":true,"confidence_bps":7200,"rationale":"aligned with range"}`},
		"technical", committee.RoleVoting, "Focus on price structure.")
	rv := r.Vote(context.Background(), brief())
	v := committee.Validate(rv)
	if !v.Valid || !v.Approve || v.ConfidenceBps != 7200 || v.Role != committee.RoleVoting {
		t.Fatalf("well-formed vote mishandled: %+v", v)
	}
}

// Out-of-range confidence from the model → the WHOLE vote is discarded (not
// clamped). This is the core safety property: the LLM cannot smuggle a number past
// the deterministic bound.
func TestVote_OutOfRangeDiscarded(t *testing.T) {
	r := New(fakeGen{enabled: true, out: `{"approve":true,"confidence_bps":99999,"rationale":"trust me"}`},
		"technical", committee.RoleVoting, "")
	v := committee.Validate(r.Vote(context.Background(), brief()))
	if v.Valid {
		t.Fatal("out-of-range confidence must invalidate the vote")
	}
	if v.Approve {
		t.Fatal("an invalid vote must not retain approval")
	}
}

// Any LLM failure fails closed by ROLE: a voting agent abstains, a hard-veto agent
// vetoes, a supervisor withholds authorization.
func TestVote_FailClosedByRole(t *testing.T) {
	cases := []struct {
		role      committee.Role
		gen       fakeGen
		wantVeto  bool // for hard-veto: Decide should treat invalid as veto
	}{
		{committee.RoleVoting, fakeGen{enabled: false}, false},                         // disabled
		{committee.RoleHardVeto, fakeGen{enabled: true, err: errors.New("timeout")}, true}, // network error
		{committee.RoleVoting, fakeGen{enabled: true, out: `{"nonsense":`}, false},     // malformed (still valid JSON? no)
		{committee.RoleSupervisor, fakeGen{enabled: true, out: `not json`}, false},
	}
	for _, c := range cases {
		rv := New(c.gen, "agent", c.role, "").Vote(context.Background(), brief())
		v := committee.Validate(rv)
		if v.Valid {
			t.Fatalf("role %s: a failure must produce an invalid vote, got valid %+v", c.role, v)
		}
		if v.Approve || v.Authorized {
			t.Fatalf("role %s: failed vote must not approve/authorize", c.role)
		}
	}
}

// End-to-end: even a compromised LLM that returns "approve everything" cannot force
// a trade — its out-of-range/garbage votes are discarded and the committee's
// deterministic gate (a real risk hard-veto here) blocks regardless.
func TestVote_CompromisedLLMCannotForceTrade(t *testing.T) {
	// The risk agent (deterministic) vetoes; the LLM voting agents all scream approve
	// but with out-of-range confidence, so they're discarded.
	votes := []committee.Vote{
		committee.Validate(committee.RawVote{Agent: "risk", Role: "hard_veto", Veto: true}), // deterministic veto
		committee.Validate(New(fakeGen{enabled: true, out: `{"approve":true,"confidence_bps":100000}`}, "technical", committee.RoleVoting, "").Vote(context.Background(), brief())),
		committee.Validate(New(fakeGen{enabled: true, out: `garbage`}, "macro", committee.RoleVoting, "").Vote(context.Background(), brief())),
		committee.Validate(New(fakeGen{enabled: true, out: `{"approve":true,"confidence_bps":9999}`}, "supervisor", committee.RoleSupervisor, "").Vote(context.Background(), brief())),
	}
	d := committee.Decide(votes, committee.Config{QuorumBps: 5000, MinConfidenceBps: 1, RequireSupervisor: true})
	if d.Approved || d.Outcome != committee.Vetoed {
		t.Fatalf("a deterministic veto must hold against an approve-everything LLM, got %+v", d)
	}
}

func TestNarrator_UsesModelOutput(t *testing.T) {
	n := NewNarrator(fakeGen{enabled: true, out: `{"explanation":"Approved: strong range-reversion signal, no vetoes."}`})
	in := ExplanationInput{Asset: "BTC", Regime: "ranging", Approved: true, Outcome: "approved", Reason: "approved by risk + committee"}
	got, err := n.Explain(context.Background(), in)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(got, "range-reversion") {
		t.Fatalf("narrator should return the model explanation, got %q", got)
	}
}

// On any LLM failure the narrator returns a TRUTHFUL deterministic summary built
// only from the record — never empty, never fabricated.
func TestNarrator_FailClosedToDeterministic(t *testing.T) {
	in := ExplanationInput{Asset: "BTC", Regime: "crisis", Approved: false, Outcome: "vetoed",
		Reason: "hard veto by [safety]", Vetoes: []string{"safety"}}
	for _, g := range []fakeGen{
		{enabled: false},
		{enabled: true, err: errors.New("boom")},
		{enabled: true, out: `{"explanation":""}`}, // empty model output
	} {
		got, _ := NewNarrator(g).Explain(context.Background(), in)
		if strings.TrimSpace(got) == "" {
			t.Fatal("narrator must never return empty")
		}
		if !strings.Contains(got, "NO TRADE") || !strings.Contains(got, "safety") {
			t.Fatalf("deterministic fallback must state the truthful outcome, got %q", got)
		}
	}
}

// FromDecision surfaces only VALID votes' rationales into the explanation input.
func TestFromDecision_OnlyValidNotes(t *testing.T) {
	d := committee.Decision{
		Outcome: committee.Approved, Approved: true, Reason: "ok",
		Deliberation: []committee.Vote{
			{Agent: "technical", Role: committee.RoleVoting, Valid: true, Rationale: "good"},
			{Agent: "macro", Role: committee.RoleVoting, Valid: false, Rationale: "should be hidden"},
		},
	}
	in := FromDecision("BTC", "ranging", d)
	if len(in.AgentNotes) != 1 || !strings.Contains(in.AgentNotes[0], "good") {
		t.Fatalf("only valid-vote notes should surface, got %v", in.AgentNotes)
	}
}
