package service

import (
	"context"
	"strings"

	"spotlight/backend/internal/arena"
	"spotlight/backend/internal/platform/crypto"
)

// ContestantService owns the contestant lifecycle (ADR-014 §8, NDC-3,5). Apply is
// KYC-gated and unique per human; Transition is guarded by arena.CanTransition and
// — for advancement — reads the Merit leaderboard ONLY (NDC-1). On CROWNED it runs
// award finalization (signed), NAIJA_DRIVER credential issue and the pot
// disbursement trigger atomically inside the state-change tx.
type ContestantService struct {
	repo   ContestantRepo
	merit  *MeritService
	awards AwardRepo
	creds  *CredentialService
	pot    *PotDisbursementService
	tiers  TierPort
	cfg    ConfigReader
	audit  AuditRepo
	// crownSigner signs the finalized crown award (an authorized adapter signer,
	// e.g. the practical adapter's). Nil disables award signing (signature blank).
	crownSigner *crypto.Signer
}

// NewContestantService builds the contestant lifecycle service.
func NewContestantService(
	repo ContestantRepo,
	merit *MeritService,
	awards AwardRepo,
	creds *CredentialService,
	pot *PotDisbursementService,
	tiers TierPort,
	cfg ConfigReader,
	audit AuditRepo,
	crownSigner *crypto.Signer,
) *ContestantService {
	return &ContestantService{
		repo: repo, merit: merit, awards: awards, creds: creds, pot: pot,
		tiers: tiers, cfg: cfg, audit: audit, crownSigner: crownSigner,
	}
}

// Apply creates an APPLIED contestant (+ application). KYC-gated (NDC-3) against
// the config-required tier and unique per human (the repo unique constraint).
func (s *ContestantService) Apply(ctx context.Context, userID, competitionID, homeState string) (*Contestant, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, ErrInvalidInput
	}
	cfg, err := s.cfg.CurrentConfig(ctx, competitionID)
	if err != nil {
		return nil, err
	}
	tier, err := s.tiers.UserTier(ctx, userID)
	if err != nil {
		return nil, ErrKYCTierTooLow // fail-closed
	}
	if tier < cfg.RequiredKYCTier {
		return nil, ErrKYCTierTooLow
	}
	c, err := s.repo.Create(ctx, competitionID, userID, tier, homeState)
	if err != nil {
		return nil, err // ErrConflict on the unique(competition_id,user_id) NDC-3
	}
	_ = s.audit.Log(ctx, AuditRecord{
		CompetitionID: competitionID, ActorID: userID, EntityType: "contestant", EntityID: c.ID,
		Action: "CONTESTANT_APPLY", After: map[string]any{"kyc_tier": tier, "home_state": homeState},
	})
	return c, nil
}

// Me returns the caller's own contestant row.
func (s *ContestantService) Me(ctx context.Context, competitionID, userID string) (*Contestant, error) {
	return s.repo.GetByUser(ctx, competitionID, userID)
}

// Transition performs a guarded lifecycle move. Legality is asserted via
// arena.CanTransition. For advancement (arena.AdvancementReadsMeritOnly) the
// decision is computed from MeritService.Leaderboard ONLY — never from any
// money/engagement tally (NDC-1). On CROWNED the award/credential/pot side-effects
// run atomically inside the state-change tx.
func (s *ContestantService) Transition(ctx context.Context, actorID, competitionID, contestantID string, to arena.ContestantState, reason string) error {
	c, err := s.repo.Get(ctx, competitionID, contestantID)
	if err != nil {
		return err
	}
	from := c.State

	if !arena.CanTransition(from, to) {
		return ErrBadState
	}

	// Advancement gate: the ONLY input is the merit leaderboard (NDC-1).
	if arena.AdvancementReadsMeritOnly(to) {
		if err := s.assertMeritAdvancement(ctx, competitionID, contestantID, to); err != nil {
			return err
		}
	}

	// Build the side-effect for CROWNED (finalize award + credential + pot trigger).
	var sideEffect func(ctx context.Context) error
	if to == arena.StCrowned {
		sideEffect = s.crownSideEffect(actorID, competitionID, c)
	}

	if err := s.repo.UpdateState(ctx, contestantID, from, to, sideEffect); err != nil {
		return err
	}

	return s.audit.Log(ctx, AuditRecord{
		CompetitionID: competitionID, ActorID: actorID, EntityType: "contestant", EntityID: contestantID,
		Action: "CONTESTANT_TRANSITION", Reason: reason,
		Before: map[string]any{"state": string(from)},
		After:  map[string]any{"state": string(to)},
	})
}

// assertMeritAdvancement confirms the contestant qualifies purely by merit for the
// target state, reading ONLY the merit leaderboard.
func (s *ContestantService) assertMeritAdvancement(ctx context.Context, competitionID, contestantID string, to arena.ContestantState) error {
	cfg, err := s.cfg.CurrentConfig(ctx, competitionID)
	if err != nil {
		return err
	}
	// Aggregate all stages into one ranking view for the cut. We read every
	// stage's leaderboard rows and combine — still merit-only.
	rows, err := s.allMeritRows(ctx, competitionID)
	if err != nil {
		return err
	}
	switch to {
	case arena.StQualified:
		if !AdvancementQualifies(rows, contestantID, cfg.QualifyTopN) {
			return ErrForbidden
		}
	case arena.StFinalist:
		if !AdvancementQualifies(rows, contestantID, cfg.FinalistTopN) {
			return ErrForbidden
		}
	case arena.StCrowned:
		if MeritLeader(rows) != contestantID {
			return ErrForbidden
		}
	}
	return nil
}

// allMeritRows collects merit leaderboard rows across every scored stage into a
// single combined ranking view (one LeaderRow per contestant, summed).
func (s *ContestantService) allMeritRows(ctx context.Context, competitionID string) ([]LeaderRow, error) {
	stages := []arena.Stage{
		arena.StageScreening, arena.StageTheoryB1, arena.StageTheoryB2, arena.StageTheoryB3,
		arena.StageFinalePractical, arena.StageFinaleFirstAid,
	}
	combined := map[string]float64{}
	for _, st := range stages {
		rows, err := s.merit.Leaderboard(ctx, competitionID, st)
		if err != nil {
			return nil, err
		}
		for _, r := range rows {
			combined[r.ContestantID] += r.TotalScore
		}
	}
	out := make([]LeaderRow, 0, len(combined))
	for id, total := range combined {
		out = append(out, LeaderRow{ContestantID: id, TotalScore: total})
	}
	return out, nil
}

// crownSideEffect returns the atomic CROWNED side-effect: finalize the signed
// crown award (fed by MERIT only), issue the NAIJA_DRIVER credential, and trigger
// pot disbursement. All run inside the state-change tx.
func (s *ContestantService) crownSideEffect(actorID, competitionID string, c *Contestant) func(ctx context.Context) error {
	return func(ctx context.Context) error {
		// 1. Finalize the signed crown award (computed_from = {MERIT} only).
		sig := ""
		if s.crownSigner != nil {
			payload := "arena-award/v1|" + competitionID + "|" + string(arena.AwardNaijaDriverCrown) + "|" + c.ID
			sig = base64Sig(s.crownSigner.Sign([]byte(payload)))
		}
		if err := s.awards.Finalize(ctx, competitionID, string(arena.AwardNaijaDriverCrown),
			c.ID, []string{string(arena.RailMerit)}, 0, sig); err != nil {
			return err
		}
		// 2. Issue the NAIJA_DRIVER credential (merit-derived).
		if _, err := s.creds.Issue(ctx, actorID, c.UserID, competitionID,
			string(arena.CredNaijaDriver), "crown:"+competitionID+":"+c.ID); err != nil {
			return err
		}
		// 3. Trigger pot disbursement (guarded multi-approve enforced inside).
		if s.pot != nil {
			if err := s.pot.OnCrown(ctx, actorID, competitionID, c.UserID); err != nil {
				return err
			}
		}
		return nil
	}
}

// ScreeningService is the reviewer decision service (SCREENED/REJECTED from the
// application review queue). It never touches merit.
type ScreeningService struct {
	repo  ContestantRepo
	audit AuditRepo
}

// NewScreeningService builds the screening service.
func NewScreeningService(repo ContestantRepo, audit AuditRepo) *ScreeningService {
	return &ScreeningService{repo: repo, audit: audit}
}

// Queue lists contestants awaiting screening (APPLIED).
func (s *ScreeningService) Queue(ctx context.Context, competitionID string) ([]Contestant, error) {
	return s.repo.ListByState(ctx, competitionID, arena.StApplied)
}

// Decide moves an APPLIED contestant to SCREENED (approve) or REJECTED (deny).
func (s *ScreeningService) Decide(ctx context.Context, actorID, competitionID, contestantID string, approve bool, reason string) error {
	c, err := s.repo.Get(ctx, competitionID, contestantID)
	if err != nil {
		return err
	}
	to := arena.StRejected
	action := "SCREENING_REJECT"
	if approve {
		to = arena.StScreened
		action = "SCREENING_APPROVE"
	}
	if !arena.CanTransition(c.State, to) {
		return ErrBadState
	}
	if err := s.repo.UpdateState(ctx, contestantID, c.State, to, nil); err != nil {
		return err
	}
	return s.audit.Log(ctx, AuditRecord{
		CompetitionID: competitionID, ActorID: actorID, EntityType: "application", EntityID: contestantID,
		Action: action, Reason: reason,
		Before: map[string]any{"state": string(c.State)}, After: map[string]any{"state": string(to)},
	})
}
