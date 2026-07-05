package repo

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/arena/service"
)

// EngagementRepo persists idempotent Play-Along / prediction events (engagement
// ledger — NEVER merit).
type EngagementRepo struct{ pool *pgxpool.Pool }

// NewEngagementRepo builds the engagement repo.
func NewEngagementRepo(pool *pgxpool.Pool) *EngagementRepo { return &EngagementRepo{pool: pool} }

var _ service.EngagementRepo = (*EngagementRepo)(nil)

// Record inserts an idempotent engagement event and returns the spectator's
// running points total and whether this call was a duplicate (idempotency_key
// already seen). The insert uses ON CONFLICT DO NOTHING; duplicate is detected by
// zero rows affected.
func (r *EngagementRepo) Record(ctx context.Context, competitionID, spectatorID, eventType, subjectID, idemKey string, points int) (totalPoints int, duplicate bool, err error) {
	tag, err := r.pool.Exec(ctx, `
		INSERT INTO arena_engagement_event
			(competition_id, spectator_id, type, subject_id, points, idempotency_key)
		VALUES ($1, $2, $3, NULLIF($4,'')::uuid, $5, $6)
		ON CONFLICT (idempotency_key) DO NOTHING`,
		competitionID, spectatorID, eventType, subjectID, points, idemKey)
	if err != nil {
		return 0, false, err
	}
	duplicate = tag.RowsAffected() == 0

	err = r.pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(points),0) FROM arena_engagement_event
		 WHERE competition_id = $1 AND spectator_id = $2`, competitionID, spectatorID).Scan(&totalPoints)
	if errors.Is(err, pgx.ErrNoRows) {
		err = nil
	}
	return totalPoints, duplicate, err
}

// CashbackCountToday counts today's play-along passes for a spectator (the rate
// limit on ledgered cashback). A QUIZ_PASS row is written once per successful
// attempt and carries the cashback marker; counting them bounds cashback per day.
func (r *EngagementRepo) CashbackCountToday(ctx context.Context, competitionID, spectatorID string) (int, error) {
	var n int
	err := r.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM arena_engagement_event
		 WHERE competition_id = $1 AND spectator_id = $2
		   AND type = 'QUIZ_PASS'
		   AND created_at >= date_trunc('day', now())`, competitionID, spectatorID).Scan(&n)
	return n, err
}
