package feescompetition

import (
	"context"

	feesstatemachine "spotlight/backend/internal/academy/fees/statemachine"
)

// service.go — Competition orchestration (build-spec §3.4). All lifecycle changes
// go through the shared pure state machine feesstatemachine.CompetitionTransition;
// this service never mutates status directly. Registration is only permitted while
// the competition is in open_registration. Scoring writes route through the
// LeaderboardManager, which enforces the ScoringLocked boundary.
//
// Money-free: no ledger, no wallet. Rewards (if any) are academy/rewards' job.

// ErrScoringLocked signals an attempt to create/edit a leaderboard entry once the
// competition is results_pending or later (build-spec §3.4). Defined here (not in
// feesstatemachine) because it is a service/leaderboard-layer failure, while the
// state machine only exposes the pure ScoringLocked predicate.
var ErrScoringLocked = feesErr("scoring_locked")

// ErrRegistrationClosed signals a school registration attempt while the
// competition is NOT in open_registration.
var ErrRegistrationClosed = feesErr("registration_closed")

// ErrUnknownEvent signals an event string that does not map to a competition
// event.
var ErrUnknownEvent = feesErr("unknown_event")

// Service is the competition application service.
type Service struct {
	store       Store
	leaderboard *LeaderboardManager
}

// NewService wires the service over a Store and a LeaderboardManager (which itself
// wraps the shared gamification ladder + identity resolver).
func NewService(store Store, leaderboard *LeaderboardManager) *Service {
	return &Service{store: store, leaderboard: leaderboard}
}

// Create makes a new Competition in the draft state (the state machine's start).
func (s *Service) Create(ctx context.Context, in CreateCompetitionRequest) (*Competition, error) {
	if !ValidScope(Scope(in.Scope)) {
		return nil, ErrScopeInvalid
	}
	c := &Competition{
		Name:                   in.Name,
		Scope:                  in.Scope,
		Subject:                in.Subject,
		ParticipatingSchoolIDs: in.ParticipatingSchoolIDs,
		Sponsor:                in.Sponsor,
		StartDate:              in.StartDate,
		EndDate:                in.EndDate,
		Status:                 feesstatemachine.CompetitionDraft,
	}
	if c.ParticipatingSchoolIDs == nil {
		c.ParticipatingSchoolIDs = []string{}
	}
	return s.store.CreateCompetition(ctx, c)
}

// Get returns a competition by id.
func (s *Service) Get(ctx context.Context, id string) (*Competition, error) {
	return s.store.GetCompetition(ctx, id)
}

// eventFromString maps an API event string to a feesstatemachine.Event. Returns
// ErrUnknownEvent for anything outside the linear competition pipeline.
func eventFromString(ev string) (feesstatemachine.Event, error) {
	switch feesstatemachine.Event(ev) {
	case feesstatemachine.EvCompOpenRegistration,
		feesstatemachine.EvCompCloseRegistration,
		feesstatemachine.EvCompStart,
		feesstatemachine.EvCompPendResults,
		feesstatemachine.EvCompComplete,
		feesstatemachine.EvCompArchive:
		return feesstatemachine.Event(ev), nil
	default:
		return "", ErrUnknownEvent
	}
}

// Transition advances a competition by firing an event through the shared state
// machine. Illegal (skip/backward) moves and out-of-terminal moves are rejected
// with the state machine's typed errors; ErrAlreadyInState is surfaced as a
// no-op success (returns the current competition unchanged).
func (s *Service) Transition(ctx context.Context, id, eventStr string) (*Competition, error) {
	ev, err := eventFromString(eventStr)
	if err != nil {
		return nil, err
	}
	c, err := s.store.GetCompetition(ctx, id)
	if err != nil {
		return nil, err
	}
	next, err := feesstatemachine.CompetitionTransition(c.Status, ev)
	if err != nil {
		if err == feesstatemachine.ErrAlreadyInState {
			// Idempotent no-op: already there.
			return c, nil
		}
		return nil, err
	}
	if err := s.store.UpdateCompetitionStatus(ctx, id, next); err != nil {
		return nil, err
	}
	c.Status = next
	return c, nil
}

// Register enrolls a school in a competition. Only permitted while the
// competition is in open_registration (build-spec: registration after
// registration_closed is rejected). Idempotent via the UNIQUE constraint.
func (s *Service) Register(ctx context.Context, competitionID, schoolID string) (*CompetitionRegistration, error) {
	c, err := s.store.GetCompetition(ctx, competitionID)
	if err != nil {
		return nil, err
	}
	if c.Status != feesstatemachine.CompetitionOpenRegistration {
		return nil, ErrRegistrationClosed
	}
	return s.store.RegisterSchool(ctx, competitionID, schoolID)
}

// ListRegistrations returns the schools registered for a competition.
func (s *Service) ListRegistrations(ctx context.Context, competitionID string) ([]CompetitionRegistration, error) {
	return s.store.ListRegistrations(ctx, competitionID)
}

// RecordScore writes one cross-school leaderboard entry for the competition. The
// LeaderboardManager enforces the ScoringLocked boundary against the competition's
// CURRENT status — so a score write is rejected the instant the competition is
// results_pending or later (SF §3.4). scopeRef pins the ladder to the competition
// so entries never collide across contests.
func (s *Service) RecordScore(ctx context.Context, competitionID string, req RecordScoreRequest) error {
	c, err := s.store.GetCompetition(ctx, competitionID)
	if err != nil {
		return err
	}
	if !ValidScope(Scope(req.Scope)) {
		return ErrScopeInvalid
	}
	return s.leaderboard.WriteEntry(
		ctx, c.Status, Scope(req.Scope),
		leaderboardScopeRef(competitionID, req.SchoolID, Scope(req.Scope)),
		req.PeriodKey, req,
	)
}

// ReadLeaderboard reads the raw (full-identity) cross-school leaderboard for a
// competition + scope selection. Callers MUST serialize with a Serializer before
// public exposure (SF-7).
func (s *Service) ReadLeaderboard(ctx context.Context, competitionID, schoolID, subject, periodKey string, scope Scope, limit int) ([]LeaderboardEntry, error) {
	if !ValidScope(scope) {
		return nil, ErrScopeInvalid
	}
	return s.leaderboard.ReadEntries(ctx, scope, leaderboardScopeRef(competitionID, schoolID, scope), subject, periodKey, limit)
}

// leaderboardScopeRef builds the academy_leaderboards.scope_ref for a competition
// ladder. For class/school scope the school id disambiguates; for city/state/
// national the ladder is competition-wide (all participating schools ranked
// together), so only the competition id is used.
func leaderboardScopeRef(competitionID, schoolID string, scope Scope) string {
	switch scope {
	case ScopeClass, ScopeSchool:
		return "comp:" + competitionID + ":school:" + schoolID
	default: // city / state / national — cross-school rollup
		return "comp:" + competitionID
	}
}
