// Package adapters implements arena.ScoringAdapter for each authorized merit
// source (theory exam, practical judging, first aid). Each adapter OWNS a
// *crypto.Signer built from a config seed and is the ONLY code path that can
// construct a verifiable arena.SignedMeritEntry (NDC-2). Money/engagement rails
// import nothing from this package and hold no signer — the compile-time half of
// the merit firewall (NDC-1).
//
// Normalization is deterministic: identical ScoreSubmission inputs always yield
// the identical NormalizedScore, so a signature is reproducible for audit.
package adapters

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"spotlight/backend/internal/arena"
	"spotlight/backend/internal/platform/crypto"
)

// SignedAtKey is the reserved attestation field carrying the scoring instant as
// RFC3339Nano. The service injects it so SignedAt is deterministic (and thus the
// signature reproducible) rather than reading a wall clock inside the adapter.
// Absent → zero time, which keeps normalization tests fully deterministic.
const SignedAtKey = "signed_at"

// signedAt derives the deterministic scoring instant from the submission's
// attestation (SignedAtKey), defaulting to the zero time when unset.
func signedAt(in arena.ScoreSubmission) time.Time {
	if in.Attestation != nil {
		if raw, ok := in.Attestation[SignedAtKey]; ok && raw != "" {
			if t, err := time.Parse(time.RFC3339Nano, raw); err == nil {
				return t.UTC()
			}
		}
	}
	return time.Time{}
}

// ── Pure normalization helpers (unit-tested without a signer) ────────────────

// Clamp bounds v to [lo, hi].
func Clamp(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

// NormalizePercent maps a raw score against a max onto a 0..100 scale. A zero or
// negative max yields 0 (fail-closed, never a divide-by-zero panic).
func NormalizePercent(raw, max float64) float64 {
	if max <= 0 {
		return 0
	}
	return Clamp((raw/max)*100.0, 0, 100)
}

// TrimmedMean returns the mean of xs after discarding the single lowest and
// single highest value (a symmetric trim), which neutralizes one biased judge.
// For fewer than 3 values it returns the plain mean; empty returns 0. The input
// is copied before sorting so the caller's slice is untouched (deterministic).
func TrimmedMean(xs []float64) float64 {
	n := len(xs)
	if n == 0 {
		return 0
	}
	cp := make([]float64, n)
	copy(cp, xs)
	sort.Float64s(cp)
	if n >= 3 {
		cp = cp[1 : n-1]
	}
	var sum float64
	for _, v := range cp {
		sum += v
	}
	return sum / float64(len(cp))
}

// attestationReason folds the attestation map into a deterministic, canonical
// string that becomes part of the signed ScorePayload.Reason. Keys are sorted so
// two callers passing the same map always produce identical signed bytes.
func attestationReason(prefix string, att map[string]string) string {
	if len(att) == 0 {
		return prefix
	}
	keys := make([]string, 0, len(att))
	for k := range att {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var b strings.Builder
	b.WriteString(prefix)
	for _, k := range keys {
		b.WriteString("|")
		b.WriteString(k)
		b.WriteString("=")
		b.WriteString(att[k])
	}
	return b.String()
}

// ── TheoryExamAdapter ────────────────────────────────────────────────────────

// TheoryExamAdapter scores a proctored theory exam. Raw["score"] is the raw
// marks, Raw["max"] the paper's maximum. The proctor attestation (proctor_id,
// webcam_ok, …) is folded into the signed canonical payload so an entry carries
// its own integrity provenance.
type TheoryExamAdapter struct{ signer *crypto.Signer }

// NewTheoryExamAdapter builds the theory adapter over a signer.
func NewTheoryExamAdapter(s *crypto.Signer) *TheoryExamAdapter { return &TheoryExamAdapter{signer: s} }

func (a *TheoryExamAdapter) ID() string               { return a.signer.ID() }
func (a *TheoryExamAdapter) Source() arena.SourceType { return arena.SourceTheoryExam }

func (a *TheoryExamAdapter) Supports(stage arena.Stage) bool {
	switch stage {
	case arena.StageTheoryB1, arena.StageTheoryB2, arena.StageTheoryB3, arena.StageScreening:
		return true
	default:
		return false
	}
}

// NormalizeTheory is the deterministic normalizer, exported for tests.
func NormalizeTheory(raw map[string]float64) (rawScore, normalized float64) {
	rawScore = raw["score"]
	return rawScore, NormalizePercent(rawScore, raw["max"])
}

func (a *TheoryExamAdapter) SubmitScore(ctx context.Context, in arena.ScoreSubmission) (arena.SignedMeritEntry, error) {
	if !a.Supports(in.Stage) {
		return arena.SignedMeritEntry{}, fmt.Errorf("theory adapter: unsupported stage %q", in.Stage)
	}
	rawScore, normalized := NormalizeTheory(in.Raw)
	p := arena.ScorePayload{
		CompetitionID:   in.CompetitionID,
		ContestantID:    in.ContestantID,
		SourceType:      arena.SourceTheoryExam,
		AdapterID:       a.signer.ID(),
		Stage:           in.Stage,
		RubricVersion:   in.RubricVersion,
		RawScore:        rawScore,
		NormalizedScore: normalized,
		SignedAt:        signedAt(in),
		Reason:          attestationReason("theory-proctor", in.Attestation),
	}
	return arena.SignScore(a.signer, p, in.PrevHash), nil
}

// ── PracticalJudgeAdapter ────────────────────────────────────────────────────

// PracticalJudgeAdapter aggregates multiple judge scores into one normalized
// score via a trimmed mean (discarding the extreme high/low). Judge ids are
// recorded in the signed attestation so the panel is provable. Raw keys are the
// per-judge scores (any keys); Raw["max"] (optional) is the per-judge maximum
// used to rescale to 0..100 — absent, judges are assumed already on 0..100.
type PracticalJudgeAdapter struct{ signer *crypto.Signer }

// NewPracticalJudgeAdapter builds the practical adapter over a signer.
func NewPracticalJudgeAdapter(s *crypto.Signer) *PracticalJudgeAdapter {
	return &PracticalJudgeAdapter{signer: s}
}

func (a *PracticalJudgeAdapter) ID() string               { return a.signer.ID() }
func (a *PracticalJudgeAdapter) Source() arena.SourceType { return arena.SourcePractical }

func (a *PracticalJudgeAdapter) Supports(stage arena.Stage) bool {
	return stage == arena.StageFinalePractical
}

// judgeScores extracts the per-judge scores (every Raw key except the reserved
// "max"), sorted by key for determinism.
func judgeScores(raw map[string]float64) []float64 {
	keys := make([]string, 0, len(raw))
	for k := range raw {
		if k == "max" {
			continue
		}
		keys = append(keys, k)
	}
	sort.Strings(keys)
	out := make([]float64, 0, len(keys))
	for _, k := range keys {
		out = append(out, raw[k])
	}
	return out
}

// NormalizePractical is the deterministic aggregator, exported for tests.
func NormalizePractical(raw map[string]float64) (rawScore, normalized float64) {
	scores := judgeScores(raw)
	rawScore = TrimmedMean(scores)
	if max := raw["max"]; max > 0 {
		normalized = NormalizePercent(rawScore, max)
	} else {
		normalized = Clamp(rawScore, 0, 100)
	}
	return rawScore, normalized
}

func (a *PracticalJudgeAdapter) SubmitScore(ctx context.Context, in arena.ScoreSubmission) (arena.SignedMeritEntry, error) {
	if !a.Supports(in.Stage) {
		return arena.SignedMeritEntry{}, fmt.Errorf("practical adapter: unsupported stage %q", in.Stage)
	}
	if len(judgeScores(in.Raw)) == 0 {
		return arena.SignedMeritEntry{}, fmt.Errorf("practical adapter: no judge scores")
	}
	rawScore, normalized := NormalizePractical(in.Raw)
	p := arena.ScorePayload{
		CompetitionID:   in.CompetitionID,
		ContestantID:    in.ContestantID,
		SourceType:      arena.SourcePractical,
		AdapterID:       a.signer.ID(),
		Stage:           in.Stage,
		RubricVersion:   in.RubricVersion,
		RawScore:        rawScore,
		NormalizedScore: normalized,
		SignedAt:        signedAt(in),
		Reason:          attestationReason("practical-panel", in.Attestation),
	}
	return arena.SignScore(a.signer, p, in.PrevHash), nil
}

// ── FirstAidAdapter ──────────────────────────────────────────────────────────

// FirstAidAdapter scores the finale first-aid station. Raw["score"] / Raw["max"]
// as with theory; assessor attestation is folded into the signed payload.
type FirstAidAdapter struct{ signer *crypto.Signer }

// NewFirstAidAdapter builds the first-aid adapter over a signer.
func NewFirstAidAdapter(s *crypto.Signer) *FirstAidAdapter { return &FirstAidAdapter{signer: s} }

func (a *FirstAidAdapter) ID() string               { return a.signer.ID() }
func (a *FirstAidAdapter) Source() arena.SourceType { return arena.SourceFirstAid }

func (a *FirstAidAdapter) Supports(stage arena.Stage) bool {
	return stage == arena.StageFinaleFirstAid
}

// NormalizeFirstAid is the deterministic normalizer, exported for tests.
func NormalizeFirstAid(raw map[string]float64) (rawScore, normalized float64) {
	rawScore = raw["score"]
	return rawScore, NormalizePercent(rawScore, raw["max"])
}

func (a *FirstAidAdapter) SubmitScore(ctx context.Context, in arena.ScoreSubmission) (arena.SignedMeritEntry, error) {
	if !a.Supports(in.Stage) {
		return arena.SignedMeritEntry{}, fmt.Errorf("first-aid adapter: unsupported stage %q", in.Stage)
	}
	rawScore, normalized := NormalizeFirstAid(in.Raw)
	p := arena.ScorePayload{
		CompetitionID:   in.CompetitionID,
		ContestantID:    in.ContestantID,
		SourceType:      arena.SourceFirstAid,
		AdapterID:       a.signer.ID(),
		Stage:           in.Stage,
		RubricVersion:   in.RubricVersion,
		RawScore:        rawScore,
		NormalizedScore: normalized,
		SignedAt:        signedAt(in),
		Reason:          attestationReason("firstaid-assessor", in.Attestation),
	}
	return arena.SignScore(a.signer, p, in.PrevHash), nil
}

// Compile-time proof each adapter satisfies the ScoringAdapter contract.
var (
	_ arena.ScoringAdapter = (*TheoryExamAdapter)(nil)
	_ arena.ScoringAdapter = (*PracticalJudgeAdapter)(nil)
	_ arena.ScoringAdapter = (*FirstAidAdapter)(nil)
)
