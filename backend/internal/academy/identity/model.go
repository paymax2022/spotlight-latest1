// Package identity is the Spotlight Academy identity-bridge sub-package.
//
// GOLDEN RULES enforced here (docs/prd/edtech/CLAUDE.md):
//   - Single Paymax identity. Roles are ADDITIVE capabilities layered onto the
//     existing auth.users record — never a parallel auth store.
//   - Minors require an active GuardianLink + an immutable ConsentRecord before
//     purchases / community / data-sharing capabilities unlock.
//   - KYC tier gates capability (reuses backend/internal/finance/kyc — not rebuilt).
//   - GuardianLink is a guarded state machine: pending → active → revoked. Illegal
//     transitions are rejected and audited.
//   - Everything mutating is written to the existing public.audit_logs table.
package identity

import "time"

// Role is an additive academy capability flag attached to a single Paymax user.
// Mirrors the academy_roles.role CHECK constraint.
type Role string

const (
	RoleLearner Role = "learner"
	RoleParent  Role = "parent"
	RoleTutor   Role = "tutor"
	RoleStaff   Role = "staff"
)

// ValidRole reports whether r is an accepted academy role.
func ValidRole(r Role) bool {
	switch r {
	case RoleLearner, RoleParent, RoleTutor, RoleStaff:
		return true
	default:
		return false
	}
}

// GuardianStatus is the guarded state-machine state of a guardian link.
// Mirrors academy_guardian_links.status.
type GuardianStatus string

const (
	GuardianPending GuardianStatus = "pending"
	GuardianActive  GuardianStatus = "active"
	GuardianRevoked GuardianStatus = "revoked"
)

// RoleGrant is one row of academy_roles.
type RoleGrant struct {
	UserID    string    `json:"user_id"`
	Role      Role      `json:"role"`
	GrantedAt time.Time `json:"granted_at"`
}

// Profile is one academy_profiles row (one per (user_id, role)).
type Profile struct {
	ID          string    `json:"id"`
	UserID      string    `json:"user_id"`
	Role        Role      `json:"role"`
	ClassID     *string   `json:"class_id,omitempty"`
	Stream      *string   `json:"stream,omitempty"`
	TradeTrack  *string   `json:"trade_track,omitempty"`
	School      *string   `json:"school,omitempty"`
	DisplayName *string   `json:"display_name,omitempty"`
	AvatarURL   *string   `json:"avatar_url,omitempty"`
	EntryYear   *int      `json:"entry_year,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// GuardianLink binds a guardian (parent) to a minor learner. Guarded lifecycle.
type GuardianLink struct {
	ID              string         `json:"id"`
	GuardianUserID  string         `json:"guardian_user_id"`
	MinorUserID     string         `json:"minor_user_id"`
	ConsentRecordID *string        `json:"consent_record_id,omitempty"`
	Status          GuardianStatus `json:"status"`
	CreatedAt       time.Time      `json:"created_at"`
}

// ConsentRecord is an immutable consent grant captured at the moment a guardian
// authorises a scope for a minor. Never updated or deleted; revocation flips the
// GuardianLink, leaving the historical consent intact.
type ConsentRecord struct {
	ID             string         `json:"id"`
	MinorUserID    string         `json:"minor_user_id"`
	GuardianUserID string         `json:"guardian_user_id"`
	Scope          map[string]any `json:"scope"`
	ActorUserID    *string        `json:"actor_user_id,omitempty"`
	GrantedAt      time.Time      `json:"granted_at"`
}

// ── Request DTOs ──────────────────────────────────────────────────────────────

// GrantRoleRequest is the body for POST /academy/roles.
type GrantRoleRequest struct {
	Role Role `json:"role" binding:"required"`
}

// UpsertProfileRequest is the body for PUT /academy/profile.
type UpsertProfileRequest struct {
	Role        Role    `json:"role" binding:"required"`
	ClassID     *string `json:"class_id,omitempty"`
	Stream      *string `json:"stream,omitempty"`
	TradeTrack  *string `json:"trade_track,omitempty"`
	School      *string `json:"school,omitempty"`
	DisplayName *string `json:"display_name,omitempty"`
	AvatarURL   *string `json:"avatar_url,omitempty"`
	EntryYear   *int    `json:"entry_year,omitempty"`
}

// LinkGuardianRequest is the body for POST /academy/guardians/link.
type LinkGuardianRequest struct {
	MinorUserID string `json:"minor_user_id" binding:"required"`
}

// RecordConsentRequest is the body for POST /academy/guardians/:minorId/consent.
// Scope is a free-form object whose keys gate capabilities, e.g.
// {"purchases": true, "community": true, "data_sharing": false}.
type RecordConsentRequest struct {
	Scope map[string]any `json:"scope" binding:"required"`
}

// Me aggregates the identity surface returned by GET /academy/me.
type Me struct {
	UserID        string         `json:"user_id"`
	Roles         []RoleGrant    `json:"roles"`
	Profiles      []Profile      `json:"profiles"`
	GuardianLinks []GuardianLink `json:"guardian_links"` // links where the user is the guardian
	GuardedBy     []GuardianLink `json:"guarded_by"`     // links where the user is the minor
}

// CapabilityResult is the outcome of a capability gate check.
type CapabilityResult struct {
	OK         bool   `json:"ok"`
	Reason     string `json:"reason,omitempty"` // stable snake_case code when !ok
	Capability string `json:"capability"`
}

// Capabilities that require a guardian consent scope when the actor is a minor.
const (
	CapabilityPurchases   = "purchases"
	CapabilityCommunity   = "community"
	CapabilityDataSharing = "data_sharing"
)

// minTierForCapability is the minimum KYC tier required to unlock a capability.
// Curriculum/learning is open (tier 0); value-bearing or social capabilities gate.
func minTierForCapability(capability string) int {
	switch capability {
	case CapabilityPurchases:
		return 1
	case CapabilityCommunity, CapabilityDataSharing:
		return 1
	default:
		return 0
	}
}
