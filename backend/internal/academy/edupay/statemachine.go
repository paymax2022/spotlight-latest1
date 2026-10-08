package edupay

import (
	"errors"
	"spotlight/backend/go-common/fsm"
)

// States: fee_due → funding → collected → disbursed → reconciled
//   - fee_due    : disbursement created, nothing collected yet.
//   - funding    : collection initiated on the rail (collect / bnpl / pot draw).
//   - collected  : funds confirmed received from the payer.
//   - disbursed  : funds paid out to the school's virtual account.
//   - reconciled : admin-confirmed against the payout (golden rule 6: reconcile + audit).
// Only the transitions below are legal. Illegal transitions are rejected with
// ErrIllegalTransition and audit-logged by the service. canDisb is PURE so it is
// unit-testable with no DB (edupay_test.go).

// DisbState is the disbursement lifecycle state (matches academy_disbursements.state
// CHECK constraint exactly).
type DisbState string

const (
	DisbFeeDue     DisbState = "fee_due"
	DisbFunding    DisbState = "funding"
	DisbCollected  DisbState = "collected"
	DisbDisbursed  DisbState = "disbursed"
	DisbReconciled DisbState = "reconciled"
)

// disbTransitions is the legal adjacency set for the disbursement SM.
var disbTransitions = fsm.Table[DisbState]{
	DisbFeeDue:     fsm.Set(DisbFunding),
	DisbFunding:    fsm.Set(DisbCollected),
	DisbCollected:  fsm.Set(DisbDisbursed),
	DisbDisbursed:  fsm.Set(DisbReconciled),
	DisbReconciled: {}, // terminal
}

// canDisb reports whether from→to is a legal disbursement-SM transition. Pure.
func canDisb(from, to DisbState) bool {
	return disbTransitions.Can(from, to)
}

// Sentinel errors mapped to stable snake_case codes / HTTP statuses by the handler.
var (
	ErrIllegalTransition    = errors.New("illegal_transition")
	ErrIdempotencyRequired  = errors.New("idempotency_key_required")
	ErrIdempotencyKeyReused = errors.New("idempotency_key_reused")
	ErrNotFound             = errors.New("not_found")
	ErrInvalidAmount        = errors.New("invalid_amount")
	ErrSchoolInactive       = errors.New("school_inactive")
	ErrFeeScheduleInactive  = errors.New("fee_schedule_inactive")
	ErrSchoolAccountMissing = errors.New("school_account_missing")
	ErrInsufficientPot      = errors.New("insufficient_pot_balance")
	ErrPotClosed            = errors.New("pot_closed")
	ErrInvalidSource        = errors.New("invalid_source")
	ErrScholarshipInactive  = errors.New("scholarship_inactive")
	ErrScholarshipExhausted = errors.New("scholarship_budget_exhausted")
)
