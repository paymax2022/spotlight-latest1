package association

// Detail DTOs + request types for the gap-fill endpoints (detail reads, profile
// update, admin audit-log, ai-note regenerate, chat reactions). Kept in a
// separate file to reduce merge surface; no name collides with model.go /
// model_ext.go. Amounts remain kobo int64.

// ── Announcement detail ───────────────────────────────────────────────────────

type AnnouncementDetail struct {
	AnnouncementSummary
	Body string `json:"body"`
}

// ── Meeting detail ────────────────────────────────────────────────────────────

type MeetingDetail struct {
	MeetingSummary
	Description string           `json:"description"`
	Agenda      []map[string]any `json:"agenda"`
	MyRsvp      *string          `json:"myRsvp"`
	CheckedIn   bool             `json:"checkedIn"`
}

// ── Task detail ───────────────────────────────────────────────────────────────

type TaskDetail struct {
	TaskSummary
	Description string           `json:"description"`
	Checklist   []map[string]any `json:"checklist"`
}

// ── Document detail ───────────────────────────────────────────────────────────

type DocumentDetail struct {
	DocumentSummary
	Version    string  `json:"version"`
	AiSummary  string  `json:"aiSummary"`
	StorageKey *string `json:"storageKey"`
}

// ── Committee detail ──────────────────────────────────────────────────────────

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

// ── Event detail ──────────────────────────────────────────────────────────────

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

// ── Profile update ────────────────────────────────────────────────────────────

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

// ── Admin audit log ───────────────────────────────────────────────────────────

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

// ── Chat reaction ─────────────────────────────────────────────────────────────

type ReactRequest struct {
	Emoji string `json:"emoji" binding:"required"`
}
