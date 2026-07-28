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
}

// ── Chat reaction ─────────────────────────────────────────────────────────────

type ReactRequest struct {
	Emoji string `json:"emoji" binding:"required"`
}
