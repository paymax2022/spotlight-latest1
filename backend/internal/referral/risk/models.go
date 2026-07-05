// Package risk is the referral fraud/risk engine (FR-RISK, §6, §10): a
// configurable rules engine (KYC/BVN/NIN dedup, device fingerprint, velocity,
// behavioural cohort, self-referral), an append-only alert + investigation-case
// workbench, a block/allow list, and a human review queue that holds rewards in
// the RB0 ledger's 'pending' state while a decision is made. Clawbacks are
// executed through the RB0 reward ledger (reversing entries, audited).
//
// PRIVACY: this package never persists raw PII. Identity dedup reuses the
// finance KYC argon2id/sha256 identity hashes; device/IP/email are stored as
// hashes; alerts carry reason codes only.
package risk

import "time"

// Rule actions.
const (
	ActionReview    = "review"
	ActionHold      = "hold"
	ActionClawback  = "clawback"
	ActionBlock     = "block"
)

// Rule types.
const (
	TypeKYCDedup     = "kyc_dedup"
	TypeDevice       = "device"
	TypeVelocity     = "velocity"
	TypeCohort       = "cohort"
	TypeSelfReferral = "self_referral"
	TypeBlocklist    = "blocklist"
)

// Alert / case / review-queue statuses.
const (
	AlertOpen      = "open"
	AlertReviewing = "reviewing"
	AlertDismissed = "dismissed"
	AlertConfirmed = "confirmed"

	CaseOpen          = "open"
	CaseInvestigating = "investigating"
	CaseResolved      = "resolved"
	CaseEscalated     = "escalated"

	ReviewQueued     = "queued"
	ReviewApproved   = "approved"
	ReviewRejected   = "rejected"
	ReviewClawedBack = "clawed_back"
)

// Rule is a configurable risk rule (admin CRUD). Params hold per-rule thresholds.
type Rule struct {
	ID        string         `json:"id"`
	Code      string         `json:"code"`
	Name      string         `json:"name"`
	RuleType  string         `json:"rule_type"`
	Enabled   bool           `json:"enabled"`
	Action    string         `json:"action"`
	Params    map[string]any `json:"params"`
	Severity  string         `json:"severity"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
}

// RuleInput is the admin create/update payload for a rule.
type RuleInput struct {
	Code     string         `json:"code"`
	Name     string         `json:"name"`
	RuleType string         `json:"rule_type"`
	Enabled  *bool          `json:"enabled"`
	Action   string         `json:"action"`
	Params   map[string]any `json:"params"`
	Severity string         `json:"severity"`
}

// Alert is an append-only fraud alert. References are ids/hashes only — never PII.
type Alert struct {
	ID            string    `json:"id"`
	SubjectID     string    `json:"subject_id,omitempty"`
	RuleCode      string    `json:"rule_code"`
	ReasonCode    string    `json:"reason_code"`
	Severity      string    `json:"severity"`
	RewardID      string    `json:"reward_id,omitempty"`
	AttributionID string    `json:"attribution_id,omitempty"`
	IdentityHash  string    `json:"identity_hash,omitempty"`
	DeviceHash    string    `json:"device_hash,omitempty"`
	WindowCount   int       `json:"window_count"`
	Status        string    `json:"status"`
	CaseID        string    `json:"case_id,omitempty"`
	CreatedAt     time.Time `json:"created_at"`
}

// Case is an investigation case (workbench).
type Case struct {
	ID          string     `json:"id"`
	SubjectID   string     `json:"subject_id,omitempty"`
	Status      string     `json:"status"`
	ReasonCodes []string   `json:"reason_codes"`
	Resolution  string     `json:"resolution,omitempty"`
	OpenedBy    string     `json:"opened_by,omitempty"`
	ResolvedBy  string     `json:"resolved_by,omitempty"`
	Notes       string     `json:"notes,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
	ResolvedAt  *time.Time `json:"resolved_at,omitempty"`
}

// BlocklistEntry is a block/allow list row. entry_value is an id or hash.
type BlocklistEntry struct {
	ID         string    `json:"id"`
	ListType   string    `json:"list_type"`
	EntryType  string    `json:"entry_type"`
	EntryValue string    `json:"entry_value"`
	Reason     string    `json:"reason,omitempty"`
	AddedBy    string    `json:"added_by,omitempty"`
	Active     bool      `json:"active"`
	CreatedAt  time.Time `json:"created_at"`
}

// BlocklistInput is the admin add payload.
type BlocklistInput struct {
	ListType   string `json:"list_type"`
	EntryType  string `json:"entry_type"`
	EntryValue string `json:"entry_value"`
	Reason     string `json:"reason"`
}

// ReviewItem is a held-reward review-queue row.
type ReviewItem struct {
	ID         string     `json:"id"`
	RewardID   string     `json:"reward_id,omitempty"`
	SubjectID  string     `json:"subject_id,omitempty"`
	AlertID    string     `json:"alert_id,omitempty"`
	ReasonCode string     `json:"reason_code"`
	Status     string     `json:"status"`
	DecidedBy  string     `json:"decided_by,omitempty"`
	DecidedAt  *time.Time `json:"decided_at,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
}

// EvaluateInput is the signup/earning evaluation request fed to the rules engine.
// Hashes are supplied by the caller (never raw PII).
type EvaluateInput struct {
	SubjectID      string `json:"subject_id"`       // the earning/referred user under evaluation
	ReferrerID     string `json:"referrer_id"`      // attributed referrer (self-referral check)
	RewardID       string `json:"reward_id"`        // RB0 reward ledger row to hold, if any
	AttributionID  string `json:"attribution_id"`   // RB0 attribution row, if any
	IdentityHash   string `json:"identity_hash"`    // argon2id/sha256 of BVN/NIN (reuse finance KYC)
	DeviceHash     string `json:"device_hash"`      // hashed device fingerprint
	IPHash         string `json:"ip_hash"`          // hashed IP
	EmailHash      string `json:"email_hash"`       // hashed email
	IdempotencyKey string `json:"idempotency_key"`  // for any clawback posting
}

// EvaluateResult summarises the decision and the alerts raised.
type EvaluateResult struct {
	Decision   string   `json:"decision"`    // pass | review | hold | block | clawback
	ReasonCode string   `json:"reason_code"` // primary reason (worst match)
	Alerts     []Alert  `json:"alerts"`
	HeldReward bool     `json:"held_reward"`
	Matched    []string `json:"matched_rules"`
}

// FraudStatus is the member-facing "my fraud-status" view (A-USR-04): no PII, no
// internal reason codes beyond a coarse standing.
type FraudStatus struct {
	UserID      string `json:"user_id"`
	Standing    string `json:"standing"` // clear | under_review | restricted
	OpenAlerts  int    `json:"open_alerts"`
	OpenCases   int    `json:"open_cases"`
	HeldRewards int    `json:"held_rewards"`
}

// ReportInput is the member report-abuse payload.
type ReportInput struct {
	TargetUserID string `json:"target_user_id"`
	ReasonCode   string `json:"reason_code"`
}

// ClawbackInput executes a clawback of a held/paid reward via the RB0 ledger.
type ClawbackInput struct {
	RewardID       string `json:"reward_id"`
	ReasonCode     string `json:"reason_code"`
	IdempotencyKey string `json:"idempotency_key"`
}
