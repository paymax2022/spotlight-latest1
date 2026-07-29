package committee

import "testing"

func cfg() Config {
	return Config{
		Weights:           map[string]int64{"technical": 2, "macro": 1, "sentiment": 1},
		QuorumBps:         6000, MinConfidenceBps: 6000, RequireSupervisor: true,
	}
}

// A full, clean approval: quorum met, confidence high, supervisor authorizes, no veto.
func cleanVotes() []Vote {
	return []Vote{
		{Agent: "risk", Role: RoleHardVeto, Veto: false, Valid: true},
		{Agent: "portfolio", Role: RoleHardVeto, Veto: false, Valid: true},
		{Agent: "safety", Role: RoleHardVeto, Veto: false, Valid: true},
		{Agent: "technical", Role: RoleVoting, Approve: true, ConfidenceBps: 8000, Valid: true},
		{Agent: "macro", Role: RoleVoting, Approve: true, ConfidenceBps: 7000, Valid: true},
		{Agent: "sentiment", Role: RoleVoting, Approve: false, ConfidenceBps: 6000, Valid: true},
		{Agent: "supervisor", Role: RoleSupervisor, Authorized: true, Valid: true},
	}
}

func TestDecide_CleanApproval(t *testing.T) {
	d := Decide(cleanVotes(), cfg())
	if !d.Approved || d.Outcome != Approved {
		t.Fatalf("clean candidate should be approved, got %+v", d)
	}
	// technical(2)+macro(1) approve of 4 total weight = 75% ≥ 60% quorum.
	if d.WeightedApprovalBps != 7500 {
		t.Fatalf("weighted approval = %d, want 7500", d.WeightedApprovalBps)
	}
	if len(d.Deliberation) != 7 {
		t.Fatal("full deliberation must be recorded")
	}
}

func TestDecide_VetoIsAbsolute(t *testing.T) {
	// Everyone approves, supervisor authorizes — but Safety vetoes → killed.
	v := cleanVotes()
	for i := range v {
		if v[i].Role == RoleVoting {
			v[i].Approve = true
			v[i].ConfidenceBps = 10000
		}
		if v[i].Agent == "safety" {
			v[i].Veto = true
		}
	}
	d := Decide(v, cfg())
	if d.Approved || d.Outcome != Vetoed {
		t.Fatalf("a hard veto must kill the trade regardless of unanimous approval, got %+v", d)
	}
	if len(d.Vetoes) != 1 || d.Vetoes[0] != "safety" {
		t.Fatalf("veto attribution wrong: %v", d.Vetoes)
	}
}

func TestDecide_InvalidVetoAgentFailsClosed(t *testing.T) {
	// The Risk agent's output is invalid — we can't confirm safety → fail closed.
	v := cleanVotes()
	for i := range v {
		if v[i].Agent == "risk" {
			v[i].Valid = false
		}
	}
	d := Decide(v, cfg())
	if d.Approved || d.Outcome != Vetoed {
		t.Fatalf("an invalid hard-veto agent must fail closed to a veto, got %+v", d)
	}
}

func TestDecide_Quorum(t *testing.T) {
	// Only sentiment(1) approves of 4 weight = 25% < 60% → no quorum.
	v := cleanVotes()
	for i := range v {
		if v[i].Role == RoleVoting {
			v[i].Approve = v[i].Agent == "sentiment"
		}
	}
	if d := Decide(v, cfg()); d.Approved || d.Outcome != NoQuorum {
		t.Fatalf("below-quorum must not trade, got %+v", d)
	}
}

func TestDecide_ConfidenceFloor(t *testing.T) {
	// Quorum met but everyone's confidence is low → LowConfidence.
	v := cleanVotes()
	for i := range v {
		if v[i].Role == RoleVoting {
			v[i].Approve = true
			v[i].ConfidenceBps = 4000
		}
	}
	if d := Decide(v, cfg()); d.Approved || d.Outcome != LowConfidence {
		t.Fatalf("below-min-confidence must not trade, got %+v", d)
	}
}

func TestDecide_SupervisorRequired(t *testing.T) {
	v := cleanVotes()
	for i := range v {
		if v[i].Role == RoleSupervisor {
			v[i].Authorized = false
		}
	}
	if d := Decide(v, cfg()); d.Approved || d.Outcome != NotAuthorized {
		t.Fatalf("no supervisor authorization must not trade, got %+v", d)
	}
}

func TestDecide_NoValidVoters(t *testing.T) {
	votes := []Vote{{Agent: "risk", Role: RoleHardVeto, Valid: true}} // no voting agents
	if d := Decide(votes, cfg()); d.Approved || d.Outcome != NoVoters {
		t.Fatalf("no voters → safe default (no trade), got %+v", d)
	}
}

func TestValidate_FailClosed(t *testing.T) {
	// Out-of-range score → invalid, and approval is STRIPPED (can't count as approve).
	v := Validate(RawVote{Agent: "x", Role: "voting", Approve: true, ScoreBps: 99999, ConfidenceBps: 8000})
	if v.Valid {
		t.Fatal("out-of-range score must be invalid")
	}
	if v.Approve {
		t.Fatal("an invalid vote must not retain its Approve flag")
	}
	// Unknown role → invalid.
	if Validate(RawVote{Agent: "x", Role: "dictator", ScoreBps: 5000}).Valid {
		t.Fatal("unknown role must be invalid")
	}
	// Empty agent → invalid.
	if Validate(RawVote{Role: "voting", ScoreBps: 5000}).Valid {
		t.Fatal("empty agent must be invalid")
	}
	// A well-formed vote is valid and preserved.
	ok := Validate(RawVote{Agent: "macro", Role: "voting", Approve: true, ScoreBps: 7000, ConfidenceBps: 8000})
	if !ok.Valid || !ok.Approve || ok.ConfidenceBps != 8000 || ok.Role != RoleVoting {
		t.Fatalf("well-formed vote mishandled: %+v", ok)
	}
}

// End-to-end: malformed LLM output flows through Validate → Decide as a
// non-approving abstention, never sneaking an approval past the quorum.
func TestValidateThenDecide_MalformedAbstains(t *testing.T) {
	raws := []RawVote{
		{Agent: "risk", Role: "hard_veto", Veto: false, ScoreBps: 0, ConfidenceBps: 0},
		{Agent: "safety", Role: "hard_veto", Veto: false, ScoreBps: 0, ConfidenceBps: 0},
		{Agent: "technical", Role: "voting", Approve: true, ScoreBps: 15000, ConfidenceBps: 9000}, // out of range → abstains
		{Agent: "macro", Role: "voting", Approve: true, ScoreBps: 7000, ConfidenceBps: 8000},
		{Agent: "sentiment", Role: "voting", Approve: false, ScoreBps: 5000, ConfidenceBps: 6000},
		{Agent: "supervisor", Role: "supervisor", Authorized: true, ScoreBps: 0, ConfidenceBps: 0},
	}
	votes := ValidateAll(raws)
	c := Config{QuorumBps: 6000, MinConfidenceBps: 5000, RequireSupervisor: true}
	d := Decide(votes, c)
	// Valid voters: macro(approve), sentiment(reject) → 50% < 60% → no quorum
	// (the malformed 'technical' approval was correctly discarded).
	if d.Approved || d.Outcome != NoQuorum {
		t.Fatalf("malformed approval must not reach quorum, got %+v (approval=%d)", d, d.WeightedApprovalBps)
	}
}
