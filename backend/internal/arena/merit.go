// Package arena is the config-driven competition engine (ADR-014). Naija Driver
// is instance #1. This file defines the MERIT FIREWALL (NDC-1,2,6): the Merit
// ledger appends ONLY SignedMeritEntry values, and a SignedMeritEntry can be
// produced ONLY by SignScore, which requires a *crypto.Signer. The Support,
// Play-Along and Sponsor rails hold no signer and therefore have no code path
// that can construct a valid merit write. Verification uses only public keys, so
// the ledger is publicly auditable.
package arena

import (
	"bytes"
	"fmt"
	"strconv"
	"time"

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
	EntryHash []byte // ChainHash(PrevHash, Canonical)
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
