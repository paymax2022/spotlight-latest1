// Package gamification implements referral missions/quests, ranks/tiers/badges,
// leaderboards and contests (FR-GAM, §8B A-GAM). Points are NON-CASH and tracked
// separately from money. When a mission carries an OPTIONAL cash reward, that
// reward is granted via RB0's ledger.Accrue (idempotent) — this package never
// posts to a wallet directly.
package gamification

import "time"

// Mission progress statuses.
const (
	ProgressInProgress = "in_progress"
	ProgressCompleted  = "completed"
	ProgressClaimed    = "claimed"
)

// Mission is a quest/mission/streak/challenge definition.
type Mission struct {
	ID             string     `json:"id"`
	Slug           string     `json:"slug"`
	Title          string     `json:"title"`
	Description    string     `json:"description,omitempty"`
	MissionType    string     `json:"mission_type"`
	TargetCount    int        `json:"target_count"`
	PointsReward   int        `json:"points_reward"`    // NON-CASH
	CashRewardKobo int64      `json:"cash_reward_kobo"` // OPTIONAL; granted via RB0 ledger
	CampaignID     string     `json:"campaign_id,omitempty"`
	IsActive       bool       `json:"is_active"`
	StartsAt       *time.Time `json:"starts_at,omitempty"`
	EndsAt         *time.Time `json:"ends_at,omitempty"`
}

// MissionProgress is a user's progress against a mission.
type MissionProgress struct {
	ID        string     `json:"id"`
	MissionID string     `json:"mission_id"`
	UserID    string     `json:"user_id"`
	Progress  int        `json:"progress"`
	Status    string     `json:"status"`
	ClaimedAt *time.Time `json:"claimed_at,omitempty"`
}

// Rank is a non-cash tier with a points threshold.
type Rank struct {
	ID        string         `json:"id"`
	Slug      string         `json:"slug"`
	Name      string         `json:"name"`
	TierOrder int            `json:"tier_order"`
	MinPoints int            `json:"min_points"`
	Perks     map[string]any `json:"perks"`
}

// Badge is a non-cash award.
type Badge struct {
	ID          string         `json:"id"`
	Slug        string         `json:"slug"`
	Name        string         `json:"name"`
	Description string         `json:"description,omitempty"`
	Icon        string         `json:"icon,omitempty"`
	Criteria    map[string]any `json:"criteria"`
}

// LeaderboardEntry is one materialised standing (non-cash).
type LeaderboardEntry struct {
	Period       string         `json:"period"`
	Scope        string         `json:"scope"`
	UserID       string         `json:"user_id"`
	RankPosition int            `json:"rank_position"`
	Points       int            `json:"points"`
	Metric       map[string]any `json:"metric"`
}

// Contest is a time-boxed competition.
type Contest struct {
	ID          string         `json:"id"`
	Slug        string         `json:"slug"`
	Title       string         `json:"title"`
	Description string         `json:"description,omitempty"`
	Status      string         `json:"status"`
	StartsAt    *time.Time     `json:"starts_at,omitempty"`
	EndsAt      *time.Time     `json:"ends_at,omitempty"`
	PrizeConfig map[string]any `json:"prize_config"`
	CampaignID  string         `json:"campaign_id,omitempty"`
}

// MissionInput is the admin mission-builder payload.
type MissionInput struct {
	Slug           string     `json:"slug"`
	Title          string     `json:"title"`
	Description    string     `json:"description"`
	MissionType    string     `json:"mission_type"`
	TargetCount    int        `json:"target_count"`
	PointsReward   int        `json:"points_reward"`
	CashRewardKobo int64      `json:"cash_reward_kobo"`
	CampaignID     string     `json:"campaign_id"`
	StartsAt       *time.Time `json:"starts_at"`
	EndsAt         *time.Time `json:"ends_at"`
	IsActive       bool       `json:"is_active"`
}

// RankInput is the admin rank-builder payload.
type RankInput struct {
	Slug      string         `json:"slug"`
	Name      string         `json:"name"`
	TierOrder int            `json:"tier_order"`
	MinPoints int            `json:"min_points"`
	Perks     map[string]any `json:"perks"`
}

// ClaimResult is returned when a mission reward is claimed.
type ClaimResult struct {
	MissionID      string `json:"mission_id"`
	PointsAwarded  int    `json:"points_awarded"`
	CashRewardKobo int64  `json:"cash_reward_kobo"`
	RewardLedgerID string `json:"reward_ledger_id,omitempty"`
	Status         string `json:"status"`
}
