package telemedicine

import "time"

// DoctorSpecialty categories for filtering.
type DoctorSpecialty string

const (
	SpecialtyGeneral    DoctorSpecialty = "general"
	SpecialtyCardiology DoctorSpecialty = "cardiology"
	SpecialtyDermatology DoctorSpecialty = "dermatology"
	SpecialtyPaediatrics DoctorSpecialty = "paediatrics"
	SpecialtyVeterinary  DoctorSpecialty = "veterinary"
	SpecialtyPharmacy    DoctorSpecialty = "pharmacy"
)

// Doctor is a registered healthcare provider.
type Doctor struct {
	ID              string          `json:"id"`
	UserID          string          `json:"user_id"`
	Name            string          `json:"name"`
	Specialty       DoctorSpecialty `json:"specialty"`
	Bio             string          `json:"bio,omitempty"`
	ConsultFeeKobo  int64           `json:"consult_fee_kobo"`
	AvatarURL       *string         `json:"avatar_url,omitempty"`
	IsAvailable     bool            `json:"is_available"`
	CreatedAt       time.Time       `json:"created_at"`
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
	ID             string            `json:"id"`
	PatientID      string            `json:"patient_id"`
	DoctorID       string            `json:"doctor_id"`
	ScheduledAt    time.Time         `json:"scheduled_at"`
	Status         AppointmentStatus `json:"status"`
	Notes          string            `json:"notes,omitempty"`
	FeeKobo        int64             `json:"fee_kobo"`
	IdempotencyKey string            `json:"idempotency_key"`
	SettlementID   string            `json:"settlement_id"`
	CreatedAt      time.Time         `json:"created_at"`
}

// Prescription is issued by a doctor after a completed appointment.
type Prescription struct {
	ID            string    `json:"id"`
	AppointmentID string    `json:"appointment_id"`
	DoctorID      string    `json:"doctor_id"`
	PatientID     string    `json:"patient_id"`
	Medications   string    `json:"medications"` // free-text or JSON blob
	Instructions  string    `json:"instructions,omitempty"`
	IssuedAt      time.Time `json:"issued_at"`
}

// RegisterDoctorRequest is the body for POST /telemedicine/doctors.
type RegisterDoctorRequest struct {
	Name           string          `json:"name" binding:"required,min=2,max=200"`
	Specialty      DoctorSpecialty `json:"specialty" binding:"required"`
	Bio            string          `json:"bio"`
	ConsultFeeKobo int64           `json:"consult_fee_kobo" binding:"required,min=100"`
	AvatarURL      *string         `json:"avatar_url,omitempty"`
}

// BookAppointmentRequest is the body for POST /telemedicine/appointments.
type BookAppointmentRequest struct {
	DoctorID       string    `json:"doctor_id" binding:"required"`
	ScheduledAt    time.Time `json:"scheduled_at" binding:"required"`
	Notes          string    `json:"notes"`
	IdempotencyKey string    `json:"idempotency_key" binding:"required"`
}

// IssuePrescriptionRequest is the body for POST /telemedicine/appointments/:id/prescription.
type IssuePrescriptionRequest struct {
	Medications  string `json:"medications" binding:"required"`
	Instructions string `json:"instructions"`
}
