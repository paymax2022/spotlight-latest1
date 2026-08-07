// Package credentials is the Spotlight Academy Phase-3 credentials + earning-bridge
// sub-package: the learn-to-earn moat (trade/academic credential → verification
// registry → Paymax earning roles).
//
// GOLDEN RULES enforced here (docs/prd/edtech state-machines.md §6, paymax-rails.md
// "Earning bridge", conventions.md):
//   - Guarded credential state machine: pending → issued → revoked. Illegal
//     transitions are rejected with a stable code AND written to the immutable audit log.
//   - The verification registry (academy_credential_verifications) is the PUBLIC
//     source of truth; revoke updates it (status=revoked) so a public verify reflects it.
//   - The earning bridge surfaces eligible opportunities and routes apply() into the
//     EXISTING Paymax role-upgrade/KYC flow via an INJECTED RoleUpgrader interface.
//     This module never rebuilds role-upgrade or KYC; apply is IDEMPOTENT on
//     academy_earning_applications.idempotency_key (double call = one route).
//   - Everything mutating is written to public.audit_logs (module 'academy.credentials').
//   - No money moves here; role onboarding is owned by Paymax.
//
// Tables owned: academy_credentials, academy_credential_verifications,
// academy_earning_opportunities, academy_earning_applications.
package credentials

import "time"

// ── Credential lifecycle ────────────────────────────────────────────────────────

// CredState mirrors academy_credentials.state CHECK ('pending','issued','revoked').
type CredState string

const (
	CredPending CredState = "pending"
	CredIssued  CredState = "issued"
	CredRevoked CredState = "revoked"
)

// Credential kinds mirror academy_credentials.kind CHECK ('academic','trade').
const (
	KindAcademic = "academic"
	KindTrade    = "trade"
)

// Credential is one academy_credentials row.
type Credential struct {
	ID             string     `json:"id"`
	UserID         string     `json:"user_id"`
	Kind           string     `json:"kind"` // academic | trade
	Title          string     `json:"title"`
	TradeTrack     *string    `json:"trade_track,omitempty"`
	SubjectID      *string    `json:"subject_id,omitempty"`
	VerificationID string     `json:"verification_id"` // public, shareable id (QR/verify)
	Signature      *string    `json:"signature,omitempty"`
	State          CredState  `json:"state"`
	Reason         *string    `json:"reason,omitempty"`
	IssuedAt       *time.Time `json:"issued_at,omitempty"`
	RevokedAt      *time.Time `json:"revoked_at,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
}

// Verification statuses mirror academy_credential_verifications.status CHECK.
const (
	VerifValid   = "valid"
	VerifRevoked = "revoked"
)

// PublicVerification is the sanitized public read from the verification registry.
// It exposes only the holder display name + claim — no PII beyond the display name.
type PublicVerification struct {
	VerificationID string     `json:"verification_id"`
	HolderName     string     `json:"holder_name"`
	Title          string     `json:"title"`
	Kind           string     `json:"kind"`
	Status         string     `json:"status"` // valid | revoked
	IssuedAt       *time.Time `json:"issued_at,omitempty"`
}

// ── Earning bridge ───────────────────────────────────────────────────────────────

// EligibilityRules mirrors the academy_earning_opportunities.eligibility_rules jsonb
// shape, e.g. {"trade_track":"solar","min_credentials":1}. Kept as data so a future
// opportunity can change rules without code changes (conventions.md "rules are data").
type EligibilityRules struct {
	TradeTrack     string `json:"trade_track,omitempty"`     // required trade track (empty = any)
	Kind           string `json:"kind,omitempty"`            // required credential kind (empty = any)
	MinCredentials int    `json:"min_credentials,omitempty"` // minimum matching issued credentials
}

// EarningOpportunity is one academy_earning_opportunities row.
type EarningOpportunity struct {
	ID               string           `json:"id"`
	Code             string           `json:"code"`
	Title            string           `json:"title"`
	Role             string           `json:"role"` // driver|agent|creator|merchant|service_provider
	EligibilityRules EligibilityRules `json:"eligibility_rules"`
	Description      *string          `json:"description,omitempty"`
	Status           string           `json:"status"`
	CreatedAt        time.Time        `json:"created_at"`
}

// AppState mirrors academy_earning_applications.state CHECK.
type AppState string

const (
	AppSubmitted AppState = "submitted"
	AppRouted    AppState = "routed"
	AppApproved  AppState = "approved"
	AppRejected  AppState = "rejected"
)

// EarningApplication is one academy_earning_applications row.
type EarningApplication struct {
	ID             string     `json:"id"`
	UserID         string     `json:"user_id"`
	OpportunityID  string     `json:"opportunity_id"`
	State          AppState   `json:"state"`
	PaymaxRef      *string    `json:"paymax_ref,omitempty"`
	Reason         *string    `json:"reason,omitempty"`
	IdempotencyKey *string    `json:"idempotency_key,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
	DecidedAt      *time.Time `json:"decided_at,omitempty"`
}

// ── Request DTOs ─────────────────────────────────────────────────────────────────

// RevokeRequest — admin POST /credentials/:id/revoke.
type RevokeRequest struct {
	Reason string `json:"reason" binding:"required"`
}

// CreateOpportunityRequest — admin POST /earning/opportunities.
type CreateOpportunityRequest struct {
	Code             string           `json:"code" binding:"required"`
	Title            string           `json:"title" binding:"required"`
	Role             string           `json:"role" binding:"required"`
	EligibilityRules EligibilityRules `json:"eligibility_rules"`
	Description      *string          `json:"description,omitempty"`
	Status           string           `json:"status,omitempty"`
}

// UpdateOpportunityRequest — admin PUT /earning/opportunities/:id (partial).
type UpdateOpportunityRequest struct {
	Title            *string           `json:"title,omitempty"`
	Role             *string           `json:"role,omitempty"`
	EligibilityRules *EligibilityRules `json:"eligibility_rules,omitempty"`
	Description      *string           `json:"description,omitempty"`
	Status           *string           `json:"status,omitempty"`
}

// ApplyRequest — member POST /earning/apply.
type ApplyRequest struct {
	OpportunityID  string `json:"opportunity_id" binding:"required"`
	IdempotencyKey string `json:"idempotency_key,omitempty"`
}

// ApplyResult is returned from a bridge apply: the application plus the role(s)
// unlocked. Paymax owns the actual onboarding; paymax_ref is the upgrade reference.
type ApplyResult struct {
	Application   *EarningApplication `json:"application"`
	UnlockedRole  string              `json:"unlocked_role"`
	PaymaxRef     string              `json:"paymax_ref,omitempty"`
	AlreadyRouted bool                `json:"already_routed"` // true when this was an idempotent replay
}
