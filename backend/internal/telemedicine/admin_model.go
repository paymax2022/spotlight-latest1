package telemedicine

import "time"

// admin_model.go — request/response types for the admin console (TELEMEDICINE-004).
// These are additive to model.go; nothing here changes the member-facing shapes.

// AdminDashboard aggregates platform-wide KPIs for the telemedicine admin console.
// Contrast with DoctorDashboard (model.go), which is ONE doctor's own view.
type AdminDashboard struct {
	TotalDoctors int `json:"total_doctors"`
	// DoctorsPendingApproval counts doctor_verifications rows whose CURRENT
	// (most-recent per user) status is not yet a terminal decision. The schema
	// (supabase/migrations/20260625000000_doctor_module.sql,
	// 20260815000600_doctor_mdcn_assisted_verification.sql) allows
	// 'unsubmitted','pending','needs_info','approved','rejected' — no
	// 'submitted'/'under_review' variant is ever written by any code path, so
	// only the values actually used are counted (pending + needs_info).
	DoctorsPendingApproval int `json:"doctors_pending_approval"`
	// DoctorsApproved is the mirror count: doctors whose current (most-recent)
	// verification status is 'approved'. Added so the admin console can show a
	// real "verified" figure instead of a client-side placeholder.
	DoctorsApproved      int `json:"doctors_approved"`
	AppointmentsThisWeek int `json:"appointments_this_week"`
	// PlatformRevenueKoboWeek is the platform's cut of every appointment
	// completed in the trailing 7 days: fee_kobo*15/100 (the 15% commission leg
	// of CompleteAppointment's settlement.Split) + platform_fee_kobo (the
	// ADR-044 booking fee, a 100%-platform leg). Integer floor arithmetic only —
	// see CompleteAppointment's comment for why `fee_kobo * 0.85` (float) was a
	// live bug (TELEMEDICINE-002) that must not be reintroduced here.
	PlatformRevenueKoboWeek int64 `json:"platform_revenue_kobo_week"`
}

// AdminDoctor is one row of the admin doctor roster — the FULL roster (unlike
// ListDoctors, which is availability-filtered for patients), joined with the
// doctor's real MDCN verification status (most-recent doctor_verifications row
// for that user_id).
type AdminDoctor struct {
	ID             string    `json:"id"`
	UserID         string    `json:"user_id"`
	Name           string    `json:"name"`
	Specialty      string    `json:"specialty"`
	ConsultFeeKobo int64     `json:"consult_fee_kobo"`
	IsAvailable    bool      `json:"is_available"`
	IsOnline       bool      `json:"is_online"`
	CreatedAt      time.Time `json:"created_at"`

	// Verification fields are nullable: a doctor row can exist with zero
	// doctor_verifications rows (never submitted) — never fabricated.
	VerificationStatus *string    `json:"verification_status,omitempty"`
	VerificationID     *string    `json:"verification_id,omitempty"`
	MDCNNumber         *string    `json:"mdcn_number,omitempty"`
	SubmittedAt        *time.Time `json:"submitted_at,omitempty"`
	ReviewedAt         *time.Time `json:"reviewed_at,omitempty"`
	RejectionReason    *string    `json:"rejection_reason,omitempty"`
}

// AdminDoctorListQuery holds validated query params for the admin roster.
type AdminDoctorListQuery struct {
	Status string `form:"status"` // filters on verification status when set
	Limit  int    `form:"limit,default=20"`
	Offset int    `form:"offset,default=0"`
}

// AdminAppointment is a system-wide appointment row — every field the admin
// console needs to triage a booking, never scoped to the requesting caller.
type AdminAppointment struct {
	ID              string    `json:"id"`
	PatientID       string    `json:"patient_id"`
	DoctorID        string    `json:"doctor_id"`
	DoctorName      string    `json:"doctor_name,omitempty"`
	ScheduledAt     time.Time `json:"scheduled_at"`
	Status          string    `json:"status"`
	FeeKobo         int64     `json:"fee_kobo"`
	PlatformFeeKobo int64     `json:"platform_fee_kobo"`
	TotalKobo       int64     `json:"total_kobo"`
	CreatedAt       time.Time `json:"created_at"`
}

// AdminAppointmentListQuery holds validated query params for the system-wide
// appointment list.
type AdminAppointmentListQuery struct {
	Status string `form:"status"`
	From   string `form:"from"` // RFC3339; filters scheduled_at >= From
	To     string `form:"to"`   // RFC3339; filters scheduled_at <  To
	Limit  int    `form:"limit,default=20"`
	Offset int    `form:"offset,default=0"`
}

// AdminVerifyDoctorRequest is the body for POST /telemedicine/admin/doctors/:userId/verify.
type AdminVerifyDoctorRequest struct {
	Decision string `json:"decision" binding:"required,oneof=approved rejected"`
	Reason   string `json:"reason"`
}
