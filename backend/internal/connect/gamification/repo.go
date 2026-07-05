package connectgamification

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository holds parameterized pgx queries for the non-cash gamification tables.
// No query touches the finance ledger.
type Repository struct{ db *pgxpool.Pool }

func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

// InsertXPIfNew inserts an XP grant idempotently on event_key. Returns inserted=
// false (no error) when the event_key already exists, so a retried award is a
// no-op and XP is never double-counted.
func (r *Repository) InsertXPIfNew(ctx context.Context, userID, eventKey, source string, xp int64) (inserted bool, err error) {
	const q = `INSERT INTO connect_xp_ledger (user_id, event_key, source, xp)
		VALUES ($1,$2,NULLIF($3,''),$4)
		ON CONFLICT (event_key) DO NOTHING
		RETURNING id`
	var id string
	err = r.db.QueryRow(ctx, q, userID, eventKey, source, xp).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil // already awarded → idempotent no-op
	}
	if err != nil {
		return false, fmt.Errorf("connect: insert xp: %w", err)
	}
	return true, nil
}

// TotalXP sums a user's non-cash XP.
func (r *Repository) TotalXP(ctx context.Context, userID string) (int64, error) {
	var total int64
	err := r.db.QueryRow(ctx,
		`SELECT COALESCE(SUM(xp),0) FROM connect_xp_ledger WHERE user_id=$1`, userID).Scan(&total)
	if err != nil {
		return 0, fmt.Errorf("connect: total xp: %w", err)
	}
	return total, nil
}

// Coins reads the user's non-cash soft-currency balance projection.
func (r *Repository) Coins(ctx context.Context, userID string) (int64, error) {
	var coins int64
	err := r.db.QueryRow(ctx,
		`SELECT COALESCE(coins,0) FROM connect_streaks WHERE user_id=$1`, userID).Scan(&coins)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("connect: coins: %w", err)
	}
	return coins, nil
}

// ListMissions returns active mission definitions.
func (r *Repository) ListMissions(ctx context.Context, includeInactive bool) ([]Mission, error) {
	const q = `SELECT id, code, title, cadence, target, reward_xp, reward_coins,
			COALESCE(meta,'{}'::jsonb), active
		FROM connect_missions WHERE ($1=true OR active=true)
		ORDER BY cadence, code`
	rows, err := r.db.Query(ctx, q, includeInactive)
	if err != nil {
		return nil, fmt.Errorf("connect: list missions: %w", err)
	}
	defer rows.Close()
	var out []Mission
	for rows.Next() {
		var m Mission
		if err := rows.Scan(&m.ID, &m.Code, &m.Title, &m.Cadence, &m.Target,
			&m.RewardXP, &m.RewardCoin, &m.Meta, &m.Active); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// MissionProgressFor returns the user's progress against active missions.
func (r *Repository) MissionProgressFor(ctx context.Context, userID string) ([]MissionProgress, error) {
	const q = `SELECT m.id, m.code, COALESCE(p.progress,0), m.target,
			COALESCE(p.completed,false), COALESCE(p.claimed,false), p.claimed_at
		FROM connect_missions m
		LEFT JOIN connect_mission_progress p
			ON p.mission_id=m.id AND p.user_id=$1
		WHERE m.active=true
		ORDER BY m.cadence, m.code`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, fmt.Errorf("connect: mission progress: %w", err)
	}
	defer rows.Close()
	var out []MissionProgress
	for rows.Next() {
		var mp MissionProgress
		if err := rows.Scan(&mp.MissionID, &mp.Code, &mp.Progress, &mp.Target,
			&mp.Completed, &mp.Claimed, &mp.ClaimedAt); err != nil {
			return nil, err
		}
		out = append(out, mp)
	}
	return out, rows.Err()
}

// GetMission resolves a mission by id.
func (r *Repository) GetMission(ctx context.Context, id string) (*Mission, error) {
	const q = `SELECT id, code, title, cadence, target, reward_xp, reward_coins,
			COALESCE(meta,'{}'::jsonb), active
		FROM connect_missions WHERE id=$1`
	m := &Mission{}
	if err := r.db.QueryRow(ctx, q, id).Scan(&m.ID, &m.Code, &m.Title, &m.Cadence,
		&m.Target, &m.RewardXP, &m.RewardCoin, &m.Meta, &m.Active); err != nil {
		return nil, ErrNotFound
	}
	return m, nil
}

// ClaimMission marks a completed mission claimed iff it is completed and unclaimed.
// Returns claimed=true only on the transition (idempotent: a second claim is false).
func (r *Repository) ClaimMission(ctx context.Context, userID, missionID string) (bool, error) {
	const q = `UPDATE connect_mission_progress
		SET claimed=true, claimed_at=now(), updated_at=now()
		WHERE user_id=$1 AND mission_id=$2 AND completed=true AND claimed=false`
	ct, err := r.db.Exec(ctx, q, userID, missionID)
	if err != nil {
		return false, fmt.Errorf("connect: claim mission: %w", err)
	}
	return ct.RowsAffected() == 1, nil
}

// AddCoins credits non-cash coins to the user's streak/balance row.
func (r *Repository) AddCoins(ctx context.Context, userID string, coins int64) error {
	const q = `INSERT INTO connect_streaks (user_id, coins)
		VALUES ($1,$2)
		ON CONFLICT (user_id) DO UPDATE SET coins=connect_streaks.coins+$2, updated_at=now()`
	if _, err := r.db.Exec(ctx, q, userID, coins); err != nil {
		return fmt.Errorf("connect: add coins: %w", err)
	}
	return nil
}

// TickStreak advances the consecutive-day streak idempotently per UTC day.
func (r *Repository) TickStreak(ctx context.Context, userID string) (*Streak, error) {
	const q = `INSERT INTO connect_streaks (user_id, current_days, best_days, last_tick_on)
		VALUES ($1, 1, 1, CURRENT_DATE)
		ON CONFLICT (user_id) DO UPDATE SET
			current_days = CASE
				WHEN connect_streaks.last_tick_on = CURRENT_DATE THEN connect_streaks.current_days
				WHEN connect_streaks.last_tick_on = CURRENT_DATE - 1 THEN connect_streaks.current_days + 1
				ELSE 1 END,
			best_days = GREATEST(connect_streaks.best_days, CASE
				WHEN connect_streaks.last_tick_on = CURRENT_DATE THEN connect_streaks.current_days
				WHEN connect_streaks.last_tick_on = CURRENT_DATE - 1 THEN connect_streaks.current_days + 1
				ELSE 1 END),
			last_tick_on = CURRENT_DATE,
			updated_at = now()
		RETURNING user_id, current_days, best_days, last_tick_on`
	st := &Streak{}
	if err := r.db.QueryRow(ctx, q, userID).Scan(
		&st.UserID, &st.CurrentDays, &st.BestDays, &st.LastTickOn); err != nil {
		return nil, fmt.Errorf("connect: tick streak: %w", err)
	}
	return st, nil
}

// GetStreak returns the user's streak row (zero-valued if none).
func (r *Repository) GetStreak(ctx context.Context, userID string) (*Streak, error) {
	const q = `SELECT user_id, current_days, best_days, last_tick_on
		FROM connect_streaks WHERE user_id=$1`
	st := &Streak{UserID: userID}
	err := r.db.QueryRow(ctx, q, userID).Scan(&st.UserID, &st.CurrentDays, &st.BestDays, &st.LastTickOn)
	if errors.Is(err, pgx.ErrNoRows) {
		return st, nil
	}
	if err != nil {
		return nil, fmt.Errorf("connect: get streak: %w", err)
	}
	return st, nil
}

// Leaderboard ranks users by non-cash XP (all-time).
func (r *Repository) Leaderboard(ctx context.Context, limit int) ([]LeaderboardEntry, error) {
	const q = `SELECT user_id, SUM(xp) AS total
		FROM connect_xp_ledger
		GROUP BY user_id
		ORDER BY total DESC
		LIMIT $1`
	rows, err := r.db.Query(ctx, q, limit)
	if err != nil {
		return nil, fmt.Errorf("connect: leaderboard: %w", err)
	}
	defer rows.Close()
	var out []LeaderboardEntry
	rank := 0
	for rows.Next() {
		var e LeaderboardEntry
		if err := rows.Scan(&e.UserID, &e.XP); err != nil {
			return nil, err
		}
		rank++
		e.Rank = rank
		out = append(out, e)
	}
	return out, rows.Err()
}

// ListSeasons returns season-pass periods.
func (r *Repository) ListSeasons(ctx context.Context) ([]Season, error) {
	const q = `SELECT id, code, name, starts_at, ends_at, active
		FROM connect_seasons ORDER BY starts_at DESC`
	rows, err := r.db.Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("connect: list seasons: %w", err)
	}
	defer rows.Close()
	var out []Season
	for rows.Next() {
		var s Season
		if err := rows.Scan(&s.ID, &s.Code, &s.Name, &s.StartsAt, &s.EndsAt, &s.Active); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// ActiveSeasonCode returns the code of the currently-active season (empty if none).
func (r *Repository) ActiveSeasonCode(ctx context.Context) (string, error) {
	var code string
	err := r.db.QueryRow(ctx,
		`SELECT code FROM connect_seasons
		 WHERE active=true AND now() BETWEEN starts_at AND ends_at
		 ORDER BY starts_at DESC LIMIT 1`).Scan(&code)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("connect: active season: %w", err)
	}
	return code, nil
}

// UpsertMission creates/updates a backend-owned mission definition (admin).
func (r *Repository) UpsertMission(ctx context.Context, in UpsertMissionInput) (*Mission, error) {
	active := true
	if in.Active != nil {
		active = *in.Active
	}
	cadence := in.Cadence
	if cadence == "" {
		cadence = "daily"
	}
	meta := in.Meta
	if len(meta) == 0 {
		meta = []byte("{}")
	}
	const q = `INSERT INTO connect_missions (code, title, cadence, target, reward_xp, reward_coins, meta, active)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		ON CONFLICT (code) DO UPDATE SET
			title=EXCLUDED.title, cadence=EXCLUDED.cadence, target=EXCLUDED.target,
			reward_xp=EXCLUDED.reward_xp, reward_coins=EXCLUDED.reward_coins,
			meta=EXCLUDED.meta, active=EXCLUDED.active, updated_at=now()
		RETURNING id, code, title, cadence, target, reward_xp, reward_coins,
			COALESCE(meta,'{}'::jsonb), active`
	m := &Mission{}
	if err := r.db.QueryRow(ctx, q, in.Code, in.Title, cadence, in.Target,
		in.RewardXP, in.RewardCoin, meta, active).Scan(
		&m.ID, &m.Code, &m.Title, &m.Cadence, &m.Target, &m.RewardXP, &m.RewardCoin, &m.Meta, &m.Active); err != nil {
		return nil, fmt.Errorf("connect: upsert mission: %w", err)
	}
	return m, nil
}

// UpsertSeason creates/updates a season-pass period (admin).
func (r *Repository) UpsertSeason(ctx context.Context, in UpsertSeasonInput) (*Season, error) {
	active := true
	if in.Active != nil {
		active = *in.Active
	}
	const q = `INSERT INTO connect_seasons (code, name, starts_at, ends_at, active)
		VALUES ($1,$2,$3,$4,$5)
		ON CONFLICT (code) DO UPDATE SET
			name=EXCLUDED.name, starts_at=EXCLUDED.starts_at, ends_at=EXCLUDED.ends_at,
			active=EXCLUDED.active, updated_at=now()
		RETURNING id, code, name, starts_at, ends_at, active`
	s := &Season{}
	if err := r.db.QueryRow(ctx, q, in.Code, in.Name, in.StartsAt, in.EndsAt, active).Scan(
		&s.ID, &s.Code, &s.Name, &s.StartsAt, &s.EndsAt, &s.Active); err != nil {
		return nil, fmt.Errorf("connect: upsert season: %w", err)
	}
	return s, nil
}
