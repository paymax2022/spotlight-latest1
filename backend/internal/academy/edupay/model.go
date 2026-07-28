package edupay

import (
	"encoding/json"
	"time"
)

// Money is always integer MINOR UNITS + a currency code (conventions.md). Never floats.
// EduPay handles school fees, savings pots and disbursements. Local entitlement-style
// state (disbursement SM, award state) lives here; the actual value movement is the
// concern of the INJECTED rails (collect / disburse / bnpl) — no vendor leak.

// ── School / fee catalog ────────────────────────────────────────────────────────

// School mirrors academy_schools.
type School struct {
	ID                string    `json:"id"`
	Name              string    `json:"name"`
	Code              *string   `json:"code,omitempty"`
	VirtualAccountRef *string   `json:"virtualAccountRef,omitempty"` // finance/va account for disbursement
	Contact           *string   `json:"contact,omitempty"`
	Status            string    `json:"status"`
	CreatedAt         time.Time `json:"createdAt"`
}

// FeeSchedule mirrors academy_fee_schedules.
type FeeSchedule struct {
	ID          string     `json:"id"`
	SchoolID    string     `json:"schoolId"`
	ClassCode   *string    `json:"classCode,omitempty"`
	Term        *string    `json:"term,omitempty"`
	Name        string     `json:"name"`
	AmountMinor int64      `json:"amountMinor"`
	Currency    string     `json:"currency"`
	DueDate     *time.Time `json:"dueDate,omitempty"`
	Status      string     `json:"status"`
	CreatedAt   time.Time  `json:"createdAt"`
}

// EduPayAccount mirrors academy_edupay_accounts: a payer/parent linked to a school
// for a named student.
type EduPayAccount struct {
	ID           string    `json:"id"`
	UserID       string    `json:"userId"`
	SchoolID     string    `json:"schoolId"`
	StudentName  string    `json:"studentName"`
	StudentClass *string   `json:"studentClass,omitempty"`
	Status       string    `json:"status"`
	CreatedAt    time.Time `json:"createdAt"`
}

// ── Savings pots (append-only contributions; saved_minor is DERIVED) ────────────

// SavingsPot mirrors academy_savings_pots. SavedMinor is a PROJECTION of the sum of
// pot contributions — never mutated directly as a shadow balance (golden rule:
// append-only ledger / no shadow balances).
type SavingsPot struct {
	ID            string    `json:"id"`
	UserID        string    `json:"userId"`
	GoalName      string    `json:"goalName"`
	TargetMinor   int64     `json:"targetMinor"`
	SavedMinor    int64     `json:"savedMinor"` // derived = SUM(contributions)
	FeeScheduleID *string   `json:"feeScheduleId,omitempty"`
	Status        string    `json:"status"`
	CreatedAt     time.Time `json:"createdAt"`
}

// PotContribution mirrors academy_pot_contributions. Rows are APPEND-ONLY (no UPDATE /
// DELETE in app code); idempotency_key is globally UNIQUE so a replayed fund is a no-op.
type PotContribution struct {
	ID             string    `json:"id"`
	PotID          string    `json:"potId"`
	UserID         string    `json:"userId"`
	AmountMinor    int64     `json:"amountMinor"`
	WalletRef      *string   `json:"walletRef,omitempty"`
	IdempotencyKey string    `json:"-"`
	CreatedAt      time.Time `json:"createdAt"`
}

// ── Disbursement (guarded SM; money via rails) ──────────────────────────────────

// Disbursement mirrors academy_disbursements. Funds flow: collect from the payer
// (CollectRail / pot / scholarship) then disburse to the school (DisburseRail). The
// local SM is guarded fee_due→funding→collected→disbursed→reconciled.
type Disbursement struct {
	ID             string     `json:"id"`
	FeeScheduleID  *string    `json:"feeScheduleId,omitempty"`
	SchoolID       string     `json:"schoolId"`
	PayerUserID    string     `json:"payerUserId"`
	StudentRef     *string    `json:"studentRef,omitempty"`
	AmountMinor    int64      `json:"amountMinor"`
	Currency       string     `json:"currency"`
	State          DisbState  `json:"state"`
	Source         string     `json:"source"` // pay | bnpl | pot | scholarship
	PaymentRef     *string    `json:"paymentRef,omitempty"`
	PayoutRef      *string    `json:"payoutRef,omitempty"`
	IdempotencyKey *string    `json:"-"`
	CreatedAt      time.Time  `json:"createdAt"`
	ReconciledAt   *time.Time `json:"reconciledAt,omitempty"`
}

// ── Scholarships (sponsor-funded; same disbursement SM) ─────────────────────────

// Scholarship mirrors academy_scholarships. AwardedMinor is the running total drawn
// against BudgetMinor.
type Scholarship struct {
	ID           string          `json:"id"`
	SponsorID    *string         `json:"sponsorId,omitempty"`
	Name         string          `json:"name"`
	Criteria     json.RawMessage `json:"criteria"`
	BudgetMinor  int64           `json:"budgetMinor"`
	AwardedMinor int64           `json:"awardedMinor"`
	Status       string          `json:"status"`
	CreatedAt    time.Time       `json:"createdAt"`
}

// ScholarshipAward mirrors academy_scholarship_awards. The award grant is idempotent
// (idempotency_key UNIQUE) and, once disbursed, runs the same disbursement SM.
type ScholarshipAward struct {
	ID             string    `json:"id"`
	ScholarshipID  string    `json:"scholarshipId"`
	UserID         string    `json:"userId"`
	FeeScheduleID  *string   `json:"feeScheduleId,omitempty"`
	AmountMinor    int64     `json:"amountMinor"`
	State          string    `json:"state"` // granted | disbursed | revoked
	IdempotencyKey *string   `json:"-"`
	CreatedAt      time.Time `json:"createdAt"`
}

// ── Aggregate view ──────────────────────────────────────────────────────────────

// MyEduPay is the member dashboard: linked schools, fee schedules due, pots and the
// disbursement history for the payer.
type MyEduPay struct {
	Accounts      []EduPayAccount `json:"accounts"`
	FeesDue       []FeeSchedule   `json:"feesDue"`
	Pots          []SavingsPot    `json:"pots"`
	Disbursements []Disbursement  `json:"disbursements"`
}

// ── Request DTOs ────────────────────────────────────────────────────────────────

// LinkSchoolRequest links the payer to a school for a named student.
type LinkSchoolRequest struct {
	SchoolID     string `json:"schoolId" binding:"required"`
	StudentName  string `json:"studentName" binding:"required"`
	StudentClass string `json:"studentClass"`
}

// PayFeesRequest pays a fee schedule via collect (wallet/VA) or BNPL.
type PayFeesRequest struct {
	FeeScheduleID string `json:"feeScheduleId" binding:"required"`
	StudentRef    string `json:"studentRef"`
	Source        string `json:"source"` // pay (default) | bnpl
}

// CreatePotRequest opens a savings pot toward a goal (optionally a fee schedule).
type CreatePotRequest struct {
	GoalName      string `json:"goalName" binding:"required"`
	TargetMinor   int64  `json:"targetMinor"`
	FeeScheduleID string `json:"feeScheduleId"`
}

// FundPotRequest funds a pot (collected from the payer) — appends a contribution.
type FundPotRequest struct {
	AmountMinor int64 `json:"amountMinor" binding:"required"`
}

// PayFromPotRequest disburses a fee from an already-funded pot.
type PayFromPotRequest struct {
	FeeScheduleID string `json:"feeScheduleId" binding:"required"`
	StudentRef    string `json:"studentRef"`
}

// CreateSchoolRequest (admin) registers a school.
type CreateSchoolRequest struct {
	Name              string `json:"name" binding:"required"`
	Code              string `json:"code"`
	VirtualAccountRef string `json:"virtualAccountRef"`
	Contact           string `json:"contact"`
}

// CreateFeeScheduleRequest (admin) publishes a fee schedule for a school.
type CreateFeeScheduleRequest struct {
	SchoolID    string `json:"schoolId" binding:"required"`
	Name        string `json:"name" binding:"required"`
	ClassCode   string `json:"classCode"`
	Term        string `json:"term"`
	AmountMinor int64  `json:"amountMinor" binding:"required"`
	Currency    string `json:"currency"`
	DueDate     string `json:"dueDate"` // YYYY-MM-DD
}

// CreateScholarshipRequest (admin academy.edupay / sponsor) funds a scholarship.
type CreateScholarshipRequest struct {
	SponsorID   string          `json:"sponsorId"`
	Name        string          `json:"name" binding:"required"`
	Criteria    json.RawMessage `json:"criteria"`
	BudgetMinor int64           `json:"budgetMinor"`
}

// AwardScholarshipRequest (admin) awards a scholarship to a user for a fee schedule.
type AwardScholarshipRequest struct {
	ScholarshipID string `json:"scholarshipId" binding:"required"`
	UserID        string `json:"userId" binding:"required"`
	FeeScheduleID string `json:"feeScheduleId"`
	AmountMinor   int64  `json:"amountMinor" binding:"required"`
}

// ── helpers ─────────────────────────────────────────────────────────────────────

func rawOrEmptyObject(b []byte) json.RawMessage {
	if len(b) == 0 {
		return json.RawMessage("{}")
	}
	return json.RawMessage(b)
}
