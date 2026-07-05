// Package connectgamification implements Paymax Connect gamification (PRD §6.5):
// XP, missions, streaks, leaderboards and seasons.
//
// NON-CASH INVARIANT (docs/prd/dating/CLAUDE.md): XP and coins are points, NOT
// money. They live in their own tables (connect_xp_ledger / connect_missions /
// connect_streaks / connect_seasons / connect_leaderboard_snapshots), are NEVER
// posted to the finance ledger, and there is NO money-conversion path. All point
// columns are BIGINT but clearly named points/xp.
package connectgamification

import (
	"encoding/json"
	"time"
)

// XPEntry is one immutable, idempotent grant of non-cash XP. event_key makes a
// repeated award a no-op (idempotency), so XP is never double-counted.
type XPEntry struct {
	ID        string    `json:"id"`
	UserID    string    `json:"user_id"`
	EventKey  string    `json:"event_key"`
	Source    string    `json:"source"`
	XP        int64     `json:"xp"` // NON-CASH points
	CreatedAt time.Time `json:"created_at"`
}

// Home is the gamification dashboard projection (all non-cash). TotalXP and Coins
// are points, NOT money; Level is derived from TotalXP.
type Home struct {
	UserID     string `json:"user_id"`
	TotalXP    int64  `json:"total_xp"`
	Level      int    `json:"level"`
	Coins      int64  `json:"coins"`
	StreakDays int    `json:"streak_days"`
	SeasonCode string `json:"season_code,omitempty"`
}

// Mission is a backend-owned task definition. Cadence is daily|weekly|season|once.
// RewardXP and RewardCoin are NON-CASH points.
type Mission struct {
	ID         string          `json:"id"`
	Code       string          `json:"code"`
	Title      string          `json:"title"`
	Cadence    string          `json:"cadence"`
	Target     int             `json:"target"`
	RewardXP   int64           `json:"reward_xp"`
	RewardCoin int64           `json:"reward_coins"`
	Meta       json.RawMessage `json:"meta,omitempty"`
	Active     bool            `json:"active"`
}

// MissionProgress is per-user progress against a mission.
type MissionProgress struct {
	MissionID string     `json:"mission_id"`
	Code      string     `json:"code,omitempty"`
	Progress  int        `json:"progress"`
	Target    int        `json:"target"`
	Completed bool       `json:"completed"`
	Claimed   bool       `json:"claimed"`
	ClaimedAt *time.Time `json:"claimed_at,omitempty"`
}

// Streak is the user's consecutive-day engagement counter.
type Streak struct {
	UserID      string     `json:"user_id"`
	CurrentDays int        `json:"current_days"`
	BestDays    int        `json:"best_days"`
	LastTickOn  *time.Time `json:"last_tick_on,omitempty"`
}

// LeaderboardEntry is a single ranked row (XP is non-cash).
type LeaderboardEntry struct {
	Rank   int    `json:"rank"`
	UserID string `json:"user_id"`
	XP     int64  `json:"xp"` // NON-CASH
}

// Season is a time-boxed pass period.
type Season struct {
	ID        string    `json:"id"`
	Code      string    `json:"code"`
	Name      string    `json:"name"`
	StartsAt  time.Time `json:"starts_at"`
	EndsAt    time.Time `json:"ends_at"`
	Active    bool      `json:"active"`
}

// --- Request DTOs ---

type AwardInput struct {
	EventKey string `json:"event_key" binding:"required"` // idempotency key
	Source   string `json:"source"`
	XP       int64  `json:"xp" binding:"required"` // NON-CASH points
}

type UpsertMissionInput struct {
	Code       string          `json:"code" binding:"required"`
	Title      string          `json:"title" binding:"required"`
	Cadence    string          `json:"cadence"`
	Target     int             `json:"target"`
	RewardXP   int64           `json:"reward_xp"`
	RewardCoin int64           `json:"reward_coins"`
	Meta       json.RawMessage `json:"meta"`
	Active     *bool           `json:"active"`
}

type UpsertSeasonInput struct {
	Code     string    `json:"code" binding:"required"`
	Name     string    `json:"name" binding:"required"`
	StartsAt time.Time `json:"starts_at"`
	EndsAt   time.Time `json:"ends_at"`
	Active   *bool     `json:"active"`
}
