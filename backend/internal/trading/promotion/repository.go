package promotion

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/trading/ladder"
)

type Repository struct{ db *pgxpool.Pool }

func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

// Get loads a strategy. exists=false means no row yet — the caller treats that as
// a synthetic NOT_PROMOTED (fail-closed: nothing is eligible until registered).
func (r *Repository) Get(ctx context.Context, strategyID string) (s Strategy, exists bool, err error) {
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
