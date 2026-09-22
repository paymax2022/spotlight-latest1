package tuition

// ── Installment Payment state machine ────────────────────────────────────
//
// States: pending → paid | overdue (→ waived)
//
//   - pending : installment created, not yet paid.
//   - paid    : payment received and confirmed (terminal).
//   - overdue : past due date and still unpaid (non-terminal; can transition to paid/waived).
//   - waived  : admin forgave the payment (terminal; e.g., scholarship).
//
// Legal transitions:
//   - pending → paid    (payment received)
//   - pending → overdue (time-based, detected at check time, not a direct transition)
//   - overdue → paid    (late payment received)
//   - overdue → waived  (admin forgiveness)
//   - paid / waived     (terminal; no further transitions)
//
// Only the transitions below are legal. Illegal transitions are rejected
// with ErrIllegalTransition. canPay is PURE so it is unit-testable with
// no DB (tuition_test.go).

// paymentTransitions is the legal adjacency set for the payment SM.
var paymentTransitions = map[string]map[string]bool{
	PaymentStatusPending: {
		PaymentStatusPaid:   true,
		PaymentStatusWaived: true,
	},
	PaymentStatusOverdue: {
		PaymentStatusPaid:   true,
		PaymentStatusWaived: true,
	},
	PaymentStatusPaid:   {}, // terminal
	PaymentStatusWaived: {}, // terminal
}

// CanPayInstallment reports whether the current payment status allows
// a payment attempt. Pure.
func CanPayInstallment(currentStatus string) bool {
	return currentStatus == PaymentStatusPending || currentStatus == PaymentStatusOverdue
}

// CanWaiveInstallment reports whether the current payment status allows
// admin waiver. Pure.
func CanWaiveInstallment(currentStatus string) bool {
	return currentStatus == PaymentStatusPending || currentStatus == PaymentStatusOverdue
}

// NextStatusAfterPayment returns the status after a successful payment.
// Called after validating CanPayInstallment(currentStatus).
// Pure.
func NextStatusAfterPayment(currentStatus string) string {
	if currentStatus == PaymentStatusPending || currentStatus == PaymentStatusOverdue {
		return PaymentStatusPaid
	}
	// Should never reach here if CanPayInstallment was checked first.
	return currentStatus
}

// NextStatusAfterWaiver returns the status after admin waiver.
// Called after validating CanWaiveInstallment(currentStatus).
// Pure.
func NextStatusAfterWaiver(currentStatus string) string {
	if currentStatus == PaymentStatusPending || currentStatus == PaymentStatusOverdue {
		return PaymentStatusWaived
	}
	// Should never reach here if CanWaiveInstallment was checked first.
	return currentStatus
}

// CanTransition reports whether from→to is a legal payment-SM transition.
// Pure. Used by repository/service to guard updates.
func CanTransition(from, to string) bool {
	targets, ok := paymentTransitions[from]
	if !ok {
		return false
	}
	return targets[to]
}

// ── Plan status transitions ──────────────────────────────────────────────

// InstallmentPlan transitions: active → completed | cancelled
// A plan is marked completed when all installments are paid or waived.
// Cancellation is admin-only and immediate.

// CanCancelPlan returns true if the plan can be cancelled (only active plans).
func CanCancelPlan(status string) bool {
	return status == PlanStatusActive
}

// CanCompletePlan returns true if all payments are terminal and the plan is
// still active (called by service after final payment or waiver).
func CanCompletePlan(status string) bool {
	return status == PlanStatusActive
}
