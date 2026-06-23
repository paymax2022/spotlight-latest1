package association

// Extended DTOs for the remaining endpoint groups (settings, support, chat,
// AI notes, join, bulk import, organisation publish). Kept separate from
// model.go to reduce merge surface. None of these names collide with model.go.

// ─── Settings (V) ─────────────────────────────────────────────────────────────

type NotificationPrefs struct {
	Announcements bool `json:"announcements"`
	DuesReminders bool `json:"duesReminders"`
	Meetings      bool `json:"meetings"`
	Tasks         bool `json:"tasks"`
	Chat          bool `json:"chat"`
	Events        bool `json:"events"`
}

type SecuritySettings struct {
	BiometricEnabled bool `json:"biometricEnabled"`
	TwoFactorEnabled bool `json:"twoFactorEnabled"`
}

type Preferences struct {
	Language string `json:"language"`
	Theme    string `json:"theme"`
}

type Device struct {
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	Platform   string  `json:"platform"`
	LastActive string  `json:"lastActive"`
	Current    bool    `json:"current"`
	Location   *string `json:"location"`
}

// ─── Support (W) ──────────────────────────────────────────────────────────────

type FaqItem struct {
	ID       string `json:"id"`
	Question string `json:"question"`
	Answer   string `json:"answer"`
}

type TicketMessage struct {
	ID          string `json:"id"`
	Author      string `json:"author"`
	FromSupport bool   `json:"fromSupport"`
	Body        string `json:"body"`
	CreatedAt   string `json:"createdAt"`
}

type SupportTicketSummary struct {
	ID        string `json:"id"`
	Subject   string `json:"subject"`
	Category  string `json:"category"`
	Status    string `json:"status"`
	UpdatedAt string `json:"updatedAt"`
}

type SupportTicket struct {
	SupportTicketSummary
	Messages []TicketMessage `json:"messages"`
}

type CreateTicketInput struct {
	Subject  string `json:"subject" binding:"required"`
	Category string `json:"category" binding:"required"`
	Message  string `json:"message" binding:"required"`
}

// ─── Chat (I) ─────────────────────────────────────────────────────────────────

type ChatThreadSummary struct {
	ID           string  `json:"id"`
	Title        string  `json:"title"`
	Scope        string  `json:"scope"`
	LastMessage  string  `json:"lastMessage"`
	LastAt       string  `json:"lastAt"`
	UnreadCount  int     `json:"unreadCount"`
	Muted        bool    `json:"muted"`
	MemberCount  int     `json:"memberCount"`
	PostingBlock *string `json:"postingBlock"`
}

type ChatMessage struct {
	ID         string  `json:"id"`
	ThreadID   string  `json:"threadId"`
	AuthorID   string  `json:"authorId"`
	AuthorName string  `json:"authorName"`
	AuthorRole *string `json:"authorRole"`
	Body       string  `json:"body"`
	ImageURL   *string `json:"imageUrl"`
	CreatedAt  string  `json:"createdAt"`
	Mine       bool    `json:"mine"`
	System     bool    `json:"system"`
	Pinned     bool    `json:"pinned"`
}

type ChatThread struct {
	ChatThreadSummary
	Description *string       `json:"description"`
	Messages    []ChatMessage `json:"messages"`
}

// ─── AI notes (L) ─────────────────────────────────────────────────────────────

type AiNoteSummary struct {
	ID            string `json:"id"`
	MeetingTitle  string `json:"meetingTitle"`
	Status        string `json:"status"`
	Source        string `json:"source"`
	CreatedAt     string `json:"createdAt"`
	DurationLabel string `json:"durationLabel"`
}

type AiNote struct {
	AiNoteSummary
	Summary           string           `json:"summary"`
	Minutes           string           `json:"minutes"`
	Decisions         []map[string]any `json:"decisions"`
	ActionItems       []map[string]any `json:"actionItems"`
	Unresolved        []string         `json:"unresolved"`
	Attendees         []map[string]any `json:"attendees"`
	TranscriptPreview string           `json:"transcriptPreview"`
	MeetingID         *string          `json:"meetingId"`
}

type CreateAiNoteInput struct {
	Source       string  `json:"source" binding:"required"`
	MeetingTitle string  `json:"meetingTitle" binding:"required"`
	MeetingID    *string `json:"meetingId"`
}

// ─── Join (B) ─────────────────────────────────────────────────────────────────

type CodeValidation struct {
	Valid               bool    `json:"valid"`
	Kind                string  `json:"kind"`
	Expired             bool    `json:"expired"`
	OrganisationID      *string `json:"organisationId"`
	OrganisationName    *string `json:"organisationName"`
	OrganisationAcronym *string `json:"organisationAcronym"`
	ChapterName         *string `json:"chapterName"`
	CategoryLabel       *string `json:"categoryLabel"`
	Message             string  `json:"message"`
}

type CodeRequest struct {
	Code string `json:"code" binding:"required"`
}

type JoinDraft struct {
	OrganisationID     string   `json:"organisationId" binding:"required"`
	CategoryID         *string  `json:"categoryId"`
	ChapterID          *string  `json:"chapterId"`
	LocalBranch        *string  `json:"localBranch"`
	CommitteeInterests []string `json:"committeeInterests"`
	SponsorName        *string  `json:"sponsorName"`
	AcceptedRules      bool     `json:"acceptedRules"`
}

type ApplicationResult struct {
	ApplicationID    string  `json:"applicationId"`
	Status           string  `json:"status"`
	OrganisationName string  `json:"organisationName"`
	SubmittedAt      string  `json:"submittedAt"`
	Message          string  `json:"message"`
	NextStep         *string `json:"nextStep"`
}

// ─── Bulk import (R) ──────────────────────────────────────────────────────────

type ImportRow struct {
	RowNum  int     `json:"rowNum"`
	Name    string  `json:"name"`
	Phone   string  `json:"phone"`
	Email   string  `json:"email"`
	Chapter string  `json:"chapter"`
	Issue   *string `json:"issue"`
}

type ImportPreview struct {
	FileName   string      `json:"fileName"`
	Total      int         `json:"total"`
	Valid      int         `json:"valid"`
	Duplicates int         `json:"duplicates"`
	Invalid    int         `json:"invalid"`
	Rows       []ImportRow `json:"rows"`
}

type ImportConfirmRequest struct {
	SendInvites bool `json:"sendInvites"`
}

type ImportResult struct {
	Imported int    `json:"imported"`
	Skipped  int    `json:"skipped"`
	Invited  int    `json:"invited"`
	BatchID  string `json:"batchId"`
}

// ─── Organisation publish (U) ─────────────────────────────────────────────────

type OrgDraftChapter struct {
	Name  string `json:"name"`
	Level string `json:"level"`
}

type OrgDraftCommittee struct {
	Name string `json:"name"`
}

type OrgDraftCategory struct {
	Label    string `json:"label"`
	DuesKobo int64  `json:"duesKobo"`
	Cadence  string `json:"cadence"`
}

type OrgDraft struct {
	Name                string              `json:"name" binding:"required"`
	Acronym             string              `json:"acronym"`
	Category            string              `json:"category" binding:"required"`
	Description         string              `json:"description"`
	GroupType           string              `json:"groupType" binding:"required"`
	ApprovalRule        string              `json:"approvalRule"`
	RegistrationFeeKobo int64               `json:"registrationFeeKobo"`
	Chapters            []OrgDraftChapter   `json:"chapters"`
	Committees          []OrgDraftCommittee `json:"committees"`
	Categories          []OrgDraftCategory  `json:"categories"`
	AcceptedTerms       bool                `json:"acceptedTerms"`
}

type PublishResult struct {
	OrganisationID string `json:"organisationId"`
	Name           string `json:"name"`
}
