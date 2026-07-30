// Package gamification is the Spotlight Academy engagement sub-package.
//
// SEPARATION OF CONCERNS (golden rule): gamification is ENGAGEMENT ONLY. It moves
// NO money and credits NO wallet. XP, levels, streaks, badges and leaderboards are
// non-monetary motivation signals. Anything that carries real value lives in the
// sibling `rewards` package, which is the only place the Paymax wallet ledger is
// touched. The two packages share no service, no balance, and no credit path; a
// challenge here may *reference* a reward pool by id, but issuing value from that
// pool is exclusively a `rewards.IssueReward` call.
//
// All thresholds / curves are configurable from rows or an injected Config — never
// hardcoded business numbers. Pure decision logic (levelForXP, streak math, badge
// criteria) is factored into testable functions with no DB dependency.
package gamification

import "time"

// Profile mirrors public.academy_gamification_profiles (PK user_id).
type Profile struct {
	UserID     string    `json:"user_id"`
	XP         int64     `json:"xp"`
	Level      int       `json:"level"`
	StreakDays int       `json:"streak_days"`
	Freezes    int       `json:"freezes"`
	LastActive *string   `json:"last_active,omitempty"` // YYYY-MM-DD
	UpdatedAt  time.Time `json:"updated_at"`
}

// Badge mirrors public.academy_badges.
type Badge struct {
	ID       string         `json:"id"`
	Code     string         `json:"code"`
	Name     string         `json:"name"`
	Criteria map[string]any `json:"criteria"`
	Icon     *string        `json:"icon,omitempty"`
}

// UserBadge mirrors public.academy_user_badges (PK user_id, badge_id).
type UserBadge struct {
	UserID   string    `json:"user_id"`
	BadgeID  string    `json:"badge_id"`
	EarnedAt time.Time `json:"earned_at"`
}

// Challenge mirrors public.academy_challenges.
type Challenge struct {
	ID           string         `json:"id"`
	Code         string         `json:"code"`
	Name         string         `json:"name"`
	Kind         string         `json:"kind"` // daily|weekly|sponsor
	Criteria     map[string]any `json:"criteria"`
	SponsorID    *string        `json:"sponsor_id,omitempty"`
	RewardPoolID *string        `json:"reward_pool_id,omitempty"` // reference only; payout is rewards.IssueReward
	StartsAt     *time.Time     `json:"starts_at,omitempty"`
	EndsAt       *time.Time     `json:"ends_at,omitempty"`
	Status       string         `json:"status"`
}

// Leaderboard mirrors public.academy_leaderboards.
type Leaderboard struct {
	ID          string  `json:"id"`
	Scope       string  `json:"scope"` // class|school|national|friends
	ScopeRef    *string `json:"scope_ref,omitempty"`
	Period      string  `json:"period"`
	ResetPolicy string  `json:"reset_policy"`
}

// LeaderboardEntry mirrors public.academy_leaderboard_entries
// (PK leaderboard_id, user_id, period_key).
type LeaderboardEntry struct {
	LeaderboardID string    `json:"leaderboard_id"`
	UserID        string    `json:"user_id"`
	PeriodKey     string    `json:"period_key"`
	Score         int64     `json:"score"`
	Rank          int       `json:"rank,omitempty"` // derived at read time
	UpdatedAt     time.Time `json:"updated_at"`
}

// ── Configurable thresholds / curves ────────────────────────────────────────────

// Config holds all tunable gamification numbers. Defaults are applied by
// DefaultConfig; production wiring may override from a config row / env. No
// engagement number is hardcoded inside the decision functions.
type Config struct {
	// XP curve: level n requires LevelBaseXP * n^LevelExponent cumulative XP.
	// Kept as integers in the decision layer to avoid float drift.
	LevelBaseXP int64 // XP for level 2 boundary (level 1 = 0 XP)
	LevelStepXP int64 // additional XP per subsequent level (linear-with-base curve)
	MaxLevel    int
	// Streak rules.
	FreezeMaxStored int // cap on freeze tokens a learner may hold
}

// DefaultConfig returns the baseline engagement curve. These are the *defaults*;
// they are still data, overridable at wiring time.
func DefaultConfig() Config {
	return Config{
		LevelBaseXP:     100,
		LevelStepXP:     150,
		MaxLevel:        100,
		FreezeMaxStored: 3,
	}
}

// ── Request DTOs (admin CRUD) ───────────────────────────────────────────────────

type UpsertBadgeRequest struct {
	Code     string         `json:"code" binding:"required"`
	Name     string         `json:"name" binding:"required"`
	Criteria map[string]any `json:"criteria"`
	Icon     *string        `json:"icon,omitempty"`
}

type UpsertChallengeRequest struct {
	Code         string         `json:"code" binding:"required"`
	Name         string         `json:"name" binding:"required"`
	Kind         string         `json:"kind"`
	Criteria     map[string]any `json:"criteria"`
	SponsorID    *string        `json:"sponsor_id,omitempty"`
	RewardPoolID *string        `json:"reward_pool_id,omitempty"`
	StartsAt     *time.Time     `json:"starts_at,omitempty"`
	EndsAt       *time.Time     `json:"ends_at,omitempty"`
	Status       string         `json:"status"`
}

type UpsertLeaderboardRequest struct {
	Scope       string  `json:"scope" binding:"required"`
	ScopeRef    *string `json:"scope_ref,omitempty"`
	Period      string  `json:"period"`
	ResetPolicy string  `json:"reset_policy"`
}
