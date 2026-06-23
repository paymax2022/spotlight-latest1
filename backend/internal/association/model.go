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
	ID           string    `json:"id"`
	Title        string    `json:"title"`
	Description  *string   `json:"description"`
	AmountKobo   int64     `json:"amountKobo"`
	Cadence      string    `json:"cadence"`
	Status       string    `json:"status"`
	Scope        string    `json:"scope"`
	DueDate      time.Time `json:"dueDate"`
}

type DuesSummary struct {
	OutstandingKobo  int64     `json:"outstandingKobo"`
	PaidThisYearKobo int64     `json:"paidThisYearKobo"`
	Standing         string    `json:"standing"`
	Invoices         []Invoice `json:"invoices"`
}

type PayInvoiceRequest struct {
	Method         string `json:"method" binding:"required"` // WALLET | PAYSTACK
	IdempotencyKey string `json:"-"`                          // taken from header, not body
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

type Organisation struct {
	OrganisationSummary
	Description          string               `json:"description"`
	FoundedYear          *int                 `json:"foundedYear"`
	RequiresPayment      bool                 `json:"requiresPayment"`
	RegistrationFeeKobo  int64                `json:"registrationFeeKobo"`
	MembershipCategories []MembershipCategory `json:"membershipCategories"`
	Chapters             []Chapter            `json:"chapters"`
}

// ── Member identity ───────────────────────────────────────────────────────────

type MembershipCard struct {
	MemberID             string  `json:"memberId"`
	FullName             string  `json:"fullName"`
	PhotoURL             *string `json:"photoUrl"`
	OrganisationName     string  `json:"organisationName"`
	OrganisationAcronym  *string `json:"organisationAcronym"`
	CategoryLabel        string  `json:"categoryLabel"`
	ChapterName          *string `json:"chapterName"`
	Status               string  `json:"status"`
	PaymentStanding      string  `json:"paymentStanding"`
	Verified             bool    `json:"verified"`
	ValidThrough         *string `json:"validThrough"`
	QRPayload            string  `json:"qrPayload"`
}

type MemberDashboard struct {
	Card                  MembershipCard `json:"card"`
	OutstandingKobo       int64          `json:"outstandingKobo"`
	NextDueDate           *string        `json:"nextDueDate"`
	UnreadAnnouncements   int            `json:"unreadAnnouncements"`
	OpenTasks             int            `json:"openTasks"`
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
}

type MemberProfile struct {
	MemberProfileSummary
	Email            *string `json:"email"`
	Phone            *string `json:"phone"`
	Location         *string `json:"location"`
	JoinedAt         string  `json:"joinedAt"`
	PaymentStanding  string  `json:"paymentStanding"`
	Bio              *string `json:"bio"`
	ContactRestricted bool   `json:"contactRestricted"`
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
	ID         string  `json:"id"`
	Title      string  `json:"title"`
	StartsAt   string  `json:"startsAt"`
	Location   string  `json:"location"`
	State      string  `json:"state"`
	Paid       bool    `json:"paid"`
	FeeKobo    int64   `json:"feeKobo"`
	Registered bool    `json:"registered"`
	CoverURL   *string `json:"coverUrl"`
}

// ── Admin ─────────────────────────────────────────────────────────────────────

type AdminKpis struct {
	TotalMembers       int   `json:"totalMembers"`
	ActiveMembers      int   `json:"activeMembers"`
	PendingApprovals   int   `json:"pendingApprovals"`
	UnpaidMembers      int   `json:"unpaidMembers"`
	DuesCollectedKobo  int64 `json:"duesCollectedKobo"`
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

type AdminApplication struct {
	AdminApplicationSummary
	Email               string  `json:"email"`
	Phone               string  `json:"phone"`
	Profession          string  `json:"profession"`
	Sponsor             *string `json:"sponsor"`
	RegistrationFeeKobo int64   `json:"registrationFeeKobo"`
}

type FinanceSummary struct {
	CollectedKobo   int64 `json:"collectedKobo"`
	OutstandingKobo int64 `json:"outstandingKobo"`
	PaidMembers     int   `json:"paidMembers"`
	UnpaidMembers   int   `json:"unpaidMembers"`
	OfflinePending  int   `json:"offlinePending"`
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
