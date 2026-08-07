// Package compliance is the referral compliance layer (FR-COMPLY, §6, §10):
// versioned disclosures / T&Cs, NDPC consent capture, AML monitoring of referral
// earnings, and structural policy (anti-pyramid line cap, tier cap, jurisdiction)
// consumed by the override + reward engines. It also drives earnings-claim review
// and regulatory-reporting export. No raw PII is persisted — consents reference
// the disclosure version; AML flags carry reason codes only.
package compliance

import "time"

// AML statuses.
const (
	AMLOpen      = "open"
	AMLReviewing = "reviewing"
	AMLCleared   = "cleared"
	AMLReported  = "reported"
)

// Consent types.
const (
	ConsentNDPCData     = "ndpc_data"
	ConsentEarningTerms = "earnings_terms"
	ConsentMarketing    = "marketing"
	ConsentOverride     = "override_disclosure"
)

// Disclosure is a versioned T&Cs / disclosure document.
type Disclosure struct {
	ID           string    `json:"id"`
	Slug         string    `json:"slug"`
	Version      int       `json:"version"`
	Title        string    `json:"title"`
	Body         string    `json:"body"`
	Jurisdiction string    `json:"jurisdiction"`
	Active       bool      `json:"active"`
	EffectiveAt  time.Time `json:"effective_at"`
	CreatedBy    string    `json:"created_by,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
}

// DisclosureInput publishes a new disclosure version. Versioning is automatic:
// publishing a slug bumps to max(version)+1 and deactivates prior versions.
type DisclosureInput struct {
	Slug         string `json:"slug"`
	Title        string `json:"title"`
	Body         string `json:"body"`
	Jurisdiction string `json:"jurisdiction"`
}

// Consent is an NDPC consent record (member-captured).
type Consent struct {
	ID           string    `json:"id"`
	UserID       string    `json:"user_id"`
	DisclosureID string    `json:"disclosure_id,omitempty"`
	ConsentType  string    `json:"consent_type"`
	Granted      bool      `json:"granted"`
	Version      int       `json:"version,omitempty"`
	Source       string    `json:"source,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
}

// ConsentInput records a member's consent decision.
type ConsentInput struct {
	ConsentType  string `json:"consent_type"`
	DisclosureID string `json:"disclosure_id"`
	Granted      *bool  `json:"granted"`
	Version      int    `json:"version"`
	Source       string `json:"source"`
}

// AMLFlag is a referral-earnings AML monitoring flag.
type AMLFlag struct {
	ID          string    `json:"id"`
	SubjectID   string    `json:"subject_id,omitempty"`
	ReasonCode  string    `json:"reason_code"`
	AmountKobo  int64     `json:"amount_kobo"`
	WindowCount int       `json:"window_count"`
	Status      string    `json:"status"`
	RewardID    string    `json:"reward_id,omitempty"`
	ReportedRef string    `json:"reported_ref,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
}

// AMLFlagInput raises an AML flag (reason code + amount only).
type AMLFlagInput struct {
	SubjectID   string `json:"subject_id"`
	ReasonCode  string `json:"reason_code"`
	AmountKobo  int64  `json:"amount_kobo"`
	WindowCount int    `json:"window_count"`
	RewardID    string `json:"reward_id"`
}

// Policy is the singleton structural policy (anti-pyramid / tier cap / jurisdiction).
type Policy struct {
	MaxPyramidDepth      int       `json:"max_pyramid_depth"`
	TierCapKobo          int64     `json:"tier_cap_kobo"`
	RequireActivity      bool      `json:"require_activity"`
	AllowedJurisdictions []string  `json:"allowed_jurisdictions"`
	UpdatedBy            string    `json:"updated_by,omitempty"`
	UpdatedAt            time.Time `json:"updated_at"`
}

// PolicyInput updates the structural policy singleton.
type PolicyInput struct {
	MaxPyramidDepth      *int     `json:"max_pyramid_depth"`
	TierCapKobo          *int64   `json:"tier_cap_kobo"`
	RequireActivity      *bool    `json:"require_activity"`
	AllowedJurisdictions []string `json:"allowed_jurisdictions"`
}

// ClaimReviewItem is an earnings-claim review row (reused from the risk review
// queue, filtered to claims). Earnings-claim review surfaces held/queued rewards.
type ClaimReviewItem struct {
	ID         string    `json:"id"`
	RewardID   string    `json:"reward_id,omitempty"`
	SubjectID  string    `json:"subject_id,omitempty"`
	ReasonCode string    `json:"reason_code"`
	Status     string    `json:"status"`
	CreatedAt  time.Time `json:"created_at"`
}

// RegulatoryExportRow is one row of the regulatory-reporting export.
type RegulatoryExportRow struct {
	SubjectID   string    `json:"subject_id,omitempty"`
	ReasonCode  string    `json:"reason_code"`
	AmountKobo  int64     `json:"amount_kobo"`
	Status      string    `json:"status"`
	ReportedRef string    `json:"reported_ref,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
}
