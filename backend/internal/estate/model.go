package estate

import "time"

// Estate is a gated community or building complex.
type Estate struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Address   string    `json:"address,omitempty"`
	AdminID   string    `json:"admin_id"`
	CreatedAt time.Time `json:"created_at"`
}

// Resident is a verified occupant of an estate.
type Resident struct {
	ID        string    `json:"id"`
	EstateID  string    `json:"estate_id"`
	UserID    string    `json:"user_id"`
	Unit      string    `json:"unit"` // e.g. "Block A, Flat 3"
	Role      string    `json:"role"` // resident | estate_admin
	CreatedAt time.Time `json:"created_at"`
}

// VisitorPass is a one-time or time-bounded entry permit issued by a resident.
type VisitorPass struct {
	ID         string     `json:"id"`
	EstateID   string     `json:"estate_id"`
	IssuedBy   string     `json:"issued_by"`
	VisitorName string    `json:"visitor_name"`
	Purpose    string     `json:"purpose,omitempty"`
	QRCode     string     `json:"qr_code"`
	ValidFrom  time.Time  `json:"valid_from"`
	ValidUntil time.Time  `json:"valid_until"`
	UsedAt     *time.Time `json:"used_at,omitempty"`
	Status     string     `json:"status"` // active | used | expired | revoked
	CreatedAt  time.Time  `json:"created_at"`
}

// Election is a private vote within an estate (e.g. AGM, committee election).
type Election struct {
	ID         string    `json:"id"`
	EstateID   string    `json:"estate_id"`
	Title      string    `json:"title"`
	Description string   `json:"description,omitempty"`
	StartsAt   time.Time `json:"starts_at"`
	EndsAt     time.Time `json:"ends_at"`
	Status     string    `json:"status"` // draft | open | closed | tallied
	CreatedBy  string    `json:"created_by"`
	CreatedAt  time.Time `json:"created_at"`
}

// Candidate is a choice in an election.
type Candidate struct {
	ID         string `json:"id"`
	ElectionID string `json:"election_id"`
	Name       string `json:"name"`
	Bio        string `json:"bio,omitempty"`
	Votes      int    `json:"votes,omitempty"` // only populated after close
}

// Vote is a single cast vote — stored as a commitment hash to preserve anonymity.
// VoterID is retained for eligibility checks (one-vote-per-resident enforcement).
type Vote struct {
	ID          string    `json:"id"`
	ElectionID  string    `json:"election_id"`
	VoterID     string    `json:"voter_id"`
	CandidateID string    `json:"candidate_id"`
	CastAt      time.Time `json:"cast_at"`
}

// ── Block 25: Resident profile models ────────────────────────────────────────

// ResidentProfile holds extended personal data for a resident.
type ResidentProfile struct {
	ID               string          `json:"id"`
	ResidentID       string          `json:"resident_id"`
	Bio              string          `json:"bio,omitempty"`
	ProfilePhotoURL  string          `json:"profile_photo_url,omitempty"`
	Phone            string          `json:"phone,omitempty"`
	AltPhone         string          `json:"alt_phone,omitempty"`
	EmergencyContact ContactInfo     `json:"emergency_contact,omitempty"`
	NextOfKin        ContactInfo     `json:"next_of_kin,omitempty"`
	OccupancyType    string          `json:"occupancy_type"` // resident|tenant|homeowner|landlord
	LeaseStart       *string         `json:"lease_start,omitempty"`
	LeaseEnd         *string         `json:"lease_end,omitempty"`
	AgreementURL     string          `json:"agreement_url,omitempty"`
	OwnershipDocURL  string          `json:"ownership_doc_url,omitempty"`
	Visibility       string          `json:"visibility"` // public|members|admin_only
	CreatedAt        time.Time       `json:"created_at"`
	UpdatedAt        time.Time       `json:"updated_at"`
}

// ContactInfo is a reusable embedded contact.
type ContactInfo struct {
	Name         string `json:"name,omitempty"`
	Phone        string `json:"phone,omitempty"`
	Relationship string `json:"relationship,omitempty"`
	Address      string `json:"address,omitempty"`
}

// HouseholdMember is a family member registered under a resident.
type HouseholdMember struct {
	ID           string    `json:"id"`
	ResidentID   string    `json:"resident_id"`
	FullName     string    `json:"full_name"`
	Relationship string    `json:"relationship"`
	DOB          *string   `json:"dob,omitempty"`
	IDType       string    `json:"id_type,omitempty"`
	IDNumber     string    `json:"id_number,omitempty"`
	PhotoURL     string    `json:"photo_url,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
}

// DomesticStaff is a worker registered under a resident (cook, cleaner, etc.).
type DomesticStaff struct {
	ID         string    `json:"id"`
	ResidentID string    `json:"resident_id"`
	FullName   string    `json:"full_name"`
	Role       string    `json:"role"`
	PhotoURL   string    `json:"photo_url,omitempty"`
	IDType     string    `json:"id_type,omitempty"`
	IDNumber   string    `json:"id_number,omitempty"`
	Phone      string    `json:"phone,omitempty"`
	Status     string    `json:"status"` // active|suspended|terminated
	CreatedAt  time.Time `json:"created_at"`
}

// ResidentVehicle is a car registered to a resident.
type ResidentVehicle struct {
	ID         string     `json:"id"`
	ResidentID string     `json:"resident_id"`
	Plate      string     `json:"plate"`
	Make       string     `json:"make,omitempty"`
	Model      string     `json:"model,omitempty"`
	Color      string     `json:"color,omitempty"`
	DocURL     string     `json:"doc_url,omitempty"`
	Verified   bool       `json:"verified"`
	VerifiedBy *string    `json:"verified_by,omitempty"`
	VerifiedAt *time.Time `json:"verified_at,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
}

// UpsertProfileRequest is the body for PUT /estate/:id/profile.
type UpsertProfileRequest struct {
	Bio              string      `json:"bio"`
	ProfilePhotoURL  string      `json:"profile_photo_url"`
	Phone            string      `json:"phone"`
	AltPhone         string      `json:"alt_phone"`
	EmergencyContact ContactInfo `json:"emergency_contact"`
	NextOfKin        ContactInfo `json:"next_of_kin"`
	OccupancyType    string      `json:"occupancy_type"`
	LeaseStart       *string     `json:"lease_start"`
	LeaseEnd         *string     `json:"lease_end"`
	AgreementURL     string      `json:"agreement_url"`
	OwnershipDocURL  string      `json:"ownership_doc_url"`
	Visibility       string      `json:"visibility"`
}

// AddHouseholdMemberRequest is the body for POST /estate/:id/profile/household.
type AddHouseholdMemberRequest struct {
	FullName     string `json:"full_name" binding:"required,min=2,max=200"`
	Relationship string `json:"relationship" binding:"required"`
	DOB          string `json:"dob"`
	IDType       string `json:"id_type"`
	IDNumber     string `json:"id_number"`
	PhotoURL     string `json:"photo_url"`
}

// AddDomesticStaffRequest is the body for POST /estate/:id/profile/staff.
type AddDomesticStaffRequest struct {
	FullName string `json:"full_name" binding:"required,min=2,max=200"`
	Role     string `json:"role" binding:"required"`
	PhotoURL string `json:"photo_url"`
	IDType   string `json:"id_type"`
	IDNumber string `json:"id_number"`
	Phone    string `json:"phone"`
}

// AddVehicleRequest is the body for POST /estate/:id/profile/vehicles.
type AddVehicleRequest struct {
	Plate  string `json:"plate" binding:"required,min=3,max=20"`
	Make   string `json:"make"`
	Model  string `json:"model"`
	Color  string `json:"color"`
	DocURL string `json:"doc_url"`
}

// ── Block 28: Security gate / guard app ───────────────────────────────────────

// Gate is a physical entry point in an estate.
type Gate struct {
	ID        string    `json:"id"`
	EstateID  string    `json:"estate_id"`
	Name      string    `json:"name"`
	GateType  string    `json:"gate_type"` // pedestrian | vehicle | service
	Active    bool      `json:"active"`
	CreatedAt time.Time `json:"created_at"`
}

// GuardShift is an active or completed security shift at a gate.
type GuardShift struct {
	ID             string     `json:"id"`
	GuardID        string     `json:"guard_id"`
	GateID         string     `json:"gate_id"`
	EstateID       string     `json:"estate_id"`
	StartedAt      time.Time  `json:"started_at"`
	EndedAt        *time.Time `json:"ended_at,omitempty"`
	HandoverNotes  string     `json:"handover_notes,omitempty"`
	RelievedBy     *string    `json:"relieved_by,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
}

// IncidentReport is a gate security incident submitted by a guard.
type IncidentReport struct {
	ID           string    `json:"id"`
	EstateID     string    `json:"estate_id"`
	GuardID      string    `json:"guard_id"`
	GateID       string    `json:"gate_id,omitempty"`
	IncidentType string    `json:"incident_type"`
	Description  string    `json:"description"`
	EvidenceURL  string    `json:"evidence_url,omitempty"`
	Escalated    bool      `json:"escalated"`
	CreatedAt    time.Time `json:"created_at"`
}

// CheckinPayload is the result of a guard's code scan or lookup.
type CheckinPayload struct {
	Code         *AccessCode `json:"code"`
	ResidentUnit string      `json:"resident_unit,omitempty"`
	Blacklisted  bool        `json:"blacklisted"`
	Allowed      bool        `json:"allowed"`
	CheckinID    string      `json:"checkin_id,omitempty"`
}

// OfflineLogEntry is one event buffered while the guard was offline.
type OfflineLogEntry struct {
	ClientID   string `json:"client_id"`
	EventType  string `json:"event_type"` // checkin|checkout|incident|vehicle
	Payload    any    `json:"payload"`
	CapturedAt string `json:"captured_at"`
}

// GuardCheckinRequest is the body for POST /guard/checkin.
type GuardCheckinRequest struct {
	NumericCode  string `json:"numeric_code"`
	QRCode       string `json:"qr_code"`
	GateID       string `json:"gate_id"`
	VehiclePlate string `json:"vehicle_plate"`
	PhotoURL     string `json:"photo_url"`
}

// SubmitIncidentRequest is the body for POST /guard/incident.
type SubmitIncidentRequest struct {
	GateID       string `json:"gate_id"`
	IncidentType string `json:"incident_type" binding:"required"`
	Description  string `json:"description" binding:"required,min=10"`
	EvidenceURL  string `json:"evidence_url"`
	Escalated    bool   `json:"escalated"`
}

// HandoverRequest is the body for POST /guard/shift-handover.
type HandoverRequest struct {
	GateID        string `json:"gate_id" binding:"required"`
	HandoverNotes string `json:"handover_notes"`
	RelievedBy    string `json:"relieved_by"`
}

// SyncRequest is the body for POST /guard/sync.
type SyncRequest struct {
	Logs []OfflineLogEntry `json:"logs" binding:"required"`
}

// ── Block 27: Extended visitor access codes ───────────────────────────────────

// AccessCode is a typed entry permit with numeric + QR code.
type AccessCode struct {
	ID           string     `json:"id"`
	EstateID     string     `json:"estate_id"`
	IssuedBy     string     `json:"issued_by"`
	VisitorName  string     `json:"visitor_name"`
	VisitorPhone string     `json:"visitor_phone,omitempty"`
	VehiclePlate string     `json:"vehicle_plate,omitempty"`
	Purpose      string     `json:"purpose,omitempty"`
	CodeType     string     `json:"code_type"`
	NumericCode  string     `json:"numeric_code"`
	QRCode       string     `json:"qr_code"`
	ValidFrom    time.Time  `json:"valid_from"`
	ValidUntil   time.Time  `json:"valid_until"`
	Recurrence   *string    `json:"recurrence,omitempty"` // raw JSONB
	UsedCount    int        `json:"used_count"`
	MaxUses      int        `json:"max_uses"`
	Status       string     `json:"status"`
	Blacklisted  bool       `json:"blacklisted"`
	CreatedAt    time.Time  `json:"created_at"`
}

// Checkin is a gate arrival or checkout event for a visitor.
type Checkin struct {
	ID         string     `json:"id"`
	CodeID     string     `json:"code_id"`
	GuardID    *string    `json:"guard_id,omitempty"`
	GateID     string     `json:"gate_id,omitempty"`
	Event      string     `json:"event"` // arrived | checked_out
	CapturedAt time.Time  `json:"captured_at"`
	PhotoURL   string     `json:"photo_url,omitempty"`
}

// CreateAccessCodeRequest is the body for POST /estate/:id/access-codes.
type CreateAccessCodeRequest struct {
	VisitorName  string    `json:"visitor_name" binding:"required,min=2,max=200"`
	VisitorPhone string    `json:"visitor_phone"`
	VehiclePlate string    `json:"vehicle_plate"`
	Purpose      string    `json:"purpose"`
	CodeType     string    `json:"code_type" binding:"required"`
	ValidFrom    time.Time `json:"valid_from" binding:"required"`
	ValidUntil   time.Time `json:"valid_until" binding:"required"`
	MaxUses      int       `json:"max_uses"`
	Recurrence   *string   `json:"recurrence"` // raw JSON string
}

// ExtendCodeRequest is the body for POST /estate/:id/access-codes/:cid/extend.
type ExtendCodeRequest struct {
	ValidUntil time.Time `json:"valid_until" binding:"required"`
}

// ── Block 26: Dashboard ───────────────────────────────────────────────────────

// DashboardPayment is a pending dues/payment summary.
type DashboardPayment struct {
	AmountKobo int64  `json:"amount_kobo"`
	DueDate    string `json:"due_date,omitempty"`
	Label      string `json:"label,omitempty"`
}

// DashboardMeeting is a brief upcoming meeting record.
type DashboardMeeting struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	StartsAt string `json:"starts_at"`
	Location string `json:"location,omitempty"`
}

// DashboardAnnouncement is the latest community notice.
type DashboardAnnouncement struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Body      string `json:"body,omitempty"`
	CreatedAt string `json:"created_at"`
}

// DashboardSecurityAlert is a recent security event.
type DashboardSecurityAlert struct {
	ID          string `json:"id"`
	Description string `json:"description"`
	Severity    string `json:"severity"` // low | medium | high | critical
	CreatedAt   string `json:"created_at"`
}

// EstateDashboard is the aggregated resident home payload.
type EstateDashboard struct {
	EstateID           string                   `json:"estate_id"`
	EstateName         string                   `json:"estate_name"`
	ResidentUnit       string                   `json:"resident_unit,omitempty"`
	ActiveVisitorCodes int                      `json:"active_visitor_codes"`
	OpenElections      int                      `json:"open_elections"`
	OpenRepairs        int                      `json:"open_repairs"`
	PendingPayment     *DashboardPayment        `json:"pending_payment,omitempty"`
	UpcomingMeetings   []DashboardMeeting       `json:"upcoming_meetings"`
	Announcements      []DashboardAnnouncement  `json:"announcements"`
	SecurityAlerts     []DashboardSecurityAlert `json:"security_alerts"`
	PropertyStatus     string                   `json:"property_status,omitempty"` // vacant | occupied | reserved
	VehicleCount       int                      `json:"vehicle_count"`
	HouseholdCount     int                      `json:"household_count"`
}

// InviteCode is a shareable code to join an estate.
type InviteCode struct {
	ID        string    `json:"id"`
	EstateID  string    `json:"estate_id"`
	CreatedBy string    `json:"created_by"`
	Code      string    `json:"code"`
	MaxUses   int       `json:"max_uses"`
	UsedCount int       `json:"used_count"`
	ExpiresAt time.Time `json:"expires_at"`
	CreatedAt time.Time `json:"created_at"`
}

// JoinRequest is a pending membership application to an estate.
type JoinRequest struct {
	ID         string     `json:"id"`
	EstateID   string     `json:"estate_id"`
	UserID     string     `json:"user_id"`
	Message    string     `json:"message,omitempty"`
	Status     string     `json:"status"` // pending | approved | rejected
	ReviewedBy *string    `json:"reviewed_by,omitempty"`
	ReviewedAt *time.Time `json:"reviewed_at,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
}

// EstateProperty is a residential or commercial unit within an estate.
type EstateProperty struct {
	ID              string    `json:"id"`
	EstateID        string    `json:"estate_id"`
	UnitLabel       string    `json:"unit_label"`
	PropertyType    string    `json:"property_type"` // apartment | house | commercial | land | other
	Floor           string    `json:"floor,omitempty"`
	Block           string    `json:"block,omitempty"`
	OccupancyStatus string    `json:"occupancy_status"` // vacant | occupied | reserved
	LandlordID      *string   `json:"landlord_id,omitempty"`
	TenantID        *string   `json:"tenant_id,omitempty"`
	CreatedAt       time.Time `json:"created_at"`
}

// OwnershipClaim is a resident's application to prove they own a property.
type OwnershipClaim struct {
	ID              string     `json:"id"`
	PropertyID      string     `json:"property_id"`
	UserID          string     `json:"user_id"`
	OwnershipDocURL string     `json:"ownership_doc_url"`
	Status          string     `json:"status"` // pending | approved | rejected
	VerifiedBy      *string    `json:"verified_by,omitempty"`
	VerifiedAt      *time.Time `json:"verified_at,omitempty"`
	RejectReason    string     `json:"reject_reason,omitempty"`
	CreatedAt       time.Time  `json:"created_at"`
}

// TenancyRequest is a tenant's application to occupy a property.
type TenancyRequest struct {
	ID           string     `json:"id"`
	PropertyID   string     `json:"property_id"`
	TenantID     string     `json:"tenant_id"`
	LandlordID   string     `json:"landlord_id"`
	LeaseStart   string     `json:"lease_start"` // DATE as YYYY-MM-DD
	LeaseEnd     string     `json:"lease_end,omitempty"`
	AgreementURL string     `json:"agreement_url,omitempty"`
	Status       string     `json:"status"` // pending | approved | rejected | cancelled
	ReviewedAt   *time.Time `json:"reviewed_at,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
}

// GenerateInviteCodeRequest is the body for POST /estate/:id/invite-codes.
type GenerateInviteCodeRequest struct {
	MaxUses   int       `json:"max_uses" binding:"required,min=1,max=500"`
	ExpiresAt time.Time `json:"expires_at" binding:"required"`
}

// JoinWithCodeRequest is the body for POST /estate/join/invite.
type JoinWithCodeRequest struct {
	Code string `json:"code" binding:"required"`
}

// RequestAccessRequest is the body for POST /estate/:id/access-request.
type RequestAccessRequest struct {
	Message string `json:"message"`
}

// AddPropertyRequest is the body for POST /estate/:id/properties.
type AddPropertyRequest struct {
	UnitLabel    string `json:"unit_label" binding:"required,min=1,max=100"`
	PropertyType string `json:"property_type" binding:"required"`
	Floor        string `json:"floor"`
	Block        string `json:"block"`
}

// ClaimOwnershipRequest is the body for POST /estate/:id/properties/:pid/claim.
type ClaimOwnershipRequest struct {
	OwnershipDocURL string `json:"ownership_doc_url" binding:"required,url"`
}

// TenancyRequestBody is the body for POST /estate/:id/properties/:pid/tenancy.
type TenancyRequestBody struct {
	LandlordID   string `json:"landlord_id" binding:"required"`
	LeaseStart   string `json:"lease_start" binding:"required"`
	LeaseEnd     string `json:"lease_end"`
	AgreementURL string `json:"agreement_url"`
}

// CreateEstateRequest is the body for POST /estate.
type CreateEstateRequest struct {
	Name    string `json:"name" binding:"required,min=2,max=200"`
	Address string `json:"address"`
}

// IssuePassRequest is the body for POST /estate/:id/passes.
type IssuePassRequest struct {
	VisitorName string    `json:"visitor_name" binding:"required"`
	Purpose     string    `json:"purpose"`
	ValidFrom   time.Time `json:"valid_from" binding:"required"`
	ValidUntil  time.Time `json:"valid_until" binding:"required"`
}

// CreateElectionRequest is the body for POST /estate/:id/elections.
type CreateElectionRequest struct {
	Title       string      `json:"title" binding:"required,min=2,max=200"`
	Description string      `json:"description"`
	StartsAt    time.Time   `json:"starts_at" binding:"required"`
	EndsAt      time.Time   `json:"ends_at" binding:"required"`
	Candidates  []Candidate `json:"candidates" binding:"required,min=2"`
}

// CastVoteRequest is the body for POST /estate/:id/elections/:electionId/vote.
type CastVoteRequest struct {
	CandidateID string `json:"candidate_id" binding:"required"`
}
