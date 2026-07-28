package doctor

import (
	"encoding/json"
	"time"
)

// ── Profile & verification ──────────────────────────────────────────────────

// Profile mirrors public.doctor_profiles (the columns the MVP reads).
type Profile struct {
	ID              string          `json:"id"`
	UserID          string          `json:"userId"`
	ProviderType    string          `json:"providerType"`
	Name            *string         `json:"name,omitempty"`
	Title           *string         `json:"title,omitempty"`
	SpecialtyID     *string         `json:"specialtyId,omitempty"`
	Specialties     json.RawMessage `json:"specialties,omitempty"`
	SubSpecialties  json.RawMessage `json:"subSpecialties,omitempty"`
	Bio             *string         `json:"bio,omitempty"`
	AvatarURL       *string         `json:"avatarUrl,omitempty"`
	Email           *string         `json:"email,omitempty"`
	Phone           *string         `json:"phone,omitempty"`
	MDCNNumber      *string         `json:"mdcnNumber,omitempty"`
	FeeKobo         int64           `json:"feeKobo"`
	Rating          float64         `json:"rating"`
	ReviewCount     int             `json:"reviewCount"`
	YearsExperience int             `json:"yearsExperience"`
	Languages       json.RawMessage `json:"languages,omitempty"`
	Hospital        *string         `json:"hospital,omitempty"`
	State           *string         `json:"state,omitempty"`
	IsOnline        bool            `json:"isOnline"`
	Presence        string          `json:"presence"`
	Verification    string          `json:"verification"`
	Timezone        string          `json:"timezone"`
	IsPublished     bool            `json:"isPublished"`
	ProfileDraft    json.RawMessage `json:"profileDraft,omitempty"`
	CompletedSteps  json.RawMessage `json:"completedSteps,omitempty"`
	CreatedAt       time.Time       `json:"createdAt"`
	UpdatedAt       time.Time       `json:"updatedAt"`
}

// Verification mirrors public.doctor_verifications.
type Verification struct {
	ID               string          `json:"id"`
	UserID           string          `json:"userId"`
	Status           string          `json:"status"`
	Kind             string          `json:"kind"`
	MDCNNumber       *string         `json:"mdcnNumber,omitempty"`
	SubmittedAt      *time.Time      `json:"submittedAt,omitempty"`
	ReviewedAt       *time.Time      `json:"reviewedAt,omitempty"`
	RejectionReason  *string         `json:"rejectionReason,omitempty"`
	RejectionReasons json.RawMessage `json:"rejectionReasons,omitempty"`
	Notes            *string         `json:"notes,omitempty"`
	CreatedAt        time.Time       `json:"createdAt"`
	UpdatedAt        time.Time       `json:"updatedAt"`
}

// SubmitVerificationRequest is the body for POST /verification.
type SubmitVerificationRequest struct {
	Kind       string          `json:"kind"`
	MDCNNumber *string         `json:"mdcnNumber,omitempty"`
	Notes      *string         `json:"notes,omitempty"`
	Documents  json.RawMessage `json:"documents,omitempty"`
}

// ── Availability ────────────────────────────────────────────────────────────

// Availability mirrors public.doctor_availability.
type Availability struct {
	ID                  string          `json:"id"`
	UserID              string          `json:"userId"`
	WorkingDays         json.RawMessage `json:"workingDays,omitempty"`
	Breaks              json.RawMessage `json:"breaks,omitempty"`
	Rules               json.RawMessage `json:"rules,omitempty"`
	ConsultDurationMins int             `json:"consultDurationMins"`
	BufferMins          int             `json:"bufferMins"`
	AcceptsInstant      bool            `json:"acceptsInstant"`
	EmergencyEnabled    bool            `json:"emergencyEnabled"`
	Timezone            string          `json:"timezone"`
	ReminderSettings    json.RawMessage `json:"reminderSettings,omitempty"`
	CreatedAt           time.Time       `json:"createdAt"`
	UpdatedAt           time.Time       `json:"updatedAt"`
}

// UpdateAvailabilityRequest is the body for PUT /availability.
type UpdateAvailabilityRequest struct {
	WorkingDays         json.RawMessage `json:"workingDays,omitempty"`
	Breaks              json.RawMessage `json:"breaks,omitempty"`
	Rules               json.RawMessage `json:"rules,omitempty"`
	ConsultDurationMins *int            `json:"consultDurationMins,omitempty"`
	BufferMins          *int            `json:"bufferMins,omitempty"`
	AcceptsInstant      *bool           `json:"acceptsInstant,omitempty"`
	EmergencyEnabled    *bool           `json:"emergencyEnabled,omitempty"`
	Timezone            *string         `json:"timezone,omitempty"`
	ReminderSettings    json.RawMessage `json:"reminderSettings,omitempty"`
}

// ── Appointments ────────────────────────────────────────────────────────────

// Appointment mirrors public.doctor_appointments.
type Appointment struct {
	ID          string          `json:"id"`
	UserID      string          `json:"userId"`
	Ref         *string         `json:"ref,omitempty"`
	PatientID   *string         `json:"patientId,omitempty"`
	Patient     json.RawMessage `json:"patient,omitempty"`
	ConsultType *string         `json:"consultType,omitempty"`
	Status      string          `json:"status"`
	SlotDate    *time.Time      `json:"slotDate,omitempty"`
	SlotTime    *string         `json:"slotTime,omitempty"`
	FeeKobo     int64           `json:"feeKobo"`
	Reason      *string         `json:"reason,omitempty"`
	IsHMO       bool            `json:"isHmo"`
	HMOProvider *string         `json:"hmoProvider,omitempty"`
	StartedAt   *time.Time      `json:"startedAt,omitempty"`
	EndedAt     *time.Time      `json:"endedAt,omitempty"`
	CreatedAt   time.Time       `json:"createdAt"`
	UpdatedAt   time.Time       `json:"updatedAt"`
}

// UpdateAppointmentStatusRequest is the body for POST /appointments/:id/status.
type UpdateAppointmentStatusRequest struct {
	Status string          `json:"status" binding:"required"`
	Detail json.RawMessage `json:"detail,omitempty"`
}

// ClinicalNote mirrors public.doctor_clinical_notes.
type ClinicalNote struct {
	ID            string          `json:"id"`
	UserID        string          `json:"userId"`
	AppointmentID *string         `json:"appointmentId,omitempty"`
	PatientID     *string         `json:"patientId,omitempty"`
	Subjective    *string         `json:"subjective,omitempty"`
	Objective     *string         `json:"objective,omitempty"`
	Assessment    *string         `json:"assessment,omitempty"`
	Plan          *string         `json:"plan,omitempty"`
	Diagnosis     json.RawMessage `json:"diagnosis,omitempty"`
	Sections      json.RawMessage `json:"sections,omitempty"`
	Status        string          `json:"status"`
	FinalizedAt   *time.Time      `json:"finalizedAt,omitempty"`
	CreatedAt     time.Time       `json:"createdAt"`
	UpdatedAt     time.Time       `json:"updatedAt"`
}

// SaveNoteRequest is the body for POST /appointments/:id/notes.
type SaveNoteRequest struct {
	Subjective *string         `json:"subjective,omitempty"`
	Objective  *string         `json:"objective,omitempty"`
	Assessment *string         `json:"assessment,omitempty"`
	Plan       *string         `json:"plan,omitempty"`
	Diagnosis  json.RawMessage `json:"diagnosis,omitempty"`
	Sections   json.RawMessage `json:"sections,omitempty"`
	Status     string          `json:"status,omitempty"` // draft|finalized|shared
}

// ── Prescriptions ───────────────────────────────────────────────────────────

// Prescription mirrors public.doctor_prescriptions.
type Prescription struct {
	ID            string             `json:"id"`
	UserID        string             `json:"userId"`
	Ref           *string            `json:"ref,omitempty"`
	AppointmentID *string            `json:"appointmentId,omitempty"`
	PatientID     *string            `json:"patientId,omitempty"`
	Patient       json.RawMessage    `json:"patient,omitempty"`
	Diagnosis     *string            `json:"diagnosis,omitempty"`
	Status        string             `json:"status"`
	IssuedAt      *time.Time         `json:"issuedAt,omitempty"`
	Items         []PrescriptionItem `json:"items,omitempty"`
	CreatedAt     time.Time          `json:"createdAt"`
	UpdatedAt     time.Time          `json:"updatedAt"`
}

// PrescriptionItem mirrors public.doctor_prescription_items.
type PrescriptionItem struct {
	Name      string  `json:"name"`
	Dosage    *string `json:"dosage,omitempty"`
	Route     *string `json:"route,omitempty"`
	Frequency *string `json:"frequency,omitempty"`
	Duration  *string `json:"duration,omitempty"`
	Notes     *string `json:"notes,omitempty"`
}

// CreatePrescriptionRequest is the body for POST /prescriptions.
type CreatePrescriptionRequest struct {
	AppointmentID *string            `json:"appointmentId,omitempty"`
	PatientID     *string            `json:"patientId,omitempty"`
	Patient       json.RawMessage    `json:"patient,omitempty"`
	Diagnosis     *string            `json:"diagnosis,omitempty"`
	Status        string             `json:"status,omitempty"` // draft|issued
	Items         []PrescriptionItem `json:"items"`
}

// ── Lab orders / results ────────────────────────────────────────────────────

// LabOrder mirrors public.doctor_lab_orders.
type LabOrder struct {
	ID            string          `json:"id"`
	UserID        string          `json:"userId"`
	Ref           *string         `json:"ref,omitempty"`
	AppointmentID *string         `json:"appointmentId,omitempty"`
	PatientID     *string         `json:"patientId,omitempty"`
	Patient       json.RawMessage `json:"patient,omitempty"`
	ClinicalNote  *string         `json:"clinicalNote,omitempty"`
	Status        string          `json:"status"`
	Priority      string          `json:"priority"`
	LabProvider   *string         `json:"labProvider,omitempty"`
	OrderedAt     time.Time       `json:"orderedAt"`
	Tests         []LabOrderTest  `json:"tests,omitempty"`
	CreatedAt     time.Time       `json:"createdAt"`
	UpdatedAt     time.Time       `json:"updatedAt"`
}

// LabOrderTest mirrors public.doctor_lab_order_tests.
type LabOrderTest struct {
	TestID   *string `json:"testId,omitempty"`
	Name     *string `json:"name,omitempty"`
	Code     *string `json:"code,omitempty"`
	Category *string `json:"category,omitempty"`
}

// CreateLabOrderRequest is the body for POST /lab-orders.
type CreateLabOrderRequest struct {
	AppointmentID *string         `json:"appointmentId,omitempty"`
	PatientID     *string         `json:"patientId,omitempty"`
	Patient       json.RawMessage `json:"patient,omitempty"`
	ClinicalNote  *string         `json:"clinicalNote,omitempty"`
	Priority      string          `json:"priority,omitempty"` // routine|urgent
	LabProvider   *string         `json:"labProvider,omitempty"`
	Tests         []LabOrderTest  `json:"tests"`
}

// LabResult mirrors public.doctor_lab_results (+ values).
type LabResult struct {
	ID         string            `json:"id"`
	UserID     string            `json:"userId"`
	OrderID    *string           `json:"orderId,omitempty"`
	Ref        *string           `json:"ref,omitempty"`
	Patient    json.RawMessage   `json:"patient,omitempty"`
	LabName    *string           `json:"labName,omitempty"`
	ReportedAt *time.Time        `json:"reportedAt,omitempty"`
	Reviewed   bool              `json:"reviewed"`
	ReviewedAt *time.Time        `json:"reviewedAt,omitempty"`
	Values     []LabResultValue  `json:"values,omitempty"`
	CreatedAt  time.Time         `json:"createdAt"`
	UpdatedAt  time.Time         `json:"updatedAt"`
}

// LabResultValue mirrors public.doctor_lab_result_values.
type LabResultValue struct {
	TestName *string `json:"testName,omitempty"`
	Value    *string `json:"value,omitempty"`
	Unit     *string `json:"unit,omitempty"`
	RefRange *string `json:"refRange,omitempty"`
	Flag     *string `json:"flag,omitempty"`
}

// ReviewLabResultRequest is the body for POST /lab-results/:resultId/review.
type ReviewLabResultRequest struct {
	Interpretation *string         `json:"interpretation,omitempty"`
	Detail         json.RawMessage `json:"detail,omitempty"`
}

// ── Earnings (ledger projection) ────────────────────────────────────────────

// Earnings is a projection computed from the ledger — never a stored balance.
type Earnings struct {
	AvailableKobo int64  `json:"availableKobo"`
	PendingKobo   int64  `json:"pendingKobo"`
	LifetimeKobo  int64  `json:"lifetimeKobo"`
	Currency      string `json:"currency"`
}

// ── Payouts (money path) ────────────────────────────────────────────────────

// Payout mirrors public.doctor_payouts. NO balance column — amount + status only.
type Payout struct {
	ID             string     `json:"id"`
	UserID         string     `json:"userId"`
	Ref            *string    `json:"ref,omitempty"`
	AmountKobo     int64      `json:"amountKobo"`
	Currency       string     `json:"currency"`
	Status         string     `json:"status"`
	BankAccountID  *string    `json:"bankAccountId,omitempty"`
	LedgerRef      *string    `json:"ledgerRef,omitempty"`
	RequestedAt    time.Time  `json:"requestedAt"`
	PaidAt         *time.Time `json:"paidAt,omitempty"`
	IdempotencyKey string     `json:"-"`
	CreatedAt      time.Time  `json:"createdAt"`
}

// RequestPayoutRequest is the body for POST /payouts. amountKobo is minor units.
type RequestPayoutRequest struct {
	AmountKobo    int64   `json:"amountKobo" binding:"required"`
	BankAccountID *string `json:"bankAccountId,omitempty"`
}

// RequestPayoutResult matches the OpenAPI RequestPayoutResult schema.
type RequestPayoutResult struct {
	PayoutID string `json:"payoutId"`
	Ref      string `json:"ref"`
	Status   string `json:"status"`
}

// ── Notifications & settings ────────────────────────────────────────────────

// Notification mirrors public.doctor_notifications.
type Notification struct {
	ID        string          `json:"id"`
	UserID    string          `json:"userId"`
	Type      string          `json:"type"`
	Title     *string         `json:"title,omitempty"`
	Body      *string         `json:"body,omitempty"`
	Read      bool            `json:"read"`
	ReadAt    *time.Time      `json:"readAt,omitempty"`
	Detail    json.RawMessage `json:"detail,omitempty"`
	CreatedAt time.Time       `json:"createdAt"`
}

// Settings mirrors public.doctor_settings.
type Settings struct {
	ID                  string          `json:"id"`
	UserID              string          `json:"userId"`
	NotifyAppointments  bool            `json:"notifyAppointments"`
	NotifyMessages      bool            `json:"notifyMessages"`
	NotifyPayouts       bool            `json:"notifyPayouts"`
	PushEnabled         bool            `json:"pushEnabled"`
	EmailEnabled        bool            `json:"emailEnabled"`
	SMSEnabled          bool            `json:"smsEnabled"`
	ShowOnlineStatus    bool            `json:"showOnlineStatus"`
	AutoAcceptInstant   bool            `json:"autoAcceptInstant"`
	PreferredCurrency   string          `json:"preferredCurrency"`
	BiometricEnabled    bool            `json:"biometricEnabled"`
	TwoFactorEnabled    bool            `json:"twoFactorEnabled"`
	AppPreferences      json.RawMessage `json:"appPreferences,omitempty"`
	Security            json.RawMessage `json:"security,omitempty"`
	CreatedAt           time.Time       `json:"createdAt"`
	UpdatedAt           time.Time       `json:"updatedAt"`
}

// UpdateSettingsRequest is the body for PUT /settings. All fields optional (PATCH-like).
type UpdateSettingsRequest struct {
	NotifyAppointments *bool           `json:"notifyAppointments,omitempty"`
	NotifyMessages     *bool           `json:"notifyMessages,omitempty"`
	NotifyPayouts      *bool           `json:"notifyPayouts,omitempty"`
	PushEnabled        *bool           `json:"pushEnabled,omitempty"`
	EmailEnabled       *bool           `json:"emailEnabled,omitempty"`
	SMSEnabled         *bool           `json:"smsEnabled,omitempty"`
	ShowOnlineStatus   *bool           `json:"showOnlineStatus,omitempty"`
	AutoAcceptInstant  *bool           `json:"autoAcceptInstant,omitempty"`
	PreferredCurrency  *string         `json:"preferredCurrency,omitempty"`
	BiometricEnabled   *bool           `json:"biometricEnabled,omitempty"`
	TwoFactorEnabled   *bool           `json:"twoFactorEnabled,omitempty"`
	AppPreferences     json.RawMessage `json:"appPreferences,omitempty"`
	Security           json.RawMessage `json:"security,omitempty"`
}

// PatientRecord is the denormalised patient row read for GET /patients/:patientId.
type PatientRecord struct {
	PatientID    string          `json:"patientId"`
	Patient      json.RawMessage `json:"patient,omitempty"`
	Appointments []Appointment   `json:"appointments,omitempty"`
}
