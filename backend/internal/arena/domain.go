// Package arena is the config-driven competition engine (ADR-014). Naija Driver
// is instance #1. The Merit ledger appends ONLY SignedMeritEntry values, and a
// SignedMeritEntry can be produced ONLY by SignScore, which requires a
// *crypto.Signer — the MERIT FIREWALL (NDC-1,2,6). The Support, Play-Along and
// Sponsor rails hold no signer and therefore have no code path that can
// construct a valid merit write. Verification uses only public keys, so the
// ledger is publicly auditable. domain.go holds the package's core types and
// policy tables: merit/signing primitives, credentials, the contestant
// lifecycle state machine, the rail → write-target policy and the scoring
// gateway contract.
package arena

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strconv"
	"time"

	"spotlight/backend/go-common/fsm"
	"spotlight/backend/internal/platform/crypto"
)

// SourceType is an authorized merit source (NDC-2).
type SourceType string

const (
	SourceTheoryExam SourceType = "THEORY_EXAM"
	SourcePractical  SourceType = "PRACTICAL"
	SourceFirstAid   SourceType = "FIRST_AID"
	SourceTelematics SourceType = "TELEMATICS"
)

// Stage is a scored stage of the competition.
type Stage string

const (
	StageScreening       Stage = "SCREENING"
	StageTheoryB1        Stage = "THEORY_B1"
	StageTheoryB2        Stage = "THEORY_B2"
	StageTheoryB3        Stage = "THEORY_B3"
	StageFinalePractical Stage = "FINALE_PRACTICAL"
	StageFinaleFirstAid  Stage = "FINALE_FIRSTAID"
)

// ScorePayload is the exact, canonical input an adapter signs. Field order in
// Canonical() is fixed and versioned so signatures are reproducible for audit.
type ScorePayload struct {
	CompetitionID   string
	ContestantID    string
	SourceType      SourceType
	AdapterID       string
	Stage           Stage
	RubricVersion   string
	RawScore        float64
	NormalizedScore float64
	SignedAt        time.Time
	// Reason is set only on compensating corrections (append-only, never edits).
	Reason string
}

// Canonical returns the deterministic bytes that are signed and hash-chained.
func (p ScorePayload) Canonical() []byte {
	f := func(v float64) string { return strconv.FormatFloat(v, 'f', -1, 64) }
	return []byte(fmt.Sprintf("arena-merit/v1|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s",
		p.CompetitionID, p.ContestantID, p.SourceType, p.AdapterID, p.Stage,
		p.RubricVersion, f(p.RawScore), f(p.NormalizedScore),
		p.SignedAt.UTC().Format(time.RFC3339Nano), p.Reason))
}

// SignedMeritEntry is the only value the Merit ledger will append. Its zero value
// is not appendable (empty signature fails verification); the only constructor is
// SignScore.
type SignedMeritEntry struct {
	Payload   ScorePayload
	Canonical []byte
	Signature []byte
	PrevHash  []byte // per-contestant previous entry_hash ("" for genesis)
	EntryHash []byte
}

// SignScore builds a signed, hash-chained merit entry. Requires an adapter
// signer — the compile-time firewall (money/engagement rails hold none).
func SignScore(s *crypto.Signer, p ScorePayload, prevHash []byte) SignedMeritEntry {
	if p.AdapterID == "" {
		p.AdapterID = s.ID()
	}
	canon := p.Canonical()
	return SignedMeritEntry{
		Payload:   p,
		Canonical: canon,
		Signature: s.Sign(canon),
		PrevHash:  prevHash,
		EntryHash: crypto.ChainHash(prevHash, canon),
	}
}

// VerifyMeritEntry checks the signature (against the authorized-adapter public
// key) AND the chain link. The Merit ledger MUST call this before every append,
// so an unsigned or forged entry is unreachable (NDC-2).
func VerifyMeritEntry(v *crypto.Verifier, e SignedMeritEntry) bool {
	if len(e.Signature) == 0 || len(e.Canonical) == 0 {
		return false
	}
	if !v.Verify(e.Payload.AdapterID, e.Canonical, e.Signature) {
		return false
	}
	return bytes.Equal(e.EntryHash, crypto.ChainHash(e.PrevHash, e.Canonical))
}

// CredentialService primitives (ADR-014 §14, NDC-7). Credentials are issued only
// from Merit-derived state, are verifiable by a public hash, and are independently
// revocable without touching a user's unrelated Paymax capabilities.

// CredentialType is the kind of attestation.
type CredentialType string

const (
	CredCertifiedSafeDriver CredentialType = "CERTIFIED_SAFE_DRIVER" // Play-Along threshold
	CredNaijaDriver         CredentialType = "NAIJA_DRIVER"          // crown
)

// VerifiableHash is the public handle for a credential: a deterministic SHA-256
// over the issuing facts. Anyone can recompute it from the public credential
// fields to confirm the credential was issued from the stated merit reference.
func VerifiableHash(userID, competitionID string, t CredentialType, issuedFromMeritRef string) string {
	sum := sha256.Sum256([]byte(fmt.Sprintf("arena-cred/v1|%s|%s|%s|%s",
		userID, competitionID, t, issuedFromMeritRef)))
	return hex.EncodeToString(sum[:])
}

// Contestant lifecycle state machine (ADR-014 §8, NDC-5). Guarded: any transition
// not explicitly listed is rejected. Advancement transitions (→QUALIFIED,
// →FINALIST, →CROWNED) are computed from the Merit leaderboard ONLY (NDC-1); the
// state machine here only encodes legality — the caller supplies the merit-derived
// decision.

// ContestantState is the lifecycle state.
type ContestantState string

const (
	StApplied        ContestantState = "APPLIED"
	StScreened       ContestantState = "SCREENED"
	StTrained        ContestantState = "TRAINED"
	StTheoryAssigned ContestantState = "THEORY_ASSIGNED"
	StTheoryTaken    ContestantState = "THEORY_TAKEN"
	StQualified      ContestantState = "QUALIFIED"
	StFinalist       ContestantState = "FINALIST"
	StCrowned        ContestantState = "CROWNED"
	StEliminated     ContestantState = "ELIMINATED"
	StRejected       ContestantState = "REJECTED"
	StWithdrawn      ContestantState = "WITHDRAWN"
)

// moves encodes the §8 graph. Terminal states have no outgoing edges.
var moves = fsm.Table[ContestantState]{
	StApplied:        fsm.Set(StScreened, StRejected, StWithdrawn),
	StScreened:       fsm.Set(StTrained, StWithdrawn),
	StTrained:        fsm.Set(StTheoryAssigned, StWithdrawn),
	StTheoryAssigned: fsm.Set(StTheoryTaken, StWithdrawn),
	StTheoryTaken:    fsm.Set(StQualified, StEliminated, StWithdrawn),
	StQualified:      fsm.Set(StFinalist, StEliminated, StWithdrawn),
	StFinalist:       fsm.Set(StCrowned, StEliminated, StWithdrawn),
	StCrowned:        {},
	StEliminated:     {},
	StRejected:       {},
	StWithdrawn:      {},
}

// terminal is the absorbing-state predicate (the admin WITHDRAWN path is an
// edge INTO StWithdrawn, not an argument that it has outgoing moves).
var terminal = fsm.TerminalOf(StCrowned, StEliminated, StRejected, StWithdrawn)

// CanTransition reports whether from → to is a legal lifecycle move. The admin
// "any non-terminal → WITHDRAWN" path is included in `moves`.
func CanTransition(from, to ContestantState) bool { return moves.Can(from, to) }

// IsTerminal reports whether a state is absorbing.
func IsTerminal(s ContestantState) bool { return terminal(s) }

// AdvancementReadsMeritOnly lists the transitions that MUST be computed from the
// Merit leaderboard and never from any money/engagement tally (NDC-1). Callers
// assert this to keep the firewall explicit at the call site.
func AdvancementReadsMeritOnly(to ContestantState) bool {
	switch to {
	case StQualified, StFinalist, StCrowned:
		return true
	default:
		return false
	}
}

// The four firewalled rails (ADR-014 §3, NDC-1). Each rail declares its write
// target; only MERIT writes to the Merit ledger, and only via a signed adapter.

// Rail is an engagement/scoring channel.
type Rail string

const (
	RailMerit     Rail = "MERIT"     // signed judging → Merit ledger (the crown)
	RailSupport   Rail = "SUPPORT"   // real-Naira gifting → wallet ledger + pot
	RailPlayAlong Rail = "PLAYALONG" // free quiz → engagement ledger + credential
	RailSponsor   Rail = "SPONSOR"   // branded → engagement + Featured Placement
)

// WriteTarget names where a rail is permitted to write.
type WriteTarget string

const (
	TargetMeritLedger       WriteTarget = "merit_ledger"
	TargetWalletLedger      WriteTarget = "wallet_ledger"
	TargetEngagementLedger  WriteTarget = "engagement_ledger"
	TargetFeaturedPlacement WriteTarget = "featured_placement"
)

// railTargets is the fixed, non-editable rail→target policy. The crown/merit is
// reachable only through RailMerit.
var railTargets = map[Rail]WriteTarget{
	RailMerit:     TargetMeritLedger,
	RailSupport:   TargetWalletLedger,
	RailPlayAlong: TargetEngagementLedger,
	RailSponsor:   TargetFeaturedPlacement,
}

// TargetFor returns the permitted write target for a rail.
func TargetFor(r Rail) WriteTarget { return railTargets[r] }

// WritesMerit reports whether a rail may write to the Merit ledger. Only MERIT.
func WritesMerit(r Rail) bool { return railTargets[r] == TargetMeritLedger }

// AwardType is a computed outcome; each declares which rails feed it.
type AwardType string

const (
	AwardNaijaDriverCrown AwardType = "NAIJA_DRIVER_CROWN"
	AwardPeoplesChampion  AwardType = "PEOPLES_CHAMPION"
	AwardStatePrideWinner AwardType = "STATE_PRIDE_WINNER"
	AwardCertifiedDriver  AwardType = "CERTIFIED_SAFE_DRIVER"
)

// awardRails is the fixed award→feeding-rail policy. The crown is fed ONLY by
// Merit (NDC-1) and this cannot be reconfigured to accept another rail.
var awardRails = map[AwardType][]Rail{
	AwardNaijaDriverCrown: {RailMerit},
	AwardPeoplesChampion:  {RailSupport},
	AwardStatePrideWinner: {RailSupport},
	AwardCertifiedDriver:  {RailPlayAlong},
}

// RailsFor returns the rails that feed an award.
func RailsFor(a AwardType) []Rail { return awardRails[a] }

// AwardFedByMeritOnly reports whether an award is a pure function of Merit.
func AwardFedByMeritOnly(a AwardType) bool {
	rs := awardRails[a]
	return len(rs) == 1 && rs[0] == RailMerit
}

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
