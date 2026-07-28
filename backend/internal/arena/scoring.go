package arena

import "context"

// ScoringGateway + adapter contract (ADR-014 §5). Provider-agnostic, per-source
// signed adapters. Only adapters registered here (authorized, with a signer) can
// emit a SignedMeritEntry — the sole input to the Merit ledger (NDC-2).

// ScoreSubmission is the raw input a source hands its adapter. The adapter
// validates it against the rubric version, computes normalized_score
// deterministically, and signs.
type ScoreSubmission struct {
	CompetitionID string
	ContestantID  string
	Stage         Stage
	RubricVersion string
	// Raw is the rubric's raw inputs (item scores, judge scores, etc.).
	Raw map[string]float64
	// Attestation carries proctor/judge identity + integrity fields folded into
	// the signed canonical payload (e.g. proctor_id, webcam_ok, judge_ids).
	Attestation map[string]string
	// PrevHash is the signer contestant's previous entry_hash ("" for genesis).
	PrevHash []byte
}

// ScoringAdapter is implemented by each source (theory exam, practical judge,
// first-aid, telematics). It holds its own signer internally.
type ScoringAdapter interface {
	ID() string
	Source() SourceType
	Supports(stage Stage) bool
	// SubmitScore validates, normalizes deterministically, and returns a signed,
	// hash-chained merit entry. It never persists — the gateway/ledger does.
	SubmitScore(ctx context.Context, in ScoreSubmission) (SignedMeritEntry, error)
}

// ScoringGateway is the registry of authorized adapters for a competition. It is
// the ONLY producer of SignedMeritEntry values. Money/engagement handlers never
// receive a gateway.
type ScoringGateway struct {
	adapters map[string]ScoringAdapter // adapter_id → adapter
}

// NewScoringGateway builds an empty gateway.
func NewScoringGateway() *ScoringGateway {
	return &ScoringGateway{adapters: map[string]ScoringAdapter{}}
}

// Register authorizes an adapter.
func (g *ScoringGateway) Register(a ScoringAdapter) { g.adapters[a.ID()] = a }

// Adapter returns an authorized adapter by id, if registered.
func (g *ScoringGateway) Adapter(id string) (ScoringAdapter, bool) {
	a, ok := g.adapters[id]
	return a, ok
}

// AdapterForStage returns the first registered adapter that supports the stage.
func (g *ScoringGateway) AdapterForStage(stage Stage) (ScoringAdapter, bool) {
	for _, a := range g.adapters {
		if a.Supports(stage) {
			return a, true
		}
	}
	return nil, false
}
