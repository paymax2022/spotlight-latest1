// Package network implements ambassador + agent/team override earnings
// (FR-AMB/AGT, §7 reward model, §8B A-AMB).
//
// INVARIANT (§7): an override is a CAPPED percentage of the VERIFIED
// activity/revenue of a network's members — it is NEVER paid for recruitment.
// House-attributed signups (referral_attributions.is_house) are EXCLUDED from the
// override base. Per-tier caps are enforced server-side. Disclosures are stored at
// application time. Money is BIGINT kobo and override accruals route through RB0's
// ledger.Accrue (idempotent); points/recruitment alone earn nothing.
package network

import "time"

// Ambassador statuses.
const (
	AmbApplied   = "applied"
	AmbApproved  = "approved"
	AmbSuspended = "suspended"
	AmbRejected  = "rejected"
)

// Ambassador is a member's ambassador profile + tier + disclosure record.
type Ambassador struct {
	ID                   string     `json:"id"`
	UserID               string     `json:"user_id"`
	Tier                 string     `json:"tier"`
	Status               string     `json:"status"`
	DisclosureText       string     `json:"disclosure_text,omitempty"`
	DisclosureAcceptedAt *time.Time `json:"disclosure_accepted_at,omitempty"`
	AppliedAt            time.Time  `json:"applied_at"`
	ApprovedBy           string     `json:"approved_by,omitempty"`
	ApprovedAt           *time.Time `json:"approved_at,omitempty"`
}

// Network is an agent/team/ambassador network led by one user.
type Network struct {
	ID          string    `json:"id"`
	LeadUserID  string    `json:"lead_user_id"`
	Name        string    `json:"name"`
	NetworkType string    `json:"network_type"`
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"created_at"`
}

// Member is a member of a network. IsHouseAttributed mirrors the member's
// referral_attributions.is_house and drives the override-base exclusion.
type Member struct {
	ID                string    `json:"id"`
	NetworkID         string    `json:"network_id"`
	MemberUserID      string    `json:"member_user_id"`
	IsHouseAttributed bool      `json:"is_house_attributed"`
	Status            string    `json:"status"`
	JoinedAt          time.Time `json:"joined_at"`
}

// Override is a recorded activity-based override accrual.
type Override struct {
	ID               string    `json:"id"`
	BeneficiaryID    string    `json:"beneficiary_id"`
	NetworkID        string    `json:"network_id,omitempty"`
	SourceUserID     string    `json:"source_user_id,omitempty"`
	CampaignID       string    `json:"campaign_id,omitempty"`
	ActivityBaseKobo int64     `json:"activity_base_kobo"`
	OverrideBps      int       `json:"override_bps"`
	AmountKobo       int64     `json:"amount_kobo"`
	CapAppliedKobo   int64     `json:"cap_applied_kobo"`
	RewardLedgerID   string    `json:"reward_ledger_id,omitempty"`
	CreatedAt        time.Time `json:"created_at"`
}

// OverridePolicy is the per-tier override rate + caps.
type OverridePolicy struct {
	ID               string `json:"id"`
	Tier             string `json:"tier"`
	OverrideBps      int    `json:"override_bps"`
	PerMemberCapKobo int64  `json:"per_member_cap_kobo"`
	MonthlyCapKobo   int64  `json:"monthly_cap_kobo"`
	IsActive         bool   `json:"is_active"`
}

// ApplyInput is the ambassador application payload (disclosure mandatory).
type ApplyInput struct {
	Tier               string `json:"tier"`
	DisclosureText     string `json:"disclosure_text"`
	DisclosureAccepted bool   `json:"disclosure_accepted"`
}

// PolicyInput sets a per-tier override policy (admin).
type PolicyInput struct {
	Tier             string `json:"tier"`
	OverrideBps      int    `json:"override_bps"`
	PerMemberCapKobo int64  `json:"per_member_cap_kobo"`
	MonthlyCapKobo   int64  `json:"monthly_cap_kobo"`
	IsActive         bool   `json:"is_active"`
}

// AccrueOverrideInput requests an activity-based override accrual for a network
// lead, driven by ONE member's verified activity. The service excludes the member
// if they are house-attributed, applies the tier rate, and enforces the cap.
type AccrueOverrideInput struct {
	NetworkID      string // network the source member belongs to
	SourceUserID   string // member whose VERIFIED activity drives this override
	CampaignID     string // optional
	IdempotencyKey string // required; idempotent accrual
}
