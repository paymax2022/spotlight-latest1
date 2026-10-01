package service

import (
	"context"
	"fmt"
	"maps"
	"slices"
	"sort"
	"strings"
	"time"

	"spotlight/backend/internal/arena"
	"spotlight/backend/internal/arena/adapters"
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
	maps.Copy(att, in.Attestation)
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

// CredentialService issues, verifies and revokes verifiable credentials (NDC-7).
// Credentials are issued only from Merit-derived state (crown) or engagement-
// derived state (Play-Along threshold), are verifiable by a public deterministic
// hash (arena.VerifiableHash), and are independently revocable without touching a
// user's unrelated Paymax capabilities.
type CredentialService struct {
	repo  CredentialRepo
	audit AuditRepo
}

// NewCredentialService builds the credential service.
func NewCredentialService(repo CredentialRepo, audit AuditRepo) *CredentialService {
	return &CredentialService{repo: repo, audit: audit}
}

// Issue mints a credential from the stated issuing facts and returns its public
// verifiable hash. The hash is deterministic over (user, competition, type,
// merit-ref) so anyone can recompute it (arena.VerifiableHash). Idempotent: a
// re-issue of the same facts yields the same hash and is a DB no-op.
func (s *CredentialService) Issue(ctx context.Context, actorID, userID, competitionID, credType, issuedFromMeritRef string) (string, error) {
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(credType) == "" {
		return "", ErrInvalidInput
	}
	hash := arena.VerifiableHash(userID, competitionID, arena.CredentialType(credType), issuedFromMeritRef)
	if err := s.repo.Issue(ctx, Credential{
		UserID:         userID,
		CompetitionID:  competitionID,
		Type:           credType,
		Status:         "ACTIVE",
		VerifiableHash: hash,
	}); err != nil {
		return "", err
	}
	_ = s.audit.Log(ctx, AuditRecord{
		CompetitionID: competitionID, ActorID: actorID, EntityType: "credential", EntityID: userID,
		Action: "CREDENTIAL_ISSUE", After: map[string]any{"type": credType, "hash": hash},
	})
	return hash, nil
}

// VerifyByHash resolves a credential by its public hash (verify-by-hash is public,
// no auth). The caller can independently recompute the hash from the returned
// public fields to confirm authenticity.
func (s *CredentialService) VerifyByHash(ctx context.Context, hash string) (*Credential, error) {
	if strings.TrimSpace(hash) == "" {
		return nil, ErrInvalidInput
	}
	return s.repo.GetByHash(ctx, hash)
}

// Revoke flips a credential to REVOKED independently and audits the reason. It
// does not affect any other Paymax capability the user holds.
func (s *CredentialService) Revoke(ctx context.Context, actorID, hash, reason string) error {
	if strings.TrimSpace(hash) == "" {
		return ErrInvalidInput
	}
	if err := s.repo.Revoke(ctx, hash, reason); err != nil {
		return err
	}
	return s.audit.Log(ctx, AuditRecord{
		ActorID: actorID, EntityType: "credential", EntityID: hash,
		Action: "CREDENTIAL_REVOKE", Reason: reason,
	})
}

// Package service holds the Arena orchestration services and the PURE decision
// helpers they call. The helpers here take no DB/network dependency so they can
// be unit-tested directly and reused by handlers, keeping the money/merit
// firewall (NDC-1) and the advancement rule (merit-only) auditable at one place.

// SupportRow is one tagged Support contribution (already ledgered).
type SupportRow struct {
	ContestantID string
	HomeState    string
	AmountKobo   int64
}

// PotTotalKobo sums Support contributions into the standing pot total. Integer
// kobo only (IRON RULE). This is a projection over ledgered rows — the pot is
// never a stored mutable balance.
func PotTotalKobo(rows []SupportRow) int64 {
	var total int64
	for _, r := range rows {
		total += r.AmountKobo
	}
	return total
}

// PeoplesChampion returns the contestant_id with the highest Support total and
// the tally per contestant. Ties break by contestant_id (deterministic). This is
// a Support-fed award (NOT merit) — arena.AwardFedByMeritOnly(PeoplesChampion)
// is false, enforcing that it can never influence the crown.
func PeoplesChampion(rows []SupportRow) (string, map[string]int64) {
	var tally map[string]int64

	var winner string

	tally = map[string]int64{}
	for _, r := range rows {
		if r.ContestantID == "" {
			continue
		}
		tally[r.ContestantID] += r.AmountKobo
	}
	ids := make([]string, 0, len(tally))
	for id := range tally {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	var best int64 = -1
	for _, id := range ids {
		if tally[id] > best {
			best, winner = tally[id], id
		}
	}
	return winner, tally
}

// StatePride returns the home_state with the highest Support total and the
// per-state tally. Ties break by state code (deterministic).
func StatePride(rows []SupportRow) (string, map[string]int64) {
	var winner string
	var tally map[string]int64

	tally = map[string]int64{}
	for _, r := range rows {
		if r.HomeState == "" {
			continue
		}
		tally[r.HomeState] += r.AmountKobo
	}
	states := make([]string, 0, len(tally))
	for s := range tally {
		states = append(states, s)
	}
	sort.Strings(states)
	var best int64 = -1
	for _, s := range states {
		if tally[s] > best {
			best, winner = tally[s], s
		}
	}
	return winner, tally
}

// LeaderRow is a contestant's aggregate merit at a stage (projection of the
// signed merit ledger via the arena_merit_leaderboard matview).
type LeaderRow struct {
	ContestantID string
	Stage        arena.Stage
	TotalScore   float64
}

// RankMerit sorts contestants by total merit descending (ties by contestant_id,
// deterministic) and returns their ordered ids. This is the sole ranking used
// for QUALIFIED/FINALIST/CROWNED advancement.
func RankMerit(rows []LeaderRow) []string {
	cp := make([]LeaderRow, len(rows))
	copy(cp, rows)
	sort.SliceStable(cp, func(i, j int) bool {
		if cp[i].TotalScore != cp[j].TotalScore {
			return cp[i].TotalScore > cp[j].TotalScore
		}
		return cp[i].ContestantID < cp[j].ContestantID
	})
	out := make([]string, len(cp))
	for i, r := range cp {
		out[i] = r.ContestantID
	}
	return out
}

// TopN returns the top-n contestant ids by merit (used to pick who QUALIFIES /
// becomes a FINALIST). n <= 0 or n beyond the field returns the full ranking.
func TopN(rows []LeaderRow, n int) []string {
	ranked := RankMerit(rows)
	if n <= 0 || n >= len(ranked) {
		return ranked
	}
	return ranked[:n]
}

// MeritLeader returns the single top-ranked contestant (the crown holder) or ""
// when the field is empty.
func MeritLeader(rows []LeaderRow) string {
	ranked := RankMerit(rows)
	if len(ranked) == 0 {
		return ""
	}
	return ranked[0]
}

// AdvancementQualifies reports whether `contestant` is within the top-n of the
// merit ranking, i.e. whether a merit-only advancement to `to` is justified. It
// panics-guards nothing about money because it receives ONLY merit rows.
func AdvancementQualifies(rows []LeaderRow, contestant string, topN int) bool {
	return slices.Contains(TopN(rows, topN), contestant)
}

// PassesCertification reports whether a spectator's cumulative Play-Along points
// meet the config threshold to earn a CERTIFIED_SAFE_DRIVER credential.
func PassesCertification(points, threshold int) bool {
	return threshold > 0 && points >= threshold
}
