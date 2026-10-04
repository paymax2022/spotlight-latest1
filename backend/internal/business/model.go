package business

import (
	"slices"
	"time"
)

// Status is a business_profiles.status value (the state machine — see statemachine.go).
type Status string

const (
	StatusDraft                 Status = "draft"
	StatusNameCheck             Status = "name_check"
	StatusNameReserved          Status = "name_reserved"
	StatusRegistrationSubmitted Status = "registration_submitted"
	StatusUnderReview           Status = "under_review"
	StatusRegistered            Status = "registered" // terminal (register_new success)
	StatusSubmitted             Status = "submitted"  // verify_existing intermediate
	StatusVerified              Status = "verified"   // terminal (verify_existing success)
	StatusRejected              Status = "rejected"   // terminal
	StatusFailed                Status = "failed"     // terminal
)

// Mode distinguishes the two flows.
type Mode string

const (
	ModeVerifyExisting Mode = "verify_existing"
	ModeRegisterNew    Mode = "register_new"
)

// EntityType mirrors the CAC entity classification (and the DB CHECK).
type EntityType string

const (
	EntityBusinessName        EntityType = "business_name"
	EntityCompany             EntityType = "company"
	EntityIncorporatedTrustee EntityType = "incorporated_trustee"
)

// BusinessProfile is the persisted CAC business identity.
type BusinessProfile struct {
	ID                 string         `json:"id"`
	UserID             string         `json:"userId"`
	EntityType         EntityType     `json:"entityType"`
	Mode               Mode           `json:"mode"`
	LegalName          string         `json:"legalName,omitempty"`
	ProposedName       string         `json:"proposedName,omitempty"`
	LineOfBusiness     string         `json:"lineOfBusiness,omitempty"`
	Status             Status         `json:"status"`
	RCOrBNNumber       string         `json:"rcOrBnNumber,omitempty"`
	CACReservationRef  string         `json:"cacReservationRef,omitempty"`
	CACRegistrationRef string         `json:"cacRegistrationRef,omitempty"`
	VerificationSource string         `json:"verificationSource,omitempty"`
	RegisteredAt       *time.Time     `json:"registeredAt,omitempty"`
	CertificateURL     string         `json:"certificateUrl,omitempty"` // CAC certificate, available once registered
	FeeKobo            int64          `json:"feeKobo"`
	FeeLedgerRef       string         `json:"feeLedgerRef,omitempty"`
	Metadata           map[string]any `json:"metadata,omitempty"`
	CreatedAt          time.Time      `json:"createdAt"`
	UpdatedAt          time.Time      `json:"updatedAt"`
	Proprietors        []Proprietor   `json:"proprietors,omitempty"`
}

// PaystackInit is returned when a user chooses to pay the CAC registration fee via
// the payment gateway rather than the wallet. The client opens AuthorizationURL, then
// calls the verify endpoint with Reference on return.
type PaystackInit struct {
	Reference        string `json:"reference"`
	AuthorizationURL string `json:"authorizationUrl,omitempty"`
	AccessCode       string `json:"accessCode,omitempty"`
	AlreadyPaid      bool   `json:"alreadyPaid,omitempty"`
}

// Proprietor is one owner/partner/director attached to a registration. BVN/NIN are
// exposed only masked in API responses.
type Proprietor struct {
	ID        string `json:"id,omitempty"`
	FullName  string `json:"fullName"`
	Role      string `json:"role"`
	BVNMasked string `json:"bvnMasked,omitempty"`
	NINMasked string `json:"ninMasked,omitempty"`
	SharePct  int    `json:"sharePct"`
	Phone     string `json:"phone,omitempty"`
	Email     string `json:"email,omitempty"`
}

// NameCheckRequest previews name availability. When BusinessID is set and owned by
// the caller, the profile transitions draft → name_check.
type NameCheckRequest struct {
	BusinessID     string `json:"businessId,omitempty"`
	ProposedName   string `json:"proposedName" binding:"required"`
	LineOfBusiness string `json:"lineOfBusiness,omitempty"`
}

// ReserveRequest reserves the profile's proposed name with CAC.
type ReserveRequest struct {
	BusinessID string `json:"businessId" binding:"required"`
}

// VerifyExistingRequest looks up + verifies an EXISTING registered business.
type VerifyExistingRequest struct {
	RCOrBNNumber string     `json:"rcOrBnNumber" binding:"required"`
	EntityType   EntityType `json:"entityType,omitempty"`
}

// ProprietorInput is a proprietor supplied on register-new. Raw BVN/NIN are sent to
// CAC by the provider and never persisted (only a masked tail is stored).
type ProprietorInput struct {
	FullName string `json:"fullName" binding:"required"`
	Role     string `json:"role,omitempty"`
	BVN      string `json:"bvn,omitempty"`
	NIN      string `json:"nin,omitempty"`
	SharePct int    `json:"sharePct,omitempty"`
	Phone    string `json:"phone,omitempty"`
	Email    string `json:"email,omitempty"`
}

// RegisterNewRequest opens a new register-new draft.
type RegisterNewRequest struct {
	EntityType     EntityType        `json:"entityType" binding:"required"`
	ProposedName   string            `json:"proposedName" binding:"required"`
	LineOfBusiness string            `json:"lineOfBusiness,omitempty"`
	Address        string            `json:"address,omitempty"`
	Objects        string            `json:"objects,omitempty"`
	DocumentRefs   []string          `json:"documentRefs,omitempty"`
	Proprietors    []ProprietorInput `json:"proprietors,omitempty"`
}

// RejectRequest is the admin reject reason.
type RejectRequest struct {
	Reason string `json:"reason" binding:"required"`
}

// NameCheckResult is returned by the name-check endpoint.
type NameCheckResult struct {
	Business    *BusinessProfile `json:"business,omitempty"`
	Available   bool             `json:"available"`
	Status      string           `json:"status"`
	Reason      string           `json:"reason,omitempty"`
	Suggestions []string         `json:"suggestions,omitempty"`
}

// State machine for a business profile.
//	register_new : draft → name_check → name_reserved → registration_submitted
//	                     → under_review → registered
//	verify_existing:       draft → submitted → verified
//	terminal failures:     any non-terminal → rejected | failed
// Every legal transition is enforced by CanTransition and logged to
// business_profile_events by the repository (see repository.transition).

// allowedTransitions maps a status to the set of statuses reachable from it.
var allowedTransitions = map[Status][]Status{
	StatusDraft: {
		StatusNameCheck,    // register_new: run availability
		StatusNameReserved, // register_new: reserve directly (reserve implies availability)
		StatusSubmitted,    // verify_existing: submit lookup
		StatusFailed, StatusRejected,
	},
	StatusNameCheck: {
		StatusNameReserved,
		StatusNameCheck, // re-check a different name (self-loop)
		StatusFailed, StatusRejected,
	},
	StatusNameReserved: {
		StatusRegistrationSubmitted,
		StatusFailed, StatusRejected,
	},
	StatusRegistrationSubmitted: {
		StatusUnderReview,
		StatusRegistered, // provider may register directly from submit
		StatusFailed, StatusRejected,
	},
	StatusUnderReview: {
		StatusRegistered,
		StatusRejected, StatusFailed,
	},
	StatusSubmitted: {
		StatusVerified,
		StatusRejected, StatusFailed,
	},
	// Terminal states have no outgoing transitions.
	StatusRegistered: {},
	StatusVerified:   {},
	StatusRejected:   {},
	StatusFailed:     {},
}

// terminalStatuses are the states from which no transition is legal.
var terminalStatuses = map[Status]bool{
	StatusRegistered: true,
	StatusVerified:   true,
	StatusRejected:   true,
	StatusFailed:     true,
}

// CanTransition reports whether from → to is a legal move.
func CanTransition(from, to Status) bool {
	return slices.Contains(allowedTransitions[from], to)
}

// IsTerminal reports whether s is a terminal state.
func IsTerminal(s Status) bool { return terminalStatuses[s] }

// IsVerifiedOrRegistered reports whether the profile represents a confirmed CAC
// identity (used by the merchant-upgrade gate).
func IsVerifiedOrRegistered(s Status) bool {
	return s == StatusVerified || s == StatusRegistered
}
