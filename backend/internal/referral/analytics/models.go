// Package analytics is the referral business-intelligence read-model (A-BI,
// A-USR §8B): K-factor (EXCLUDING house rows per §7A.6), the acquisition funnel
// from referral_engine_events, referral CAC vs paid, cohort LTV/retention,
// channel/vertical attribution, organic-vs-referred segmentation (house_default
// separated), and a per-user referral-360 profile (A-USR-01).
//
// HOUSE EXCLUSION INVARIANT (§7A.6): every K-factor / referral-attribution metric
// filters out rows where excluded_from_kfactor = true OR is_house = true. House
// (house_default) is reported as a SEPARATE segment, never folded into referred.
package analytics

// KFactor is the viral-coefficient summary. The numerator counts ONLY
// human-referred signups (house excluded); the denominator counts referrers.
type KFactor struct {
	Referrers          int     `json:"referrers"`            // distinct human referrers (house excluded)
	ReferredSignups    int     `json:"referred_signups"`     // human-referred signups (house excluded)
	HouseSignups       int     `json:"house_signups"`        // house_default signups (reported separately)
	KFactor            float64 `json:"k_factor"`             // referred_signups / referrers
}

// FunnelStage is one acquisition-funnel stage with a count.
type FunnelStage struct {
	Stage string `json:"stage"`
	Count int    `json:"count"`
}

// CAC is referral cost-of-acquisition vs paid acquisition (kobo).
type CAC struct {
	ReferralSpendKobo  int64   `json:"referral_spend_kobo"`   // paid, non-house reward spend
	ReferredSignups    int     `json:"referred_signups"`      // human-referred signups (house excluded)
	ReferralCACKobo    int64   `json:"referral_cac_kobo"`     // spend / referred signups
	PaidCACKobo        int64   `json:"paid_cac_kobo"`         // supplied benchmark (admin param)
}

// CohortRow is one signup-month cohort's LTV/retention.
type CohortRow struct {
	CohortMonth   string `json:"cohort_month"`    // YYYY-MM
	Signups       int    `json:"signups"`         // human-referred signups in cohort
	ActiveUsers   int    `json:"active_users"`    // with verified activity
	LTVKobo       int64  `json:"ltv_kobo"`        // verified activity value
	RetentionPct  int    `json:"retention_pct"`   // active / signups
}

// ChannelRow is channel/vertical attribution (by attribution_type).
type ChannelRow struct {
	Channel        string `json:"channel"`          // code | deeplink | context | regional_house | global_house
	Signups        int    `json:"signups"`
	IsHouse        bool   `json:"is_house"`
}

// Segmentation separates organic vs referred (house_default reported apart).
type Segmentation struct {
	ReferredSignups int `json:"referred_signups"` // human-referred (house excluded)
	HouseSignups    int `json:"house_signups"`    // house_default segment
	OrganicSignups  int `json:"organic_signups"`  // users with no attribution row
}

// User360 is the per-user referral profile (A-USR-01).
type User360 struct {
	UserID           string  `json:"user_id"`
	AttributionType  string  `json:"attribution_type,omitempty"`
	IsHouse          bool    `json:"is_house"`
	ReferrerID       string  `json:"referrer_id,omitempty"`
	ReferredCount    int     `json:"referred_count"`     // humans this user referred (house excluded)
	TotalEarnedKobo  int64   `json:"total_earned_kobo"`  // non-clawed reward total
	PaidKobo         int64   `json:"paid_kobo"`
	ClawedBackKobo   int64   `json:"clawed_back_kobo"`
	ActivityKobo     int64   `json:"activity_kobo"`      // own verified activity (LTV)
	FraudStanding    string  `json:"fraud_standing"`     // clear | under_review | restricted
}
