package committee

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
