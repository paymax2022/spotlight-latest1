package service

import (
	"context"
	"time"

	"spotlight/backend/internal/arena"
	"spotlight/backend/internal/arena/adapters"
)

// ScoringService is the merit-WRITE side. It holds the arena.ScoringGateway (the
// only holder of signers) and the MeritService. A score submission flows:
// adapter.SubmitScore → SignedMeritEntry → MeritService.Append (verify-before-
// append). Money/engagement handlers never receive a ScoringService.
type ScoringService struct {
	gateway *arena.ScoringGateway
	merit   *MeritService
	audit   AuditRepo
}

// NewScoringService builds the write-side scoring service.
func NewScoringService(gateway *arena.ScoringGateway, merit *MeritService, audit AuditRepo) *ScoringService {
	return &ScoringService{gateway: gateway, merit: merit, audit: audit}
}

// ScoreInput is a normalized admin scoring request (proctor attest / judge score).
type ScoreInput struct {
	CompetitionID string
	ContestantID  string
	Stage         arena.Stage
	RubricVersion string
	Raw           map[string]float64
	Attestation   map[string]string
	// AdapterID optionally pins which authorized adapter must score; empty picks
	// the first adapter that supports the stage.
	AdapterID string
}

// Submit routes a score to the correct authorized adapter, injects a
// deterministic signed_at, chains onto the contestant's prior entry, and appends
// the resulting SignedMeritEntry via the verify-before-append merit ledger.
func (s *ScoringService) Submit(ctx context.Context, actorID string, in ScoreInput) (arena.SignedMeritEntry, error) {
	var (
		adapter arena.ScoringAdapter
		ok      bool
	)
	if in.AdapterID != "" {
		adapter, ok = s.gateway.Adapter(in.AdapterID)
	} else {
		adapter, ok = s.gateway.AdapterForStage(in.Stage)
	}
	if !ok {
		return arena.SignedMeritEntry{}, ErrInvalidInput
	}

	prev, err := s.merit.PrevHashFor(ctx, in.CompetitionID, in.ContestantID)
	if err != nil {
		return arena.SignedMeritEntry{}, err
	}

	// Deterministic signing instant folded into the attestation so the adapter's
	// canonical payload (and therefore the signature) is reproducible for audit.
	att := map[string]string{}
	for k, v := range in.Attestation {
		att[k] = v
	}
	if _, set := att[adapters.SignedAtKey]; !set {
		att[adapters.SignedAtKey] = time.Now().UTC().Format(time.RFC3339Nano)
	}

	entry, err := adapter.SubmitScore(ctx, arena.ScoreSubmission{
		CompetitionID: in.CompetitionID,
		ContestantID:  in.ContestantID,
		Stage:         in.Stage,
		RubricVersion: in.RubricVersion,
		Raw:           in.Raw,
		Attestation:   att,
		PrevHash:      prev,
	})
	if err != nil {
		return arena.SignedMeritEntry{}, err
	}
	if err := s.merit.Append(ctx, actorID, entry); err != nil {
		return arena.SignedMeritEntry{}, err
	}
	return entry, nil
}
