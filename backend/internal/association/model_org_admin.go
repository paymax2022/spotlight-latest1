package association

// Admin-side organisation management DTOs.
//
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
