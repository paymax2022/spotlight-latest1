// Package tuition is the DOMAIN layer for Film Academy tuition payment paths
// (batch discounts, installment plans, tiered pricing).
//
// Phase 0 (this file, statemachine.go, calculations.go) is EXPLICITLY
// scope-limited to pure types and pure functions: zero I/O, nothing wired
// into the running app. Phase 1 adds repository.go, service.go, and
// handler.go on top of this package.
//
// All monetary amounts are integers in whole NAIRA (not kobo) — never floats,
// never strings for math.
package tuition

import (
	"errors"
	"time"
)

// ── Batch (fee catalog) ──────────────────────────────────────────────────

// Batch mirrors academy_tuition_batches: a cohort's fixed fee, frequency
// option, and discount tier.
type Batch struct {
	ID                  string    `json:"id"`
	FeeNGN              int64     `json:"feeNGN"`           // whole naira only
	InstallmentsCount   int32     `json:"installmentsCount"` // e.g., 4, 6, 12
	FeeFrequency        string    `json:"feeFrequency"`     // "weekly" | "biweekly" | "monthly"
	DiscountPct         int32     `json:"discountPct"`      // 0–100; applied to lump-sum
	Status              string    `json:"status"`           // "active" | "inactive"
	CreatedAt           time.Time `json:"createdAt"`
}

// ── Application (payer enrollment) ──────────────────────────────────────

// Application mirrors academy_tuition_applications: a user's payment pledge
// for a given batch.
type Application struct {
	ID                 string    `json:"id"`
	UserID             string    `json:"userId"`
	BatchID            string    `json:"batchId"`
	TuitionTotalNGN    int64     `json:"tuitionTotalNGN"`    // copy of batch fee
	ApplicationFeePaid bool      `json:"applicationFeePaid"` // enrollment gate
	PaymentPreference  string    `json:"paymentPreference"`  // "one_off" | "installment"
	PaymentStatus      string    `json:"paymentStatus"`      // "pending" | "in_progress" | "completed" | "failed"
	CreatedAt          time.Time `json:"createdAt"`
}

// ── Installment Plan (guarded lifecycle) ─────────────────────────────────

// InstallmentPlan mirrors academy_tuition_installment_plans: a time-sliced
// payment contract (e.g., 4 equal payments biweekly). Amounts are derived
// from calculations (CalculateInstallmentAmount); immutable once created.
type InstallmentPlan struct {
	ID                  string    `json:"id"`
	ApplicationID       string    `json:"applicationId"`
	UserID              string    `json:"userId"`
	TotalAmountNGN      int64     `json:"totalAmountNGN"`      // full tuition
	DiscountedAmountNGN int64     `json:"discountedAmountNGN"` // after discount, if any
	InstallmentsCount   int32     `json:"installmentsCount"`   // 4, 6, 12, etc.
	Frequency           string    `json:"frequency"`           // "weekly" | "biweekly" | "monthly"
	Status              string    `json:"status"`              // "active" | "completed" | "cancelled"
	CreatedAt           time.Time `json:"createdAt"`
	CompletedAt         *time.Time `json:"completedAt,omitempty"`
}

// ── Installment Payment (guarded SM) ─────────────────────────────────────

// InstallmentPayment mirrors academy_tuition_installment_payments: a single
// time-slot within a plan. Status transitions are guarded by CanPayInstallment
// and NextStatusAfterPayment.
type InstallmentPayment struct {
	ID                 string     `json:"id"`
	InstallmentPlanID  string     `json:"installmentPlanId"`
	UserID             string     `json:"userId"`
	AmountNGN          int64      `json:"amountNGN"`        // installment slice
	DueDate            time.Time  `json:"dueDate"`
	Status             string     `json:"status"`           // "pending" | "paid" | "overdue" | "waived"
	PaymentReference   *string    `json:"paymentReference,omitempty"` // ledger txn ref
	PaidAt             *time.Time `json:"paidAt,omitempty"`
	CreatedAt          time.Time  `json:"createdAt"`
}

// ── Status constants ─────────────────────────────────────────────────────

// Batch status constants.
const (
	BatchStatusActive   = "active"
	BatchStatusInactive = "inactive"
)

// Application payment status constants.
const (
	AppPaymentStatusPending    = "pending"
	AppPaymentStatusInProgress = "in_progress"
	AppPaymentStatusCompleted  = "completed"
	AppPaymentStatusFailed     = "failed"
)

// InstallmentPlan status constants.
const (
	PlanStatusActive    = "active"
	PlanStatusCompleted = "completed"
	PlanStatusCancelled = "cancelled"
)

// InstallmentPayment status constants (state machine guarded in statemachine.go).
const (
	PaymentStatusPending = "pending"
	PaymentStatusPaid    = "paid"
	PaymentStatusOverdue = "overdue"
	PaymentStatusWaived  = "waived"
)

// ── Frequency validation ──────────────────────────────────────────────────

// ValidFrequencies is the set of allowed frequency strings.
// "upfront" is NOT included here even though academy_batches.fee_frequency allows
// it as a batch-level descriptor: academy_installment_plans.frequency is
// CONSTRAINED to weekly|biweekly|monthly (see the CHECK constraint) — an "upfront"
// batch cadence or a one_off plan must be NORMALIZED to one of these (see
// NormalizePlanFrequency) before it's ever persisted as a plan's frequency.
var ValidFrequencies = map[string]bool{
	"weekly":   true,
	"biweekly": true,
	"monthly":  true,
}

// NormalizePlanFrequency maps a batch's fee_frequency (which may be "upfront", or
// any value at all if the batch config is stale) plus the chosen plan type onto a
// frequency that academy_installment_plans.frequency's CHECK constraint accepts,
// plus the correct installment count for that choice. A one-off plan is always a
// single payment; the stored cadence is immaterial for it, so it defaults to
// "monthly" rather than failing the insert.
func NormalizePlanFrequency(planType, batchFrequency string, batchInstallmentsCount int32) (frequency string, count int32) {
	payUpfront := planType == "one_off" || !IsValidFrequency(batchFrequency)
	if payUpfront {
		return "monthly", 1
	}
	if batchInstallmentsCount < 1 {
		batchInstallmentsCount = 1
	}
	if batchInstallmentsCount > 12 {
		batchInstallmentsCount = 12
	}
	return batchFrequency, batchInstallmentsCount
}

// ── Sentinel errors ──────────────────────────────────────────────────────

var (
	ErrInvalidStatus     = errors.New("invalid_status")
	ErrZeroTuition       = errors.New("zero_tuition")
	ErrInvalidFrequency  = errors.New("invalid_frequency")
	ErrIllegalTransition = errors.New("illegal_transition")
	ErrNegativeDiscount  = errors.New("negative_discount")
	ErrDiscountTooHigh   = errors.New("discount_too_high")
	ErrInvalidAmount     = errors.New("invalid_amount")
)

// ── Validation helpers ───────────────────────────────────────────────────

// IsValidFrequency returns true if freq is one of the allowed constants.
func IsValidFrequency(freq string) bool {
	return ValidFrequencies[freq]
}

// IsTerminalStatus returns true if the payment can no longer transition.
func IsTerminalStatus(status string) bool {
	return status == PaymentStatusPaid || status == PaymentStatusWaived
}
