package telemedicine

import "time"

// DoctorSpecialty categories for filtering.
type DoctorSpecialty string

const (
	SpecialtyGeneral      DoctorSpecialty = "general"
	SpecialtyCardiology   DoctorSpecialty = "cardiology"
	SpecialtyDermatology  DoctorSpecialty = "dermatology"
	SpecialtyPaediatrics  DoctorSpecialty = "paediatrics"
	SpecialtyVeterinary   DoctorSpecialty = "veterinary"
	SpecialtyPharmacy     DoctorSpecialty = "pharmacy"
	SpecialtyMentalHealth DoctorSpecialty = "mental_health"
	SpecialtyWomensHealth DoctorSpecialty = "womens_health"
	SpecialtyNeurology    DoctorSpecialty = "neurology"
	SpecialtyEyeCare      DoctorSpecialty = "eye_care"
	SpecialtyNutrition    DoctorSpecialty = "nutrition"
	SpecialtyDentistry    DoctorSpecialty = "dentistry"
	SpecialtyOncology     DoctorSpecialty = "oncology"
	SpecialtyOrthopedic   DoctorSpecialty = "orthopedic"
)

// Doctor is a registered healthcare provider (base record).
type Doctor struct {
	ID              string          `json:"id"`
	UserID          string          `json:"user_id"`
	Name            string          `json:"name"`
	Specialty       DoctorSpecialty `json:"specialty"`
	SubSpecialty    *string         `json:"sub_specialty,omitempty"`
	Bio             string          `json:"bio,omitempty"`
	About           string          `json:"about,omitempty"`
	ConsultFeeKobo  int64           `json:"consult_fee_kobo"`
	// Booking is the server-computed price breakdown for consulting this doctor
	// (consultation fee + platform booking fee). It is derived from
	// ConsultFeeKobo, never stored, and is what the app renders on the confirm
	// screen — the app holds no fee rate of its own. See ADR-044.
	Booking         *BookingQuote   `json:"booking,omitempty"`
	AvatarURL       *string         `json:"avatar_url,omitempty"`
	IsAvailable     bool            `json:"is_available"`
	IsOnline        bool            `json:"is_online"`
	IsHMOVerified   bool            `json:"is_hmo_verified"`
	ExperienceYears int             `json:"experience_years"`
	Rating          float64         `json:"rating"`
	ReviewCount     int             `json:"review_count"`
	PatientsCount   int             `json:"patients_count"`
	SuccessRate     int             `json:"success_rate"`
	MDCNNumber      *string         `json:"mdcn_number,omitempty"`
	Phone           *string         `json:"phone,omitempty"`
	Education       []Education     `json:"education"`
	CreatedAt       time.Time       `json:"created_at"`
}

// Education is a single academic credential.
type Education struct {
	Institution string `json:"institution"`
	Degree      string `json:"degree"`
	Year        int    `json:"year"`
}

// Specialty is a consultation specialty category.
type Specialty struct {
	ID          string `json:"id"`
	Slug        string `json:"slug"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Icon        string `json:"icon"`
	DoctorCount int    `json:"doctor_count"`
	IsFeatured  bool   `json:"is_featured"`
}

// AppointmentStatus tracks a consultation through its lifecycle.
type AppointmentStatus string

const (
	ApptBooked    AppointmentStatus = "booked"
	ApptConfirmed AppointmentStatus = "confirmed"
	ApptCompleted AppointmentStatus = "completed"
	ApptCancelled AppointmentStatus = "cancelled"
)

// Appointment is a scheduled or on-demand consultation.
type Appointment struct {
	ID               string            `json:"id"`
	PatientID        string            `json:"patient_id"`
	DoctorID         string            `json:"doctor_id"`
	DoctorName       string            `json:"doctor_name,omitempty"`
	DoctorSpecialty  string            `json:"doctor_specialty,omitempty"`
	ConsultationType string            `json:"consultation_type"`
	ScheduledAt      time.Time         `json:"scheduled_at"`
	StartsAt         *time.Time        `json:"starts_at,omitempty"`
	Status           AppointmentStatus `json:"status"`
	Notes            string            `json:"notes,omitempty"`
	// FeeKobo is the doctor's CONSULTATION fee alone. Doctor earnings are 85% of
	// it (see the SUM(fee_kobo * 0.85) queries below), so it must never be widened
	// to mean "what the patient paid" — that figure is TotalKobo.
	FeeKobo int64 `json:"fee_kobo"`
	// PlatformFeeKobo is the platform booking fee charged on top of the
	// consultation fee. Settled as a 100%-platform leg, so it does not dilute the
	// doctor's 85%. Zero for appointments booked before ADR-044.
	PlatformFeeKobo int64 `json:"platform_fee_kobo"`
	// TotalKobo is what was actually escrowed and what the patient paid
	// (FeeKobo + PlatformFeeKobo). A cancellation refunds this in full.
	TotalKobo      int64  `json:"total_kobo"`
	IdempotencyKey string `json:"idempotency_key"`
	SettlementID     string            `json:"settlement_id"`
	CreatedAt        time.Time         `json:"created_at"`
}

// Prescription is issued by a doctor after a completed appointment.
type Prescription struct {
	ID            string    `json:"id"`
	AppointmentID string    `json:"appointment_id"`
	DoctorID      string    `json:"doctor_id"`
	PatientID     string    `json:"patient_id"`
	Medications   string    `json:"medications"`
	Instructions  string    `json:"instructions,omitempty"`
	IssuedAt      time.Time `json:"issued_at"`
}

// SOAPNote captures a structured consultation note.
type SOAPNote struct {
	ID            string             `json:"id"`
	AppointmentID string             `json:"appointment_id"`
	DoctorID      string             `json:"doctor_id"`
	PatientID     string             `json:"patient_id"`
	Subjective    string             `json:"subjective"`
	Objective     string             `json:"objective"`
	Assessment    string             `json:"assessment"`
	Plan          string             `json:"plan"`
	Prescriptions []PrescriptionItem `json:"prescriptions"`
	CreatedAt     time.Time          `json:"created_at"`
}

// PrescriptionItem is a single medication row in a SOAP note.
type PrescriptionItem struct {
	Drug     string `json:"drug"`
	Dosage   string `json:"dosage"`
	Duration string `json:"duration"`
}

// LicenceDocument is an uploaded credential for doctor verification.
type LicenceDocument struct {
	ID             string    `json:"id"`
	DoctorUserID   string    `json:"doctor_user_id"`
	DocumentType   string    `json:"document_type"`
	Filename       string    `json:"filename"`
	StorageKey     string    `json:"storage_key"`
	Status         string    `json:"status"`
	IdempotencyKey *string   `json:"idempotency_key,omitempty"`
	UploadedAt     time.Time `json:"uploaded_at"`
}

// DoctorDashboard aggregates a doctor's day-view data.
type DoctorDashboard struct {
	Stats              DashboardStats  `json:"stats"`
	PendingRequests    []PendingReq    `json:"pending_requests"`
	TodaysAppointments []ScheduledAppt `json:"todays_appointments"`
}

// DashboardStats are the KPI cards shown at the top of the doctor dashboard.
type DashboardStats struct {
	WeeklyRevenueKobo int64   `json:"weekly_revenue_kobo"`
	RevenueGrowthPct  float64 `json:"revenue_growth_pct"`
	PatientsSeen      int     `json:"patients_seen"`
	Rating            float64 `json:"rating"`
	IsOnline          bool    `json:"is_online"`
}

// PendingReq is a patient's pending consultation request.
type PendingReq struct {
	ID          string    `json:"id"`
	PatientName string    `json:"patient_name"`
	RequestType string    `json:"request_type"`
	CreatedAt   time.Time `json:"created_at"`
}

// ScheduledAppt is a today's appointment entry on the doctor dashboard.
type ScheduledAppt struct {
	ID          string `json:"id"`
	PatientName string `json:"patient_name"`
	Time        string `json:"time"`
	Type        string `json:"type"`
	Reason      string `json:"reason"`
	Status      string `json:"status"`
}

// ─── Request types ───────────────────────────────────────────────────────────

// RegisterDoctorRequest is the body for POST /telemedicine/doctors (legacy).
type RegisterDoctorRequest struct {
	Name           string          `json:"name" binding:"required,min=2,max=200"`
	Specialty      DoctorSpecialty `json:"specialty" binding:"required"`
	Bio            string          `json:"bio"`
	ConsultFeeKobo int64           `json:"consult_fee_kobo" binding:"required,min=100"`
	AvatarURL      *string         `json:"avatar_url,omitempty"`
}

// RegisterDoctorV2Request is the body for POST /telemedicine/doctor/register.
type RegisterDoctorV2Request struct {
	FullName        string `json:"full_name" binding:"required,min=2,max=200"`
	Email           string `json:"email" binding:"required"`
	Phone           string `json:"phone" binding:"required"`
	Specialty       string `json:"specialty" binding:"required"`
	YearsExperience int    `json:"years_experience"`
	MDCNNumber      string `json:"mdcn_number" binding:"required"`
}

// BookAppointmentRequest is the body for POST /telemedicine/appointments.
type BookAppointmentRequest struct {
	DoctorID         string    `json:"doctor_id" binding:"required"`
	ScheduledAt      time.Time `json:"scheduled_at" binding:"required"`
	ConsultationType string    `json:"consultation_type"`
	Notes            string    `json:"notes"`
	IdempotencyKey   string    `json:"idempotency_key" binding:"required"`
	// ExpectedTotalKobo is the total the client quoted the patient, taken from the
	// doctor's `booking` quote. The card rail charges that amount at the PSP before
	// this server escrows anything, so a stale quote would put the charged and
	// escrowed amounts out of step — when this disagrees with the server's own
	// computation the booking is rejected before any money moves. Zero means the
	// client did not quote a total and skips the check (ADR-044).
	ExpectedTotalKobo int64 `json:"expected_total_kobo"`
}

// IssuePrescriptionRequest is the body for POST /telemedicine/appointments/:id/prescription.
type IssuePrescriptionRequest struct {
	Medications  string `json:"medications" binding:"required"`
	Instructions string `json:"instructions"`
}

// SubmitSOAPNoteRequest is the body for POST /telemedicine/doctor/notes.
type SubmitSOAPNoteRequest struct {
	AppointmentID  string             `json:"appointment_id" binding:"required"`
	Subjective     string             `json:"subjective" binding:"required"`
	Objective      string             `json:"objective"`
	Assessment     string             `json:"assessment" binding:"required"`
	Plan           string             `json:"plan" binding:"required"`
	Prescriptions  []PrescriptionItem `json:"prescriptions"`
	IdempotencyKey string             `json:"idempotency_key"`
}

// UploadLicenceRequest is the body for POST /telemedicine/doctor/licence.
type UploadLicenceRequest struct {
	DocumentType   string `json:"document_type" binding:"required"`
	Base64         string `json:"base64"`
	Filename       string `json:"filename" binding:"required"`
	IdempotencyKey string `json:"idempotency_key"`
}

// ToggleAvailabilityRequest is the body for PATCH /telemedicine/doctor/availability.
type ToggleAvailabilityRequest struct {
	IsOnline bool `json:"is_online"`
}

// ListDoctorsQuery holds validated query params for the doctor list endpoint.
type ListDoctorsQuery struct {
	SpecialtyID   string `form:"specialty_id"`
	Search        string `form:"search"`
	AvailableNow  bool   `form:"available_now"`
	TopRated      bool   `form:"top_rated"`
	MinExperience int    `form:"min_experience"`
	Limit         int    `form:"limit,default=20"`
	Offset        int    `form:"offset,default=0"`
}
