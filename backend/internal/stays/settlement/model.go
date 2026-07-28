package settlement

import (
	"errors"
	"time"
)

// Sentinel errors.
var (
	// ErrPayoutHeld is returned when a payout cannot be released yet because the
	// hotelier has no confirmed+completed stay (fraud control, PRD §12).
	ErrPayoutHeld = errors.New("settlement: payout held until first confirmed+completed stay")
	// ErrNotFound is a generic not-found.
	ErrNotFound = errors.New("settlement: not found")
	// ErrBadAmount guards non-positive money.
	ErrBadAmount = errors.New("settlement: amount must be positive")
)

// Payout is a Naira hotel payout to a hotelier (direct rail).
type Payout struct {
	ID             string     `json:"id"`
	PropertyID     string     `json:"property_id"`
	HotelierUserID string     `json:"hotelier_user_id"`
	ReservationID  string     `json:"reservation_id"`
	AmountKobo     int64      `json:"amount_kobo"`
	Currency       string     `json:"currency"`
	Status         string     `json:"status"` // HELD | PENDING | PAID | FAILED | CANCELLED
	HoldReason     string     `json:"hold_reason"`
	LedgerRef      string     `json:"ledger_ref"`
	SettlementID   string     `json:"settlement_id"`
	IdempotencyKey string     `json:"idempotency_key"`
	PaidAt         *time.Time `json:"paid_at"`
	CreatedAt      time.Time  `json:"created_at"`
}

// CommissionEntry records Paymax commission posted to the SEPARATE AccountCommission
// ledger account. AmountKobo is positive on accrual, negative on a refund reversal.
type CommissionEntry struct {
	ID             string    `json:"id"`
	ReservationID  string    `json:"reservation_id"`
	PropertyID     string    `json:"property_id"`
	AmountKobo     int64     `json:"amount_kobo"`
	Currency       string    `json:"currency"`
	Kind           string    `json:"kind"` // ACCRUAL | REVERSAL
	LedgerRef      string    `json:"ledger_ref"`
	IdempotencyKey string    `json:"idempotency_key"`
	CreatedAt      time.Time `json:"created_at"`
}

// Remittance is a Rail-A supplier remittance line reconciled against the expected
// net-rate owed. A mismatch beyond tolerance records a BREAK fed to the admin
// workbench.
type Remittance struct {
	ID             string    `json:"id"`
	SupplierCode   string    `json:"supplier_code"`
	ReservationID  string    `json:"reservation_id"`
	SupplierRef    string    `json:"supplier_ref"`
	ExpectedKobo   int64     `json:"expected_kobo"`
	RemittedKobo   int64     `json:"remitted_kobo"`
	Currency       string    `json:"currency"`
	Status         string    `json:"status"` // UNMATCHED | MATCHED | BREAK | RESOLVED
	BreakReason    string    `json:"break_reason"`
	ExternalRef    string    `json:"external_ref"`
	IdempotencyKey string    `json:"idempotency_key"`
	CreatedAt      time.Time `json:"created_at"`
}
