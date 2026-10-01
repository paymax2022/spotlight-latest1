// Package association implements the money-path + core reads for the Group /
// Association membership module. It mirrors the internal/groups pattern: a pgx
// pool for the financial path plus the shared ledger service for double-entry
// posting. Schema: supabase/migrations/20260628000000_association_module.sql
// (assoc_* tables). API contract: contracts/associations.openapi.yaml.
// IRON RULES honoured here:
//   - All amounts are integers in minor units (kobo).
//   - Every money mutation requires an Idempotency-Key, posts a balanced
//     double-entry via ledger.Service, and writes an assoc_audit_log event.
//   - Wallet balances are ledger projections — never updated directly.
package association

import "time"

type Invoice struct {
	ID          string  `json:"id"`
	Title       string  `json:"title"`
	Description *string `json:"description"`
	AmountKobo  int64   `json:"amountKobo"`
	Cadence     string  `json:"cadence"`
	Status      string  `json:"status"`
	Scope       string  `json:"scope"`
	// DueDate is nullable in the schema: an ad-hoc or open-ended invoice has no
	// due date. It was a non-pointer time.Time, so the first invoice ever
	// created with a NULL due_date failed the row scan — invisible only because
	// nothing in the repo could create an invoice at all.
	DueDate *time.Time `json:"dueDate"`
}

type DuesSummary struct {
	OutstandingKobo  int64     `json:"outstandingKobo"`
	PaidThisYearKobo int64     `json:"paidThisYearKobo"`
	Standing         string    `json:"standing"`
	Invoices         []Invoice `json:"invoices"`
}

type PayInvoiceRequest struct {
	Method         string `json:"method" binding:"required"` // WALLET | PAYSTACK
	IdempotencyKey string `json:"-"`                         // taken from header, not body
}

type PayInvoiceResult struct {
	ReceiptID string `json:"receiptId"`
	Status    string `json:"status"` // SUCCESS | PENDING | FAILED
}

// RevenueSplitLine is one destination of a dues payment (reporting).
type RevenueSplitLine struct {
	Label      string `json:"label"`
	AmountKobo int64  `json:"amountKobo"`
}

type Receipt struct {
	ID               string             `json:"id"`
	Reference        string             `json:"reference"`
	InvoiceTitle     string             `json:"invoiceTitle"`
	AmountKobo       int64              `json:"amountKobo"`
	Method           string             `json:"method"`
	PaidAt           time.Time          `json:"paidAt"`
	MemberName       string             `json:"memberName"`
	OrganisationName string             `json:"organisationName"`
	Split            []RevenueSplitLine `json:"split"`
}

type ApprovalDecisionRequest struct {
	Decision       string `json:"decision" binding:"required"` // APPROVE | REJECT | REQUEST_INFO
	Note           string `json:"note"`
	IdempotencyKey string `json:"-"`
}

type OrganisationSummary struct {
	ID           string  `json:"id"`
	Name         string  `json:"name"`
	Acronym      *string `json:"acronym"`
	Category     string  `json:"category"`
	LogoURL      *string `json:"logoUrl"`
	CoverURL     *string `json:"coverUrl"`
	GroupType    string  `json:"groupType"`
	MemberCount  int     `json:"memberCount"`
	ChapterCount int     `json:"chapterCount"`
	Verified     bool    `json:"verified"`
	Location     *string `json:"location"`
	Tagline      *string `json:"tagline"`
}

type MembershipCategory struct {
	ID          string  `json:"id"`
	Label       string  `json:"label"`
	Description *string `json:"description"`
	DuesKobo    int64   `json:"duesKobo"`
	DuesCadence string  `json:"duesCadence"`
}

type Chapter struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Level       string  `json:"level"`
	ParentID    *string `json:"parentId"`
	MemberCount int     `json:"memberCount"`
}

// JoinRequirement is one item an applicant must satisfy to join.
type JoinRequirement struct {
	ID       string `json:"id"`
	Label    string `json:"label"`
	Kind     string `json:"kind"`
	Required bool   `json:"required"`
}

// OrgRestrictions are the founder-configured feature gates for members in
// arrears. GraceDays is the number of days past due before they apply.
type OrgRestrictions struct {
	GraceDays     int  `json:"graceDays"`
	DisableVoting bool `json:"disableVoting"`
	DisableEvents bool `json:"disableEvents"`
	DisableChat   bool `json:"disableChat"`
	DisableCard   bool `json:"disableCard"`
}

type Organisation struct {
	OrganisationSummary
	Description          string               `json:"description"`
	FoundedYear          *int                 `json:"foundedYear"`
	RequiresPayment      bool                 `json:"requiresPayment"`
	RegistrationFeeKobo  int64                `json:"registrationFeeKobo"`
	MembershipCategories []MembershipCategory `json:"membershipCategories"`
	Chapters             []Chapter            `json:"chapters"`

	// The client renders all of the following; every one of them was previously
	// absent from this DTO and present only in the mobile mock fixtures, so the
	// join and organisation-detail screens dereferenced undefined and crashed as
	// soon as the module went live.
	ApprovalSummary  string            `json:"approvalSummary"`
	Requirements     []JoinRequirement `json:"requirements"`
	Rules            []string          `json:"rules"`
	Website          *string           `json:"website"`
	Branches         []string          `json:"branches"`
	CommitteeOptions []string          `json:"committeeOptions"`
	Restrictions     OrgRestrictions   `json:"restrictions"`
}

// approvalSummary renders the human-readable join path shown on the
// organisation detail and join screens. Wording matches what the mobile mock
// previously synthesised client-side, so the copy is unchanged for users.
func approvalSummary(approvalRule, groupType string) string {
	switch approvalRule {
	case "AUTO":
		return "Members are active immediately — no review required."
	case "ADMIN":
		return "An admin reviews each application before activation."
	case "CHAPTER_THEN_NATIONAL":
		return "Your chapter admin approves, then national validates."
	case "PAYMENT_FIRST":
		return "Membership activates once the registration fee is confirmed."
	}
	if groupType == "OPEN" {
		return "Open group — anyone can join instantly."
	}
	return "Membership requires admin approval."
}

// VerifyCardRequest is the body of POST /associations/cards/verify.
type VerifyCardRequest struct {
	Token string `json:"token" binding:"required"`
}

// CardVerification is the result of scanning + verifying a membership-card QR.
// Valid is the authoritative verdict; Reason is set only when Valid is false
// (INVALID_SIGNATURE, NOT_FOUND, SUSPENDED, EXPIRED, REVOKED, ARREARS).
type CardVerification struct {
	Valid               bool    `json:"valid"`
	Reason              string  `json:"reason,omitempty"`
	MemberID            string  `json:"memberId,omitempty"`
	FullName            string  `json:"fullName,omitempty"`
	OrganisationName    string  `json:"organisationName,omitempty"`
	OrganisationAcronym *string `json:"organisationAcronym,omitempty"`
	CategoryLabel       string  `json:"categoryLabel,omitempty"`
	Status              string  `json:"status,omitempty"`
	PaymentStanding     string  `json:"paymentStanding,omitempty"`
	ValidThrough        *string `json:"validThrough,omitempty"`
	VerifiedAt          string  `json:"verifiedAt"`
}

type MembershipCard struct {
	MemberID            string  `json:"memberId"`
	FullName            string  `json:"fullName"`
	PhotoURL            *string `json:"photoUrl"`
	OrganisationName    string  `json:"organisationName"`
	OrganisationAcronym *string `json:"organisationAcronym"`
	CategoryLabel       string  `json:"categoryLabel"`
	ChapterName         *string `json:"chapterName"`
	Status              string  `json:"status"`
	PaymentStanding     string  `json:"paymentStanding"`
	Verified            bool    `json:"verified"`
	ValidThrough        *string `json:"validThrough"`
	QRPayload           string  `json:"qrPayload"`
}

type MemberDashboard struct {
	Card                MembershipCard `json:"card"`
	OutstandingKobo     int64          `json:"outstandingKobo"`
	NextDueDate         *string        `json:"nextDueDate"`
	UnreadAnnouncements int            `json:"unreadAnnouncements"`
	OpenTasks           int            `json:"openTasks"`
}

type MyProfile struct {
	FullName      string         `json:"fullName"`
	MemberID      string         `json:"memberId"`
	PhotoURL      *string        `json:"photoUrl"`
	Email         string         `json:"email"`
	Phone         string         `json:"phone"`
	Profession    string         `json:"profession"`
	Location      string         `json:"location"`
	DOB           *string        `json:"dob"`
	Bio           string         `json:"bio"`
	Emergency     map[string]any `json:"emergency"`
	NextOfKin     map[string]any `json:"nextOfKin"`
	CategoryLabel string         `json:"categoryLabel"`
	ChapterName   *string        `json:"chapterName"`
}

type PrivacySettings struct {
	ShowPhone       bool `json:"showPhone"`
	ShowEmail       bool `json:"showEmail"`
	ShowInDirectory bool `json:"showInDirectory"`
	ShowProfession  bool `json:"showProfession"`
}

type ActivityEntry struct {
	ID   string `json:"id"`
	Type string `json:"type"`
	Text string `json:"text"`
	At   string `json:"at"`
}

type AdminCapabilities struct {
	ApproveMembers bool `json:"approveMembers"`
	ManageMembers  bool `json:"manageMembers"`
	ManageFinance  bool `json:"manageFinance"`
	ImportMembers  bool `json:"importMembers"`
	// ManageCommittees is the committee LIFECYCLE — create, rename, delete.
	// Deliberately narrower than ManageMembers: running a committee's roster
	// (adding, approving, removing members, setting their role) stays with
	// ManageMembers so a CHAPTER_ADMIN can do the day-to-day work, while
	// creating or destroying a committee is reserved to the organisation
	// owner. Deleting one drops every assoc_committee_members row with it.
	ManageCommittees bool `json:"manageCommittees"`
}

type AdminAccess struct {
	IsAdmin      bool              `json:"isAdmin"`
	Role         string            `json:"role"`
	RoleLabel    string            `json:"roleLabel"`
	Jurisdiction string            `json:"jurisdiction"`
	Can          AdminCapabilities `json:"can"`
	// OrganisationID is the org the role is held in. The client needs it to
	// scope admin calls (bulk import's org_id, the chapter list for a member
	// transfer); without it those flows had no source for the org id at all.
	OrganisationID   *string `json:"organisationId"`
	OrganisationName *string `json:"organisationName"`
}

type MemberProfileSummary struct {
	ID            string  `json:"id"`
	FullName      string  `json:"fullName"`
	MemberID      string  `json:"memberId"`
	PhotoURL      *string `json:"photoUrl"`
	CategoryLabel string  `json:"categoryLabel"`
	ChapterName   *string `json:"chapterName"`
	Status        string  `json:"status"`
	Profession    *string `json:"profession"`
	// OrganisationID lets the client scope org-specific lookups (e.g. the
	// chapter list offered when transferring this member) without guessing.
	OrganisationID *string `json:"organisationId"`
}

type MemberProfile struct {
	MemberProfileSummary
	Email             *string `json:"email"`
	Phone             *string `json:"phone"`
	Location          *string `json:"location"`
	JoinedAt          string  `json:"joinedAt"`
	PaymentStanding   string  `json:"paymentStanding"`
	Bio               *string `json:"bio"`
	ContactRestricted bool    `json:"contactRestricted"`
}

type AnnouncementSummary struct {
	ID           string `json:"id"`
	Title        string `json:"title"`
	Preview      string `json:"preview"`
	Audience     string `json:"audience"`
	PostedAt     string `json:"postedAt"`
	Author       string `json:"author"`
	Urgent       bool   `json:"urgent"`
	Read         bool   `json:"read"`
	RequiresAck  bool   `json:"requiresAck"`
	Acknowledged bool   `json:"acknowledged"`
}

type AppNotification struct {
	ID        string  `json:"id"`
	Kind      string  `json:"kind"`
	Title     string  `json:"title"`
	Body      string  `json:"body"`
	CreatedAt string  `json:"createdAt"`
	Read      bool    `json:"read"`
	Route     *string `json:"route"`
}

type MeetingSummary struct {
	ID            string  `json:"id"`
	Title         string  `json:"title"`
	Mode          string  `json:"mode"`
	StartsAt      string  `json:"startsAt"`
	EndsAt        *string `json:"endsAt"`
	Location      *string `json:"location"`
	State         string  `json:"state"`
	AttendeeCount int     `json:"attendeeCount"`
	// ApprovalStatus is APPROVED for the organisation's calendar. A member's own
	// proposal appears in their list as PENDING or REJECTED so they can see what
	// they submitted; nobody else sees it until it is approved.
	ApprovalStatus string `json:"approvalStatus"`
}

type TaskSummary struct {
	ID           string  `json:"id"`
	Title        string  `json:"title"`
	Status       string  `json:"status"`
	Priority     string  `json:"priority"`
	DueDate      *string `json:"dueDate"`
	AssigneeName string  `json:"assigneeName"`
	Committee    *string `json:"committee"`
	// Overdue is derived from due_date on read, not read from `status`. The
	// OVERDUE status value exists in the schema but nothing writes it, so a late
	// task still reads ASSIGNED.
	Overdue bool `json:"overdue"`
}

type DocumentSummary struct {
	ID           string `json:"id"`
	Title        string `json:"title"`
	Category     string `json:"category"`
	Kind         string `json:"kind"`
	SizeLabel    string `json:"sizeLabel"`
	UpdatedAt    string `json:"updatedAt"`
	Restricted   bool   `json:"restricted"`
	RequiresAck  bool   `json:"requiresAck"`
	Acknowledged bool   `json:"acknowledged"`
}

type CommitteeSummary struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Purpose     string  `json:"purpose"`
	MemberCount int     `json:"memberCount"`
	JoinStatus  string  `json:"joinStatus"`
	MyRole      *string `json:"myRole"`
}

type EventSummary struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	StartsAt string `json:"startsAt"`
	// Location is COALESCEd to '' in the query: the column is nullable and this
	// field is not, so a location-less event failed the row scan. The scan error
	// was swallowed by a `continue`, so in production it would have silently
	// dropped the event from the list rather than surfacing anything.
	Location   string  `json:"location"`
	State      string  `json:"state"`
	Paid       bool    `json:"paid"`
	FeeKobo    int64   `json:"feeKobo"`
	Registered bool    `json:"registered"`
	CoverURL   *string `json:"coverUrl"`
	// Rsvp is what the list screen renders; it had no field at all, so a saved
	// RSVP never showed on the events list.
	Rsvp *string `json:"rsvp"`
	// Invited is true when this member was explicitly invited, as opposed to
	// finding the event in the list themselves. An invitation and an RSVP live on
	// the same registration row, so being invited says nothing about whether they
	// have responded.
	Invited bool `json:"invited"`
}

// AdminOrgOption is one entry in the admin console's org picker.
// AdminOrgFilter narrows the admin organisation register. Published/Verified are
// pointers so "unset" is distinguishable from "false".
type AdminOrgFilter struct {
	Search    string
	Category  string
	Status    string
	Published *bool
	Verified  *bool
	Limit     int
	Offset    int
}

// AdminOrgOption is one row of the admin organisation register. It began as a
// bare picker option (id/name/published/verified/memberCount); the console's
// register table needed acronym, category, status and createdAt too and was
// issuing one extra GET /admin/organisations/:id per visible row to get them.
// Returning them here collapses that back to a single query.
type AdminOrgOption struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Acronym     *string `json:"acronym"`
	Category    string  `json:"category"`
	Status      string  `json:"status"`
	Published   bool    `json:"published"`
	Verified    bool    `json:"verified"`
	MemberCount int     `json:"memberCount"`
	CreatedAt   string  `json:"createdAt"`
}

type AdminKpis struct {
	TotalMembers        int   `json:"totalMembers"`
	ActiveMembers       int   `json:"activeMembers"`
	PendingApprovals    int   `json:"pendingApprovals"`
	UnpaidMembers       int   `json:"unpaidMembers"`
	DuesCollectedKobo   int64 `json:"duesCollectedKobo"`
	DuesOutstandingKobo int64 `json:"duesOutstandingKobo"`
}

type AdminApplicationSummary struct {
	ID            string `json:"id"`
	ApplicantName string `json:"applicantName"`
	Category      string `json:"category"`
	Chapter       string `json:"chapter"`
	SubmittedAt   string `json:"submittedAt"`
	Status        string `json:"status"`
	Jurisdiction  string `json:"jurisdiction"`
	Paid          bool   `json:"paid"`
}

// ApplicationDocument is a document submitted with a membership application.
type ApplicationDocument struct {
	ID    string  `json:"id"`
	Label string  `json:"label"`
	URL   *string `json:"url"`
	Kind  string  `json:"kind"`
}

type AdminApplication struct {
	AdminApplicationSummary
	Email               string  `json:"email"`
	Phone               string  `json:"phone"`
	Profession          string  `json:"profession"`
	Sponsor             *string `json:"sponsor"`
	RegistrationFeeKobo int64   `json:"registrationFeeKobo"`

	// Rendered by the approvals detail screen; both were absent, so the page
	// crashed on documents.map and printed NaN for the SLA countdown.
	Documents    []ApplicationDocument `json:"documents"`
	SLAHoursLeft *int                  `json:"slaHoursLeft"`
}

// FinanceBreakdownLine is one row of the collected-vs-outstanding split by
// chapter or by membership category. Amounts are integer kobo.
type FinanceBreakdownLine struct {
	Label           string `json:"label"`
	CollectedKobo   int64  `json:"collectedKobo"`
	OutstandingKobo int64  `json:"outstandingKobo"`
	MemberCount     int    `json:"memberCount"`
}

type FinanceSummary struct {
	CollectedKobo   int64 `json:"collectedKobo"`
	OutstandingKobo int64 `json:"outstandingKobo"`
	PaidMembers     int   `json:"paidMembers"`
	UnpaidMembers   int   `json:"unpaidMembers"`
	OfflinePending  int   `json:"offlinePending"`

	// The admin finance screen renders both breakdowns; neither existed on the
	// DTO, so the page crashed on `.map` of undefined as soon as it went live.
	ByChapter  []FinanceBreakdownLine `json:"byChapter"`
	ByCategory []FinanceBreakdownLine `json:"byCategory"`
}

type OfflinePayment struct {
	ID          string `json:"id"`
	MemberName  string `json:"memberName"`
	MemberID    string `json:"memberId"`
	AmountKobo  int64  `json:"amountKobo"`
	Method      string `json:"method"`
	Reference   string `json:"reference"`
	ForItem     string `json:"forItem"`
	SubmittedAt string `json:"submittedAt"`
	Status      string `json:"status"`
}

type UpdatePrivacyRequest = PrivacySettings // same shape

type MemberDirectoryQuery struct {
	Search    string `form:"search"`
	ChapterID string `form:"chapterId"`
	Category  string `form:"category"`
	Status    string `form:"status"`
	// OrgID is an explicit organisation override for the admin console's org
	// picker — authorized via resolveOrgID (platform super-admin, or a real
	// per-org admin role in that org) rather than the member self-service
	// "any org I actively belong to" scoping GetDirectory uses by default.
	OrgID string `form:"org_id"`
}

// RevenueSplit computes the configurable dues split (National 50 / State 30 /
// Local 15 / Platform 5). The first line absorbs any rounding remainder so the
// parts always sum exactly to amountKobo. Pure function — unit-tested.
func RevenueSplit(amountKobo int64) []RevenueSplitLine {
	state := amountKobo * 30 / 100
	local := amountKobo * 15 / 100
	platform := amountKobo * 5 / 100
	national := amountKobo - state - local - platform // remainder-safe
	return []RevenueSplitLine{
		{Label: "National body", AmountKobo: national},
		{Label: "State chapter", AmountKobo: state},
		{Label: "Local chapter", AmountKobo: local},
		{Label: "Platform fee", AmountKobo: platform},
	}
}

// Content-creation DTOs.
// Before this file, assoc_announcements, assoc_meetings, assoc_documents,
// assoc_events, assoc_notifications and assoc_devices had READ endpoints and no
// writer anywhere in the repo. They were permanently empty, so every one of
// those screens rendered an empty state forever and content could only arrive
// by hand-written SQL. assoc_dues_invoices was worse: it is the entire input to
// the money path, so PayInvoice had nothing it could ever settle.
// Money rule: every *Kobo field is an integer in minor units. Never a float,
// never a string for math.

// AnnouncementRequest creates or updates an announcement.
type AnnouncementRequest struct {
	Title       string  `json:"title" binding:"required"`
	Body        *string `json:"body"`
	Audience    *string `json:"audience"`
	Urgent      bool    `json:"urgent"`
	RequiresAck bool    `json:"requiresAck"`
	// Notify fans the announcement out to every ACTIVE member as an in-app
	// notification. Only honoured on create.
	Notify bool `json:"notify"`
}

// MeetingRequest creates or updates a meeting. StartsAt/EndsAt are RFC3339.
type MeetingRequest struct {
	Title       string   `json:"title" binding:"required"`
	Description *string  `json:"description"`
	Mode        string   `json:"mode"`
	StartsAt    string   `json:"startsAt" binding:"required"`
	EndsAt      *string  `json:"endsAt"`
	Location    *string  `json:"location"`
	State       string   `json:"state"`
	Agenda      []string `json:"agenda"`
	// GenerateAttendanceCode issues a short check-in code for the meeting.
	GenerateAttendanceCode bool `json:"generateAttendanceCode"`
	Notify                 bool `json:"notify"`
}

// DocumentRequest creates or updates a document-vault entry. The file itself is
// uploaded separately; StorageKey is the resulting object key.
type DocumentRequest struct {
	Title       string  `json:"title" binding:"required"`
	Category    string  `json:"category" binding:"required"`
	Kind        string  `json:"kind"`
	StorageKey  *string `json:"storageKey"`
	SizeLabel   *string `json:"sizeLabel"`
	Version     string  `json:"version"`
	Restricted  bool    `json:"restricted"`
	RequiresAck bool    `json:"requiresAck"`
	AISummary   *string `json:"aiSummary"`
	Notify      bool    `json:"notify"`
}

// EventRequest creates or updates an event. FeeKobo is integer kobo and is only
// meaningful when Paid is true.
type EventRequest struct {
	Title       string  `json:"title" binding:"required"`
	Description *string `json:"description"`
	StartsAt    string  `json:"startsAt" binding:"required"`
	EndsAt      *string `json:"endsAt"`
	Location    *string `json:"location"`
	Paid        bool    `json:"paid"`
	FeeKobo     int64   `json:"feeKobo"`
	Capacity    *int    `json:"capacity"`
	Organiser   *string `json:"organiser"`
	CoverURL    *string `json:"coverUrl"`
	Notify      bool    `json:"notify"`
}

// TaskRequest creates or updates a task. AssigneeID is a membership id.
type TaskRequest struct {
	Title       string   `json:"title" binding:"required"`
	Description *string  `json:"description"`
	Status      string   `json:"status"`
	Priority    string   `json:"priority"`
	DueDate     *string  `json:"dueDate"`
	AssigneeID  *string  `json:"assigneeId"`
	CommitteeID *string  `json:"committeeId"`
	MeetingID   *string  `json:"meetingId"`
	Checklist   []string `json:"checklist"`
	Notify      bool     `json:"notify"`
}

// DuesRunRequest raises dues invoices in bulk from each member's own membership
// category. Money-path: requires an Idempotency-Key so a retried run cannot
// double-bill an organisation's entire roster.
type DuesRunRequest struct {
	Title   string  `json:"title" binding:"required"`
	Scope   string  `json:"scope"`
	DueDate *string `json:"dueDate"`
	// CategoryID restricts the run to one dues tier; empty means every tier.
	CategoryID *string `json:"categoryId"`
	// ChapterID restricts the run to one chapter.
	ChapterID *string `json:"chapterId"`
	Notify    bool    `json:"notify"`

	IdempotencyKey string `json:"-"`
}

// DuesRunResult reports what a dues run raised.
type DuesRunResult struct {
	RunID         string `json:"runId"`
	Invoiced      int    `json:"invoiced"`
	Skipped       int    `json:"skipped"`
	TotalKobo     int64  `json:"totalKobo"`
	AlreadyRaised bool   `json:"alreadyRaised"`
}

// InvoiceRequest raises a single ad-hoc invoice against one membership.
type InvoiceRequest struct {
	MembershipID string  `json:"membershipId" binding:"required"`
	Title        string  `json:"title" binding:"required"`
	Description  *string `json:"description"`
	AmountKobo   int64   `json:"amountKobo" binding:"required"`
	Cadence      string  `json:"cadence"`
	Scope        string  `json:"scope"`
	DueDate      *string `json:"dueDate"`
	Notify       bool    `json:"notify"`

	IdempotencyKey string `json:"-"`
}

// DeviceRequest registers the caller's device so the settings screen has
// something to list and revoke. assoc_devices previously had no writer, so the
// list was always empty and DELETE always 403'd on zero rows affected.
type DeviceRequest struct {
	Name     string  `json:"name" binding:"required"`
	Platform string  `json:"platform"`
	Location *string `json:"location"`
}

// EventRegistrationResult is the outcome of registering for an event. A paid
// event returns PaymentRequired with the invoice to settle instead of a ticket;
// the ticket is released once that invoice is PAID.
type EventRegistrationResult struct {
	Registered      bool    `json:"registered"`
	PaymentRequired bool    `json:"paymentRequired"`
	TicketCode      *string `json:"ticketCode"`
	InvoiceID       *string `json:"invoiceId"`
	AmountKobo      int64   `json:"amountKobo"`
}

// PendingMeeting is one row of the admin approval queue.
type PendingMeeting struct {
	ID             string  `json:"id"`
	Title          string  `json:"title"`
	Mode           string  `json:"mode"`
	StartsAt       string  `json:"startsAt"`
	EndsAt         *string `json:"endsAt"`
	Location       *string `json:"location"`
	ProposedByName string  `json:"proposedByName"`
	ProposedAt     string  `json:"proposedAt"`
}

// Detail DTOs + request types for the gap-fill endpoints (detail reads, profile
// update, admin audit-log, ai-note regenerate, chat reactions). Kept in a
// separate file to reduce merge surface; no name collides with model.go /
// model_ext.go. Amounts remain kobo int64.

type AnnouncementDetail struct {
	AnnouncementSummary

	Body string `json:"body"`
}

type MeetingDetail struct {
	MeetingSummary

	Description string           `json:"description"`
	Agenda      []map[string]any `json:"agenda"`
	MyRsvp      *string          `json:"myRsvp"`
	CheckedIn   bool             `json:"checkedIn"`
}

type TaskDetail struct {
	TaskSummary

	Description string           `json:"description"`
	Checklist   []map[string]any `json:"checklist"`
}

type DocumentDetail struct {
	DocumentSummary

	Version    string  `json:"version"`
	AiSummary  string  `json:"aiSummary"`
	StorageKey *string `json:"storageKey"`
}

type CommitteeMemberEntry struct {
	MembershipID string  `json:"membershipId"`
	FullName     string  `json:"fullName"`
	Role         string  `json:"role"`
	Status       string  `json:"status"`
	PhotoURL     *string `json:"photoUrl"`
}

type CommitteeDetail struct {
	CommitteeSummary

	Members []CommitteeMemberEntry `json:"members"`
}

type EventDetail struct {
	EventSummary

	Description string  `json:"description"`
	EndsAt      *string `json:"endsAt"`
	Capacity    *int    `json:"capacity"`
	Organiser   *string `json:"organiser"`
	MyRsvp      *string `json:"myRsvp"`
	Registered  bool    `json:"registered"`
	TicketCode  *string `json:"ticketCode"`
}

// UpdateProfileInput is the editable subset of MyProfile. All fields optional;
// only non-nil fields are applied (partial update).
type UpdateProfileInput struct {
	Phone      *string         `json:"phone"`
	Profession *string         `json:"profession"`
	Location   *string         `json:"location"`
	Bio        *string         `json:"bio"`
	PhotoURL   *string         `json:"photoUrl"`
	Emergency  *map[string]any `json:"emergency"`
	NextOfKin  *map[string]any `json:"nextOfKin"`
}

type AuditLogEntry struct {
	ID          string         `json:"id"`
	ActorID     string         `json:"actorId"`
	Action      string         `json:"action"`
	SubjectType string         `json:"subjectType"`
	SubjectID   string         `json:"subjectId"`
	Metadata    map[string]any `json:"metadata"`
	CreatedAt   string         `json:"createdAt"`

	// The clients render these four and the DTO carried none of them, so every
	// audit row displayed blank. Kept alongside the raw fields rather than
	// replacing them so existing consumers keep working.
	ActorName string `json:"actorName"`
	Summary   string `json:"summary"`
	Subject   string `json:"subject"`
	At        string `json:"at"`
}

// auditActionLabel renders an audit action code as a human sentence.
func auditActionLabel(action string) string {
	labels := map[string]string{
		"ORG_PUBLISH":              "Published an organisation",
		"ORG_PUBLISH_TOGGLE":       "Changed organisation visibility",
		"ORG_UPDATE":               "Updated organisation details",
		"ORG_VERIFY":               "Changed organisation verification",
		"ORG_SUSPEND":              "Changed organisation suspension",
		"ORG_SETTINGS_UPDATE":      "Updated organisation settings",
		"APPROVAL_DECISION":        "Decided a membership application",
		"DUES_PAY":                 "Paid dues",
		"OFFLINE_PAYMENT_APPROVE":  "Approved an offline payment",
		"OFFLINE_PAYMENT_REJECTED": "Rejected an offline payment",
		"MEMBER_SUSPEND":           "Suspended a member",
		"MEMBER_RESTORE":           "Restored a member",
		"MEMBER_TRANSFER":          "Transferred a member",
		"ROLE_ASSIGN":              "Assigned a role",
		"BULK_IMPORT":              "Bulk-imported members",
		"IMPORT":                   "Imported members",
		"COMMITTEE_JOIN_REQUEST":   "Requested to join a committee",
		"MINUTES_REGENERATE":       "Regenerated meeting minutes",
		"CHAPTER_CREATE":           "Created a chapter",
		"CHAPTER_UPDATE":           "Updated a chapter",
		"CHAPTER_DELETE":           "Deleted a chapter",
		"COMMITTEE_CREATE":         "Created a committee",
		"COMMITTEE_UPDATE":         "Updated a committee",
		"COMMITTEE_DELETE":         "Deleted a committee",
		"CATEGORY_CREATE":          "Created a dues category",
		"CATEGORY_UPDATE":          "Updated a dues category",
		"CATEGORY_DELETE":          "Deleted a dues category",
		"RULE_CREATE":              "Added a group rule",
		"RULE_UPDATE":              "Updated a group rule",
		"RULE_DELETE":              "Removed a group rule",
	}
	if l, ok := labels[action]; ok {
		return l
	}
	return action
}

type ReactRequest struct {
	Emoji string `json:"emoji" binding:"required"`
}

// Admin-side organisation management DTOs.
// Before this file, assoc_organisations was write-once: PublishOrganisation was
// the only writer in the repo and there was no UPDATE or DELETE against it, its
// chapters, its committees or its membership categories anywhere. Every field —
// name, branding, group type, approval rule, registration fee, verified,
// published — was permanently immutable after creation, and there was no
// per-organisation settings surface at all.

// AdminOrganisationDetail is the full admin view of one organisation.
type AdminOrganisationDetail struct {
	ID                  string  `json:"id"`
	Name                string  `json:"name"`
	Acronym             *string `json:"acronym"`
	Category            string  `json:"category"`
	Description         *string `json:"description"`
	LogoURL             *string `json:"logoUrl"`
	CoverURL            *string `json:"coverUrl"`
	GroupType           string  `json:"groupType"`
	ApprovalRule        string  `json:"approvalRule"`
	RegistrationFeeKobo int64   `json:"registrationFeeKobo"`
	RequiresPayment     bool    `json:"requiresPayment"`
	FoundedYear         *int    `json:"foundedYear"`
	Location            *string `json:"location"`
	Website             *string `json:"website"`
	Verified            bool    `json:"verified"`
	Published           bool    `json:"published"`
	Status              string  `json:"status"`
	StructureType       *string `json:"structureType"`
	CreatedBy           *string `json:"createdBy"`
	CreatedAt           string  `json:"createdAt"`
	SuspendedAt         *string `json:"suspendedAt"`

	Restrictions OrgRestrictions `json:"restrictions"`
	Settings     map[string]any  `json:"settings"`

	MemberCount    int `json:"memberCount"`
	ActiveCount    int `json:"activeCount"`
	PendingCount   int `json:"pendingCount"`
	ChapterCount   int `json:"chapterCount"`
	CommitteeCount int `json:"committeeCount"`
	CategoryCount  int `json:"categoryCount"`

	Chapters   []Chapter            `json:"chapters"`
	Committees []AdminCommittee     `json:"committees"`
	Categories []MembershipCategory `json:"categories"`
	Rules      []AdminOrgRule       `json:"rules"`
	Leaders    []AdminChapterLeader `json:"leaders"`
}

type AdminCommittee struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Description *string `json:"description"`
	MemberCount int     `json:"memberCount"`
}

type AdminOrgRule struct {
	ID       string `json:"id"`
	Body     string `json:"body"`
	Position int    `json:"position"`
}

type AdminChapterLeader struct {
	ID                string  `json:"id"`
	ChapterID         *string `json:"chapterId"`
	StateName         string  `json:"stateName"`
	LeaderName        *string `json:"leaderName"`
	LeaderContact     *string `json:"leaderContact"`
	CanApproveMembers bool    `json:"canApproveMembers"`
}

// UpdateOrganisationRequest patches an organisation. Every field is a pointer:
// nil means "leave unchanged", so a partial patch never blanks a column the
// caller did not mention.
type UpdateOrganisationRequest struct {
	Name                *string `json:"name"`
	Acronym             *string `json:"acronym"`
	Category            *string `json:"category"`
	Description         *string `json:"description"`
	LogoURL             *string `json:"logoUrl"`
	CoverURL            *string `json:"coverUrl"`
	GroupType           *string `json:"groupType"`
	ApprovalRule        *string `json:"approvalRule"`
	RegistrationFeeKobo *int64  `json:"registrationFeeKobo"`
	FoundedYear         *int    `json:"foundedYear"`
	Location            *string `json:"location"`
	Website             *string `json:"website"`
	StructureType       *string `json:"structureType"`

	GraceDays     *int  `json:"graceDays"`
	DisableVoting *bool `json:"disableVoting"`
	DisableEvents *bool `json:"disableEvents"`
	DisableChat   *bool `json:"disableChat"`
	DisableCard   *bool `json:"disableCard"`

	IdempotencyKey string `json:"-"`
}

// ChapterRequest / CommitteeRequest / CategoryRequest / RuleRequest are the
// create+update bodies for an organisation's sub-entities.
type ChapterRequest struct {
	Name  string `json:"name" binding:"required"`
	Level string `json:"level"`
}

type CommitteeRequest struct {
	Name        string  `json:"name" binding:"required"`
	Description *string `json:"description"`
}

// CategoryRequest carries a dues tier. DuesKobo is an integer in minor units
// (kobo) — never a float, never a string for math.
type CategoryRequest struct {
	Label       string  `json:"label" binding:"required"`
	Description *string `json:"description"`
	DuesKobo    int64   `json:"duesKobo"`
	Cadence     string  `json:"cadence"`

	IdempotencyKey string `json:"-"`
}

type RuleRequest struct {
	Body     string `json:"body" binding:"required"`
	Position int    `json:"position"`
}
