package domain

type StemOverview struct {
	TotalApplications       int `json:"totalApplications"`
	SubmittedApplications   int `json:"submittedApplications"`
	UnderReviewApplications int `json:"underReviewApplications"`
	ShortlistedApplications int `json:"shortlistedApplications"`
	SchoolChannelApplicants int `json:"schoolChannelApplicants"`
	EmergingApplicants      int `json:"emergingApplicants"`
}

type StemSchool struct {
	ID                 string `json:"id,omitempty"`
	Name               string `json:"name"`
	State              string `json:"state"`
	Applications       int    `json:"applications"`
	SubmittedCount     int    `json:"submittedCount"`
	UnderReviewCount   int    `json:"underReviewCount"`
	ShortlistedCount   int    `json:"shortlistedCount"`
	VerificationStatus string `json:"verificationStatus"`
}

type StemSchoolCreateInput struct {
	SchoolName               string         `json:"schoolName"`
	SchoolType               string         `json:"schoolType"`
	OwnershipType            string         `json:"ownershipType"`
	EducationLevel           string         `json:"educationLevel"`
	Country                  string         `json:"country"`
	State                    string         `json:"state"`
	LGACity                  string         `json:"lgaCity"`
	Address                  string         `json:"address"`
	OfficialEmail            string         `json:"officialEmail"`
	OfficialPhone            string         `json:"officialPhone"`
	Website                  string         `json:"website"`
	PrincipalName            string         `json:"principalName"`
	SchoolAdminName          string         `json:"schoolAdminName"`
	SchoolAdminEmail         string         `json:"schoolAdminEmail"`
	SchoolAdminPhone         string         `json:"schoolAdminPhone"`
	NumberOfStudents         int            `json:"numberOfStudents"`
	HasStemClub              bool           `json:"hasStemClub"`
	HasStemTeacher           bool           `json:"hasStemTeacher"`
	SchoolLogoURL            string         `json:"schoolLogoUrl"`
	RegistrationDocumentURL  string         `json:"registrationDocumentUrl"`
	AccreditationDocumentURL string         `json:"accreditationDocumentUrl"`
	SocialLinks              map[string]any `json:"socialLinks"`
	PreferredContestCategory string         `json:"preferredContestCategory"`
	SubmittedBy              string         `json:"submittedBy"`
}

type StemEmergingInnovator struct {
	ID                 string `json:"id,omitempty"`
	FullName           string `json:"fullName"`
	Email              string `json:"email"`
	Phone              string `json:"phone"`
	State              string `json:"state"`
	CurrentStatus      string `json:"currentStatus"`
	InnovationTrack    string `json:"innovationTrack"`
	TeamName           string `json:"teamName"`
	PrototypeAvailable bool   `json:"prototypeAvailable"`
	VerificationStatus string `json:"verificationStatus"`
}

type StemEmergingInnovatorCreateInput struct {
	FullName            string         `json:"fullName"`
	Email               string         `json:"email"`
	Phone               string         `json:"phone"`
	Country             string         `json:"country"`
	State               string         `json:"state"`
	LGACity             string         `json:"lgaCity"`
	EducationBackground string         `json:"educationBackground"`
	CurrentStatus       string         `json:"currentStatus"`
	StemSkillArea       string         `json:"stemSkillArea"`
	InnovationTrack     string         `json:"innovationTrack"`
	PortfolioURL        string         `json:"portfolioUrl"`
	LinkedInURL         string         `json:"linkedInUrl"`
	GitHubURL           string         `json:"githubUrl"`
	SocialLinks         map[string]any `json:"socialLinks"`
	BusinessName        string         `json:"businessName"`
	TeamName            string         `json:"teamName"`
	PrototypeAvailable  bool           `json:"prototypeAvailable"`
	PitchDeckURL        string         `json:"pitchDeckUrl"`
	VideoDemoURL        string         `json:"videoDemoUrl"`
	PhotoURL            string         `json:"photoUrl"`
	IDVerificationURL   string         `json:"idVerificationUrl"`
	SubmittedBy         string         `json:"submittedBy"`
}

type StemSchoolDashboard struct {
	SchoolID             string `json:"schoolId"`
	SchoolName           string `json:"schoolName"`
	VerificationStatus   string `json:"verificationStatus"`
	TotalStudents        int    `json:"totalStudents"`
	TotalTeams           int    `json:"totalTeams"`
	TotalProjects        int    `json:"totalProjects"`
	TotalSubmissions     int    `json:"totalSubmissions"`
	ActiveContests       int    `json:"activeContests"`
	PendingVerifications int    `json:"pendingVerifications"`
}

type StemSchoolTeam struct {
	ID              string `json:"id,omitempty"`
	SchoolID        string `json:"schoolId"`
	TeamName        string `json:"teamName"`
	ContestCategory string `json:"contestCategory"`
	CoachName       string `json:"coachName"`
	ProjectTitle    string `json:"projectTitle"`
	TeamSize        int    `json:"teamSize"`
}

type StemSchoolTeamCreateInput struct {
	SchoolID        string `json:"schoolId"`
	TeamName        string `json:"teamName"`
	ContestCategory string `json:"contestCategory"`
	CoachName       string `json:"coachName"`
	ProjectTitle    string `json:"projectTitle"`
	TeamSize        int    `json:"teamSize"`
}

type StemSchoolProfile struct {
	ID             string `json:"id,omitempty"`
	SchoolID       string `json:"schoolId"`
	UserID         string `json:"userId"`
	RoleType       string `json:"roleType"`
	FullName       string `json:"fullName"`
	Email          string `json:"email"`
	Phone          string `json:"phone"`
	GradeLevel     string `json:"gradeLevel"`
	Specialization string `json:"specialization"`
	Status         string `json:"status"`
}

type StemSchoolProfileCreateInput struct {
	SchoolID       string `json:"schoolId"`
	UserID         string `json:"userId"`
	RoleType       string `json:"roleType"`
	FullName       string `json:"fullName"`
	Email          string `json:"email"`
	Phone          string `json:"phone"`
	GradeLevel     string `json:"gradeLevel"`
	Specialization string `json:"specialization"`
}

type StemEmergingTeam struct {
	ID              string `json:"id,omitempty"`
	InnovatorID     string `json:"innovatorId"`
	TeamName        string `json:"teamName"`
	InnovationTrack string `json:"innovationTrack"`
	TeamSize        int    `json:"teamSize"`
}

type StemEmergingTeamCreateInput struct {
	InnovatorID     string `json:"innovatorId"`
	TeamName        string `json:"teamName"`
	InnovationTrack string `json:"innovationTrack"`
	TeamSize        int    `json:"teamSize"`
}

type StemEmergingProject struct {
	ID           string `json:"id,omitempty"`
	TeamID       string `json:"teamId"`
	ProjectTitle string `json:"projectTitle"`
	Category     string `json:"category"`
	Status       string `json:"status"`
}

type StemEmergingProjectCreateInput struct {
	TeamID           string `json:"teamId"`
	ProjectTitle     string `json:"projectTitle"`
	Category         string `json:"category"`
	ProblemStatement string `json:"problemStatement"`
	ProposedSolution string `json:"proposedSolution"`
}

type StemContest struct {
	ID                       string              `json:"id,omitempty"`
	Name                     string              `json:"name"`
	Slug                     string              `json:"slug"`
	ContestType              string              `json:"contestType"`
	ContestMode              string              `json:"contestMode"`
	EligibleParticipantTypes []string            `json:"eligibleParticipantTypes"`
	EligibleSchoolLevels     []string            `json:"eligibleSchoolLevels"`
	EligibleStates           []string            `json:"eligibleStates"`
	AllowMixedChannels       bool                `json:"allowMixedChannels"`
	RankingFormula           string              `json:"rankingFormula"`
	StageLifecycle           []string            `json:"stageLifecycle"`
	StageTransitions         map[string][]string `json:"stageTransitions"`
	Status                   string              `json:"status"`
}

type StemContestCreateInput struct {
	Name                     string              `json:"name"`
	Slug                     string              `json:"slug"`
	ContestType              string              `json:"contestType"`
	ContestMode              string              `json:"contestMode"`
	EligibleParticipantTypes []string            `json:"eligibleParticipantTypes"`
	EligibleSchoolLevels     []string            `json:"eligibleSchoolLevels"`
	EligibleStates           []string            `json:"eligibleStates"`
	AllowMixedChannels       bool                `json:"allowMixedChannels"`
	RankingFormula           string              `json:"rankingFormula"`
	StageLifecycle           []string            `json:"stageLifecycle"`
	StageTransitions         map[string][]string `json:"stageTransitions"`
	Status                   string              `json:"status"`
}

type StemEligibilityCheckInput struct {
	ContestID       string `json:"contestId"`
	ParticipantType string `json:"participantType"`
	State           string `json:"state"`
	SchoolLevel     string `json:"schoolLevel"`
	SchoolVerified  bool   `json:"schoolVerified"`
}

type StemEligibilityCheckResult struct {
	Eligible bool     `json:"eligible"`
	Reasons  []string `json:"reasons"`
}

type StemLeaderboardEntry struct {
	ID              string  `json:"id,omitempty"`
	ContestID       string  `json:"contestId"`
	ParticipantID   string  `json:"participantId"`
	ParticipantType string  `json:"participantType"`
	DisplayName     string  `json:"displayName"`
	JudgeScore      float64 `json:"judgeScore"`
	VoteScore       float64 `json:"voteScore"`
	StageScore      float64 `json:"stageScore"`
	FinalScore      float64 `json:"finalScore"`
	RankPosition    int     `json:"rankPosition"`
}

type StemLeaderboardSlice struct {
	GroupKey string  `json:"groupKey"`
	Count    int     `json:"count"`
	AvgScore float64 `json:"avgScore"`
}

type StemSubmission struct {
	ID                string `json:"id"`
	Status            string `json:"status"`
	ReviewStage       string `json:"reviewStage"`
	EntryRoute        string `json:"entryRoute"`
	ChallengeType     string `json:"challengeType"`
	CategoryTrack     string `json:"categoryTrack"`
	CompletionPercent int    `json:"completionPercent"`
}

type StemJudgingScore struct {
	ID                  string  `json:"id"`
	ApplicationID       string  `json:"applicationId"`
	ReviewerID          string  `json:"reviewerId"`
	InnovationScore     float64 `json:"innovationScore"`
	TechnicalDepthScore float64 `json:"technicalDepthScore"`
	ImpactScore         float64 `json:"impactScore"`
	OverallScore        float64 `json:"overallScore"`
	Notes               string  `json:"notes"`
	ReviewStatus        string  `json:"reviewStatus"`
	IsLocked            bool    `json:"isLocked"`
	LockReason          string  `json:"lockReason"`
	LockedAt            string  `json:"lockedAt"`
	LockedBy            string  `json:"lockedBy"`
	HasConflict         bool    `json:"hasConflict"`
	ConflictReason      string  `json:"conflictReason"`
}

type StemJudgingRubric struct {
	ID          string `json:"id,omitempty"`
	ContestID   string `json:"contestId"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Status      string `json:"status"`
}

type StemJudgingCriterion struct {
	ID          string  `json:"id,omitempty"`
	RubricID    string  `json:"rubricId"`
	Key         string  `json:"key"`
	Label       string  `json:"label"`
	WeightPct   float64 `json:"weightPct"`
	MaxScore    float64 `json:"maxScore"`
	Description string  `json:"description"`
}

type StemJudgeAssignment struct {
	ID             string `json:"id,omitempty"`
	ContestID      string `json:"contestId"`
	ApplicationID  string `json:"applicationId"`
	JudgeUserID    string `json:"judgeUserId"`
	Status         string `json:"status"`
	HasConflict    bool   `json:"hasConflict"`
	ConflictReason string `json:"conflictReason"`
}

type StemVotingRule struct {
	ID             string `json:"id,omitempty"`
	ContestID      string `json:"contestId"`
	VotingStatus   string `json:"votingStatus"`
	VotingMode     string `json:"votingMode"`
	DailyVoteLimit int    `json:"dailyVoteLimit"`
	OneUserOneVote bool   `json:"oneUserOneVote"`
	AllowPaidVotes bool   `json:"allowPaidVotes"`
}

type StemVotePackage struct {
	ID        string  `json:"id,omitempty"`
	ContestID string  `json:"contestId"`
	Name      string  `json:"name"`
	Votes     int     `json:"votes"`
	AmountNGN float64 `json:"amountNgn"`
	IsActive  bool    `json:"isActive"`
}

type StemVoteTransaction struct {
	ID               string  `json:"id,omitempty"`
	ContestID        string  `json:"contestId"`
	ApplicationID    string  `json:"applicationId"`
	PackageID        string  `json:"packageId"`
	VoterRef         string  `json:"voterRef"`
	PaymentReference string  `json:"paymentReference"`
	AmountNGN        float64 `json:"amountNgn"`
	VotesAllocated   int     `json:"votesAllocated"`
	Status           string  `json:"status"`
}

type StemBootcampCohort struct {
	ID        string `json:"id,omitempty"`
	ContestID string `json:"contestId"`
	Name      string `json:"name"`
	Status    string `json:"status"`
	StartDate string `json:"startDate"`
	EndDate   string `json:"endDate"`
}

type StemBootcampTask struct {
	ID          string  `json:"id,omitempty"`
	CohortID    string  `json:"cohortId"`
	Title       string  `json:"title"`
	Description string  `json:"description"`
	DayNumber   int     `json:"dayNumber"`
	MaxScore    float64 `json:"maxScore"`
}

type StemBootcampScore struct {
	ID            string  `json:"id,omitempty"`
	CohortID      string  `json:"cohortId"`
	TaskID        string  `json:"taskId"`
	ApplicationID string  `json:"applicationId"`
	Score         float64 `json:"score"`
	Note          string  `json:"note"`
}

type StemSponsor struct {
	ID              string `json:"id,omitempty"`
	Name            string `json:"name"`
	SponsorType     string `json:"sponsorType"`
	LogoURL         string `json:"logoUrl"`
	WebsiteURL      string `json:"websiteUrl"`
	CampaignMessage string `json:"campaignMessage"`
	CTAURL          string `json:"ctaUrl"`
	IsActive        bool   `json:"isActive"`
}

type StemCertificate struct {
	ID                string `json:"id,omitempty"`
	ApplicationID     string `json:"applicationId"`
	CertificateType   string `json:"certificateType"`
	CertificateNumber string `json:"certificateNumber"`
	IssuedAt          string `json:"issuedAt"`
	FileURL           string `json:"fileUrl"`
}

type StemBadge struct {
	ID          string `json:"id,omitempty"`
	Name        string `json:"name"`
	Description string `json:"description"`
	IconURL     string `json:"iconUrl"`
}

type StemBadgeAward struct {
	ID            string `json:"id,omitempty"`
	BadgeID       string `json:"badgeId"`
	ApplicationID string `json:"applicationId"`
	AwardedAt     string `json:"awardedAt"`
	Note          string `json:"note"`
}

type StemReportSummary struct {
	TotalApplications    int `json:"totalApplications"`
	TotalSchools         int `json:"totalSchools"`
	TotalEmerging        int `json:"totalEmerging"`
	TotalVotes           int `json:"totalVotes"`
	TotalSponsors        int `json:"totalSponsors"`
	TotalCertificates    int `json:"totalCertificates"`
	TotalBadgeAwards     int `json:"totalBadgeAwards"`
	TotalBootcampCohorts int `json:"totalBootcampCohorts"`
}

type StemReportBucket struct {
	Key   string `json:"key"`
	Count int    `json:"count"`
}
