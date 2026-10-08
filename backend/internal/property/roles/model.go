// Package roles implements property marketplace role registration (estate
// manager, developer, agent): self-serve profiles with an admin-reviewed
// verification lifecycle. Tables: property_role_profiles/_documents/_events.
package roles

import (
	"errors"
	"fmt"
	"time"
)

const (
	RoleEstateManager = "estate_manager"
	RoleDeveloper     = "developer"
	RoleAgent         = "agent"
)

// ValidRole reports whether role is one of the three registrable roles.
func ValidRole(role string) bool {
	switch role {
	case RoleEstateManager, RoleDeveloper, RoleAgent:
		return true
	}
	return false
}

// Profile status / verification values (mirror the table CHECK constraints).
const (
	StatusDraft     = "draft"
	StatusActive    = "active"
	StatusSuspended = "suspended"

	VerUnverified = "unverified"
	VerPending    = "pending"
	VerVerified   = "verified"
	VerRejected   = "rejected"
)

type Document struct {
	ID         string    `json:"id"`
	Kind       string    `json:"kind"`
	StorageKey string    `json:"storageKey"`
	CreatedAt  time.Time `json:"createdAt"`
}

type Profile struct {
	ID                 string         `json:"id"`
	UserID             string         `json:"userId"`
	Role               string         `json:"role"`
	Status             string         `json:"status"`
	VerificationStatus string         `json:"verificationStatus"`
	DisplayName        string         `json:"displayName"`
	Details            map[string]any `json:"details"`
	RejectionReason    *string        `json:"rejectionReason,omitempty"`
	VerifiedAt         *time.Time     `json:"verifiedAt,omitempty"`
	// VerifiedBy is the reviewing admin's id; never serialised (member responses
	// must not reveal who reviewed them).
	VerifiedBy *string    `json:"-"`
	CreatedAt  time.Time  `json:"createdAt"`
	UpdatedAt  time.Time  `json:"updatedAt"`
	Documents  []Document `json:"documents"`
}

var (
	ErrInvalidRole      = errors.New("property roles: invalid role")
	ErrNotFound         = errors.New("property roles: profile not found")
	ErrSuspended        = errors.New("property roles: profile is suspended")
	ErrIncomplete       = errors.New("property roles: required details missing")
	ErrNoDocument       = errors.New("property roles: at least one document is required")
	ErrBadTransition    = errors.New("property roles: invalid verification transition")
	ErrForeignKey       = errors.New("property roles: storage key outside caller prefix")
	ErrDetailsInvalid   = errors.New("property roles: invalid details")
	ErrSelfReview       = errors.New("property roles: reviewers cannot review their own profile")
	ErrReasonRequired   = errors.New("property roles: a reason is required")
	ErrStale            = errors.New("property roles: profile changed since you viewed it; reload")
	ErrTooManyDocuments = errors.New("property roles: document limit reached")
)

// MaxDocumentsPerProfile caps attached documents per role profile.
const MaxDocumentsPerProfile = 10

// IncompleteError carries the missing field names; errors.Is(err, ErrIncomplete) holds.
type IncompleteError struct{ Missing []string }

func (e *IncompleteError) Error() string {
	return fmt.Sprintf("%s: %v", ErrIncomplete.Error(), e.Missing)
}
func (e *IncompleteError) Unwrap() error { return ErrIncomplete }

// DocumentKeyPrefix is the only object-key prefix a caller may attach documents under.
func DocumentKeyPrefix(userID, role string) string {
	return "property-roles/" + userID + "/" + role + "/"
}
