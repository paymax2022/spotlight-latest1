package reconciliation

import "time"

// RecordStatus is the lifecycle of a reconciliation record (a match attempt
// between a Paymax premium/commission row and a provider statement line).
type RecordStatus string

const (
	// StatusMatched — premium amount + provider line agree; nothing to do.
	StatusMatched RecordStatus = "MATCHED"
	// StatusBreak — a discrepancy (amount mismatch / missing on one side).
	StatusBreak RecordStatus = "BREAK"
	// StatusResolved — an operator resolved a break (manual disposition recorded).
	StatusResolved RecordStatus = "RESOLVED"
)

// CommissionStatus is the lifecycle of a commission entry. Commission lives on
// the SEPARATE commission ledger account IB0 used (ledger.AccountCommission); a
// reversal posts a balanced correction, never an UPDATE.
type CommissionStatus string

const (
	CommissionPending   CommissionStatus = "PENDING"   // posted at bind, awaiting statement confirm
	CommissionConfirmed CommissionStatus = "CONFIRMED" // reconciled against provider statement
	CommissionReversed  CommissionStatus = "REVERSED"  // reversing entry posted (cancel/clawback)
)

// ReconciliationRecord is one premium↔statement match attempt. A BREAK is a
// discrepancy an operator works in the admin workbench.
type ReconciliationRecord struct {
	ID                  string       `json:"id"`
	Provider            string       `json:"provider"`
	PolicyID            *string      `json:"policy_id,omitempty"`
	PremiumTxID         *string      `json:"premium_tx_id,omitempty"`
	StatementRef        string       `json:"statement_ref"`
	ExpectedAmountKobo  int64        `json:"expected_amount_kobo"`
	StatementAmountKobo int64        `json:"statement_amount_kobo"`
	Status              RecordStatus `json:"status"`
	BreakReason         string       `json:"break_reason,omitempty"`
	ResolutionNote      string       `json:"resolution_note,omitempty"`
	CreatedAt           time.Time    `json:"created_at"`
	ResolvedAt          *time.Time   `json:"resolved_at,omitempty"`
}

// CommissionEntry is the insurance-domain record of a commission posting on the
// SEPARATE commission ledger account. It references the ledger entry by ref and
// carries the idempotency key (UNIQUE) so confirm/reverse are replay-safe.
type CommissionEntry struct {
	ID             string           `json:"id"`
	PolicyID       string           `json:"policy_id"`
	Provider       string           `json:"provider"`
	AmountKobo     int64            `json:"amount_kobo"`
	LedgerRef      string           `json:"ledger_ref"`
	IdempotencyKey string           `json:"idempotency_key"`
	Status         CommissionStatus `json:"status"`
	CreatedAt      time.Time        `json:"created_at"`
	UpdatedAt      time.Time        `json:"updated_at"`
}

// StatementLine is one line of a provider statement uploaded for reconciliation.
type StatementLine struct {
	PolicyID     string `json:"policy_id"`
	StatementRef string `json:"statement_ref"`
	AmountKobo   int64  `json:"amount_kobo"`
}
