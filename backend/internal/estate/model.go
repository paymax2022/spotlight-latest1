package estate

import "time"

// Estate is a gated community or building complex. The profile columns (timezone) and
// duplicate_suspected come from the M02 governance work; both default to the platform's historical
// implicit behaviour, so an estate created before it reads unchanged.
type Estate struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Address   string    `json:"address,omitempty"`
	AdminID   string    `json:"admin_id"`
	Status    string    `json:"status,omitempty"`
	CreatedAt time.Time `json:"created_at"`

	Timezone           string `json:"timezone,omitempty"`
	DuplicateSuspected bool   `json:"duplicate_suspected,omitempty"`
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
	ID          string     `json:"id"`
	EstateID    string     `json:"estate_id"`
	IssuedBy    string     `json:"issued_by"`
	VisitorName string     `json:"visitor_name"`
	Purpose     string     `json:"purpose,omitempty"`
	QRCode      string     `json:"qr_code"`
	ValidFrom   time.Time  `json:"valid_from"`
	ValidUntil  time.Time  `json:"valid_until"`
	UsedAt      *time.Time `json:"used_at,omitempty"`
	Status      string     `json:"status"` // active | used | expired | revoked
	CreatedAt   time.Time  `json:"created_at"`
}

// Election is a private vote within an estate (e.g. AGM, committee election).
// The governance columns (kind/weighting/quorum/tie_break/…) are what turn a ballot into
// an electable result; they default to the historical single-position, one-person-one-vote
// behaviour, so an election created before Phase 2.2 reads exactly as it did.
type Election struct {
	ID          string    `json:"id"`
	EstateID    string    `json:"estate_id"`
	Title       string    `json:"title"`
	Description string    `json:"description,omitempty"`
	StartsAt    time.Time `json:"starts_at"`
	EndsAt      time.Time `json:"ends_at"`
	Status      string    `json:"status"` // draft | open | closed | tallied | cancelled
	CreatedBy   string    `json:"created_by"`
	CreatedAt   time.Time `json:"created_at"`

	Kind        string `json:"kind"` // binding | poll
	Weighting   string `json:"weighting"`
	QuorumType  string `json:"quorum_type"`
	QuorumValue int    `json:"quorum_value"`
	TieBreak    string `json:"tie_break"`

	NominationOpensAt  *time.Time `json:"nomination_opens_at,omitempty"`
	NominationClosesAt *time.Time `json:"nomination_closes_at,omitempty"`
	RollFrozenAt       *time.Time `json:"roll_frozen_at,omitempty"`
	RulesLockedAt      *time.Time `json:"rules_locked_at,omitempty"`
	CancelledAt        *time.Time `json:"cancelled_at,omitempty"`
	CancellationReason string     `json:"cancellation_reason,omitempty"`
}

// Candidate is a choice in an election.
type Candidate struct {
	ID         string `json:"id"`
	ElectionID string `json:"election_id"`
	Name       string `json:"name"`
	Bio        string `json:"bio,omitempty"`
	Votes      int    `json:"votes,omitempty"` // only populated after close
}

// Vote is the receipt for one cast ballot. ID is the anonymous election_ballots row;
// VoterID exists only to echo the caller's own submission back to them — the stored
// choice (election_ballots) carries no voter column, and the participation registry
// (election_votes) carries no choice.
type Vote struct {
	ID          string    `json:"id"`
	ElectionID  string    `json:"election_id"`
	VoterID     string    `json:"voter_id"`
	CandidateID string    `json:"candidate_id"`
	UnitID      string    `json:"unit_id,omitempty"` // the unit that authorised a weighted ballot
	Abstained   bool      `json:"abstained"`
	CastAt      time.Time `json:"cast_at"`
}

// ResidentProfile holds extended personal data for a resident.
type ResidentProfile struct {
	ID               string      `json:"id"`
	ResidentID       string      `json:"resident_id"`
	Bio              string      `json:"bio,omitempty"`
	ProfilePhotoURL  string      `json:"profile_photo_url,omitempty"`
	Phone            string      `json:"phone,omitempty"`
	AltPhone         string      `json:"alt_phone,omitempty"`
	EmergencyContact ContactInfo `json:"emergency_contact,omitempty"`
	NextOfKin        ContactInfo `json:"next_of_kin,omitempty"`
	OccupancyType    string      `json:"occupancy_type"` // resident|tenant|homeowner|landlord
	// ProofStatus is the estate's verdict on the declared documents, read at member level so the person
	// who filed them can see where they stand (EST-UAT-0051). Replacing a document resets it in the
	// database; nothing in Go can set it.
	ProofStatus     string    `json:"proof_status"`
	LeaseStart      *string   `json:"lease_start,omitempty"`
	LeaseEnd        *string   `json:"lease_end,omitempty"`
	AgreementURL    string    `json:"agreement_url,omitempty"`
	OwnershipDocURL string    `json:"ownership_doc_url,omitempty"`
	Visibility      string    `json:"visibility"` // public|members|admin_only
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
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

// Gate — Block 28: Security gate / guard app
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
	ID            string     `json:"id"`
	GuardID       string     `json:"guard_id"`
	GateID        string     `json:"gate_id"`
	EstateID      string     `json:"estate_id"`
	StartedAt     time.Time  `json:"started_at"`
	EndedAt       *time.Time `json:"ended_at,omitempty"`
	HandoverNotes string     `json:"handover_notes,omitempty"`
	RelievedBy    *string    `json:"relieved_by,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
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

// AccessCode is a typed entry permit with numeric + QR code.
type AccessCode struct {
	ID           string    `json:"id"`
	EstateID     string    `json:"estate_id"`
	IssuedBy     string    `json:"issued_by"`
	VisitorName  string    `json:"visitor_name"`
	VisitorPhone string    `json:"visitor_phone,omitempty"`
	VehiclePlate string    `json:"vehicle_plate,omitempty"`
	Purpose      string    `json:"purpose,omitempty"`
	CodeType     string    `json:"code_type"`
	NumericCode  string    `json:"numeric_code"`
	QRCode       string    `json:"qr_code"`
	ValidFrom    time.Time `json:"valid_from"`
	ValidUntil   time.Time `json:"valid_until"`
	Recurrence   *string   `json:"recurrence,omitempty"` // raw JSONB
	UsedCount    int       `json:"used_count"`
	MaxUses      int       `json:"max_uses"`
	Status       string    `json:"status"`
	Blacklisted  bool      `json:"blacklisted"`
	// RequireHostApproval, when true, makes a guard admit contingent on an
	// approved visitor_arrival_request from the issuing host.
	RequireHostApproval bool      `json:"require_host_approval"`
	GateID              string    `json:"gate_id,omitempty"` // optional gate binding
	CreatedAt           time.Time `json:"created_at"`
}

// StaffGrant is an expiring, revocable delegated officer capability scoped to one
// estate (see estate_staff_grants). It is distinct from the estate_residents super
// role and never carries estate_admin.
type StaffGrant struct {
	ID        string     `json:"id"`
	EstateID  string     `json:"estate_id"`
	UserID    string     `json:"user_id"`
	Role      string     `json:"role"`
	GrantedBy string     `json:"granted_by"`
	GrantedAt time.Time  `json:"granted_at"`
	ExpiresAt *time.Time `json:"expires_at,omitempty"`
	RevokedAt *time.Time `json:"revoked_at,omitempty"`
}

// GrantRoleRequest is the body for POST /estate/:id/staff-grants.
type GrantRoleRequest struct {
	UserID    string `json:"user_id" binding:"required"`
	Role      string `json:"role" binding:"required"`
	ExpiresAt string `json:"expires_at"` // RFC3339; empty = no expiry
}

// DecideArrivalRequest is the body for POST .../arrival-requests/:rid/decision.
type DecideArrivalRequest struct {
	Approve bool `json:"approve"`
}

// Checkin is a gate arrival or checkout event for a visitor.
type Checkin struct {
	ID         string    `json:"id"`
	CodeID     string    `json:"code_id"`
	GuardID    *string   `json:"guard_id,omitempty"`
	GateID     string    `json:"gate_id,omitempty"`
	Event      string    `json:"event"` // arrived | checked_out
	CapturedAt time.Time `json:"captured_at"`
	PhotoURL   string    `json:"photo_url,omitempty"`
}

// CreateAccessCodeRequest is the body for POST /estate/:id/access-codes.
type CreateAccessCodeRequest struct {
	VisitorName         string    `json:"visitor_name" binding:"required,min=2,max=200"`
	VisitorPhone        string    `json:"visitor_phone"`
	VehiclePlate        string    `json:"vehicle_plate"`
	Purpose             string    `json:"purpose"`
	CodeType            string    `json:"code_type" binding:"required"`
	ValidFrom           time.Time `json:"valid_from" binding:"required"`
	ValidUntil          time.Time `json:"valid_until" binding:"required"`
	MaxUses             int       `json:"max_uses"`
	Recurrence          *string   `json:"recurrence"` // raw JSON string
	RequireHostApproval bool      `json:"require_host_approval"`
	GateID              string    `json:"gate_id"` // optional gate binding
}

// ExtendCodeRequest is the body for POST /estate/:id/access-codes/:cid/extend.
type ExtendCodeRequest struct {
	ValidUntil time.Time `json:"valid_until" binding:"required"`
}

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

// Estate membership roles. These are the only two values estate_residents.role accepts, so they are
// also the only two an invite code may grant.
const (
	RoleResident    = "resident"
	RoleEstateAdmin = "estate_admin"
)

// InviteCode is a shareable code to join an estate.
type InviteCode struct {
	ID        string    `json:"id"`
	EstateID  string    `json:"estate_id"`
	CreatedBy string    `json:"created_by"`
	Code      string    `json:"code"`
	Role      string    `json:"role"`
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
	Capacity        int       `json:"capacity"`
	LandlordID      *string   `json:"landlord_id,omitempty"`
	TenantID        *string   `json:"tenant_id,omitempty"`
	Archived        bool      `json:"archived"`
	CreatedAt       time.Time `json:"created_at"`
}

// UpdatePropertyRequest is the body for PATCH /estate/:id/properties/:pid.
// Only non-nil fields are applied (partial update).
type UpdatePropertyRequest struct {
	UnitLabel    *string `json:"unit_label"`
	PropertyType *string `json:"property_type"`
	Floor        *string `json:"floor"`
	Block        *string `json:"block"`
}

// PropertyAnalytics is the per-property summary returned by the analytics route.
type PropertyAnalytics struct {
	PropertyID       string `json:"property_id"`
	OccupancyStatus  string `json:"occupancy_status"`
	OpenRepairs      int    `json:"open_repairs"`
	TotalRepairs     int    `json:"total_repairs"`
	InvoicedKobo     int64  `json:"invoiced_kobo"`
	CollectedKobo    int64  `json:"collected_kobo"`
	OutstandingKobo  int64  `json:"outstanding_kobo"`
	OpenTransferReqs int    `json:"open_transfer_requests"`
}

// PropertyTransferRequest is a request to change a property's owner/tenant.
type PropertyTransferRequest struct {
	ID           string     `json:"id"`
	EstateID     string     `json:"estate_id"`
	PropertyID   string     `json:"property_id"`
	RequestedBy  string     `json:"requested_by"`
	ToUserID     string     `json:"to_user_id"`
	TransferType string     `json:"transfer_type"` // ownership | tenancy
	Reason       string     `json:"reason,omitempty"`
	Status       string     `json:"status"` // pending | approved | rejected
	ReviewedBy   *string    `json:"reviewed_by,omitempty"`
	ReviewedAt   *time.Time `json:"reviewed_at,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
}

// RequestPropertyTransferBody is the body for POST .../properties/:pid/transfer-request.
type RequestPropertyTransferBody struct {
	ToUserID     string `json:"to_user_id" binding:"required"`
	TransferType string `json:"transfer_type" binding:"required"` // ownership | tenancy
	Reason       string `json:"reason"`
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
// ReviewedBy/RejectReason are what EST-UAT-0051 asked for on this lane: a review that could set a
// status but could not say who set it or why it was refused.
type TenancyRequest struct {
	ID           string     `json:"id"`
	PropertyID   string     `json:"property_id"`
	TenantID     string     `json:"tenant_id"`
	LandlordID   string     `json:"landlord_id"`
	LeaseStart   string     `json:"lease_start"` // DATE as YYYY-MM-DD
	LeaseEnd     string     `json:"lease_end,omitempty"`
	AgreementURL string     `json:"agreement_url,omitempty"`
	Status       string     `json:"status"` // pending | approved | rejected | cancelled
	ReviewedBy   *string    `json:"reviewed_by,omitempty"`
	ReviewedAt   *time.Time `json:"reviewed_at,omitempty"`
	RejectReason string     `json:"reject_reason,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
}

// GenerateInviteCodeRequest is the body for POST /estate/:id/invite-codes. Role is optional and
// defaults to a plain resident; "estate_admin" mints a manager code (EST-UAT-0028), which is why
// only an estate admin may create one.
type GenerateInviteCodeRequest struct {
	MaxUses   int       `json:"max_uses" binding:"required,min=1,max=500"`
	ExpiresAt time.Time `json:"expires_at" binding:"required"`
	Role      string    `json:"role" binding:"omitempty,oneof=resident estate_admin"`
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
// Capacity is optional: 0 means the platform default, and the DB CHECK (>0) plus the
// capacity trigger are what actually bound admissions (EST-UAT-0044).
type AddPropertyRequest struct {
	UnitLabel    string `json:"unit_label" binding:"required,min=1,max=100"`
	PropertyType string `json:"property_type" binding:"required"`
	Floor        string `json:"floor"`
	Block        string `json:"block"`
	Capacity     int    `json:"capacity"`
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

// CreateEstateRequest is the body for POST /estate. Timezone is optional and defaults to the
// platform zone; an unknown zone name is refused rather than stored.
type CreateEstateRequest struct {
	Name     string `json:"name" binding:"required,min=2,max=200"`
	Address  string `json:"address"`
	Timezone string `json:"timezone"`
}

// IssuePassRequest is the body for POST /estate/:id/passes.
type IssuePassRequest struct {
	VisitorName string    `json:"visitor_name" binding:"required"`
	Purpose     string    `json:"purpose"`
	ValidFrom   time.Time `json:"valid_from" binding:"required"`
	ValidUntil  time.Time `json:"valid_until" binding:"required"`
}

// CreateElectionRequest is the body for POST /estate/:id/elections.
// Candidates may be supplied up front, or left to the nomination workflow (0209/0211):
// an election with no inline candidates must open a nomination window, and OpenElection
// refuses to open a ballot with fewer than two names on it either way.
type CreateElectionRequest struct {
	Title       string      `json:"title" binding:"required,min=2,max=200"`
	Description string      `json:"description"`
	StartsAt    time.Time   `json:"starts_at" binding:"required"`
	EndsAt      time.Time   `json:"ends_at" binding:"required"`
	Candidates  []Candidate `json:"candidates"`

	Kind               string     `json:"kind"`
	Weighting          string     `json:"weighting"`
	QuorumType         string     `json:"quorum_type"`
	QuorumValue        int        `json:"quorum_value"`
	TieBreak           string     `json:"tie_break"`
	NominationOpensAt  *time.Time `json:"nomination_opens_at"`
	NominationClosesAt *time.Time `json:"nomination_closes_at"`
}

// CastVoteRequest is the body for POST /estate/:id/elections/:electionId/vote.
// An empty candidate_id is an abstention — a blank ballot that counts in turnout and
// credits no candidate (EST-UAT-0221). UnitID authorises one ballot per held unit in a
// one_vote_per_unit election (EST-UAT-0205).
type CastVoteRequest struct {
	CandidateID string `json:"candidate_id"`
	UnitID      string `json:"unit_id"`
}

// ResidentCard is the payload returned by GET /estate/:id/profile/id-card.
// The QR value encodes "<estate_id>:<resident_id>" for gate scanner verification.
type ResidentCard struct {
	ResidentID    string `json:"resident_id"`
	EstateID      string `json:"estate_id"`
	EstateName    string `json:"estate_name"`
	FullName      string `json:"full_name"`
	Unit          string `json:"unit"`
	Role          string `json:"role"`
	OccupancyType string `json:"occupancy_type"`
	// ProofStatus is what makes the printed occupancy_type more than a self-declaration: the guard
	// reading the card can see whether the estate has checked the document behind it (EST-UAT-0051).
	ProofStatus     string `json:"proof_status"`
	ProfilePhotoURL string `json:"profile_photo_url,omitempty"`
	QRValue         string `json:"qr_value"` // "<estate_id>:<resident_id>"
	IssuedAt        string `json:"issued_at"`
}
