package gamification

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository wraps academy gamification tables over a pgx pool.
// Engagement-only: there is no money path here, so no ledger primitives.
type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

// GetProfile returns the gamification profile, or pgx.ErrNoRows if absent.
func (r *Repository) GetProfile(ctx context.Context, userID string) (*Profile, error) {
	const q = `
		SELECT user_id, xp, level, streak_days, freezes,
		       to_char(last_active,'YYYY-MM-DD'), updated_at
		FROM academy_gamification_profiles WHERE user_id=$1`
	p := &Profile{}
	var last *string
	err := r.db.QueryRow(ctx, q, userID).Scan(
		&p.UserID, &p.XP, &p.Level, &p.StreakDays, &p.Freezes, &last, &p.UpdatedAt)
	if err != nil {
		return nil, err
	}
	p.LastActive = last
	return p, nil
}

// UpsertProfile writes the full projection of a profile (xp/level/streak/freezes).
// Balances here are engagement counters, not money — a plain UPSERT is correct.
func (r *Repository) UpsertProfile(ctx context.Context, p *Profile) error {
	const q = `
		INSERT INTO academy_gamification_profiles
			(user_id, xp, level, streak_days, freezes, last_active, updated_at)
		VALUES ($1,$2,$3,$4,$5, NULLIF($6,'')::date, now())
		ON CONFLICT (user_id) DO UPDATE SET
			xp=EXCLUDED.xp, level=EXCLUDED.level, streak_days=EXCLUDED.streak_days,
			freezes=EXCLUDED.freezes, last_active=EXCLUDED.last_active, updated_at=now()`
	last := ""
	if p.LastActive != nil {
		last = *p.LastActive
	}
	_, err := r.db.Exec(ctx, q, p.UserID, p.XP, p.Level, p.StreakDays, p.Freezes, last)
	if err != nil {
		return fmt.Errorf("gamification: upsert profile: %w", err)
	}
	return nil
}

// ── Badges ──────────────────────────────────────────────────────────────────────

func (r *Repository) ListBadges(ctx context.Context) ([]Badge, error) {
	const q = `SELECT id, code, name, criteria, icon FROM academy_badges ORDER BY code`
	rows, err := r.db.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Badge
	for rows.Next() {
		var b Badge
		if err := rows.Scan(&b.ID, &b.Code, &b.Name, &b.Criteria, &b.Icon); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

func (r *Repository) UpsertBadge(ctx context.Context, in UpsertBadgeRequest) (*Badge, error) {
	const q = `
		INSERT INTO academy_badges (code, name, criteria, icon)
		VALUES ($1,$2,COALESCE($3,'{}'::jsonb),$4)
		ON CONFLICT (code) DO UPDATE SET
			name=EXCLUDED.name, criteria=EXCLUDED.criteria, icon=EXCLUDED.icon
		RETURNING id, code, name, criteria, icon`
	b := &Badge{}
	err := r.db.QueryRow(ctx, q, in.Code, in.Name, in.Criteria, in.Icon).
		Scan(&b.ID, &b.Code, &b.Name, &b.Criteria, &b.Icon)
	if err != nil {
		return nil, fmt.Errorf("gamification: upsert badge: %w", err)
	}
	return b, nil
}

func (r *Repository) ListUserBadges(ctx context.Context, userID string) ([]UserBadge, error) {
	const q = `SELECT user_id, badge_id, earned_at FROM academy_user_badges WHERE user_id=$1 ORDER BY earned_at`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []UserBadge
	for rows.Next() {
		var ub UserBadge
		if err := rows.Scan(&ub.UserID, &ub.BadgeID, &ub.EarnedAt); err != nil {
			return nil, err
		}
		out = append(out, ub)
	}
	return out, rows.Err()
}

// GrantBadge is idempotent via the (user_id, badge_id) primary key. Returns
// (granted=true) only when this call actually inserted a new row.
func (r *Repository) GrantBadge(ctx context.Context, userID, badgeID string) (bool, error) {
	const q = `
		INSERT INTO academy_user_badges (user_id, badge_id)
		VALUES ($1,$2) ON CONFLICT (user_id, badge_id) DO NOTHING`
	tag, err := r.db.Exec(ctx, q, userID, badgeID)
	if err != nil {
		return false, fmt.Errorf("gamification: grant badge: %w", err)
	}
	return tag.RowsAffected() == 1, nil
}

// ── Challenges ──────────────────────────────────────────────────────────────────

func (r *Repository) ListChallenges(ctx context.Context) ([]Challenge, error) {
	const q = `
		SELECT id, code, name, kind, criteria, sponsor_id, reward_pool_id,
		       starts_at, ends_at, status
		FROM academy_challenges WHERE status='active' ORDER BY code`
	rows, err := r.db.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Challenge
	for rows.Next() {
		var c Challenge
		if err := rows.Scan(&c.ID, &c.Code, &c.Name, &c.Kind, &c.Criteria,
			&c.SponsorID, &c.RewardPoolID, &c.StartsAt, &c.EndsAt, &c.Status); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (r *Repository) UpsertChallenge(ctx context.Context, in UpsertChallengeRequest) (*Challenge, error) {
	kind := in.Kind
	if kind == "" {
		kind = "daily"
	}
	status := in.Status
	if status == "" {
		status = "active"
	}
	const q = `
		INSERT INTO academy_challenges
			(code, name, kind, criteria, sponsor_id, reward_pool_id, starts_at, ends_at, status)
		VALUES ($1,$2,$3,COALESCE($4,'{}'::jsonb),$5,$6,$7,$8,$9)
		ON CONFLICT (code) DO UPDATE SET
			name=EXCLUDED.name, kind=EXCLUDED.kind, criteria=EXCLUDED.criteria,
			sponsor_id=EXCLUDED.sponsor_id, reward_pool_id=EXCLUDED.reward_pool_id,
			starts_at=EXCLUDED.starts_at, ends_at=EXCLUDED.ends_at, status=EXCLUDED.status
		RETURNING id, code, name, kind, criteria, sponsor_id, reward_pool_id, starts_at, ends_at, status`
	c := &Challenge{}
	err := r.db.QueryRow(ctx, q, in.Code, in.Name, kind, in.Criteria, in.SponsorID,
		in.RewardPoolID, in.StartsAt, in.EndsAt, status).
		Scan(&c.ID, &c.Code, &c.Name, &c.Kind, &c.Criteria, &c.SponsorID,
			&c.RewardPoolID, &c.StartsAt, &c.EndsAt, &c.Status)
	if err != nil {
		return nil, fmt.Errorf("gamification: upsert challenge: %w", err)
	}
	return c, nil
}

// ── Leaderboards ────────────────────────────────────────────────────────────────

func (r *Repository) GetLeaderboard(ctx context.Context, id string) (*Leaderboard, error) {
	const q = `SELECT id, scope, scope_ref, period, reset_policy FROM academy_leaderboards WHERE id=$1`
	lb := &Leaderboard{}
	if err := r.db.QueryRow(ctx, q, id).Scan(&lb.ID, &lb.Scope, &lb.ScopeRef, &lb.Period, &lb.ResetPolicy); err != nil {
		return nil, err
	}
	return lb, nil
}

func (r *Repository) UpsertLeaderboard(ctx context.Context, in UpsertLeaderboardRequest) (*Leaderboard, error) {
	period := in.Period
	if period == "" {
		period = "weekly"
	}
	reset := in.ResetPolicy
	if reset == "" {
		reset = "weekly"
	}
	const q = `
		INSERT INTO academy_leaderboards (scope, scope_ref, period, reset_policy)
		VALUES ($1,$2,$3,$4)
		RETURNING id, scope, scope_ref, period, reset_policy`
	lb := &Leaderboard{}
	err := r.db.QueryRow(ctx, q, in.Scope, in.ScopeRef, period, reset).
		Scan(&lb.ID, &lb.Scope, &lb.ScopeRef, &lb.Period, &lb.ResetPolicy)
	if err != nil {
		return nil, fmt.Errorf("gamification: upsert leaderboard: %w", err)
	}
	return lb, nil
}

// AddLeaderboardScore increments a user's score for a period (idempotent per call
// is not required — scores accumulate; the PK keeps one row per user/period).
func (r *Repository) AddLeaderboardScore(ctx context.Context, leaderboardID, userID, periodKey string, delta int64) error {
	const q = `
		INSERT INTO academy_leaderboard_entries (leaderboard_id, user_id, period_key, score, updated_at)
		VALUES ($1,$2,$3,$4, now())
		ON CONFLICT (leaderboard_id, user_id, period_key) DO UPDATE SET
			score = academy_leaderboard_entries.score + EXCLUDED.score, updated_at = now()`
	_, err := r.db.Exec(ctx, q, leaderboardID, userID, periodKey, delta)
	if err != nil {
		return fmt.Errorf("gamification: add leaderboard score: %w", err)
	}
	return nil
}

// RankedEntries returns leaderboard entries for a period, score-descending, with
// dense rank derived at read time.
func (r *Repository) RankedEntries(ctx context.Context, leaderboardID, periodKey string, limit int) ([]LeaderboardEntry, error) {
	if limit <= 0 {
		limit = 100
	}
	const q = `
		SELECT leaderboard_id, user_id, period_key, score, updated_at,
		       RANK() OVER (ORDER BY score DESC) AS rnk
		FROM academy_leaderboard_entries
		WHERE leaderboard_id=$1 AND period_key=$2
		ORDER BY score DESC
		LIMIT $3`
	rows, err := r.db.Query(ctx, q, leaderboardID, periodKey, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []LeaderboardEntry
	for rows.Next() {
		var e LeaderboardEntry
		if err := rows.Scan(&e.LeaderboardID, &e.UserID, &e.PeriodKey, &e.Score, &e.UpdatedAt, &e.Rank); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// IsNoRows is a small helper so callers don't import pgx just to detect absence.
func IsNoRows(err error) bool { return err == pgx.ErrNoRows }
