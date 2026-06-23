package telemedicine

import "time"

// ─── Block 13 additions: slots, reviews, visit summaries ─────────────────────

// Slot is a single bookable availability window for a doctor.
type Slot struct {
	ID        string `json:"id"`
	DoctorID  string `json:"doctor_id"`
	Date      string `json:"date"` // YYYY-MM-DD
	Time      string `json:"time"` // e.g. "09:00 AM"
	Available bool   `json:"available"`
}

// Review is an immutable patient rating left after a completed appointment.
type Review struct {
	ID            string    `json:"id"`
	AppointmentID string    `json:"appointment_id"`
	DoctorID      string    `json:"doctor_id"`
	PatientID     string    `json:"patient_id"`
	Rating        int       `json:"rating"`
	Comment       string    `json:"comment"`
	IsHidden      bool      `json:"is_hidden"`
	CreatedAt     time.Time `json:"created_at"`
}

// VisitSummary is the patient-facing diagnosis / notes / follow-up for a visit.
type VisitSummary struct {
	ID            string    `json:"id"`
	AppointmentID string    `json:"appointment_id"`
	DoctorID      string    `json:"doctor_id"`
	PatientID     string    `json:"patient_id"`
	Diagnosis     string    `json:"diagnosis"`
	Notes         string    `json:"notes"`
	FollowUp      string    `json:"follow_up"`
	CreatedAt     time.Time `json:"created_at"`
}

// ─── Request types ───────────────────────────────────────────────────────────

// SubmitReviewRequest is the body for POST /telemedicine/appointments/:id/review.
type SubmitReviewRequest struct {
	Rating  int    `json:"rating" binding:"required,min=1,max=5"`
	Comment string `json:"comment"`
}

// RescheduleRequest is the body for POST /telemedicine/appointments/:id/reschedule.
type RescheduleRequest struct {
	ScheduledAt time.Time `json:"scheduled_at" binding:"required"`
	SlotTime    string    `json:"slot_time"`
}
