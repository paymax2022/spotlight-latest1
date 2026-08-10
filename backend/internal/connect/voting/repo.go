package connectvoting

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository handles connect_contests + connect_votes reads/writes over a pgx
// pool. Vote inserts are append-only (immutable tally records). All queries are
// parameterized.
type Repository struct {
	db *pgxpool.Pool
}

// NewRepository builds a voting repository.
func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

const contestColumns = `id, title, description, status, paid_vote_kobo,
	free_votes_per_user, velocity_per_minute, opens_at, closes_at, created_at`

// ListContests returns open/closed contests, newest first.
func (r *Repository) ListContests(ctx context.Context, limit int) ([]Contest, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	const q = `SELECT ` + contestColumns + ` FROM connect_contests
		WHERE status IN ('open','closed') ORDER BY created_at DESC LIMIT $1`
	rows, err := r.db.Query(ctx, q, limit)
	if err != nil {
		return nil, fmt.Errorf("voting: list contests: %w", err)
	}
	defer rows.Close()
	var out []Contest
	for rows.Next() {
		c, err := scanContest(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *c)
	}
	return out, rows.Err()
}

// GetContest fetches a single contest by id.
func (r *Repository) GetContest(ctx context.Context, id string) (*Contest, error) {
	const q = `SELECT ` + contestColumns + ` FROM connect_contests WHERE id = $1`
	return scanContest(r.db.QueryRow(ctx, q, id))
}

// rowScanner abstracts pgx.Row / pgx.Rows for the shared contest scan.
type rowScanner interface {
	Scan(dest ...any) error
}

func scanContest(s rowScanner) (*Contest, error) {
	c := &Contest{}
	if err := s.Scan(
		&c.ID, &c.Title, &c.Description, &c.Status, &c.PaidVoteKobo,
		&c.FreeVotesPerUser, &c.VelocityPerMinute, &c.OpensAt, &c.ClosesAt, &c.CreatedAt,
	); err != nil {
		return nil, err
	}
	return c, nil
}

// CountFreeVotes returns how many free votes the user has cast in a contest.
func (r *Repository) CountFreeVotes(ctx context.Context, contestID, voterID string) (int, error) {
	const q = `SELECT COUNT(*) FROM connect_votes
		WHERE contest_id = $1 AND voter_id = $2 AND paid = false`
	var n int
	err := r.db.QueryRow(ctx, q, contestID, voterID).Scan(&n)
	return n, err
}

// CountRecentVotes returns how many votes (any kind) the user cast in a contest
// since `since` — used for the per-window velocity guard.
func (r *Repository) CountRecentVotes(ctx context.Context, contestID, voterID string, since time.Time) (int, error) {
	const q = `SELECT COUNT(*) FROM connect_votes
		WHERE contest_id = $1 AND voter_id = $2 AND created_at >= $3`
	var n int
	err := r.db.QueryRow(ctx, q, contestID, voterID, since).Scan(&n)
	return n, err
}

// InsertVote records an immutable vote row (free or paid).
func (r *Repository) InsertVote(ctx context.Context, v *Vote) (*Vote, error) {
	const ins = `INSERT INTO connect_votes
		(contest_id, voter_id, option_ref, paid, quantity, amount_kobo, idempotency_key, ledger_ref)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		RETURNING id, contest_id, voter_id, option_ref, paid, quantity, amount_kobo, ledger_ref, created_at`
	out := &Vote{}
	if err := r.db.QueryRow(ctx, ins,
		v.ContestID, v.VoterID, v.OptionRef, v.Paid, v.Quantity, v.AmountKobo, v.IdempotencyKey, v.LedgerRef,
	).Scan(
		&out.ID, &out.ContestID, &out.VoterID, &out.OptionRef, &out.Paid,
		&out.Quantity, &out.AmountKobo, &out.LedgerRef, &out.CreatedAt,
	); err != nil {
		return nil, fmt.Errorf("voting: insert vote: %w", err)
	}
	return out, nil
}

// Results tallies free vs paid vote units per option for a contest.
func (r *Repository) Results(ctx context.Context, contestID string) ([]ResultRow, error) {
	const q = `SELECT option_ref,
			COALESCE(SUM(CASE WHEN paid = false THEN quantity ELSE 0 END), 0) AS free_votes,
			COALESCE(SUM(CASE WHEN paid = true  THEN quantity ELSE 0 END), 0) AS paid_votes
		FROM connect_votes
		WHERE contest_id = $1
		GROUP BY option_ref
		ORDER BY (COALESCE(SUM(quantity),0)) DESC`
	rows, err := r.db.Query(ctx, q, contestID)
	if err != nil {
		return nil, fmt.Errorf("voting: results: %w", err)
	}
	defer rows.Close()
	var out []ResultRow
	for rows.Next() {
		var rr ResultRow
		if err := rows.Scan(&rr.OptionRef, &rr.FreeVotes, &rr.PaidVotes); err != nil {
			return nil, err
		}
		rr.TotalVotes = rr.FreeVotes + rr.PaidVotes
		out = append(out, rr)
	}
	return out, rows.Err()
}

// ContestStage represents a single contest stage with eviction config.
type ContestStage struct {
	ID                    string     `json:"id"`
	ContestID             string     `json:"contest_id"`
	StageNumber           int        `json:"stage_number"`
	StageName             string     `json:"stage_name"`
	StageDescription      *string    `json:"stage_description,omitempty"`
	EvictionPercentage    int        `json:"eviction_percentage"`
	MinContestantsToEvict int        `json:"min_contestants_to_evict"`
	VotingStartsAt        *time.Time `json:"voting_starts_at,omitempty"`
	VotingEndsAt          *time.Time `json:"voting_ends_at,omitempty"`
	IsActive              bool       `json:"is_active"`
	CreatedAt             time.Time  `json:"created_at"`
	UpdatedAt             time.Time  `json:"updated_at"`
}

// GetStages retrieves all stages for a contest, ordered by stage number.
func (r *Repository) GetStages(ctx context.Context, contestID string) ([]ContestStage, error) {
	const q = `SELECT id, contest_id, stage_number, stage_name, stage_description,
		eviction_percentage, min_contestants_to_evict, voting_starts_at, voting_ends_at,
		is_active, created_at, updated_at
	FROM public.contest_stages
	WHERE contest_id = $1
	ORDER BY stage_number ASC`
	rows, err := r.db.Query(ctx, q, contestID)
	if err != nil {
		return nil, fmt.Errorf("get stages: %w", err)
	}
	defer rows.Close()

	var stages []ContestStage
	for rows.Next() {
		var stage ContestStage
		if err := rows.Scan(
			&stage.ID, &stage.ContestID, &stage.StageNumber, &stage.StageName,
			&stage.StageDescription, &stage.EvictionPercentage, &stage.MinContestantsToEvict,
			&stage.VotingStartsAt, &stage.VotingEndsAt, &stage.IsActive,
			&stage.CreatedAt, &stage.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan stage: %w", err)
		}
		stages = append(stages, stage)
	}
	return stages, rows.Err()
}
