// Package campaigns implements the referral campaign builder and the budget
// governor (FR-CAMP, §8B A-CMP). A campaign carries a reward model
// (flat | dynamic | ltv) plus an optional vesting schedule reference; the budget
// governor enforces per-campaign caps and ROI guardrails and can auto-pause on a
// burn or fraud spike, in addition to manual throttle/pause.
//
// This package references RB0's shared tables by name; it never recreates them.
// Money is BIGINT kobo. All writes are parameterized.
package campaigns

import "time"

// Campaign statuses.
const (
	StatusDraft     = "draft"
	StatusActive    = "active"
	StatusThrottled = "throttled"
	StatusPaused    = "paused"
	StatusEnded     = "ended"
)

// Reward models.
const (
	RewardFlat    = "flat"
	RewardDynamic = "dynamic"
	RewardLTV     = "ltv"
)

// Funding sources.
const (
	FundingHouse    = "house"
	FundingMerchant = "merchant"
	FundingPartner  = "partner"
)

// Campaign is a referral campaign definition.
type Campaign struct {
	ID                 string         `json:"id"`
	Name               string         `json:"name"`
	Slug               string         `json:"slug"`
	Description        string         `json:"description,omitempty"`
	Status             string         `json:"status"`
	RewardModel        string         `json:"reward_model"`
	RewardConfig       map[string]any `json:"reward_config"`
	VestingScheduleID  string         `json:"vesting_schedule_id,omitempty"`
	StartsAt           *time.Time     `json:"starts_at,omitempty"`
	EndsAt             *time.Time     `json:"ends_at,omitempty"`
	FundingSource      string         `json:"funding_source"`
	MerchantCampaignID string         `json:"merchant_campaign_id,omitempty"`
	CreatedBy          string         `json:"created_by,omitempty"`
	CreatedAt          time.Time      `json:"created_at"`
	UpdatedAt          time.Time      `json:"updated_at"`
}

// Budget is the budget governor row for one campaign.
type Budget struct {
	CampaignID      string `json:"campaign_id"`
	TotalBudgetKobo int64  `json:"total_budget_kobo"`
	SpentKobo       int64  `json:"spent_kobo"`
	PerUserCapKobo  int64  `json:"per_user_cap_kobo"`
	DailyCapKobo    int64  `json:"daily_cap_kobo"`
	MaxCACKobo      int64  `json:"max_cac_kobo"`
	FraudPauseBps   int    `json:"fraud_pause_bps"`
	AutoPaused      bool   `json:"auto_paused"`
	AutoPauseReason string `json:"auto_pause_reason,omitempty"`
	ThrottlePct     int    `json:"throttle_pct"`
}

// Variant is one A/B reward-config variant of a campaign.
type Variant struct {
	ID           string         `json:"id"`
	CampaignID   string         `json:"campaign_id"`
	VariantKey   string         `json:"variant_key"`
	WeightPct    int            `json:"weight_pct"`
	RewardConfig map[string]any `json:"reward_config"`
	IsActive     bool           `json:"is_active"`
}

// CreateInput is the admin campaign-create payload.
type CreateInput struct {
	Name              string         `json:"name"`
	Slug              string         `json:"slug"`
	Description       string         `json:"description"`
	RewardModel       string         `json:"reward_model"`
	RewardConfig      map[string]any `json:"reward_config"`
	VestingScheduleID string         `json:"vesting_schedule_id"`
	StartsAt          *time.Time     `json:"starts_at"`
	EndsAt            *time.Time     `json:"ends_at"`
	FundingSource     string         `json:"funding_source"`
}

// UpdateInput patches a campaign's mutable fields (nil = leave unchanged).
type UpdateInput struct {
	Name         *string         `json:"name"`
	Description  *string         `json:"description"`
	RewardModel  *string         `json:"reward_model"`
	RewardConfig *map[string]any `json:"reward_config"`
	StartsAt     *time.Time      `json:"starts_at"`
	EndsAt       *time.Time      `json:"ends_at"`
}

// BudgetInput sets/updates the budget governor row for a campaign.
type BudgetInput struct {
	TotalBudgetKobo int64 `json:"total_budget_kobo"`
	PerUserCapKobo  int64 `json:"per_user_cap_kobo"`
	DailyCapKobo    int64 `json:"daily_cap_kobo"`
	MaxCACKobo      int64 `json:"max_cac_kobo"`
	FraudPauseBps   int   `json:"fraud_pause_bps"`
}

// Analytics summarises a campaign's burn and ROI position (A-CMP analytics).
type Analytics struct {
	CampaignID      string  `json:"campaign_id"`
	TotalBudgetKobo int64   `json:"total_budget_kobo"`
	SpentKobo       int64   `json:"spent_kobo"`
	RemainingKobo   int64   `json:"remaining_kobo"`
	BurnPct         float64 `json:"burn_pct"`
	RewardCount     int64   `json:"reward_count"`
	BeneficiaryCnt  int64   `json:"beneficiary_count"`
	AutoPaused      bool    `json:"auto_paused"`
	AutoPauseReason string  `json:"auto_pause_reason,omitempty"`
	Status          string  `json:"status"`
}
