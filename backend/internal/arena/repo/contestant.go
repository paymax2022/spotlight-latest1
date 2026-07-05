package repo

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/arena"
	"spotlight/backend/internal/arena/service"
)

// ContestantRepo persists contestants + guarded lifecycle transitions. The
// unique(competition_id,user_id) constraint enforces NDC-3 (one human → one entry).
type ContestantRepo struct{ pool *pgxpool.Pool }

// NewContestantRepo builds the contestant repo.
func NewContestantRepo(pool *pgxpool.Pool) *ContestantRepo { return &ContestantRepo{pool: pool} }

var _ service.ContestantRepo = (*ContestantRepo)(nil)

func scanContestant(row pgx.Row) (*service.Contestant, error) {
	var (
		c        service.Contestant
		state    string
		kycTier  *int
		home     *string
		batch    *string
	)
	if err := row.Scan(&c.ID, &c.CompetitionID, &c.UserID, &state, &kycTier, &home, &batch); err != nil {
		return nil, err
	}
	c.State = arena.ContestantState(state)
	if kycTier != nil {
		c.KYCTier = *kycTier
	}
	if home != nil {
		c.HomeState = *home
	}
	if batch != nil {
		c.TheoryBatch = *batch
	}
	return &c, nil
}

const contestantCols = `id, competition_id, user_id, state, kyc_tier, home_state, theory_batch`

// Create makes a new APPLIED contestant. A duplicate (competition_id,user_id) →
// ErrConflict (NDC-3).
func (r *ContestantRepo) Create(ctx context.Context, competitionID, userID string, kycTier int, homeState string) (*service.Contestant, error) {
	row := r.pool.QueryRow(ctx, `
		INSERT INTO arena_contestant (competition_id, user_id, kyc_tier, home_state, state)
		VALUES ($1,$2,$3, NULLIF($4,''), 'APPLIED')
		RETURNING `+contestantCols, competitionID, userID, kycTier, homeState)
	c, err := scanContestant(row)
	if err != nil {
		if isUniqueViolation(err) {
			return nil, service.ErrConflict
		}
		return nil, err
	}
	return c, nil
}

// Get returns a contestant by id.
func (r *ContestantRepo) Get(ctx context.Context, competitionID, contestantID string) (*service.Contestant, error) {
	row := r.pool.QueryRow(ctx, `
		SELECT `+contestantCols+` FROM arena_contestant
		 WHERE competition_id = $1 AND id = $2`, competitionID, contestantID)
	c, err := scanContestant(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, service.ErrNotFound
	}
	return c, err
}

// GetByUser returns the caller's own contestant row.
func (r *ContestantRepo) GetByUser(ctx context.Context, competitionID, userID string) (*service.Contestant, error) {
	row := r.pool.QueryRow(ctx, `
		SELECT `+contestantCols+` FROM arena_contestant
		 WHERE competition_id = $1 AND user_id = $2`, competitionID, userID)
	c, err := scanContestant(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, service.ErrNotFound
	}
	return c, err
}

// ListByState lists contestants in a given lifecycle state (review queue etc.).
func (r *ContestantRepo) ListByState(ctx context.Context, competitionID string, state arena.ContestantState) ([]service.Contestant, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT `+contestantCols+` FROM arena_contestant
		 WHERE competition_id = $1 AND state = $2
		 ORDER BY created_at`, competitionID, string(state))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []service.Contestant{}
	for rows.Next() {
		c, err := scanContestant(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *c)
	}
	return out, rows.Err()
}

// UpdateState performs the state change atomically with sideEffect (award
// finalize + credential issue + pot trigger on CROWNED) in ONE tx. The row is
// locked FOR UPDATE and the compare-and-set on `from` guards against a lost
// update; a stale `from` → ErrConflict.
func (r *ContestantRepo) UpdateState(ctx context.Context, contestantID string, from, to arena.ContestantState, sideEffect func(ctx context.Context) error) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var current string
	err = tx.QueryRow(ctx, `SELECT state FROM arena_contestant WHERE id = $1 FOR UPDATE`, contestantID).Scan(&current)
	if errors.Is(err, pgx.ErrNoRows) {
		return service.ErrNotFound
	}
	if err != nil {
		return err
	}
	if arena.ContestantState(current) != from {
		return service.ErrConflict
	}

	tag, err := tx.Exec(ctx, `
		UPDATE arena_contestant SET state = $2, updated_at = now()
		 WHERE id = $1 AND state = $3`, contestantID, string(to), string(from))
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return service.ErrConflict
	}

	if sideEffect != nil {
		// Run side-effects inside the SAME tx so CROWNED's award/credential/pot
		// trigger commit-or-rollback with the state change.
		txCtx := withTx(ctx, tx)
		if err := sideEffect(txCtx); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}
