package connectvoting

import (
	"context"
	"fmt"
	"time"
)

// TriggerEvictions calls the RPC to mark bottom 20% for eviction
func (r *Repository) TriggerEvictions(ctx context.Context, contestID string, stageNumber, evictionPercentage, gracePeriodHours int, actorID string) ([]EvictionResponse, error) {
	const q = `
		SELECT evicted_contestant_id, vote_count, eviction_rank, eviction_record_id
		FROM public.evict_bottom_percentage($1, $2, $3, $4, $5::uuid)
	`

	rows, err := r.db.Query(ctx, q, contestID, stageNumber, evictionPercentage, gracePeriodHours, actorID)
	if err != nil {
		return nil, fmt.Errorf("evict_bottom_percentage failed: %w", err)
	}
	defer rows.Close()

	var results []EvictionResponse
	for rows.Next() {
		var resp EvictionResponse
		if err := rows.Scan(&resp.ContestantID, &resp.VoteCount, &resp.EvictionRank, &resp.EvictionID); err != nil {
			return nil, fmt.Errorf("scan eviction result failed: %w", err)
		}
		resp.EvictedAt = time.Now()
		resp.GracePeriodEnd = time.Now().Add(time.Duration(gracePeriodHours) * time.Hour)
		results = append(results, resp)
	}

	return results, rows.Err()
}

// SaveContestant calls the RPC to save a contestant from eviction
func (r *Repository) SaveContestant(ctx context.Context, evictionID, actorID, saveType, reason string) (*SaveResponse, error) {
	const q = `
		SELECT success, message, save_record_id
		FROM public.save_contestant_from_eviction($1::uuid, $2::uuid, $3, $4)
	`

	var resp SaveResponse
	var saveRecordID *string

	err := r.db.QueryRow(ctx, q, evictionID, actorID, saveType, reason).Scan(
		&resp.Success,
		&resp.Message,
		&saveRecordID,
	)
	if err != nil {
		return nil, fmt.Errorf("save_contestant_from_eviction failed: %w", err)
	}

	if saveRecordID != nil {
		resp.SaveRecordID = *saveRecordID
	}

	return &resp, nil
}

// ExtendGracePeriod calls the RPC to extend grace period
func (r *Repository) ExtendGracePeriod(ctx context.Context, evictionID string, additionalHours int, actorID string) (*SaveResponse, error) {
	const q = `
		SELECT success, message, new_grace_period_ends_at
		FROM public.extend_eviction_grace_period($1::uuid, $2, $3::uuid)
	`

	var success bool
	var message string
	var newEndTime *time.Time

	err := r.db.QueryRow(ctx, q, evictionID, additionalHours, actorID).Scan(
		&success,
		&message,
		&newEndTime,
	)
	if err != nil {
		return nil, fmt.Errorf("extend_eviction_grace_period failed: %w", err)
	}

	return &SaveResponse{
		Success: success,
		Message: message,
	}, nil
}

// FinalizeEvictions calls the RPC to finalize evictions
func (r *Repository) FinalizeEvictions(ctx context.Context, contestID string, stageNumber int) (*SaveResponse, error) {
	const q = `
		SELECT finalized_count, saved_count
		FROM public.finalize_stage_evictions($1::uuid, $2)
	`

	var finalizedCount, savedCount int

	err := r.db.QueryRow(ctx, q, contestID, stageNumber).Scan(
		&finalizedCount,
		&savedCount,
	)
	if err != nil {
		return nil, fmt.Errorf("finalize_stage_evictions failed: %w", err)
	}

	return &SaveResponse{
		Success: true,
		Message: fmt.Sprintf("Evictions finalized: %d removed, %d saved", finalizedCount, savedCount),
	}, nil
}

// GetContestantsByStage retrieves all contestants in a stage
func (r *Repository) GetContestantsByStage(ctx context.Context, contestID string, stageNumber int) ([]StageContestant, error) {
	const q = `
		SELECT
			c.id,
			c.name,
			COALESCE(c.photo_url, ''),
			COALESCE(vt.total_confirmed_votes, 0),
			COALESCE(c.eviction_status, 'none'),
			COALESCE(c.eviction_template, 'normal'),
			ce.id,
			ce.grace_period_ends_at
		FROM public.contestants c
		LEFT JOIN public.contestant_stage_assignments csa
			ON c.id = csa.contestant_id
			AND csa.contest_id = $1
			AND csa.stage_number = $2
		LEFT JOIN public.vote_totals vt
			ON c.id = vt.contestant_id
			AND vt.contest_id = $1
		LEFT JOIN public.contestant_evictions ce
			ON c.id = ce.contestant_id
			AND ce.contest_id = $1
			AND ce.stage_number = $2
			AND ce.status = 'pending'
		WHERE csa.id IS NOT NULL
		ORDER BY vt.total_confirmed_votes DESC
	`

	rows, err := r.db.Query(ctx, q, contestID, stageNumber)
	if err != nil {
		return nil, fmt.Errorf("get_contestants_by_stage failed: %w", err)
	}
	defer rows.Close()

	var contestants []StageContestant
	for rows.Next() {
		var c StageContestant
		var evictionID *string
		var gracePeriodEnd *time.Time

		if err := rows.Scan(
			&c.ID,
			&c.Name,
			&c.PhotoURL,
			&c.VoteCount,
			&c.EvictionStatus,
			&c.EvictionTemplate,
			&evictionID,
			&gracePeriodEnd,
		); err != nil {
			return nil, fmt.Errorf("scan contestant failed: %w", err)
		}

		c.EvictionID = evictionID
		c.GracePeriodEnd = gracePeriodEnd
		contestants = append(contestants, c)
	}

	return contestants, rows.Err()
}

// GetEvictions retrieves all pending evictions
func (r *Repository) GetEvictions(ctx context.Context, contestID string, stageNum string) ([]EvictionInfo, error) {
	var q string
	var args []any

	if stageNum == "" {
		q = `
			SELECT
				ce.id,
				ce.contestant_id,
				c.name,
				ce.stage_number,
				ce.vote_count,
				ce.eviction_rank,
				ce.grace_period_ends_at,
				ce.status,
				COALESCE(COUNT(jsr.id), 0),
				CASE WHEN ce.status = 'pending' THEN true ELSE false END
			FROM public.contestant_evictions ce
			JOIN public.contestants c ON c.id = ce.contestant_id
			LEFT JOIN public.judge_save_records jsr ON jsr.eviction_id = ce.id
			WHERE ce.contest_id = $1
			GROUP BY ce.id, c.name
			ORDER BY ce.grace_period_ends_at ASC
		`
		args = []any{contestID}
	} else {
		q = `
			SELECT
				ce.id,
				ce.contestant_id,
				c.name,
				ce.stage_number,
				ce.vote_count,
				ce.eviction_rank,
				ce.grace_period_ends_at,
				ce.status,
				COALESCE(COUNT(jsr.id), 0),
				CASE WHEN ce.status = 'pending' THEN true ELSE false END
			FROM public.contestant_evictions ce
			JOIN public.contestants c ON c.id = ce.contestant_id
			LEFT JOIN public.judge_save_records jsr ON jsr.eviction_id = ce.id
			WHERE ce.contest_id = $1 AND ce.stage_number = $2
			GROUP BY ce.id, c.name
			ORDER BY ce.grace_period_ends_at ASC
		`
		args = []any{contestID, stageNum}
	}

	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("get_evictions failed: %w", err)
	}
	defer rows.Close()

	var evictions []EvictionInfo
	for rows.Next() {
		var e EvictionInfo
		if err := rows.Scan(
			&e.ID,
			&e.ContestantID,
			&e.ContestantName,
			&e.StageNumber,
			&e.VoteCount,
			&e.EvictionRank,
			&e.GracePeriodEndsAt,
			&e.Status,
			&e.SaveCount,
			&e.CanBeSaved,
		); err != nil {
			return nil, fmt.Errorf("scan eviction failed: %w", err)
		}
		evictions = append(evictions, e)
	}

	return evictions, rows.Err()
}

// AdminVote records an admin vote (no ledger debit)
func (r *Repository) AdminVote(ctx context.Context, contestID, contestantID, actorID string, voteQuantity int) (*Vote, error) {
	// For now, insert directly into votes table
	// In production, you might want to use a dedicated admin_votes table or a flag
	const ins = `
		INSERT INTO connect_votes
		(contest_id, voter_id, option_ref, paid, quantity, amount_kobo, ledger_ref, created_at)
		VALUES ($1, $2, $3, false, $4, 0, NULL, NOW())
		RETURNING id, contest_id, voter_id, option_ref, paid, quantity, amount_kobo, created_at
	`

	vote := &Vote{}
	err := r.db.QueryRow(ctx, ins, contestID, actorID, contestantID, voteQuantity).Scan(
		&vote.ID,
		&vote.ContestID,
		&vote.VoterID,
		&vote.OptionRef,
		&vote.Paid,
		&vote.Quantity,
		&vote.AmountKobo,
		&vote.CreatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("insert admin vote failed: %w", err)
	}

	return vote, nil
}
