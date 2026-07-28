package schools

import (
	"encoding/json"
	"time"
)

// Spotlight Academy — Phase 4 B2B2C institutions (schools).
//
// Money is always integer MINOR UNITS (conventions.md). Never floats. The actual
// value movement for institution billing is delegated to the INJECTED BillingRail
// (a finance/va account charge) — no vendor type ever leaks into this package
// (paymax-rails.md §Virtual accounts). Every guarded transition is audited to
// public.audit_logs (module 'academy.schools').
//
// Tables map EXACTLY to 20260815001300_academy_schools_tutor.sql:
//   academy_institutions, academy_licences, academy_class_groups,
//   academy_enrollments, academy_institution_billing.

// ── Licence lifecycle state ─────────────────────────────────────────────────────

// LicenceState is the licence lifecycle state (matches academy_licences.state CHECK
// constraint exactly: active | suspended | expired).
type LicenceState string

const (
	LicenceActive    LicenceState = "active"
	LicenceSuspended LicenceState = "suspended"
	LicenceExpired   LicenceState = "expired"
)

// Enrollment + billing states (match the migration CHECK constraints exactly).
const (
	EnrollInvited = "invited"
	EnrollActive  = "active"
	EnrollRemoved = "removed"

	BillingOpen     = "open"
	BillingInvoiced = "invoiced"
	BillingPaid     = "paid"
	BillingVoid     = "void"
)

// ── Entities ────────────────────────────────────────────────────────────────────

// Institution mirrors academy_institutions (B2B2C school / institution).
type Institution struct {
	ID                string          `json:"id"`
	Name              string          `json:"name"`
	Type              string          `json:"type"` // school | institution
	AdminUserID       *string         `json:"adminUserId,omitempty"`
	WhiteLabel        json.RawMessage `json:"whiteLabel"` // logo/colors/domain
	VirtualAccountRef *string         `json:"virtualAccountRef,omitempty"`
	Status            string          `json:"status"` // active | suspended | closed
	CreatedAt         time.Time       `json:"createdAt"`
}

// Licence mirrors academy_licences. Seats are the entitlement cap; UsedSeats is the
// authoritative count incremented atomically on enrolment (FOR UPDATE) and decremented
// on removal — never allowed to exceed Seats.
type Licence struct {
	ID            string       `json:"id"`
	InstitutionID string       `json:"institutionId"`
	Tier          string       `json:"tier"`
	Seats         int          `json:"seats"`
	UsedSeats     int          `json:"usedSeats"`
	PriceMinor    int64        `json:"priceMinor"`
	StartsAt      *time.Time   `json:"startsAt,omitempty"`
	ExpiresAt     *time.Time   `json:"expiresAt,omitempty"`
	State         LicenceState `json:"state"`
	CreatedAt     time.Time    `json:"createdAt"`
}

// ClassGroup mirrors academy_class_groups.
type ClassGroup struct {
	ID            string    `json:"id"`
	InstitutionID string    `json:"institutionId"`
	Name          string    `json:"name"`
	ClassCode     *string   `json:"classCode,omitempty"`
	TeacherUserID *string   `json:"teacherUserId,omitempty"`
	CreatedAt     time.Time `json:"createdAt"`
}

// Enrollment mirrors academy_enrollments. Rows are idempotent on
// UNIQUE (institution_id, learner_user_id) and on the globally-unique idempotency_key,
// so a replayed bulk enrolment never double-counts a seat.
type Enrollment struct {
	ID             string    `json:"id"`
	InstitutionID  string    `json:"institutionId"`
	ClassGroupID   *string   `json:"classGroupId,omitempty"`
	LearnerUserID  string    `json:"learnerUserId"`
	State          string    `json:"state"` // invited | active | removed
	IdempotencyKey *string   `json:"-"`
	CreatedAt      time.Time `json:"createdAt"`
}

// Billing mirrors academy_institution_billing. AmountMinor is charged via the INJECTED
// BillingRail (finance/va) once generated; the rail owns value movement, this module
// only flips local billing state open→paid and records the payment ref.
type Billing struct {
	ID            string    `json:"id"`
	InstitutionID string    `json:"institutionId"`
	Period        string    `json:"period"`
	AmountMinor   int64     `json:"amountMinor"`
	State         string    `json:"state"` // open | invoiced | paid | void
	PaymentRef    *string   `json:"paymentRef,omitempty"`
	CreatedAt     time.Time `json:"createdAt"`
}

// ── Aggregate overview ──────────────────────────────────────────────────────────

// LicenceSeats summarises seat usage across a licence.
type LicenceSeats struct {
	LicenceID string       `json:"licenceId"`
	Tier      string       `json:"tier"`
	State     LicenceState `json:"state"`
	Seats     int          `json:"seats"`
	UsedSeats int          `json:"usedSeats"`
}

// Overview is the institution dashboard: licences (with seat usage), class groups and
// enrolment counts by state.
type Overview struct {
	Institution     *Institution   `json:"institution"`
	Licences        []Licence      `json:"licences"`
	Seats           []LicenceSeats `json:"seats"`
	SeatsTotal      int            `json:"seatsTotal"`
	SeatsUsed       int            `json:"seatsUsed"`
	ClassGroups     []ClassGroup   `json:"classGroups"`
	EnrollmentCount map[string]int `json:"enrollmentCount"` // state → count
}

// ── Bulk-enrolment result ───────────────────────────────────────────────────────

// BulkEnrollResult reports the outcome of a seat-capped, idempotent bulk enrolment:
// how many learners were enrolled (newly seated), how many were replays (already
// enrolled — no new seat), and whether the seat cap stopped the run early.
type BulkEnrollResult struct {
	Enrolled       []string `json:"enrolled"`       // newly seated learner ids
	AlreadyEnrolled []string `json:"alreadyEnrolled"` // idempotent replays (no new seat)
	Succeeded      int      `json:"succeeded"`      // count newly seated this call
	SeatLimitHit   bool     `json:"seatLimitHit"`   // true ⇒ cap reached, remaining rejected
	UsedSeats      int      `json:"usedSeats"`
	Seats          int      `json:"seats"`
}

// ── Request DTOs ────────────────────────────────────────────────────────────────

// OnboardInstitutionRequest (admin) registers a B2B2C institution.
type OnboardInstitutionRequest struct {
	Name              string          `json:"name" binding:"required"`
	Type              string          `json:"type"` // school (default) | institution
	AdminUserID       string          `json:"adminUserId"`
	WhiteLabel        json.RawMessage `json:"whiteLabel"`
	VirtualAccountRef string          `json:"virtualAccountRef"`
}

// IssueLicenceRequest (admin) issues a licence for an institution.
type IssueLicenceRequest struct {
	InstitutionID string `json:"institutionId" binding:"required"`
	Tier          string `json:"tier" binding:"required"`
	Seats         int    `json:"seats" binding:"required"`
	PriceMinor    int64  `json:"priceMinor"`
	StartsAt      string `json:"startsAt"`  // YYYY-MM-DD
	ExpiresAt     string `json:"expiresAt"` // YYYY-MM-DD
}

// CreateClassGroupRequest (admin) creates a class group for an institution.
type CreateClassGroupRequest struct {
	InstitutionID string `json:"institutionId" binding:"required"`
	Name          string `json:"name" binding:"required"`
	ClassCode     string `json:"classCode"`
	TeacherUserID string `json:"teacherUserId"`
}

// BulkEnrollRequest (admin) enrols a batch of learners into an institution / class.
type BulkEnrollRequest struct {
	InstitutionID string   `json:"institutionId" binding:"required"`
	ClassGroupID  string   `json:"classGroupId"`
	LearnerIDs    []string `json:"learnerIds" binding:"required"`
}

// GenerateBillingRequest (admin) opens a billing line for a period.
type GenerateBillingRequest struct {
	InstitutionID string `json:"institutionId" binding:"required"`
	Period        string `json:"period" binding:"required"`
	AmountMinor   int64  `json:"amountMinor" binding:"required"`
}

// ── helpers ─────────────────────────────────────────────────────────────────────

func rawOrEmptyObject(b []byte) json.RawMessage {
	if len(b) == 0 {
		return json.RawMessage("{}")
	}
	return json.RawMessage(b)
}
