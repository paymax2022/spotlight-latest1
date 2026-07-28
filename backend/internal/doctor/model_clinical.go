package doctor

import (
	"encoding/json"
	"time"
)

// model_clinical.go — Wave 3a (human-side CLINICAL) request & response shapes.
//
// As with model_account.go, the OpenAPI (contracts/doctor.openapi.yaml) types these
// endpoints as the free-form `Generic` schema, so request bodies are captured as
// json.RawMessage and merged/stored into the doctor_* JSONB columns, while responses
// mirror the underlying tables (camelCase JSON to match the mobile contracts in
// mobile-app/reactnative/src/types/doctor.phase2.ts / .batch3.ts / .batch4.ts).
//
// None of these are money movements — they are clinical state transitions / document
// writes. Monetary columns surface as int64 kobo only (no floats, no stored balances).

// ── Pharmacy ─────────────────────────────────────────────────────────────────

// PharmacyFulfilment mirrors public.doctor_pharmacy_fulfilments.
type PharmacyFulfilment struct {
	ID             string          `json:"id"`
	UserID         string          `json:"userId"`
	PrescriptionID *string         `json:"prescriptionId,omitempty"`
	PharmacyID     *string         `json:"pharmacyId,omitempty"`
	Pharmacy       json.RawMessage `json:"pharmacy,omitempty"`
	Status         string          `json:"status"`
	TotalKobo      int64           `json:"totalKobo"`
	Detail         json.RawMessage `json:"detail,omitempty"`
	CreatedAt      time.Time       `json:"createdAt"`
	UpdatedAt      time.Time       `json:"updatedAt"`
}

// PharmacySubstitute mirrors public.doctor_pharmacy_substitutes.
type PharmacySubstitute struct {
	ID             string          `json:"id"`
	FulfilmentID   string          `json:"fulfilmentId"`
	UserID         string          `json:"userId"`
	OriginalDrug   *string         `json:"originalDrug,omitempty"`
	SubstituteDrug *string         `json:"substituteDrug,omitempty"`
	Status         string          `json:"status"` // proposed|approved|rejected
	PriceKobo      int64           `json:"priceKobo"`
	ReviewedAt     *time.Time      `json:"reviewedAt,omitempty"`
	Detail         json.RawMessage `json:"detail,omitempty"`
	CreatedAt      time.Time       `json:"createdAt"`
}

// DrugDelivery mirrors public.doctor_drug_deliveries.
type DrugDelivery struct {
	ID           string          `json:"id"`
	FulfilmentID *string         `json:"fulfilmentId,omitempty"`
	UserID       string          `json:"userId"`
	Status       string          `json:"status"`
	Courier      *string         `json:"courier,omitempty"`
	TrackingRef  *string         `json:"trackingRef,omitempty"`
	ETA          *time.Time      `json:"eta,omitempty"`
	DeliveredAt  *time.Time      `json:"deliveredAt,omitempty"`
	Detail       json.RawMessage `json:"detail,omitempty"`
	CreatedAt    time.Time       `json:"createdAt"`
	UpdatedAt    time.Time       `json:"updatedAt"`
}

// RefillRequest mirrors public.doctor_refill_requests.
type RefillRequest struct {
	ID             string          `json:"id"`
	UserID         string          `json:"userId"`
	PrescriptionID *string         `json:"prescriptionId,omitempty"`
	Patient        json.RawMessage `json:"patient,omitempty"`
	Status         string          `json:"status"` // pending|approved|rejected|consultation_required
	ReviewedAt     *time.Time      `json:"reviewedAt,omitempty"`
	Detail         json.RawMessage `json:"detail,omitempty"`
	CreatedAt      time.Time       `json:"createdAt"`
	UpdatedAt      time.Time       `json:"updatedAt"`
}

// PharmacyMessage mirrors public.doctor_pharmacy_messages.
type PharmacyMessage struct {
	ID           string    `json:"id"`
	FulfilmentID string    `json:"fulfilmentId"`
	UserID       string    `json:"userId"`
	Author       string    `json:"author"`
	Body         *string   `json:"body,omitempty"`
	CreatedAt    time.Time `json:"createdAt"`
}

// ── Labs (extended beyond MVP) ───────────────────────────────────────────────

// LabResultInbox mirrors public.doctor_lab_results for the inbox list projection.
type LabResultInbox struct {
	ID         string          `json:"id"`
	UserID     string          `json:"userId"`
	OrderID    *string         `json:"orderId,omitempty"`
	Ref        *string         `json:"ref,omitempty"`
	Patient    json.RawMessage `json:"patient,omitempty"`
	LabName    *string         `json:"labName,omitempty"`
	ReportedAt *time.Time      `json:"reportedAt,omitempty"`
	Reviewed   bool            `json:"reviewed"`
	ReviewedAt *time.Time      `json:"reviewedAt,omitempty"`
	CreatedAt  time.Time       `json:"createdAt"`
	UpdatedAt  time.Time       `json:"updatedAt"`
}

// LabInterpretation mirrors public.doctor_lab_interpretations.
type LabInterpretation struct {
	ID             string          `json:"id"`
	ResultID       string          `json:"resultId"`
	UserID         string          `json:"userId"`
	Interpretation *string         `json:"interpretation,omitempty"`
	Detail         json.RawMessage `json:"detail,omitempty"`
	CreatedAt      time.Time       `json:"createdAt"`
	UpdatedAt      time.Time       `json:"updatedAt"`
}

// ── Referrals & collaboration ────────────────────────────────────────────────

// Referral mirrors public.doctor_referrals (outgoing — direction='outgoing').
type Referral struct {
	ID           string          `json:"id"`
	UserID       string          `json:"userId"`
	SpecialistID *string         `json:"specialistId,omitempty"`
	PatientID    *string         `json:"patientId,omitempty"`
	Direction    string          `json:"direction"`
	Status       string          `json:"status"`
	Reason       *string         `json:"reason,omitempty"`
	Detail       json.RawMessage `json:"detail,omitempty"`
	CreatedAt    time.Time       `json:"createdAt"`
	UpdatedAt    time.Time       `json:"updatedAt"`
}

// IncomingReferral mirrors public.doctor_incoming_referrals.
type IncomingReferral struct {
	ID              string          `json:"id"`
	UserID          string          `json:"userId"`
	ReferringDoctor *string         `json:"referringDoctor,omitempty"`
	PatientID       *string         `json:"patientId,omitempty"`
	Status          string          `json:"status"`
	Reason          *string         `json:"reason,omitempty"`
	Detail          json.RawMessage `json:"detail,omitempty"`
	CreatedAt       time.Time       `json:"createdAt"`
	UpdatedAt       time.Time       `json:"updatedAt"`
}

// OpinionRequest mirrors public.doctor_opinion_requests.
type OpinionRequest struct {
	ID        string          `json:"id"`
	UserID    string          `json:"userId"`
	PatientID *string         `json:"patientId,omitempty"`
	Status    string          `json:"status"`
	Question  *string         `json:"question,omitempty"`
	Detail    json.RawMessage `json:"detail,omitempty"`
	CreatedAt time.Time       `json:"createdAt"`
	UpdatedAt time.Time       `json:"updatedAt"`
}

// CareTeamMessage mirrors public.doctor_care_team_messages.
type CareTeamMessage struct {
	ID        string    `json:"id"`
	UserID    string    `json:"userId"`
	ThreadID  string    `json:"threadId"`
	Author    string    `json:"author"`
	Body      *string   `json:"body,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

// ── Follow-up care ───────────────────────────────────────────────────────────

// FollowUpPlan mirrors public.doctor_follow_up_plans.
type FollowUpPlan struct {
	ID            string          `json:"id"`
	UserID        string          `json:"userId"`
	PatientID     *string         `json:"patientId,omitempty"`
	AppointmentID *string         `json:"appointmentId,omitempty"`
	Status        string          `json:"status"`
	Kind          string          `json:"kind"` // standard|emergency
	DueAt         *time.Time      `json:"dueAt,omitempty"`
	ReminderSet   bool            `json:"reminderSet"`
	CompletedAt   *time.Time      `json:"completedAt,omitempty"`
	Detail        json.RawMessage `json:"detail,omitempty"`
	CreatedAt     time.Time       `json:"createdAt"`
	UpdatedAt     time.Time       `json:"updatedAt"`
}

// CarePlan mirrors public.doctor_care_plans.
type CarePlan struct {
	ID        string          `json:"id"`
	UserID    string          `json:"userId"`
	PatientID *string         `json:"patientId,omitempty"`
	Title     *string         `json:"title,omitempty"`
	Status    string          `json:"status"`
	Plan      json.RawMessage `json:"plan,omitempty"`
	CreatedAt time.Time       `json:"createdAt"`
	UpdatedAt time.Time       `json:"updatedAt"`
}

// ChronicMonitoringEntry mirrors public.doctor_chronic_monitoring.
type ChronicMonitoringEntry struct {
	ID        string          `json:"id"`
	UserID    string          `json:"userId"`
	PatientID *string         `json:"patientId,omitempty"`
	Condition *string         `json:"condition,omitempty"`
	Readings  json.RawMessage `json:"readings,omitempty"`
	Detail    json.RawMessage `json:"detail,omitempty"`
	CreatedAt time.Time       `json:"createdAt"`
	UpdatedAt time.Time       `json:"updatedAt"`
}

// AdherenceCheck mirrors public.doctor_adherence_checks.
type AdherenceCheck struct {
	ID             string          `json:"id"`
	UserID         string          `json:"userId"`
	PatientID      *string         `json:"patientId,omitempty"`
	PrescriptionID *string         `json:"prescriptionId,omitempty"`
	Status         string          `json:"status"`
	Detail         json.RawMessage `json:"detail,omitempty"`
	CreatedAt      time.Time       `json:"createdAt"`
}

// ── HMO ──────────────────────────────────────────────────────────────────────

// HMOPlanCoverage mirrors public.doctor_hmo_plan_coverage.
type HMOPlanCoverage struct {
	ID         string          `json:"id"`
	UserID     string          `json:"userId"`
	PatientID  *string         `json:"patientId,omitempty"`
	Provider   *string         `json:"provider,omitempty"`
	PlanName   *string         `json:"planName,omitempty"`
	MemberID   *string         `json:"memberId,omitempty"`
	ValidUntil *time.Time      `json:"validUntil,omitempty"`
	CopayKobo  int64           `json:"copayKobo"`
	Coverage   json.RawMessage `json:"coverage,omitempty"`
	CreatedAt  time.Time       `json:"createdAt"`
	UpdatedAt  time.Time       `json:"updatedAt"`
}

// HMOPreAuthRequest mirrors public.doctor_hmo_preauth_requests.
type HMOPreAuthRequest struct {
	ID            string          `json:"id"`
	UserID        string          `json:"userId"`
	PatientID     *string         `json:"patientId,omitempty"`
	AppointmentID *string         `json:"appointmentId,omitempty"`
	Status        string          `json:"status"`
	AuthCode      *string         `json:"authCode,omitempty"`
	AmountKobo    int64           `json:"amountKobo"`
	Detail        json.RawMessage `json:"detail,omitempty"`
	CreatedAt     time.Time       `json:"createdAt"`
	UpdatedAt     time.Time       `json:"updatedAt"`
}

// HMOCoveredService mirrors public.doctor_hmo_covered_services.
type HMOCoveredService struct {
	ID          string          `json:"id"`
	UserID      string          `json:"userId"`
	ServiceName string          `json:"serviceName"`
	Provider    *string         `json:"provider,omitempty"`
	Covered     bool            `json:"covered"`
	Detail      json.RawMessage `json:"detail,omitempty"`
	CreatedAt   time.Time       `json:"createdAt"`
}

// HMOClaim mirrors public.doctor_hmo_claims.
type HMOClaim struct {
	ID            string          `json:"id"`
	UserID        string          `json:"userId"`
	Ref           *string         `json:"ref,omitempty"`
	PatientID     *string         `json:"patientId,omitempty"`
	AppointmentID *string         `json:"appointmentId,omitempty"`
	Status        string          `json:"status"`
	AmountKobo    int64           `json:"amountKobo"`
	Detail        json.RawMessage `json:"detail,omitempty"`
	CreatedAt     time.Time       `json:"createdAt"`
	UpdatedAt     time.Time       `json:"updatedAt"`
}

// HMOSupportMessage mirrors public.doctor_hmo_support_messages.
type HMOSupportMessage struct {
	ID        string    `json:"id"`
	UserID    string    `json:"userId"`
	ThreadID  string    `json:"threadId"`
	Author    string    `json:"author"`
	Body      *string   `json:"body,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

// HMOFraudWarning mirrors public.doctor_hmo_fraud_warnings.
type HMOFraudWarning struct {
	ID             string          `json:"id"`
	UserID         string          `json:"userId"`
	Severity       string          `json:"severity"`
	Acknowledged   bool            `json:"acknowledged"`
	AcknowledgedAt *time.Time      `json:"acknowledgedAt,omitempty"`
	Detail         json.RawMessage `json:"detail,omitempty"`
	CreatedAt      time.Time       `json:"createdAt"`
}

// ── Medical records ──────────────────────────────────────────────────────────

// RecordRestriction mirrors public.doctor_record_restrictions.
type RecordRestriction struct {
	ID         string          `json:"id"`
	UserID     string          `json:"userId"`
	PatientID  *string         `json:"patientId,omitempty"`
	Scope      *string         `json:"scope,omitempty"`
	Restricted bool            `json:"restricted"`
	Reason     *string         `json:"reason,omitempty"`
	Detail     json.RawMessage `json:"detail,omitempty"`
	CreatedAt  time.Time       `json:"createdAt"`
}

// RecordShare mirrors public.doctor_record_shares.
type RecordShare struct {
	ID         string          `json:"id"`
	UserID     string          `json:"userId"`
	PatientID  *string         `json:"patientId,omitempty"`
	SharedWith *string         `json:"sharedWith,omitempty"`
	Status     string          `json:"status"`
	ExpiresAt  *time.Time      `json:"expiresAt,omitempty"`
	Detail     json.RawMessage `json:"detail,omitempty"`
	CreatedAt  time.Time       `json:"createdAt"`
}

// RecordAccessEntry mirrors public.doctor_record_access_log.
type RecordAccessEntry struct {
	ID        string          `json:"id"`
	UserID    string          `json:"userId"`
	PatientID *string         `json:"patientId,omitempty"`
	Action    string          `json:"action"`
	Detail    json.RawMessage `json:"detail,omitempty"`
	CreatedAt time.Time       `json:"createdAt"`
}
