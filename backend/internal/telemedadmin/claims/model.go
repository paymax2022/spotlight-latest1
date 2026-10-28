// Package claims is the telemedicine admin console's oversight surface for the
// doctor module's HMO claims, pre-authorisations, fraud warnings and clinical
// referrals. It is read-mostly: the only writes are an admin review note on a
// claim and acknowledging a fraud warning, each audited in the same transaction.
// It never moves money — claims settle out-of-band with the HMO.
package claims

import "time"

// HmoClaim is one claim row, patient identity masked, free-form detail withheld.
type HmoClaim struct {
	ID            string    `json:"id"`
	Ref           *string   `json:"ref"`
	DoctorID      *string   `json:"doctor_id"`
	DoctorUserID  string    `json:"doctor_user_id"`
	DoctorName    string    `json:"doctor_name"`
	PatientMasked string    `json:"patient_masked"`
	AppointmentID *string   `json:"appointment_id"`
	Status        string    `json:"status"`
	AmountKobo    int64     `json:"amount_kobo"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

// HmoClaimDetail adds the allow-listed detail JSON and the admin audit trail.
type HmoClaimDetail struct {
	HmoClaim
	Detail map[string]any `json:"detail"`
	Audit  []AuditEntry   `json:"audit"`
}

// PreAuth is one pre-authorisation request. The auth code itself is never exposed.
type PreAuth struct {
	ID              string    `json:"id"`
	DoctorUserID    string    `json:"doctor_user_id"`
	DoctorName      string    `json:"doctor_name"`
	PatientMasked   string    `json:"patient_masked"`
	AppointmentID   *string   `json:"appointment_id"`
	Status          string    `json:"status"`
	AuthCodePresent bool      `json:"auth_code_present"`
	AmountKobo      int64     `json:"amount_kobo"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

// PreAuthDetail adds the allow-listed detail JSON.
type PreAuthDetail struct {
	PreAuth
	Detail map[string]any `json:"detail"`
}

// FraudWarning is one HMO fraud warning raised against a doctor's account.
type FraudWarning struct {
	ID             string     `json:"id"`
	DoctorUserID   string     `json:"doctor_user_id"`
	DoctorName     string     `json:"doctor_name"`
	Severity       string     `json:"severity"`
	Acknowledged   bool       `json:"acknowledged"`
	AcknowledgedAt *time.Time `json:"acknowledged_at"`
	Summary        string     `json:"summary"`
	CreatedAt      time.Time  `json:"created_at"`
}

// Referral covers the three referral-like tables behind one shape.
type Referral struct {
	ID            string    `json:"id"`
	Kind          string    `json:"kind"`
	DoctorUserID  string    `json:"doctor_user_id"`
	DoctorName    string    `json:"doctor_name"`
	Counterpart   string    `json:"counterpart"`
	PatientMasked string    `json:"patient_masked"`
	Status        string    `json:"status"`
	Reason        string    `json:"reason"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

// ReferralDetail adds the allow-listed detail JSON.
type ReferralDetail struct {
	Referral
	Detail map[string]any `json:"detail"`
}

// AuditEntry is one admin action recorded in doctor_compliance_audit.
type AuditEntry struct {
	ID        string    `json:"id"`
	Action    string    `json:"action"`
	ActorID   string    `json:"actor_id"`
	Note      string    `json:"note"`
	CreatedAt time.Time `json:"created_at"`
}

// ClaimsSummary is the KPI strip for the claims console.
type ClaimsSummary struct {
	ClaimsTotal           int            `json:"claims_total"`
	ClaimsByStatus        map[string]int `json:"claims_by_status"`
	ClaimsAmountKobo      int64          `json:"claims_amount_kobo"`
	PreauthTotal          int            `json:"preauth_total"`
	PreauthByStatus       map[string]int `json:"preauth_by_status"`
	FraudWarningsOpen     int            `json:"fraud_warnings_open"`
	FraudWarningsHighOpen int            `json:"fraud_warnings_high_open"`
}

// ReferralsSummary is the KPI strip for the referrals console.
type ReferralsSummary struct {
	OutgoingTotal    int            `json:"outgoing_total"`
	OutgoingByStatus map[string]int `json:"outgoing_by_status"`
	IncomingTotal    int            `json:"incoming_total"`
	IncomingByStatus map[string]int `json:"incoming_by_status"`
	OpinionsTotal    int            `json:"opinions_total"`
	OpinionsByStatus map[string]int `json:"opinions_by_status"`
}

// ListQuery is the validated filter + page for list endpoints.
type ListQuery struct {
	Status string
	Q      string
	Limit  int
	Offset int
}
