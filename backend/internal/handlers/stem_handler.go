package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"path"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

type StemHandler struct {
	service services.StemService
	// audit is an OPTIONAL sink. When nil (e.g. legacy construction / unit tests
	// that don't wire it) emission is a no-op via emitAudit. This keeps the
	// existing NewStemHandler signature and all existing tests intact while
	// closing audit coverage on STEM sensitive mutations (#23).
	audit services.AuditService
}

func NewStemHandler(service services.StemService) *StemHandler {
	return &StemHandler{service: service}
}

// WithAudit attaches an audit sink so every sensitive STEM mutation
// (create/update/state-transition/approve) emits a structured audit event.
// Additive: returns the same handler for chaining in the router.
func (h *StemHandler) WithAudit(audit services.AuditService) *StemHandler {
	h.audit = audit
	return h
}

// emitAudit records a structured audit event for a STEM mutation. Actor/IP/UA
// are derived from the request context; when no authenticated actor is present
// (public STEM submission endpoints) the actor is recorded as empty and the
// event still captures the mutation for the compliance trail.
func (h *StemHandler) emitAudit(c *gin.Context, action, resourceType, resourceID string, newValues map[string]any, severity string) {
	if h.audit == nil {
		return
	}
	actorID := ""
	if actor, ok := middleware.GetAuthenticatedUser(c); ok {
		actorID = actor.ID
	}
	h.audit.LogAction(actorID, "", action, "stem", resourceType, resourceID, nil, newValues, c.ClientIP(), c.Request.UserAgent(), severity)
}

// refID best-effort extracts an "id" from a created domain struct without
// coupling emitAudit to every concrete STEM type. Returns "" when absent.
func refID(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		return ""
	}
	var m map[string]any
	if json.Unmarshal(b, &m) != nil {
		return ""
	}
	for _, k := range []string{"id", "ID", "Id"} {
		if s, ok := m[k].(string); ok && s != "" {
			return s
		}
	}
	return ""
}

func (h *StemHandler) Overview(c *gin.Context) {
	overview, err := h.service.GetOverview()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not load stem overview"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "overview": overview})
}

func (h *StemHandler) Schools(c *gin.Context) {
	limitRaw := c.DefaultQuery("limit", "100")
	limit, _ := strconv.Atoi(limitRaw)
	if limit <= 0 {
		limit = 100
	}
	if limit > 300 {
		limit = 300
	}

	schools, err := h.service.ListSchools(limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not load schools"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "schools": schools})
}

func (h *StemHandler) CreateSchool(c *gin.Context) {
	var payload struct {
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
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid payload"})
		return
	}
	if strings.TrimSpace(payload.SchoolName) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "school name is required"})
		return
	}
	if err := validateStemArtifactURL(payload.SchoolLogoURL, "image"); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": fmt.Sprintf("invalid schoolLogoUrl: %v", err)})
		return
	}
	if err := validateStemArtifactURL(payload.RegistrationDocumentURL, "document"); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": fmt.Sprintf("invalid registrationDocumentUrl: %v", err)})
		return
	}
	if err := validateStemArtifactURL(payload.AccreditationDocumentURL, "document"); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": fmt.Sprintf("invalid accreditationDocumentUrl: %v", err)})
		return
	}
	created, err := h.service.CreateSchool(domain.StemSchoolCreateInput{
		SchoolName:               payload.SchoolName,
		SchoolType:               payload.SchoolType,
		OwnershipType:            payload.OwnershipType,
		EducationLevel:           payload.EducationLevel,
		Country:                  payload.Country,
		State:                    payload.State,
		LGACity:                  payload.LGACity,
		Address:                  payload.Address,
		OfficialEmail:            payload.OfficialEmail,
		OfficialPhone:            payload.OfficialPhone,
		Website:                  payload.Website,
		PrincipalName:            payload.PrincipalName,
		SchoolAdminName:          payload.SchoolAdminName,
		SchoolAdminEmail:         payload.SchoolAdminEmail,
		SchoolAdminPhone:         payload.SchoolAdminPhone,
		NumberOfStudents:         payload.NumberOfStudents,
		HasStemClub:              payload.HasStemClub,
		HasStemTeacher:           payload.HasStemTeacher,
		SchoolLogoURL:            payload.SchoolLogoURL,
		RegistrationDocumentURL:  payload.RegistrationDocumentURL,
		AccreditationDocumentURL: payload.AccreditationDocumentURL,
		SocialLinks:              payload.SocialLinks,
		PreferredContestCategory: payload.PreferredContestCategory,
		SubmittedBy:              payload.SubmittedBy,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not create school"})
		return
	}
	h.emitAudit(c, "stem.school.create", "stem_school", refID(created), map[string]any{"schoolName": payload.SchoolName, "state": payload.State}, "medium")
	c.JSON(http.StatusCreated, gin.H{"success": true, "school": created})
}

func (h *StemHandler) UpdateSchoolVerification(c *gin.Context) {
	schoolID := strings.TrimSpace(c.Param("id"))
	if schoolID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "school id is required"})
		return
	}
	var payload struct {
		Status  string `json:"status"`
		Reason  string `json:"reason"`
		ActorID string `json:"actorId"`
	}
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid payload"})
		return
	}
	status := strings.ToUpper(strings.TrimSpace(payload.Status))
	switch status {
	case "PENDING", "UNDER_REVIEW", "APPROVED", "REJECTED", "SUSPENDED", "NEEDS_MORE_INFORMATION":
	default:
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid verification status"})
		return
	}
	if err := h.service.UpdateSchoolVerification(schoolID, status, payload.Reason, payload.ActorID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not update school verification"})
		return
	}
	h.emitAudit(c, "stem.school.verification", "stem_school", schoolID, map[string]any{"status": status, "reason": payload.Reason}, "high")
	c.JSON(http.StatusOK, gin.H{"success": true, "id": schoolID, "status": status})
}

func (h *StemHandler) SchoolDashboard(c *gin.Context) {
	schoolID := strings.TrimSpace(c.Param("id"))
	if schoolID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "school id is required"})
		return
	}
	dashboard, err := h.service.GetSchoolDashboard(schoolID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not load school dashboard"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "dashboard": dashboard})
}

func (h *StemHandler) SchoolProfiles(c *gin.Context) {
	limitRaw := c.DefaultQuery("limit", "100")
	limit, _ := strconv.Atoi(limitRaw)
	if limit <= 0 {
		limit = 100
	}
	if limit > 300 {
		limit = 300
	}
	rows, err := h.service.ListSchoolProfiles(limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not load school profiles"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "profiles": rows})
}

func (h *StemHandler) CreateSchoolProfile(c *gin.Context) {
	var payload struct {
		SchoolID       string `json:"schoolId"`
		UserID         string `json:"userId"`
		RoleType       string `json:"roleType"`
		FullName       string `json:"fullName"`
		Email          string `json:"email"`
		Phone          string `json:"phone"`
		GradeLevel     string `json:"gradeLevel"`
		Specialization string `json:"specialization"`
	}
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid payload"})
		return
	}
	if strings.TrimSpace(payload.SchoolID) == "" || strings.TrimSpace(payload.RoleType) == "" || strings.TrimSpace(payload.FullName) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "schoolId, roleType and fullName are required"})
		return
	}
	created, err := h.service.CreateSchoolProfile(domain.StemSchoolProfileCreateInput{
		SchoolID:       payload.SchoolID,
		UserID:         payload.UserID,
		RoleType:       payload.RoleType,
		FullName:       payload.FullName,
		Email:          payload.Email,
		Phone:          payload.Phone,
		GradeLevel:     payload.GradeLevel,
		Specialization: payload.Specialization,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not create school profile"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "profile": created})
}

func (h *StemHandler) SchoolTeams(c *gin.Context) {
	limitRaw := c.DefaultQuery("limit", "100")
	limit, _ := strconv.Atoi(limitRaw)
	if limit <= 0 {
		limit = 100
	}
	if limit > 300 {
		limit = 300
	}
	rows, err := h.service.ListSchoolTeams(limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not load school teams"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "teams": rows})
}

func (h *StemHandler) CreateSchoolTeam(c *gin.Context) {
	var payload struct {
		SchoolID        string `json:"schoolId"`
		TeamName        string `json:"teamName"`
		ContestCategory string `json:"contestCategory"`
		CoachName       string `json:"coachName"`
		ProjectTitle    string `json:"projectTitle"`
		TeamSize        int    `json:"teamSize"`
	}
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid payload"})
		return
	}
	if strings.TrimSpace(payload.SchoolID) == "" || strings.TrimSpace(payload.TeamName) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "schoolId and teamName are required"})
		return
	}
	created, err := h.service.CreateSchoolTeam(domain.StemSchoolTeamCreateInput{
		SchoolID:        payload.SchoolID,
		TeamName:        payload.TeamName,
		ContestCategory: payload.ContestCategory,
		CoachName:       payload.CoachName,
		ProjectTitle:    payload.ProjectTitle,
		TeamSize:        payload.TeamSize,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not create school team"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "team": created})
}

func (h *StemHandler) EmergingInnovators(c *gin.Context) {
	limitRaw := c.DefaultQuery("limit", "100")
	limit, _ := strconv.Atoi(limitRaw)
	if limit <= 0 {
		limit = 100
	}
	if limit > 300 {
		limit = 300
	}

	rows, err := h.service.ListEmergingInnovators(limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not load emerging innovators"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "emergingInnovators": rows})
}

func (h *StemHandler) CreateEmergingInnovator(c *gin.Context) {
	var payload struct {
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
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid payload"})
		return
	}
	if strings.TrimSpace(payload.FullName) == "" || strings.TrimSpace(payload.Email) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "full name and email are required"})
		return
	}
	if err := validateStemArtifactURL(payload.PitchDeckURL, "deck"); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": fmt.Sprintf("invalid pitchDeckUrl: %v", err)})
		return
	}
	if err := validateStemArtifactURL(payload.VideoDemoURL, "video"); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": fmt.Sprintf("invalid videoDemoUrl: %v", err)})
		return
	}
	if err := validateStemArtifactURL(payload.PhotoURL, "image"); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": fmt.Sprintf("invalid photoUrl: %v", err)})
		return
	}
	if err := validateStemArtifactURL(payload.IDVerificationURL, "id_doc"); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": fmt.Sprintf("invalid idVerificationUrl: %v", err)})
		return
	}

	created, err := h.service.CreateEmergingInnovator(domain.StemEmergingInnovatorCreateInput{
		FullName:            payload.FullName,
		Email:               payload.Email,
		Phone:               payload.Phone,
		Country:             payload.Country,
		State:               payload.State,
		LGACity:             payload.LGACity,
		EducationBackground: payload.EducationBackground,
		CurrentStatus:       payload.CurrentStatus,
		StemSkillArea:       payload.StemSkillArea,
		InnovationTrack:     payload.InnovationTrack,
		PortfolioURL:        payload.PortfolioURL,
		LinkedInURL:         payload.LinkedInURL,
		GitHubURL:           payload.GitHubURL,
		SocialLinks:         payload.SocialLinks,
		BusinessName:        payload.BusinessName,
		TeamName:            payload.TeamName,
		PrototypeAvailable:  payload.PrototypeAvailable,
		PitchDeckURL:        payload.PitchDeckURL,
		VideoDemoURL:        payload.VideoDemoURL,
		PhotoURL:            payload.PhotoURL,
		IDVerificationURL:   payload.IDVerificationURL,
		SubmittedBy:         payload.SubmittedBy,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not create emerging innovator"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "emergingInnovator": created})
}

func (h *StemHandler) EmergingTeams(c *gin.Context) {
	limitRaw := c.DefaultQuery("limit", "100")
	limit, _ := strconv.Atoi(limitRaw)
	if limit <= 0 {
		limit = 100
	}
	if limit > 300 {
		limit = 300
	}
	rows, err := h.service.ListEmergingTeams(limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not load emerging teams"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "teams": rows})
}

func (h *StemHandler) CreateEmergingTeam(c *gin.Context) {
	var payload struct {
		InnovatorID     string `json:"innovatorId"`
		TeamName        string `json:"teamName"`
		InnovationTrack string `json:"innovationTrack"`
		TeamSize        int    `json:"teamSize"`
	}
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid payload"})
		return
	}
	if strings.TrimSpace(payload.InnovatorID) == "" || strings.TrimSpace(payload.TeamName) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "innovatorId and teamName are required"})
		return
	}
	created, err := h.service.CreateEmergingTeam(domain.StemEmergingTeamCreateInput{
		InnovatorID:     payload.InnovatorID,
		TeamName:        payload.TeamName,
		InnovationTrack: payload.InnovationTrack,
		TeamSize:        payload.TeamSize,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not create emerging team"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "team": created})
}

func (h *StemHandler) EmergingProjects(c *gin.Context) {
	limitRaw := c.DefaultQuery("limit", "100")
	limit, _ := strconv.Atoi(limitRaw)
	if limit <= 0 {
		limit = 100
	}
	if limit > 300 {
		limit = 300
	}
	rows, err := h.service.ListEmergingProjects(limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not load emerging projects"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "projects": rows})
}

func (h *StemHandler) CreateEmergingProject(c *gin.Context) {
	var payload struct {
		TeamID           string `json:"teamId"`
		ProjectTitle     string `json:"projectTitle"`
		Category         string `json:"category"`
		ProblemStatement string `json:"problemStatement"`
		ProposedSolution string `json:"proposedSolution"`
	}
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid payload"})
		return
	}
	if strings.TrimSpace(payload.TeamID) == "" || strings.TrimSpace(payload.ProjectTitle) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "teamId and projectTitle are required"})
		return
	}
	created, err := h.service.CreateEmergingProject(domain.StemEmergingProjectCreateInput{
		TeamID:           payload.TeamID,
		ProjectTitle:     payload.ProjectTitle,
		Category:         payload.Category,
		ProblemStatement: payload.ProblemStatement,
		ProposedSolution: payload.ProposedSolution,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not create emerging project"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "project": created})
}

func (h *StemHandler) Contests(c *gin.Context) {
	limitRaw := c.DefaultQuery("limit", "100")
	limit, _ := strconv.Atoi(limitRaw)
	if limit <= 0 {
		limit = 100
	}
	if limit > 300 {
		limit = 300
	}
	rows, err := h.service.ListContests(limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not load contests"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "contests": rows})
}

func (h *StemHandler) CreateContest(c *gin.Context) {
	var payload struct {
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
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid payload"})
		return
	}
	if strings.TrimSpace(payload.Name) == "" || strings.TrimSpace(payload.Slug) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "name and slug are required"})
		return
	}
	created, err := h.service.CreateContest(domain.StemContestCreateInput{
		Name:                     payload.Name,
		Slug:                     payload.Slug,
		ContestType:              payload.ContestType,
		ContestMode:              payload.ContestMode,
		EligibleParticipantTypes: payload.EligibleParticipantTypes,
		EligibleSchoolLevels:     payload.EligibleSchoolLevels,
		EligibleStates:           payload.EligibleStates,
		AllowMixedChannels:       payload.AllowMixedChannels,
		RankingFormula:           payload.RankingFormula,
		StageLifecycle:           payload.StageLifecycle,
		StageTransitions:         payload.StageTransitions,
		Status:                   payload.Status,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not create contest"})
		return
	}
	h.emitAudit(c, "stem.contest.create", "stem_contest", refID(created), map[string]any{"name": payload.Name, "slug": payload.Slug, "status": payload.Status}, "high")
	c.JSON(http.StatusCreated, gin.H{"success": true, "contest": created})
}

func (h *StemHandler) CheckEligibility(c *gin.Context) {
	var payload struct {
		ContestID       string `json:"contestId"`
		ParticipantType string `json:"participantType"`
		State           string `json:"state"`
		SchoolLevel     string `json:"schoolLevel"`
		SchoolVerified  bool   `json:"schoolVerified"`
	}
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid payload"})
		return
	}
	if strings.TrimSpace(payload.ContestID) == "" || strings.TrimSpace(payload.ParticipantType) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "contestId and participantType are required"})
		return
	}
	result, err := h.service.CheckEligibility(domain.StemEligibilityCheckInput{
		ContestID:       payload.ContestID,
		ParticipantType: payload.ParticipantType,
		State:           payload.State,
		SchoolLevel:     payload.SchoolLevel,
		SchoolVerified:  payload.SchoolVerified,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "eligibility check failed"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "result": result})
}

func (h *StemHandler) Leaderboard(c *gin.Context) {
	contestID := strings.TrimSpace(c.Query("contestId"))
	if contestID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "contestId is required"})
		return
	}
	limitRaw := c.DefaultQuery("limit", "100")
	limit, _ := strconv.Atoi(limitRaw)
	if limit <= 0 {
		limit = 100
	}
	if limit > 300 {
		limit = 300
	}
	// Annotated with previous-rank/rankChange (additive projection layer).
	rows, err := h.service.ListLeaderboardWithRankChange(contestID, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not load leaderboard"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "leaderboard": rows})
}

func (h *StemHandler) LeaderboardSlices(c *gin.Context) {
	contestID := strings.TrimSpace(c.Query("contestId"))
	by := strings.TrimSpace(c.DefaultQuery("by", "participant_type"))
	if contestID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "contestId is required"})
		return
	}
	limitRaw := c.DefaultQuery("limit", "100")
	limit, _ := strconv.Atoi(limitRaw)
	if limit <= 0 {
		limit = 100
	}
	if limit > 300 {
		limit = 300
	}
	rows, err := h.service.ListLeaderboardSlices(contestID, by, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not load leaderboard slices"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "slices": rows})
}

func (h *StemHandler) Submissions(c *gin.Context) {
	limitRaw := c.DefaultQuery("limit", "100")
	limit, _ := strconv.Atoi(limitRaw)
	if limit <= 0 {
		limit = 100
	}
	if limit > 300 {
		limit = 300
	}
	status := strings.TrimSpace(c.Query("status"))
	rows, err := h.service.ListSubmissions(limit, status)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not load submissions"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "submissions": rows})
}

func (h *StemHandler) UpdateSubmissionStatus(c *gin.Context) {
	submissionID := strings.TrimSpace(c.Param("id"))
	if submissionID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "submission id is required"})
		return
	}
	var payload struct {
		Status      string `json:"status"`
		ReviewStage string `json:"reviewStage"`
	}
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid payload"})
		return
	}
	if strings.TrimSpace(payload.Status) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "status is required"})
		return
	}
	if err := h.service.UpdateSubmissionStatus(submissionID, payload.Status, payload.ReviewStage); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not update submission status"})
		return
	}
	h.emitAudit(c, "stem.submission.status", "stem_submission", submissionID, map[string]any{"status": payload.Status, "reviewStage": payload.ReviewStage}, "high")
	c.JSON(http.StatusOK, gin.H{"success": true, "id": submissionID, "status": payload.Status})
}

func (h *StemHandler) CreateJudgingScore(c *gin.Context) {
	var payload struct {
		ApplicationID       string  `json:"applicationId"`
		ReviewerID          string  `json:"reviewerId"`
		InnovationScore     float64 `json:"innovationScore"`
		TechnicalDepthScore float64 `json:"technicalDepthScore"`
		ImpactScore         float64 `json:"impactScore"`
		OverallScore        float64 `json:"overallScore"`
		Notes               string  `json:"notes"`
	}
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid payload"})
		return
	}
	if strings.TrimSpace(payload.ApplicationID) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "applicationId is required"})
		return
	}
	created, err := h.service.UpsertJudgingScore(domain.StemJudgingScore{
		ApplicationID: payload.ApplicationID, ReviewerID: payload.ReviewerID, InnovationScore: payload.InnovationScore,
		TechnicalDepthScore: payload.TechnicalDepthScore, ImpactScore: payload.ImpactScore, OverallScore: payload.OverallScore, Notes: payload.Notes,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not create judging score"})
		return
	}
	h.emitAudit(c, "stem.judging.score.upsert", "stem_judging_score", refID(created), map[string]any{"applicationId": payload.ApplicationID, "reviewerId": payload.ReviewerID, "overallScore": payload.OverallScore}, "high")
	c.JSON(http.StatusCreated, gin.H{"success": true, "score": created})
}

func (h *StemHandler) JudgingScores(c *gin.Context) {
	applicationID := strings.TrimSpace(c.Query("applicationId"))
	if applicationID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "applicationId is required"})
		return
	}
	limitRaw := c.DefaultQuery("limit", "100")
	limit, _ := strconv.Atoi(limitRaw)
	if limit <= 0 {
		limit = 100
	}
	if limit > 300 {
		limit = 300
	}
	rows, err := h.service.ListJudgingScores(applicationID, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not load judging scores"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "scores": rows})
}

func (h *StemHandler) UpdateJudgingScoreReviewState(c *gin.Context) {
	scoreID := strings.TrimSpace(c.Param("id"))
	if scoreID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "score id is required"})
		return
	}
	var payload struct {
		ReviewStatus string `json:"reviewStatus"`
		IsLocked     bool   `json:"isLocked"`
		LockReason   string `json:"lockReason"`
		LockedBy     string `json:"lockedBy"`
	}
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid payload"})
		return
	}
	if strings.TrimSpace(payload.ReviewStatus) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "reviewStatus is required"})
		return
	}
	reviewStatus := strings.ToLower(strings.TrimSpace(payload.ReviewStatus))
	allowedReviewStatuses := map[string]struct{}{
		"submitted": {}, "in_review": {}, "locked": {}, "reopened": {}, "approved": {}, "rejected": {}, "conflict_hold": {},
	}
	if _, ok := allowedReviewStatuses[reviewStatus]; !ok {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid reviewStatus"})
		return
	}
	if payload.IsLocked && strings.TrimSpace(payload.LockReason) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "lockReason is required when isLocked is true"})
		return
	}
	if reviewStatus == "locked" && !payload.IsLocked {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "locked reviewStatus requires isLocked=true"})
		return
	}
	if err := h.service.UpdateJudgingScoreReviewState(scoreID, payload.ReviewStatus, payload.IsLocked, payload.LockReason, payload.LockedBy); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not update judging score review state"})
		return
	}
	h.emitAudit(c, "stem.judging.score.review_state", "stem_judging_score", scoreID, map[string]any{"reviewStatus": reviewStatus, "isLocked": payload.IsLocked, "lockReason": payload.LockReason}, "high")
	c.JSON(http.StatusOK, gin.H{"success": true, "id": scoreID})
}

func (h *StemHandler) CreateJudgingRubric(c *gin.Context) {
	var payload struct {
		ContestID   string `json:"contestId"`
		Name        string `json:"name"`
		Description string `json:"description"`
		Status      string `json:"status"`
		Criteria    []struct {
			Key         string  `json:"key"`
			Label       string  `json:"label"`
			WeightPct   float64 `json:"weightPct"`
			MaxScore    float64 `json:"maxScore"`
			Description string  `json:"description"`
		} `json:"criteria"`
	}
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid payload"})
		return
	}
	if strings.TrimSpace(payload.ContestID) == "" || strings.TrimSpace(payload.Name) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "contestId and name are required"})
		return
	}
	criteria := make([]domain.StemJudgingCriterion, 0, len(payload.Criteria))
	for _, item := range payload.Criteria {
		criteria = append(criteria, domain.StemJudgingCriterion{
			Key: item.Key, Label: item.Label, WeightPct: item.WeightPct, MaxScore: item.MaxScore, Description: item.Description,
		})
	}
	rubric, createdCriteria, err := h.service.CreateJudgingRubric(domain.StemJudgingRubric{
		ContestID: payload.ContestID, Name: payload.Name, Description: payload.Description, Status: payload.Status,
	}, criteria)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not create judging rubric"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "rubric": rubric, "criteria": createdCriteria})
}

func (h *StemHandler) JudgingRubrics(c *gin.Context) {
	contestID := strings.TrimSpace(c.Query("contestId"))
	limitRaw := c.DefaultQuery("limit", "100")
	limit, _ := strconv.Atoi(limitRaw)
	if limit <= 0 {
		limit = 100
	}
	if limit > 300 {
		limit = 300
	}
	rows, err := h.service.ListJudgingRubrics(contestID, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not load judging rubrics"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "rubrics": rows})
}

func (h *StemHandler) JudgingCriteria(c *gin.Context) {
	rubricID := strings.TrimSpace(c.Query("rubricId"))
	if rubricID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "rubricId is required"})
		return
	}
	limitRaw := c.DefaultQuery("limit", "100")
	limit, _ := strconv.Atoi(limitRaw)
	if limit <= 0 {
		limit = 100
	}
	if limit > 300 {
		limit = 300
	}
	rows, err := h.service.ListJudgingCriteria(rubricID, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not load judging criteria"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "criteria": rows})
}

func (h *StemHandler) CreateJudgeAssignment(c *gin.Context) {
	var payload struct {
		ContestID     string `json:"contestId"`
		ApplicationID string `json:"applicationId"`
		JudgeUserID   string `json:"judgeUserId"`
		Status        string `json:"status"`
	}
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid payload"})
		return
	}
	if strings.TrimSpace(payload.ContestID) == "" || strings.TrimSpace(payload.ApplicationID) == "" || strings.TrimSpace(payload.JudgeUserID) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "contestId, applicationId, and judgeUserId are required"})
		return
	}
	status := strings.ToLower(strings.TrimSpace(payload.Status))
	if status == "" {
		status = "assigned"
	}
	allowedAssignmentStatuses := map[string]struct{}{
		"assigned": {}, "flagged_conflict": {}, "recused": {}, "reassigned": {}, "resolved": {},
	}
	if _, ok := allowedAssignmentStatuses[status]; !ok {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid assignment status"})
		return
	}
	created, err := h.service.CreateJudgeAssignment(domain.StemJudgeAssignment{
		ContestID: payload.ContestID, ApplicationID: payload.ApplicationID, JudgeUserID: payload.JudgeUserID, Status: status,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not create judge assignment"})
		return
	}
	h.emitAudit(c, "stem.judging.assignment.create", "stem_judge_assignment", refID(created), map[string]any{"contestId": payload.ContestID, "applicationId": payload.ApplicationID, "judgeUserId": payload.JudgeUserID, "status": status}, "high")
	c.JSON(http.StatusCreated, gin.H{"success": true, "assignment": created})
}

func (h *StemHandler) JudgeAssignments(c *gin.Context) {
	contestID := strings.TrimSpace(c.Query("contestId"))
	applicationID := strings.TrimSpace(c.Query("applicationId"))
	judgeUserID := strings.TrimSpace(c.Query("judgeUserId"))
	limitRaw := c.DefaultQuery("limit", "100")
	limit, _ := strconv.Atoi(limitRaw)
	if limit <= 0 {
		limit = 100
	}
	if limit > 300 {
		limit = 300
	}
	rows, err := h.service.ListJudgeAssignments(contestID, applicationID, judgeUserID, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not load judge assignments"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "assignments": rows})
}

func (h *StemHandler) UpdateJudgeAssignmentConflict(c *gin.Context) {
	assignmentID := strings.TrimSpace(c.Param("id"))
	if assignmentID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "assignment id is required"})
		return
	}
	var payload struct {
		HasConflict    bool   `json:"hasConflict"`
		ConflictReason string `json:"conflictReason"`
		Status         string `json:"status"`
	}
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid payload"})
		return
	}
	status := strings.ToLower(strings.TrimSpace(payload.Status))
	if payload.HasConflict {
		if strings.TrimSpace(payload.ConflictReason) == "" {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "conflictReason is required when hasConflict is true"})
			return
		}
		if status == "" {
			status = "flagged_conflict"
		}
		if status != "flagged_conflict" && status != "recused" {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "status must be flagged_conflict or recused when hasConflict is true"})
			return
		}
	} else {
		if status == "" {
			status = "resolved"
		}
		if status == "flagged_conflict" {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "cannot keep flagged_conflict status when hasConflict is false"})
			return
		}
	}
	if err := h.service.UpdateJudgeAssignmentConflict(assignmentID, payload.HasConflict, payload.ConflictReason, status); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not update judge assignment conflict"})
		return
	}
	h.emitAudit(c, "stem.judging.assignment.conflict", "stem_judge_assignment", assignmentID, map[string]any{"hasConflict": payload.HasConflict, "conflictReason": payload.ConflictReason, "status": status}, "high")
	c.JSON(http.StatusOK, gin.H{"success": true, "id": assignmentID})
}

func validateStemArtifactURL(raw string, kind string) error {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("invalid URL format")
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return fmt.Errorf("URL must use http or https")
	}
	ext := strings.ToLower(path.Ext(parsed.Path))
	if ext == "" {
		return fmt.Errorf("missing file extension")
	}

	allowed := map[string]map[string]struct{}{
		"image": {
			".jpg": {}, ".jpeg": {}, ".png": {}, ".webp": {},
		},
		"document": {
			".pdf": {},
		},
		"deck": {
			".pdf": {}, ".ppt": {}, ".pptx": {},
		},
		"video": {
			".mp4": {}, ".mov": {}, ".webm": {},
		},
		"id_doc": {
			".pdf": {}, ".jpg": {}, ".jpeg": {}, ".png": {},
		},
	}
	group, ok := allowed[kind]
	if !ok {
		return fmt.Errorf("unknown artifact type")
	}
	if _, ok := group[ext]; !ok {
		return fmt.Errorf("unsupported file extension %s", ext)
	}
	return nil
}

func (h *StemHandler) VotingRules(c *gin.Context) {
	contestID := strings.TrimSpace(c.Query("contestId"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "100"))
	if limit <= 0 {
		limit = 100
	}
	rows, err := h.service.ListVotingRules(contestID, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not load voting rules"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "rules": rows})
}

func (h *StemHandler) UpsertVotingRule(c *gin.Context) {
	var payload domain.StemVotingRule
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid payload"})
		return
	}
	if strings.TrimSpace(payload.ContestID) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "contestId is required"})
		return
	}
	created, err := h.service.UpsertVotingRule(payload)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not upsert voting rule"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "rule": created})
}

func (h *StemHandler) VotePackages(c *gin.Context) {
	contestID := strings.TrimSpace(c.Query("contestId"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "100"))
	if limit <= 0 {
		limit = 100
	}
	rows, err := h.service.ListVotePackages(contestID, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not load vote packages"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "packages": rows})
}

func (h *StemHandler) CreateVotePackage(c *gin.Context) {
	var payload domain.StemVotePackage
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid payload"})
		return
	}
	if strings.TrimSpace(payload.ContestID) == "" || strings.TrimSpace(payload.Name) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "contestId and name are required"})
		return
	}
	created, err := h.service.CreateVotePackage(payload)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not create vote package"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "package": created})
}

func (h *StemHandler) VoteTransactions(c *gin.Context) {
	contestID := strings.TrimSpace(c.Query("contestId"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "100"))
	if limit <= 0 {
		limit = 100
	}
	rows, err := h.service.ListVoteTransactions(contestID, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not load vote transactions"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "transactions": rows})
}

func (h *StemHandler) CreateVoteTransaction(c *gin.Context) {
	var payload domain.StemVoteTransaction
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid payload"})
		return
	}
	if strings.TrimSpace(payload.ContestID) == "" || strings.TrimSpace(payload.VoterRef) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "contestId and voterRef are required"})
		return
	}
	created, err := h.service.CreateVoteTransaction(payload)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not create vote transaction"})
		return
	}
	h.emitAudit(c, "stem.voting.transaction.create", "stem_vote_transaction", refID(created), map[string]any{"contestId": payload.ContestID, "voterRef": payload.VoterRef}, "high")
	c.JSON(http.StatusCreated, gin.H{"success": true, "transaction": created})
}

func (h *StemHandler) BootcampCohorts(c *gin.Context) {
	contestID := strings.TrimSpace(c.Query("contestId"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "100"))
	if limit <= 0 {
		limit = 100
	}
	rows, err := h.service.ListBootcampCohorts(contestID, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not load bootcamp cohorts"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "cohorts": rows})
}

func (h *StemHandler) CreateBootcampCohort(c *gin.Context) {
	var payload domain.StemBootcampCohort
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid payload"})
		return
	}
	if strings.TrimSpace(payload.Name) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "name is required"})
		return
	}
	created, err := h.service.CreateBootcampCohort(payload)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not create bootcamp cohort"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "cohort": created})
}

func (h *StemHandler) BootcampTasks(c *gin.Context) {
	cohortID := strings.TrimSpace(c.Query("cohortId"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "100"))
	if limit <= 0 {
		limit = 100
	}
	rows, err := h.service.ListBootcampTasks(cohortID, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not load bootcamp tasks"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "tasks": rows})
}

func (h *StemHandler) CreateBootcampTask(c *gin.Context) {
	var payload domain.StemBootcampTask
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid payload"})
		return
	}
	if strings.TrimSpace(payload.CohortID) == "" || strings.TrimSpace(payload.Title) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "cohortId and title are required"})
		return
	}
	created, err := h.service.CreateBootcampTask(payload)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not create bootcamp task"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "task": created})
}

func (h *StemHandler) BootcampScores(c *gin.Context) {
	cohortID := strings.TrimSpace(c.Query("cohortId"))
	applicationID := strings.TrimSpace(c.Query("applicationId"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "100"))
	if limit <= 0 {
		limit = 100
	}
	rows, err := h.service.ListBootcampScores(cohortID, applicationID, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not load bootcamp scores"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "scores": rows})
}

func (h *StemHandler) UpsertBootcampScore(c *gin.Context) {
	var payload domain.StemBootcampScore
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid payload"})
		return
	}
	if strings.TrimSpace(payload.CohortID) == "" || strings.TrimSpace(payload.TaskID) == "" || strings.TrimSpace(payload.ApplicationID) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "cohortId, taskId and applicationId are required"})
		return
	}
	created, err := h.service.UpsertBootcampScore(payload)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not upsert bootcamp score"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "score": created})
}

func (h *StemHandler) Sponsors(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "100"))
	if limit <= 0 {
		limit = 100
	}
	rows, err := h.service.ListSponsors(limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not load sponsors"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "sponsors": rows})
}

func (h *StemHandler) CreateSponsor(c *gin.Context) {
	var payload domain.StemSponsor
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid payload"})
		return
	}
	if strings.TrimSpace(payload.Name) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "name is required"})
		return
	}
	created, err := h.service.CreateSponsor(payload)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not create sponsor"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "sponsor": created})
}

func (h *StemHandler) Certificates(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "100"))
	if limit <= 0 {
		limit = 100
	}
	rows, err := h.service.ListCertificates(limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not load certificates"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "certificates": rows})
}

func (h *StemHandler) CreateCertificate(c *gin.Context) {
	var payload domain.StemCertificate
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid payload"})
		return
	}
	if strings.TrimSpace(payload.CertificateType) == "" || strings.TrimSpace(payload.CertificateNumber) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "certificateType and certificateNumber are required"})
		return
	}
	created, err := h.service.CreateCertificate(payload)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not create certificate"})
		return
	}
	h.emitAudit(c, "stem.award.certificate.create", "stem_certificate", refID(created), map[string]any{"certificateType": payload.CertificateType, "certificateNumber": payload.CertificateNumber}, "high")
	c.JSON(http.StatusCreated, gin.H{"success": true, "certificate": created})
}

func (h *StemHandler) Badges(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "100"))
	if limit <= 0 {
		limit = 100
	}
	rows, err := h.service.ListBadges(limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not load badges"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "badges": rows})
}

func (h *StemHandler) CreateBadge(c *gin.Context) {
	var payload domain.StemBadge
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid payload"})
		return
	}
	if strings.TrimSpace(payload.Name) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "name is required"})
		return
	}
	created, err := h.service.CreateBadge(payload)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not create badge"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "badge": created})
}

func (h *StemHandler) BadgeAwards(c *gin.Context) {
	applicationID := strings.TrimSpace(c.Query("applicationId"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "100"))
	if limit <= 0 {
		limit = 100
	}
	rows, err := h.service.ListBadgeAwards(applicationID, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not load badge awards"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "awards": rows})
}

func (h *StemHandler) AwardBadge(c *gin.Context) {
	var payload domain.StemBadgeAward
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid payload"})
		return
	}
	if strings.TrimSpace(payload.BadgeID) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "badgeId is required"})
		return
	}
	created, err := h.service.AwardBadge(payload)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not award badge"})
		return
	}
	h.emitAudit(c, "stem.award.badge.grant", "stem_badge_award", refID(created), map[string]any{"badgeId": payload.BadgeID}, "high")
	c.JSON(http.StatusCreated, gin.H{"success": true, "award": created})
}

func (h *StemHandler) ReportSummary(c *gin.Context) {
	summary, err := h.service.GetReportSummary()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not load report summary"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "summary": summary})
}

func (h *StemHandler) ReportBuckets(c *gin.Context) {
	kind := strings.TrimSpace(c.Query("kind"))
	contestID := strings.TrimSpace(c.Query("contestId"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "100"))
	if limit <= 0 {
		limit = 100
	}
	rows, err := h.service.GetReportBuckets(kind, contestID, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not load report buckets"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "buckets": rows})
}
