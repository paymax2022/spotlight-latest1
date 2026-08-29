package association

// Content-creation DTOs.
//
// Before this file, assoc_announcements, assoc_meetings, assoc_documents,
// assoc_events, assoc_notifications and assoc_devices had READ endpoints and no
// writer anywhere in the repo. They were permanently empty, so every one of
// those screens rendered an empty state forever and content could only arrive
// by hand-written SQL. assoc_dues_invoices was worse: it is the entire input to
// the money path, so PayInvoice had nothing it could ever settle.
//
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
