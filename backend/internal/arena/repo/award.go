package repo

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/arena/service"
)

// AwardRepo persists finalized signed award results (append-only; UPDATE/DELETE
// blocked by the arena_award_result_immutable trigger).
type AwardRepo struct{ pool *pgxpool.Pool }

// NewAwardRepo builds the award repo.
func NewAwardRepo(pool *pgxpool.Pool) *AwardRepo { return &AwardRepo{pool: pool} }

var _ service.AwardRepo = (*AwardRepo)(nil)

// Finalize records a signed award result. computed_from records which rails fed
// the award (the crown = {MERIT} only). Enlists in an outer tx when present
// (CROWNED path). A duplicate (competition, award_type, subject) → ErrConflict.
func (r *AwardRepo) Finalize(ctx context.Context, competitionID, awardType, subjectID string, computedFrom []string, value float64, signature string) error {
	_, err := q(ctx, r.pool).Exec(ctx, `
		INSERT INTO arena_award_result
			(competition_id, award_type, subject_id, computed_from, value, signature)
		VALUES ($1, $2, $3, $4, $5, NULLIF($6,''))
		ON CONFLICT (competition_id, award_type, subject_id) DO NOTHING`,
		competitionID, awardType, subjectID, computedFrom, value, signature)
	return err
}
