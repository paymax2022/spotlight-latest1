package feesadminapi

import (
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"time"
)

// DTOs mirror the school-admin console's expected shapes (frontend-admin/src/types/
// academyFees.ts) EXACTLY — snake_case JSON, kobo integers for money. Fields with no
// backing column in the academy_fees tables (e.g. school.owner_email/bank_account/state,
// competition team rosters) are omitted or zero-valued; the console's types mark those
// optional. Every list handler wraps the slice in gin.H{"data": …}.

// School → FeesSchool. owner_email / bank_account / state have no columns and are omitted.
type School struct {
	ID               string    `json:"id"`
	Name             string    `json:"name"`
	State            string    `json:"state"`
	VerificationTier string    `json:"verification_tier"`
	Status           string    `json:"status"`
	CreatedAt        time.Time `json:"created_at"`
}

// Session → FeesSession.
type Session struct {
	ID       string `json:"id"`
	SchoolID string `json:"school_id"`
	Name     string `json:"name"`
	StartsOn string `json:"starts_on"`
	EndsOn   string `json:"ends_on"`
	Status   string `json:"status"`
}

// Class → FeesClass. curriculum_class maps to academy_fee_classes.level.
type Class struct {
	ID              string `json:"id"`
	SchoolID        string `json:"school_id"`
	SessionID       string `json:"session_id"`
	Name            string `json:"name"`
	CurriculumClass string `json:"curriculum_class"`
	Students        int    `json:"students"`
}

// FeeSchedule → FeeSchedule. fee_items / installment_policy are emitted as raw JSON from
// the stored jsonb columns (already kobo-shaped by the writer).
type FeeSchedule struct {
	ID                   string          `json:"id"`
	SchoolID             string          `json:"school_id"`
	SessionID            string          `json:"session_id"`
	ClassID              string          `json:"class_id"`
	Term                 string          `json:"term"`
	Name                 string          `json:"name,omitempty"`
	AmountMinor          int64           `json:"amount_minor"`
	Status               string          `json:"status"` // 'draft' | 'issued' (locked)
	Locked               bool            `json:"-"`
	DueDate              string          `json:"due_date"`
	IssuedAt             *time.Time      `json:"issued_at"`
	FeeItems             json.RawMessage `json:"fee_items"`
	InstallmentPolicy    json.RawMessage `json:"installment_policy"`
	FeeItemsRaw          string          `json:"-"`
	InstallmentPolicyRaw string          `json:"-"`
}

// MarshalJSON hydrates the raw jsonb text columns into the fee_items / installment_policy
// fields at serialization time (avoids a second parse in the repo).
func (f FeeSchedule) MarshalJSON() ([]byte, error) {
	type alias FeeSchedule
	a := alias(f)
	a.FeeItems = json.RawMessage(orDefault(f.FeeItemsRaw, "[]"))
	a.InstallmentPolicy = json.RawMessage(orDefault(f.InstallmentPolicyRaw, "{}"))
	return json.Marshal(a)
}

// FeeScheduleIssueResult → FeeScheduleIssueResult.
type FeeScheduleIssueResult struct {
	ID        string    `json:"id"`
	Status    string    `json:"status"` // always 'issued'
	IssuedAt  time.Time `json:"issued_at"`
	Immutable bool      `json:"immutable"` // always true
}

// CollectionsOverview → CollectionsOverview. All *_kobo are int64 minor units.
type CollectionsOverview struct {
	InvoicesIssued  int   `json:"invoices_issued"`
	InvoicesPaid    int   `json:"invoices_paid"`
	InvoicesPartial int   `json:"invoices_partial"`
	InvoicesOverdue int   `json:"invoices_overdue"`
	BilledKobo      int64 `json:"billed_kobo"`
	CollectedKobo   int64 `json:"collected_kobo"`
	OutstandingKobo int64 `json:"outstanding_kobo"`
}

// InvoiceRow → InvoiceRow. paid_kobo is derived (SF-2), never stored.
type InvoiceRow struct {
	ID            string    `json:"id"`
	StudentName   string    `json:"student_name"`
	ClassName     string    `json:"class_name"`
	GuardianEmail string    `json:"guardian_email"`
	BilledKobo    int64     `json:"billed_kobo"`
	PaidKobo      int64     `json:"paid_kobo"`
	Status        string    `json:"status"`
	DueDate       string    `json:"due_date"`
	IssuedAt      time.Time `json:"issued_at"`
}

// PromotionBatch → PromotionBatch (per-cohort aggregate; SF-3 two-approval state).
type PromotionBatch struct {
	ID                string     `json:"id"`
	SchoolID          string     `json:"school_id"`
	SessionID         string     `json:"session_id"`
	FromClass         string     `json:"from_class"`
	ToClass           string     `json:"to_class"`
	StudentsTotal     int        `json:"students_total"`
	StudentsPromoted  int        `json:"students_promoted"`
	StudentsRetained  int        `json:"students_retained"`
	Status            string     `json:"status"`
	TeacherApprovedBy *string    `json:"teacher_approved_by"`
	TeacherApprovedAt *time.Time `json:"teacher_approved_at"`
	HeadApprovedBy    *string    `json:"head_approved_by"`
	HeadApprovedAt    *time.Time `json:"head_approved_at"`
	ComputedAt        time.Time  `json:"computed_at"`
}

// Competition → Competition.
type Competition struct {
	ID                 string `json:"id"`
	Name               string `json:"name"`
	Subject            string `json:"subject"`
	Scope              string `json:"scope"`
	Status             string `json:"status"`
	StartsOn           string `json:"starts_on"`
	RegistrationCloses string `json:"registration_closes"`
	RegisteredSchools  int    `json:"registered_schools"`
	RegisteredStudents int    `json:"registered_students"`
}

// CompetitionRegistration → CompetitionRegistration. team_name / students have no columns.
type CompetitionRegistration struct {
	ID            string    `json:"id"`
	CompetitionID string    `json:"competition_id"`
	SchoolID      string    `json:"school_id"`
	TeamName      string    `json:"team_name"`
	Students      int       `json:"students"`
	Status        string    `json:"status"`
	RegisteredAt  time.Time `json:"registered_at"`
}

// GovOptIn → GovExportOptIn.
type GovOptIn struct {
	SchoolID  string    `json:"school_id"`
	Category  string    `json:"category"`
	OptedIn   bool      `json:"opted_in"`
	UpdatedAt time.Time `json:"updated_at"`
}

// RoleGrant → SchoolRoleGrant.
type RoleGrant struct {
	ID        string    `json:"id"`
	SchoolID  string    `json:"school_id"`
	UserEmail string    `json:"user_email"`
	Role      string    `json:"role"`
	GrantedBy string    `json:"granted_by"`
	GrantedAt time.Time `json:"granted_at"`
	Status    string    `json:"status"`
}

// ── Request DTOs ────────────────────────────────────────────────────────────────

// CreateFeeScheduleRequest is the console's FeeScheduleInput. fee_items carry kobo amounts.
type CreateFeeScheduleRequest struct {
	SchoolID          string          `json:"school_id" binding:"required"`
	SessionID         string          `json:"session_id"`
	ClassID           string          `json:"class_id"`
	Term              string          `json:"term"`
	DueDate           string          `json:"due_date"`
	FeeItems          json.RawMessage `json:"fee_items"`
	InstallmentPolicy json.RawMessage `json:"installment_policy"`
}

// CreateFeeScheduleParams is the repo-facing insert shape.
type CreateFeeScheduleParams struct {
	SchoolID              string
	SessionID             string
	ClassID               string
	Term                  string
	Name                  string
	AmountMinor           int64
	DueDate               string
	FeeItemsJSON          string
	InstallmentPolicyJSON string
}

// SetGovOptInRequest is the console's GovExportOptInInput.
type SetGovOptInRequest struct {
	SchoolID string `json:"school_id" binding:"required"`
	Category string `json:"category" binding:"required"`
	OptedIn  bool   `json:"opted_in"`
}

// ── Admin create requests (flat setup-wizard surface, SC-29) ──────────────────────
// These POSTs create rows in the EXISTING fees tables by REUSING the domain services
// (feesschool / feessession) — which own the guarded state machines + audit — so no
// parallel insert logic and no schema is added here.

// CreateSchoolAdminRequest onboards a school from the flat admin console. The owner is the
// authenticated admin (never trusted from the body); the school starts 'unverified'.
type CreateSchoolAdminRequest struct {
	Name              string `json:"name" binding:"required"`
	Code              string `json:"code"`
	Level             string `json:"level"`
	VirtualAccountRef string `json:"virtual_account_ref"`
	Contact           string `json:"contact"`
}

// CreateSessionAdminRequest opens an academic session for a school (school_id in body).
type CreateSessionAdminRequest struct {
	SchoolID      string          `json:"school_id" binding:"required"`
	Name          string          `json:"name" binding:"required"`
	TermStructure json.RawMessage `json:"term_structure"`
	StartDate     string          `json:"start_date"` // YYYY-MM-DD
	EndDate       string          `json:"end_date"`   // YYYY-MM-DD
}

// CreateClassAdminRequest opens a class within a school (optionally bound to a session).
type CreateClassAdminRequest struct {
	SchoolID           string `json:"school_id" binding:"required"`
	SessionID          string `json:"session_id"`
	Name               string `json:"name" binding:"required"`
	Level              string `json:"level"`
	ClassTeacherUserID string `json:"class_teacher_user_id"`
}

// feeItem is used only to sum a create request's kobo total into amount_minor.
type feeItem struct {
	AmountKobo int64 `json:"amount_kobo"`
}

func sumFeeItems(raw json.RawMessage) int64 {
	if len(raw) == 0 {
		return 0
	}
	var items []feeItem
	if err := json.Unmarshal(raw, &items); err != nil {
		return 0
	}
	var total int64
	for _, it := range items {
		total += it.AmountKobo
	}
	return total
}

func orDefault(s, def string) string {
	if s == "" {
		return def
	}
	return s
}

func shortHash(s string) string {
	sum := sha1.Sum([]byte(s))
	return hex.EncodeToString(sum[:6])
}
