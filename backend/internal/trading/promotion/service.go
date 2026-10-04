package promotion

import (
	"context"
	"errors"
	"fmt"
	"spotlight/backend/internal/trading/ladder"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
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

// RBAC permission slugs — MUST match the seeds in migration 20261029000300.
const (
	PermPropose = "trading.promotion.propose" // maker
	PermApprove = "trading.promotion.approve" // checker
	PermHalt    = "trading.promotion.halt"    // Risk/admin — halt + de-risk
	PermRead    = "trading.promotion.read"
	PermRisk    = "trading.promotion.risk" // Risk sign-off for Canary→Live
)

// Strategy mirrors public.trading_strategy_promotions.
// Strategy is serialised to BOTH the member /strategies route (mobile
// src/features/aitrading) and the admin promotions list — json tags required.
type Strategy struct {
	StrategyID       string       `json:"strategy_id"`
	Stage            ladder.Stage `json:"stage"`
	ValidationPassed bool         `json:"validation_passed"`
	TrackRecordDays  int          `json:"track_record_days"`
	CircuitTripped   bool         `json:"circuit_tripped"`
	Version          int          `json:"version"`
	UpdatedAt        time.Time    `json:"updated_at"`
}

// Event mirrors public.trading_promotion_events (append-only audit).
type Event struct {
	StrategyID     string
	EventType      string
	OldStage       string
	NewStage       string
	MakerID        *string
	CheckerID      *string
	RiskSignedOff  *bool
	LegalSignedOff *bool
	Reason         string
	CreatedAt      time.Time
}

// Sentinel errors (mapped to HTTP by the handler).
var (
	ErrNotFound        = errors.New("trading promotion: strategy not found")
	ErrVersionConflict = errors.New("trading promotion: strategy changed concurrently, retry")
	ErrReasonRequired  = errors.New("trading promotion: reason is required")
	// ErrDenied wraps a ladder gate rejection (illegal transition / unmet gate).
	ErrDenied = errors.New("trading promotion: transition denied")
)

// DefaultRequirements are the track-record thresholds for promotion, fixed by
// policy. Conservative by design; tuned in the validation phase, never by a client.
func DefaultRequirements() ladder.Requirements {
	return ladder.Requirements{
		ShadowMinTrackRecordDays: 30,
		CanaryMinTrackRecordDays: 60,
		LiveMinTrackRecordDays:   90,
	}
}

type Repository struct{ db *pgxpool.Pool }

func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

// Get loads a strategy. exists=false means no row yet — the caller treats that as
// a synthetic NOT_PROMOTED (fail-closed: nothing is eligible until registered).
func (r *Repository) Get(ctx context.Context, strategyID string) (Strategy, bool, error) {
	var err error

	var s Strategy

	var stage string
	err = r.db.QueryRow(ctx, `
		SELECT stage, validation_passed, track_record_days, circuit_tripped, version, updated_at
		FROM public.trading_strategy_promotions WHERE strategy_id=$1`, strategyID).
		Scan(&stage, &s.ValidationPassed, &s.TrackRecordDays, &s.CircuitTripped, &s.Version, &s.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Strategy{StrategyID: strategyID, Stage: ladder.StageNotPromoted}, false, nil
	}
	if err != nil {
		return Strategy{}, false, err
	}
	s.StrategyID = strategyID
	s.Stage = ladder.Stage(stage)
	return s, true, nil
}

// Register creates a strategy at NOT_PROMOTED if it does not exist, and appends a
// register event. Idempotent.
func (r *Repository) Register(ctx context.Context, strategyID string) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	tag, err := tx.Exec(ctx, `
		INSERT INTO public.trading_strategy_promotions (strategy_id) VALUES ($1)
		ON CONFLICT (strategy_id) DO NOTHING`, strategyID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() > 0 {
		if _, err := tx.Exec(ctx, `
			INSERT INTO public.trading_promotion_events (strategy_id, event_type, new_stage)
			VALUES ($1, 'register', 'not_promoted')`, strategyID); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// Apply is the ONE stage-write path: it updates stage (guarded on version) and
// appends an immutable event, in a single transaction. A version mismatch (the row
// changed since the caller read it) returns ErrVersionConflict.
type Apply struct {
	To             ladder.Stage
	ExpectVersion  int
	EventType      string
	MakerID        *string
	CheckerID      *string
	RiskSignedOff  *bool
	LegalSignedOff *bool
	Reason         string
}

func (r *Repository) Apply(ctx context.Context, strategyID string, from ladder.Stage, a Apply) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	tag, err := tx.Exec(ctx, `
		UPDATE public.trading_strategy_promotions
		SET stage=$2, version=version+1, updated_at=now()
		WHERE strategy_id=$1 AND version=$3`, strategyID, string(a.To), a.ExpectVersion)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrVersionConflict
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO public.trading_promotion_events
			(strategy_id, event_type, old_stage, new_stage, maker_id, checker_id, risk_signed_off, legal_signed_off, reason)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
		strategyID, a.EventType, string(from), string(a.To), a.MakerID, a.CheckerID, a.RiskSignedOff, a.LegalSignedOff, a.Reason); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// SetReadiness updates the validation verdict + track-record days (guarded on
// version) and appends a readiness event. Never changes the stage.
func (r *Repository) SetReadiness(ctx context.Context, strategyID string, expectVersion int, validationPassed bool, trackRecordDays int, circuitTripped bool, actorID *string) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	tag, err := tx.Exec(ctx, `
		UPDATE public.trading_strategy_promotions
		SET validation_passed=$2, track_record_days=$3, circuit_tripped=$4, version=version+1, updated_at=now()
		WHERE strategy_id=$1 AND version=$5`, strategyID, validationPassed, trackRecordDays, circuitTripped, expectVersion)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrVersionConflict
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO public.trading_promotion_events (strategy_id, event_type, checker_id, reason)
		VALUES ($1, 'readiness', $2, $3)`, strategyID, actorID, "readiness update"); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// List returns all strategies (admin ladder view).
func (r *Repository) List(ctx context.Context) ([]Strategy, error) {
	rows, err := r.db.Query(ctx, `
		SELECT strategy_id, stage, validation_passed, track_record_days, circuit_tripped, version, updated_at
		FROM public.trading_strategy_promotions ORDER BY strategy_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Strategy
	for rows.Next() {
		var s Strategy
		var stage string
		if err := rows.Scan(&s.StrategyID, &stage, &s.ValidationPassed, &s.TrackRecordDays, &s.CircuitTripped, &s.Version, &s.UpdatedAt); err != nil {
			return nil, err
		}
		s.Stage = ladder.Stage(stage)
		out = append(out, s)
	}
	return out, rows.Err()
}

// Events returns a strategy's audit trail (newest first).
func (r *Repository) Events(ctx context.Context, strategyID string, limit int) ([]Event, error) {
	rows, err := r.db.Query(ctx, `
		SELECT strategy_id, event_type, COALESCE(old_stage,''), COALESCE(new_stage,''), maker_id, checker_id, risk_signed_off, legal_signed_off, COALESCE(reason,''), created_at
		FROM public.trading_promotion_events WHERE strategy_id=$1 ORDER BY created_at DESC LIMIT $2`, strategyID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Event
	for rows.Next() {
		var e Event
		if err := rows.Scan(&e.StrategyID, &e.EventType, &e.OldStage, &e.NewStage, &e.MakerID, &e.CheckerID, &e.RiskSignedOff, &e.LegalSignedOff, &e.Reason, &e.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}
