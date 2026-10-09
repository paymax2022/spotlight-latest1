package schools

import (
	"errors"
	"spotlight/backend/go-common/fsm"
)

// States: active → suspended → expired, with suspended → active (reactivate).
//   - active    : licence in force; seats consumable by enrolment.
//   - suspended : admin-paused; reversible back to active.
//   - expired   : terminal sink (active|suspended → expired).
// Only the transitions below are legal. Illegal transitions are rejected with
// ErrIllegalTransition and audit-logged by the service. canLicence is PURE so it is
// unit-testable with no DB (schools_test.go).

// licenceTransitions is the legal adjacency set for the licence SM.
var licenceTransitions = fsm.Table[LicenceState]{
	LicenceActive:    fsm.Set(LicenceSuspended, LicenceExpired),
	LicenceSuspended: fsm.Set(LicenceActive, LicenceExpired),
	LicenceExpired:   {}, // terminal
}

// canLicence reports whether from→to is a legal licence-SM transition. Pure.
func canLicence(from, to LicenceState) bool {
	return licenceTransitions.Can(from, to)
}

// Sentinel errors mapped to stable snake_case codes / HTTP statuses by the handler.
var (
	ErrIllegalTransition    = errors.New("illegal_transition")
	ErrIdempotencyRequired  = errors.New("idempotency_key_required")
	ErrIdempotencyKeyReused = errors.New("idempotency_key_reused")
	ErrNotFound             = errors.New("not_found")
	ErrInvalidAmount        = errors.New("invalid_amount")
	ErrInvalidInput         = errors.New("invalid_input")
	ErrInstitutionInactive  = errors.New("institution_inactive")
	ErrLicenceNotFound      = errors.New("licence_not_found")
	ErrNoActiveLicence      = errors.New("no_active_licence")
	ErrSeatLimitExceeded    = errors.New("seat_limit_exceeded")
	ErrBillingNotOpen       = errors.New("billing_not_open")
)
