// Package association implements the money-path + core reads for the Group /
// Association membership module. It mirrors the internal/groups pattern: a pgx
// pool for the financial path plus the shared ledger service for double-entry
// posting. Schema: supabase/migrations/20260628000000_association_module.sql
// (assoc_* tables). API contract: contracts/associations.openapi.yaml.
//
// IRON RULES honoured here:
//   - All amounts are integers in minor units (kobo).
//   - Every money mutation requires an Idempotency-Key, posts a balanced
//     double-entry via ledger.Service, and writes an assoc_audit_log event.
//   - Wallet balances are ledger projections — never updated directly.
package association

import "time"

// ── Dues & payments ──────────────────────────────────────────────────────────

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

// ── Admin: approvals ─────────────────────────────────────────────────────────

type ApprovalDecisionRequest struct {
	Decision       string `json:"decision" binding:"required"` // APPROVE | REJECT | REQUEST_INFO
	Note           string `json:"note"`
	IdempotencyKey string `json:"-"`
}

// ── Discovery ────────────────────────────────────────────────────────────────

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

// ── Member identity ───────────────────────────────────────────────────────────

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

// ── RBAC ──────────────────────────────────────────────────────────────────────

type AdminCapabilities struct {
	ApproveMembers bool `json:"approveMembers"`
	ManageMembers  bool `json:"manageMembers"`
	ManageFinance  bool `json:"manageFinance"`
	ImportMembers  bool `json:"importMembers"`
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

// ── Directory ─────────────────────────────────────────────────────────────────

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

// ── Announcements & notifications ─────────────────────────────────────────────

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

// ── Meetings ──────────────────────────────────────────────────────────────────

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

// ── Tasks ─────────────────────────────────────────────────────────────────────

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

// ── Documents ─────────────────────────────────────────────────────────────────

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

// ── Community ─────────────────────────────────────────────────────────────────

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
}

// ── Admin ─────────────────────────────────────────────────────────────────────

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

// ── Request types for new mutations ──────────────────────────────────────────

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
