package gamification

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository is the parameterized data layer for gamification tables.
type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

func decodeJSON(raw []byte) map[string]any {
	out := map[string]any{}
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &out)
	}
	return out
}

const missionCols = `id, slug, title, description, mission_type, target_count,
	points_reward, cash_reward_kobo, campaign_id, is_active, starts_at, ends_at`

func scanMission(row pgx.Row) (*Mission, error) {
	var (
		m          Mission
		desc, camp *string
	)
	if err := row.Scan(&m.ID, &m.Slug, &m.Title, &desc, &m.MissionType, &m.TargetCount,
		&m.PointsReward, &m.CashRewardKobo, &camp, &m.IsActive, &m.StartsAt, &m.EndsAt); err != nil {
		return nil, err
	}
	if desc != nil {
		m.Description = *desc
	}
	if camp != nil {
		m.CampaignID = *camp
	}
	return &m, nil
}

// ListActiveMissions returns active, in-window missions for members.
func (r *Repository) ListActiveMissions(ctx context.Context) ([]Mission, error) {
	q := `SELECT ` + missionCols + ` FROM referral_missions
		WHERE is_active = true
		  AND (starts_at IS NULL OR starts_at <= now())
		  AND (ends_at IS NULL OR ends_at >= now())
		ORDER BY created_at DESC`
	return r.queryMissions(ctx, q)
}

// ListAllMissions returns every mission (admin).
func (r *Repository) ListAllMissions(ctx context.Context) ([]Mission, error) {
	q := `SELECT ` + missionCols + ` FROM referral_missions ORDER BY created_at DESC LIMIT 500`
	return r.queryMissions(ctx, q)
}

func (r *Repository) queryMissions(ctx context.Context, q string, args ...any) ([]Mission, error) {
	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("gamification: query missions: %w", err)
	}
	defer rows.Close()
	var out []Mission
	for rows.Next() {
		m, err := scanMission(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *m)
	}
	return out, rows.Err()
}

// GetMission returns one mission by id.
func (r *Repository) GetMission(ctx context.Context, id string) (*Mission, error) {
	q := `SELECT ` + missionCols + ` FROM referral_missions WHERE id = $1`
	return scanMission(r.db.QueryRow(ctx, q, id))
}

// CreateMission inserts a mission (admin builder).
func (r *Repository) CreateMission(ctx context.Context, in MissionInput) (*Mission, error) {
	mt := in.MissionType
	if mt == "" {
		mt = "quest"
	}
	tc := in.TargetCount
	if tc <= 0 {
		tc = 1
	}
	const q = `
		INSERT INTO referral_missions
			(slug, title, description, mission_type, target_count, points_reward,
			 cash_reward_kobo, campaign_id, is_active, starts_at, ends_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
		RETURNING ` + missionCols
	return scanMission(r.db.QueryRow(ctx, q, in.Slug, in.Title, nullable(in.Description), mt, tc,
		in.PointsReward, in.CashRewardKobo, nullable(in.CampaignID), in.IsActive, in.StartsAt, in.EndsAt))
}

// GetProgress returns a user's progress against a mission (nil row → zero state).
func (r *Repository) GetProgress(ctx context.Context, missionID, userID string) (*MissionProgress, error) {
	const q = `
		SELECT id, mission_id, user_id, progress, status, claimed_at
		FROM referral_mission_progress WHERE mission_id = $1 AND user_id = $2`
	var p MissionProgress
	err := r.db.QueryRow(ctx, q, missionID, userID).Scan(
		&p.ID, &p.MissionID, &p.UserID, &p.Progress, &p.Status, &p.ClaimedAt)
	if err == pgx.ErrNoRows {
		return &MissionProgress{MissionID: missionID, UserID: userID, Progress: 0, Status: ProgressInProgress}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("gamification: get progress: %w", err)
	}
	return &p, nil
}

// ListUserProgress returns all of a user's mission progress rows.
func (r *Repository) ListUserProgress(ctx context.Context, userID string) ([]MissionProgress, error) {
	const q = `
		SELECT id, mission_id, user_id, progress, status, claimed_at
		FROM referral_mission_progress WHERE user_id = $1 ORDER BY updated_at DESC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, fmt.Errorf("gamification: list progress: %w", err)
	}
	defer rows.Close()
	var out []MissionProgress
	for rows.Next() {
		var p MissionProgress
		if err := rows.Scan(&p.ID, &p.MissionID, &p.UserID, &p.Progress, &p.Status, &p.ClaimedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// MarkClaimed flips a progress row to 'claimed' with the claim idempotency key,
// only if it is currently 'completed'. Returns true when this call performed the
// transition (so the caller knows whether to grant the reward exactly once).
func (r *Repository) MarkClaimed(ctx context.Context, missionID, userID, idemKey string) (bool, error) {
	const q = `
		INSERT INTO referral_mission_progress (mission_id, user_id, progress, status, claimed_at, claim_idempotency_key)
		VALUES ($1, $2, 0, 'claimed', now(), $3)
		ON CONFLICT (mission_id, user_id) DO UPDATE
			SET status = 'claimed', claimed_at = now(), claim_idempotency_key = EXCLUDED.claim_idempotency_key, updated_at = now()
			WHERE referral_mission_progress.status = 'completed'
		RETURNING id`
	var id string
	err := r.db.QueryRow(ctx, q, missionID, userID, idemKey).Scan(&id)
	if err == pgx.ErrNoRows {
		return false, nil // not completed / already claimed
	}
	if err != nil {
		return false, fmt.Errorf("gamification: mark claimed: %w", err)
	}
	return true, nil
}

// UserPoints sums a user's awarded NON-CASH points from claimed missions.
func (r *Repository) UserPoints(ctx context.Context, userID string) (int, error) {
	const q = `
		SELECT COALESCE(SUM(m.points_reward), 0)
		FROM referral_mission_progress p
		JOIN referral_missions m ON m.id = p.mission_id
		WHERE p.user_id = $1 AND p.status = 'claimed'`
	var pts int
	if err := r.db.QueryRow(ctx, q, userID).Scan(&pts); err != nil {
		return 0, fmt.Errorf("gamification: user points: %w", err)
	}
	return pts, nil
}

// ListRanks returns ranks ordered by tier.
func (r *Repository) ListRanks(ctx context.Context) ([]Rank, error) {
	const q = `SELECT id, slug, name, tier_order, min_points, perks FROM referral_ranks ORDER BY tier_order`
	rows, err := r.db.Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("gamification: list ranks: %w", err)
	}
	defer rows.Close()
	var out []Rank
	for rows.Next() {
		var (
			rk  Rank
			raw []byte
		)
		if err := rows.Scan(&rk.ID, &rk.Slug, &rk.Name, &rk.TierOrder, &rk.MinPoints, &raw); err != nil {
			return nil, err
		}
		rk.Perks = decodeJSON(raw)
		out = append(out, rk)
	}
	return out, rows.Err()
}

// CreateRank inserts a rank (admin builder).
func (r *Repository) CreateRank(ctx context.Context, in RankInput) (*Rank, error) {
	perks, _ := json.Marshal(in.Perks)
	if len(perks) == 0 || string(perks) == "null" {
		perks = []byte("{}")
	}
	const q = `
		INSERT INTO referral_ranks (slug, name, tier_order, min_points, perks)
		VALUES ($1,$2,$3,$4,$5)
		RETURNING id, slug, name, tier_order, min_points, perks`
	var (
		rk  Rank
		raw []byte
	)
	if err := r.db.QueryRow(ctx, q, in.Slug, in.Name, in.TierOrder, in.MinPoints, perks).Scan(
		&rk.ID, &rk.Slug, &rk.Name, &rk.TierOrder, &rk.MinPoints, &raw); err != nil {
		return nil, fmt.Errorf("gamification: create rank: %w", err)
	}
	rk.Perks = decodeJSON(raw)
	return &rk, nil
}

// ListBadges returns all badges.
func (r *Repository) ListBadges(ctx context.Context) ([]Badge, error) {
	const q = `SELECT id, slug, name, description, icon, criteria FROM referral_badges ORDER BY created_at`
	rows, err := r.db.Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("gamification: list badges: %w", err)
	}
	defer rows.Close()
	var out []Badge
	for rows.Next() {
		var (
			b               Badge
			desc, icon      *string
			raw             []byte
		)
		if err := rows.Scan(&b.ID, &b.Slug, &b.Name, &desc, &icon, &raw); err != nil {
			return nil, err
		}
		if desc != nil {
			b.Description = *desc
		}
		if icon != nil {
			b.Icon = *icon
		}
		b.Criteria = decodeJSON(raw)
		out = append(out, b)
	}
	return out, rows.Err()
}

// Leaderboard returns the top entries for a period+scope.
func (r *Repository) Leaderboard(ctx context.Context, period, scope string, limit int) ([]LeaderboardEntry, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	const q = `
		SELECT period, scope, user_id, rank_position, points, metric
		FROM referral_leaderboard_snapshots
		WHERE period = $1 AND scope = $2
		ORDER BY rank_position ASC LIMIT $3`
	rows, err := r.db.Query(ctx, q, period, scope, limit)
	if err != nil {
		return nil, fmt.Errorf("gamification: leaderboard: %w", err)
	}
	defer rows.Close()
	var out []LeaderboardEntry
	for rows.Next() {
		var (
			e   LeaderboardEntry
			raw []byte
		)
		if err := rows.Scan(&e.Period, &e.Scope, &e.UserID, &e.RankPosition, &e.Points, &raw); err != nil {
			return nil, err
		}
		e.Metric = decodeJSON(raw)
		out = append(out, e)
	}
	return out, rows.Err()
}

// ListContests returns contests, optionally only active ones.
func (r *Repository) ListContests(ctx context.Context, onlyActive bool) ([]Contest, error) {
	q := `SELECT id, slug, title, description, status, starts_at, ends_at, prize_config, campaign_id
		FROM referral_contests`
	if onlyActive {
		q += ` WHERE status = 'active'`
	}
	q += ` ORDER BY starts_at DESC NULLS LAST LIMIT 200`
	rows, err := r.db.Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("gamification: list contests: %w", err)
	}
	defer rows.Close()
	var out []Contest
	for rows.Next() {
		var (
			ct         Contest
			desc, camp *string
			raw        []byte
		)
		if err := rows.Scan(&ct.ID, &ct.Slug, &ct.Title, &desc, &ct.Status,
			&ct.StartsAt, &ct.EndsAt, &raw, &camp); err != nil {
			return nil, err
		}
		if desc != nil {
			ct.Description = *desc
		}
		if camp != nil {
			ct.CampaignID = *camp
		}
		ct.PrizeConfig = decodeJSON(raw)
		out = append(out, ct)
	}
	return out, rows.Err()
}

func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}
