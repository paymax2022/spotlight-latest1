package promotion

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/trading/ladder"
)

// Service drives the audited promotion ladder. Every stage change goes through the
// pure ladder.CanTransition gate, so the separation-of-duties and evidence rules
// live in one tested place; this layer adds persistence, audit, and authorization
// context. It executes NOTHING.
type Service struct {
	repo *Repository
	req  ladder.Requirements
}

func NewService(pool *pgxpool.Pool) *Service {
	return &Service{repo: NewRepository(pool), req: DefaultRequirements()}
}

// Register idempotently creates a strategy at NOT_PROMOTED.
func (s *Service) Register(ctx context.Context, strategyID string) error {
	if strings.TrimSpace(strategyID) == "" {
		return fmt.Errorf("promotion: strategy id required")
	}
	return s.repo.Register(ctx, strategyID)
}

// Get returns a strategy's current ladder position (synthetic NOT_PROMOTED if
// unregistered — fail-closed).
func (s *Service) Get(ctx context.Context, strategyID string) (Strategy, error) {
	st, _, err := s.repo.Get(ctx, strategyID)
	return st, err
}

// Stage returns just the current stage (used by the evaluate gate).
func (s *Service) Stage(ctx context.Context, strategyID string) (ladder.Stage, error) {
	st, _, err := s.repo.Get(ctx, strategyID)
	if err != nil {
		return ladder.StageNotPromoted, err
	}
	return st.Stage, nil
}

// Promote moves a strategy UP one rung. It is called by the CHECKER (whose
// permission the route enforces) and carries the maker's id; the ladder gate
// enforces maker≠checker, the passing validation verdict, the track-record
// threshold, and — for Live — the Risk + legal sign-offs. The verdict + track
// record come from the STRATEGY RECORD (server-side), never the request.
func (s *Service) Promote(ctx context.Context, checkerID, strategyID string, to ladder.Stage, makerID string, riskSignedOff, legalSignedOff bool) (Strategy, error) {
	cur, exists, err := s.repo.Get(ctx, strategyID)
	if err != nil {
		return Strategy{}, err
	}
	if !exists {
		return Strategy{}, ErrNotFound
	}
	ev := ladder.Evidence{
		ValidationPassed: cur.ValidationPassed,
		TrackRecordDays:  cur.TrackRecordDays,
		CircuitTripped:   cur.CircuitTripped,
		MakerID:          makerID,
		CheckerID:        checkerID,
		RiskSignedOff:    riskSignedOff,
		LegalSignedOff:   legalSignedOff,
	}
	if ok, reason := ladder.CanTransition(cur.Stage, to, ev, s.req); !ok {
		return Strategy{}, fmt.Errorf("%w: %s", ErrDenied, reason)
	}
	if err := s.repo.Apply(ctx, strategyID, cur.Stage, Apply{
		To: to, ExpectVersion: cur.Version, EventType: "promote",
		MakerID: &makerID, CheckerID: &checkerID,
		RiskSignedOff: &riskSignedOff, LegalSignedOff: &legalSignedOff,
		Reason: fmt.Sprintf("promote %s→%s", cur.Stage, to),
	}); err != nil {
		return Strategy{}, err
	}
	cur.Stage, cur.Version = to, cur.Version+1
	return cur, nil
}

// Demote steps a strategy DOWN the ladder (de-risk). Always permitted by the gate;
// the route restricts it to the halt/Risk permission.
func (s *Service) Demote(ctx context.Context, actorID, strategyID string, to ladder.Stage, reason string) (Strategy, error) {
	if strings.TrimSpace(reason) == "" {
		return Strategy{}, ErrReasonRequired
	}
	return s.stepDown(ctx, actorID, strategyID, to, "demote", reason)
}

// Halt is the emergency stop from any active stage.
func (s *Service) Halt(ctx context.Context, actorID, strategyID, reason string) (Strategy, error) {
	if strings.TrimSpace(reason) == "" {
		return Strategy{}, ErrReasonRequired
	}
	return s.stepDown(ctx, actorID, strategyID, ladder.StageHalted, "halt", reason)
}

func (s *Service) stepDown(ctx context.Context, actorID, strategyID string, to ladder.Stage, eventType, reason string) (Strategy, error) {
	cur, exists, err := s.repo.Get(ctx, strategyID)
	if err != nil {
		return Strategy{}, err
	}
	if !exists {
		return Strategy{}, ErrNotFound
	}
	if ok, r := ladder.CanTransition(cur.Stage, to, ladder.Evidence{}, s.req); !ok {
		return Strategy{}, fmt.Errorf("%w: %s", ErrDenied, r)
	}
	if err := s.repo.Apply(ctx, strategyID, cur.Stage, Apply{
		To: to, ExpectVersion: cur.Version, EventType: eventType,
		CheckerID: &actorID, Reason: reason,
	}); err != nil {
		return Strategy{}, err
	}
	cur.Stage, cur.Version = to, cur.Version+1
	return cur, nil
}

// SetReadiness records the latest validation verdict + track-record days (and
// circuit state) for a strategy — the inputs a future promotion is judged on. It
// never changes the stage.
func (s *Service) SetReadiness(ctx context.Context, actorID, strategyID string, validationPassed bool, trackRecordDays int, circuitTripped bool) (Strategy, error) {
	cur, exists, err := s.repo.Get(ctx, strategyID)
	if err != nil {
		return Strategy{}, err
	}
	if !exists {
		return Strategy{}, ErrNotFound
	}
	if err := s.repo.SetReadiness(ctx, strategyID, cur.Version, validationPassed, trackRecordDays, circuitTripped, &actorID); err != nil {
		return Strategy{}, err
	}
	cur.ValidationPassed, cur.TrackRecordDays, cur.CircuitTripped, cur.Version =
		validationPassed, trackRecordDays, circuitTripped, cur.Version+1
	return cur, nil
}

// List returns the full ladder (admin view).
func (s *Service) List(ctx context.Context) ([]Strategy, error) { return s.repo.List(ctx) }

// Events returns a strategy's audit trail.
func (s *Service) Events(ctx context.Context, strategyID string, limit int) ([]Event, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	return s.repo.Events(ctx, strategyID, limit)
}

// PublicStrategy is the SANITIZED member-facing view of a strategy's ladder
// position: stage + real-capital eligibility only. It deliberately omits the
// validation verdict, track record, circuit state, version, and all audit/maker-
// checker detail — those are internal governance, not member-facing.
type PublicStrategy struct {
	StrategyID          string       `json:"strategy_id"`
	Stage               ladder.Stage `json:"stage"`
	RealCapitalEligible bool         `json:"real_capital_eligible"` // canary/live — still stubbed (no venue adapter)
}

// PublicList returns the sanitized ladder for member transparency (§12): which
// strategies exist and at what validated maturity. NotPromoted strategies are
// hidden (not yet part of the managed set).
func (s *Service) PublicList(ctx context.Context) ([]PublicStrategy, error) {
	all, err := s.repo.List(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]PublicStrategy, 0, len(all))
	for _, st := range all {
		if st.Stage == ladder.StageNotPromoted {
			continue
		}
		out = append(out, PublicStrategy{
			StrategyID:          st.StrategyID,
			Stage:               st.Stage,
			RealCapitalEligible: ladder.AllowsRealCapital(st.Stage),
		})
	}
	return out, nil
}

// Evaluable reports whether a strategy's stage permits running the evaluation
// pipeline at all: Paper and above, but not NotPromoted or Halted. Fail-closed.
func (s *Service) Evaluable(ctx context.Context, strategyID string) (ladder.Stage, bool, error) {
	st, _, err := s.repo.Get(ctx, strategyID)
	if err != nil {
		return ladder.StageNotPromoted, false, err
	}
	switch st.Stage {
	case ladder.StagePaper, ladder.StageShadow, ladder.StageCanary, ladder.StageLive:
		return st.Stage, true, nil
	default:
		return st.Stage, false, nil
	}
}
