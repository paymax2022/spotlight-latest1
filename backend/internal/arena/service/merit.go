package service

import (
	"context"
	"fmt"

	"spotlight/backend/internal/arena"
	"spotlight/backend/internal/platform/crypto"
)

// MeritService is the guarded gateway to the append-only merit ledger. The ONLY
// way merit enters the system is Append(SignedMeritEntry): it builds a verifier
// from the competition's AUTHORIZED adapter public keys, calls
// arena.VerifyMeritEntry BEFORE insert, and rejects unauthorized signers or
// replays. It holds NO signer and cannot itself mint merit — only an authorized
// adapter (in the adapters package) can produce the entry it consumes (NDC-2).
type MeritService struct {
	repo  MeritRepo
	audit AuditRepo
}

// NewMeritService builds the merit service.
func NewMeritService(repo MeritRepo, audit AuditRepo) *MeritService {
	return &MeritService{repo: repo, audit: audit}
}

// verifierFor builds a crypto.Verifier registered with a competition's active
// authorized-adapter public keys. Only entries signed by one of these verify.
func (s *MeritService) verifierFor(ctx context.Context, competitionID string) (*crypto.Verifier, error) {
	adapters, err := s.repo.AuthorizedAdapters(ctx, competitionID)
	if err != nil {
		return nil, err
	}
	v := crypto.NewVerifier()
	for _, a := range adapters {
		if !a.Active {
			continue
		}
		if err := v.Register(a.AdapterID, a.PublicKey); err != nil {
			return nil, fmt.Errorf("arena merit: bad adapter key %s: %w", a.AdapterID, err)
		}
	}
	return v, nil
}

// Append verifies then persists a signed merit entry. The signature is checked
// against the authorized-adapter verifier (NDC-2) and the chain link is checked;
// on success the entry is inserted (duplicate → ErrReplay) and audited.
func (s *MeritService) Append(ctx context.Context, actorID string, e arena.SignedMeritEntry) error {
	v, err := s.verifierFor(ctx, e.Payload.CompetitionID)
	if err != nil {
		return err
	}
	// VERIFY-BEFORE-APPEND: unsigned/forged/unauthorized/tampered → reject.
	if !arena.VerifyMeritEntry(v, e) {
		_ = s.audit.Log(ctx, AuditRecord{
			CompetitionID: e.Payload.CompetitionID,
			ActorID:       actorID,
			EntityType:    "merit_entry",
			EntityID:      e.Payload.ContestantID,
			Action:        "MERIT_REJECT_UNAUTHORIZED",
			Reason:        "signature not from an authorized active adapter (NDC-2)",
		})
		return ErrUnauthorizedSig
	}
	if err := s.repo.Insert(ctx, e); err != nil {
		return err // ErrReplay bubbles up from the repo unique constraint
	}
	return s.audit.Log(ctx, AuditRecord{
		CompetitionID: e.Payload.CompetitionID,
		ActorID:       actorID,
		EntityType:    "merit_entry",
		EntityID:      e.Payload.ContestantID,
		Action:        "MERIT_APPEND",
		Reason:        e.Payload.Reason,
		After: map[string]any{
			"stage":            string(e.Payload.Stage),
			"adapter_id":       e.Payload.AdapterID,
			"normalized_score": e.Payload.NormalizedScore,
			"entry_hash":       fmt.Sprintf("%x", e.EntryHash),
		},
	})
}

// PrevHashFor returns the contestant's latest entry_hash so a caller (an adapter
// invocation) can chain the next signed entry.
func (s *MeritService) PrevHashFor(ctx context.Context, competitionID, contestantID string) ([]byte, error) {
	return s.repo.LastEntryHash(ctx, competitionID, contestantID)
}

// Leaderboard refreshes and returns the merit leaderboard for a stage. This is
// the SOLE source consulted for advancement (NDC-1).
func (s *MeritService) Leaderboard(ctx context.Context, competitionID string, stage arena.Stage) ([]LeaderRow, error) {
	if err := s.repo.RefreshLeaderboard(ctx); err != nil {
		return nil, err
	}
	return s.repo.Leaderboard(ctx, competitionID, stage)
}

// ContestantMerit returns a contestant's own signed merit rows.
func (s *MeritService) ContestantMerit(ctx context.Context, competitionID, contestantID string) ([]MeritEntryRow, error) {
	return s.repo.ContestantMerit(ctx, competitionID, contestantID)
}

// CompetitionMerit returns all merit rows for a competition (auditor read).
func (s *MeritService) CompetitionMerit(ctx context.Context, competitionID string) ([]MeritEntryRow, error) {
	return s.repo.CompetitionMerit(ctx, competitionID)
}
