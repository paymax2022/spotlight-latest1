package services

import (
	"strings"

	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/repositories"
)

type StemService interface {
	GetOverview() (domain.StemOverview, error)
	ListSchools(limit int) ([]domain.StemSchool, error)
	CreateSchool(input domain.StemSchoolCreateInput) (domain.StemSchool, error)
	UpdateSchoolVerification(schoolID string, status string, reason string, actorID string) error
	GetSchoolDashboard(schoolID string) (domain.StemSchoolDashboard, error)
	ListSchoolProfiles(limit int) ([]domain.StemSchoolProfile, error)
	CreateSchoolProfile(input domain.StemSchoolProfileCreateInput) (domain.StemSchoolProfile, error)
	ListSchoolTeams(limit int) ([]domain.StemSchoolTeam, error)
	CreateSchoolTeam(input domain.StemSchoolTeamCreateInput) (domain.StemSchoolTeam, error)
	ListEmergingInnovators(limit int) ([]domain.StemEmergingInnovator, error)
	CreateEmergingInnovator(input domain.StemEmergingInnovatorCreateInput) (domain.StemEmergingInnovator, error)
	ListEmergingTeams(limit int) ([]domain.StemEmergingTeam, error)
	CreateEmergingTeam(input domain.StemEmergingTeamCreateInput) (domain.StemEmergingTeam, error)
	ListEmergingProjects(limit int) ([]domain.StemEmergingProject, error)
	CreateEmergingProject(input domain.StemEmergingProjectCreateInput) (domain.StemEmergingProject, error)
	ListContests(limit int) ([]domain.StemContest, error)
	CreateContest(input domain.StemContestCreateInput) (domain.StemContest, error)
	CheckEligibility(input domain.StemEligibilityCheckInput) (domain.StemEligibilityCheckResult, error)
	ListLeaderboard(contestID string, limit int) ([]domain.StemLeaderboardEntry, error)
	ListLeaderboardSlices(contestID string, by string, limit int) ([]domain.StemLeaderboardSlice, error)
	ListSubmissions(limit int, status string) ([]domain.StemSubmission, error)
	UpdateSubmissionStatus(submissionID string, status string, reviewStage string) error
	UpsertJudgingScore(score domain.StemJudgingScore) (domain.StemJudgingScore, error)
	ListJudgingScores(applicationID string, limit int) ([]domain.StemJudgingScore, error)
	UpdateJudgingScoreReviewState(scoreID string, reviewStatus string, isLocked bool, lockReason string, lockedBy string) error
	CreateJudgingRubric(rubric domain.StemJudgingRubric, criteria []domain.StemJudgingCriterion) (domain.StemJudgingRubric, []domain.StemJudgingCriterion, error)
	ListJudgingRubrics(contestID string, limit int) ([]domain.StemJudgingRubric, error)
	ListJudgingCriteria(rubricID string, limit int) ([]domain.StemJudgingCriterion, error)
	CreateJudgeAssignment(assignment domain.StemJudgeAssignment) (domain.StemJudgeAssignment, error)
	ListJudgeAssignments(contestID string, applicationID string, judgeUserID string, limit int) ([]domain.StemJudgeAssignment, error)
	UpdateJudgeAssignmentConflict(assignmentID string, hasConflict bool, conflictReason string, status string) error
	UpsertVotingRule(rule domain.StemVotingRule) (domain.StemVotingRule, error)
	ListVotingRules(contestID string, limit int) ([]domain.StemVotingRule, error)
	CreateVotePackage(pkg domain.StemVotePackage) (domain.StemVotePackage, error)
	ListVotePackages(contestID string, limit int) ([]domain.StemVotePackage, error)
	CreateVoteTransaction(tx domain.StemVoteTransaction) (domain.StemVoteTransaction, error)
	ListVoteTransactions(contestID string, limit int) ([]domain.StemVoteTransaction, error)
	CreateBootcampCohort(cohort domain.StemBootcampCohort) (domain.StemBootcampCohort, error)
	ListBootcampCohorts(contestID string, limit int) ([]domain.StemBootcampCohort, error)
	CreateBootcampTask(task domain.StemBootcampTask) (domain.StemBootcampTask, error)
	ListBootcampTasks(cohortID string, limit int) ([]domain.StemBootcampTask, error)
	UpsertBootcampScore(score domain.StemBootcampScore) (domain.StemBootcampScore, error)
	ListBootcampScores(cohortID string, applicationID string, limit int) ([]domain.StemBootcampScore, error)
	CreateSponsor(sponsor domain.StemSponsor) (domain.StemSponsor, error)
	ListSponsors(limit int) ([]domain.StemSponsor, error)
	CreateCertificate(cert domain.StemCertificate) (domain.StemCertificate, error)
	ListCertificates(limit int) ([]domain.StemCertificate, error)
	CreateBadge(badge domain.StemBadge) (domain.StemBadge, error)
	ListBadges(limit int) ([]domain.StemBadge, error)
	AwardBadge(award domain.StemBadgeAward) (domain.StemBadgeAward, error)
	ListBadgeAwards(applicationID string, limit int) ([]domain.StemBadgeAward, error)
	GetReportSummary() (domain.StemReportSummary, error)
	GetReportBuckets(kind string, contestID string, limit int) ([]domain.StemReportBucket, error)
}

type stemService struct {
	repo repositories.StemRepository
}

func NewStemService(repo repositories.StemRepository) StemService {
	return &stemService{repo: repo}
}

func (s *stemService) GetOverview() (domain.StemOverview, error) {
	if s.repo == nil {
		return domain.StemOverview{}, nil
	}
	return s.repo.GetOverview()
}

func (s *stemService) ListSchools(limit int) ([]domain.StemSchool, error) {
	if s.repo == nil {
		return []domain.StemSchool{}, nil
	}
	return s.repo.ListSchools(limit)
}

func (s *stemService) CreateSchool(input domain.StemSchoolCreateInput) (domain.StemSchool, error) {
	if s.repo == nil {
		return domain.StemSchool{}, nil
	}
	return s.repo.CreateSchool(input)
}

func (s *stemService) UpdateSchoolVerification(schoolID string, status string, reason string, actorID string) error {
	if s.repo == nil {
		return nil
	}
	return s.repo.UpdateSchoolVerification(schoolID, status, reason, actorID)
}

func (s *stemService) GetSchoolDashboard(schoolID string) (domain.StemSchoolDashboard, error) {
	if s.repo == nil {
		return domain.StemSchoolDashboard{}, nil
	}
	return s.repo.GetSchoolDashboard(schoolID)
}

func (s *stemService) ListSchoolProfiles(limit int) ([]domain.StemSchoolProfile, error) {
	if s.repo == nil {
		return []domain.StemSchoolProfile{}, nil
	}
	return s.repo.ListSchoolProfiles(limit)
}

func (s *stemService) CreateSchoolProfile(input domain.StemSchoolProfileCreateInput) (domain.StemSchoolProfile, error) {
	if s.repo == nil {
		return domain.StemSchoolProfile{}, nil
	}
	return s.repo.CreateSchoolProfile(input)
}

func (s *stemService) ListSchoolTeams(limit int) ([]domain.StemSchoolTeam, error) {
	if s.repo == nil {
		return []domain.StemSchoolTeam{}, nil
	}
	return s.repo.ListSchoolTeams(limit)
}

func (s *stemService) CreateSchoolTeam(input domain.StemSchoolTeamCreateInput) (domain.StemSchoolTeam, error) {
	if s.repo == nil {
		return domain.StemSchoolTeam{}, nil
	}
	return s.repo.CreateSchoolTeam(input)
}

func (s *stemService) ListEmergingInnovators(limit int) ([]domain.StemEmergingInnovator, error) {
	if s.repo == nil {
		return []domain.StemEmergingInnovator{}, nil
	}
	return s.repo.ListEmergingInnovators(limit)
}

func (s *stemService) CreateEmergingInnovator(input domain.StemEmergingInnovatorCreateInput) (domain.StemEmergingInnovator, error) {
	if s.repo == nil {
		return domain.StemEmergingInnovator{}, nil
	}
	return s.repo.CreateEmergingInnovator(input)
}

func (s *stemService) ListEmergingTeams(limit int) ([]domain.StemEmergingTeam, error) {
	if s.repo == nil {
		return []domain.StemEmergingTeam{}, nil
	}
	return s.repo.ListEmergingTeams(limit)
}

func (s *stemService) CreateEmergingTeam(input domain.StemEmergingTeamCreateInput) (domain.StemEmergingTeam, error) {
	if s.repo == nil {
		return domain.StemEmergingTeam{}, nil
	}
	return s.repo.CreateEmergingTeam(input)
}

func (s *stemService) ListEmergingProjects(limit int) ([]domain.StemEmergingProject, error) {
	if s.repo == nil {
		return []domain.StemEmergingProject{}, nil
	}
	return s.repo.ListEmergingProjects(limit)
}

func (s *stemService) CreateEmergingProject(input domain.StemEmergingProjectCreateInput) (domain.StemEmergingProject, error) {
	if s.repo == nil {
		return domain.StemEmergingProject{}, nil
	}
	return s.repo.CreateEmergingProject(input)
}

func (s *stemService) ListContests(limit int) ([]domain.StemContest, error) {
	if s.repo == nil {
		return []domain.StemContest{}, nil
	}
	return s.repo.ListContests(limit)
}

func (s *stemService) CreateContest(input domain.StemContestCreateInput) (domain.StemContest, error) {
	if s.repo == nil {
		return domain.StemContest{}, nil
	}
	return s.repo.CreateContest(input)
}

func (s *stemService) CheckEligibility(input domain.StemEligibilityCheckInput) (domain.StemEligibilityCheckResult, error) {
	out := domain.StemEligibilityCheckResult{Eligible: false, Reasons: []string{}}
	if s.repo == nil {
		out.Reasons = append(out.Reasons, "contest repository unavailable")
		return out, nil
	}
	contest, err := s.repo.GetContestByID(input.ContestID)
	if err != nil {
		out.Reasons = append(out.Reasons, "contest not found")
		return out, nil
	}

	participantType := strings.ToUpper(strings.TrimSpace(input.ParticipantType))
	state := strings.ToUpper(strings.TrimSpace(input.State))
	schoolLevel := strings.ToUpper(strings.TrimSpace(input.SchoolLevel))

	if len(contest.EligibleParticipantTypes) > 0 && !containsIgnoreCase(contest.EligibleParticipantTypes, participantType) {
		out.Reasons = append(out.Reasons, "participant type not eligible for this contest")
	}
	if len(contest.EligibleStates) > 0 && state != "" && !containsIgnoreCase(contest.EligibleStates, state) {
		out.Reasons = append(out.Reasons, "state not eligible for this contest")
	}
	if len(contest.EligibleSchoolLevels) > 0 && schoolLevel != "" && !containsIgnoreCase(contest.EligibleSchoolLevels, schoolLevel) {
		out.Reasons = append(out.Reasons, "school level not eligible for this contest")
	}
	if !contest.AllowMixedChannels && len(contest.EligibleParticipantTypes) > 1 {
		out.Reasons = append(out.Reasons, "contest does not allow mixed participant channels")
	}
	if strings.HasPrefix(participantType, "SCHOOL_") && !input.SchoolVerified {
		out.Reasons = append(out.Reasons, "school participant requires verified school")
	}

	out.Eligible = len(out.Reasons) == 0
	return out, nil
}

func (s *stemService) ListLeaderboard(contestID string, limit int) ([]domain.StemLeaderboardEntry, error) {
	if s.repo == nil {
		return []domain.StemLeaderboardEntry{}, nil
	}
	return s.repo.ListLeaderboard(contestID, limit)
}

func (s *stemService) ListLeaderboardSlices(contestID string, by string, limit int) ([]domain.StemLeaderboardSlice, error) {
	if s.repo == nil {
		return []domain.StemLeaderboardSlice{}, nil
	}
	return s.repo.ListLeaderboardSlices(contestID, by, limit)
}

func (s *stemService) ListSubmissions(limit int, status string) ([]domain.StemSubmission, error) {
	if s.repo == nil {
		return []domain.StemSubmission{}, nil
	}
	return s.repo.ListSubmissions(limit, status)
}

func (s *stemService) UpdateSubmissionStatus(submissionID string, status string, reviewStage string) error {
	if s.repo == nil {
		return nil
	}
	return s.repo.UpdateSubmissionStatus(submissionID, status, reviewStage)
}

func (s *stemService) UpsertJudgingScore(score domain.StemJudgingScore) (domain.StemJudgingScore, error) {
	if s.repo == nil {
		return domain.StemJudgingScore{}, nil
	}
	return s.repo.UpsertJudgingScore(score)
}

func (s *stemService) ListJudgingScores(applicationID string, limit int) ([]domain.StemJudgingScore, error) {
	if s.repo == nil {
		return []domain.StemJudgingScore{}, nil
	}
	return s.repo.ListJudgingScores(applicationID, limit)
}

func (s *stemService) UpdateJudgingScoreReviewState(scoreID string, reviewStatus string, isLocked bool, lockReason string, lockedBy string) error {
	if s.repo == nil {
		return nil
	}
	return s.repo.UpdateJudgingScoreReviewState(scoreID, reviewStatus, isLocked, lockReason, lockedBy)
}

func (s *stemService) CreateJudgingRubric(
	rubric domain.StemJudgingRubric,
	criteria []domain.StemJudgingCriterion,
) (domain.StemJudgingRubric, []domain.StemJudgingCriterion, error) {
	if s.repo == nil {
		return domain.StemJudgingRubric{}, []domain.StemJudgingCriterion{}, nil
	}
	return s.repo.CreateJudgingRubric(rubric, criteria)
}

func (s *stemService) ListJudgingRubrics(contestID string, limit int) ([]domain.StemJudgingRubric, error) {
	if s.repo == nil {
		return []domain.StemJudgingRubric{}, nil
	}
	return s.repo.ListJudgingRubrics(contestID, limit)
}

func (s *stemService) ListJudgingCriteria(rubricID string, limit int) ([]domain.StemJudgingCriterion, error) {
	if s.repo == nil {
		return []domain.StemJudgingCriterion{}, nil
	}
	return s.repo.ListJudgingCriteria(rubricID, limit)
}

func (s *stemService) CreateJudgeAssignment(assignment domain.StemJudgeAssignment) (domain.StemJudgeAssignment, error) {
	if s.repo == nil {
		return domain.StemJudgeAssignment{}, nil
	}
	return s.repo.CreateJudgeAssignment(assignment)
}

func (s *stemService) ListJudgeAssignments(contestID string, applicationID string, judgeUserID string, limit int) ([]domain.StemJudgeAssignment, error) {
	if s.repo == nil {
		return []domain.StemJudgeAssignment{}, nil
	}
	return s.repo.ListJudgeAssignments(contestID, applicationID, judgeUserID, limit)
}

func (s *stemService) UpdateJudgeAssignmentConflict(assignmentID string, hasConflict bool, conflictReason string, status string) error {
	if s.repo == nil {
		return nil
	}
	return s.repo.UpdateJudgeAssignmentConflict(assignmentID, hasConflict, conflictReason, status)
}

func (s *stemService) UpsertVotingRule(rule domain.StemVotingRule) (domain.StemVotingRule, error) {
	if s.repo == nil {
		return domain.StemVotingRule{}, nil
	}
	return s.repo.UpsertVotingRule(rule)
}
func (s *stemService) ListVotingRules(contestID string, limit int) ([]domain.StemVotingRule, error) {
	if s.repo == nil {
		return []domain.StemVotingRule{}, nil
	}
	return s.repo.ListVotingRules(contestID, limit)
}
func (s *stemService) CreateVotePackage(pkg domain.StemVotePackage) (domain.StemVotePackage, error) {
	if s.repo == nil {
		return domain.StemVotePackage{}, nil
	}
	return s.repo.CreateVotePackage(pkg)
}
func (s *stemService) ListVotePackages(contestID string, limit int) ([]domain.StemVotePackage, error) {
	if s.repo == nil {
		return []domain.StemVotePackage{}, nil
	}
	return s.repo.ListVotePackages(contestID, limit)
}
func (s *stemService) CreateVoteTransaction(tx domain.StemVoteTransaction) (domain.StemVoteTransaction, error) {
	if s.repo == nil {
		return domain.StemVoteTransaction{}, nil
	}
	return s.repo.CreateVoteTransaction(tx)
}
func (s *stemService) ListVoteTransactions(contestID string, limit int) ([]domain.StemVoteTransaction, error) {
	if s.repo == nil {
		return []domain.StemVoteTransaction{}, nil
	}
	return s.repo.ListVoteTransactions(contestID, limit)
}
func (s *stemService) CreateBootcampCohort(cohort domain.StemBootcampCohort) (domain.StemBootcampCohort, error) {
	if s.repo == nil {
		return domain.StemBootcampCohort{}, nil
	}
	return s.repo.CreateBootcampCohort(cohort)
}
func (s *stemService) ListBootcampCohorts(contestID string, limit int) ([]domain.StemBootcampCohort, error) {
	if s.repo == nil {
		return []domain.StemBootcampCohort{}, nil
	}
	return s.repo.ListBootcampCohorts(contestID, limit)
}
func (s *stemService) CreateBootcampTask(task domain.StemBootcampTask) (domain.StemBootcampTask, error) {
	if s.repo == nil {
		return domain.StemBootcampTask{}, nil
	}
	return s.repo.CreateBootcampTask(task)
}
func (s *stemService) ListBootcampTasks(cohortID string, limit int) ([]domain.StemBootcampTask, error) {
	if s.repo == nil {
		return []domain.StemBootcampTask{}, nil
	}
	return s.repo.ListBootcampTasks(cohortID, limit)
}
func (s *stemService) UpsertBootcampScore(score domain.StemBootcampScore) (domain.StemBootcampScore, error) {
	if s.repo == nil {
		return domain.StemBootcampScore{}, nil
	}
	return s.repo.UpsertBootcampScore(score)
}
func (s *stemService) ListBootcampScores(cohortID string, applicationID string, limit int) ([]domain.StemBootcampScore, error) {
	if s.repo == nil {
		return []domain.StemBootcampScore{}, nil
	}
	return s.repo.ListBootcampScores(cohortID, applicationID, limit)
}
func (s *stemService) CreateSponsor(sponsor domain.StemSponsor) (domain.StemSponsor, error) {
	if s.repo == nil {
		return domain.StemSponsor{}, nil
	}
	return s.repo.CreateSponsor(sponsor)
}
func (s *stemService) ListSponsors(limit int) ([]domain.StemSponsor, error) {
	if s.repo == nil {
		return []domain.StemSponsor{}, nil
	}
	return s.repo.ListSponsors(limit)
}
func (s *stemService) CreateCertificate(cert domain.StemCertificate) (domain.StemCertificate, error) {
	if s.repo == nil {
		return domain.StemCertificate{}, nil
	}
	return s.repo.CreateCertificate(cert)
}
func (s *stemService) ListCertificates(limit int) ([]domain.StemCertificate, error) {
	if s.repo == nil {
		return []domain.StemCertificate{}, nil
	}
	return s.repo.ListCertificates(limit)
}
func (s *stemService) CreateBadge(badge domain.StemBadge) (domain.StemBadge, error) {
	if s.repo == nil {
		return domain.StemBadge{}, nil
	}
	return s.repo.CreateBadge(badge)
}
func (s *stemService) ListBadges(limit int) ([]domain.StemBadge, error) {
	if s.repo == nil {
		return []domain.StemBadge{}, nil
	}
	return s.repo.ListBadges(limit)
}
func (s *stemService) AwardBadge(award domain.StemBadgeAward) (domain.StemBadgeAward, error) {
	if s.repo == nil {
		return domain.StemBadgeAward{}, nil
	}
	return s.repo.AwardBadge(award)
}
func (s *stemService) ListBadgeAwards(applicationID string, limit int) ([]domain.StemBadgeAward, error) {
	if s.repo == nil {
		return []domain.StemBadgeAward{}, nil
	}
	return s.repo.ListBadgeAwards(applicationID, limit)
}
func (s *stemService) GetReportSummary() (domain.StemReportSummary, error) {
	if s.repo == nil {
		return domain.StemReportSummary{}, nil
	}
	return s.repo.GetReportSummary()
}
func (s *stemService) GetReportBuckets(kind string, contestID string, limit int) ([]domain.StemReportBucket, error) {
	if s.repo == nil {
		return []domain.StemReportBucket{}, nil
	}
	return s.repo.GetReportBuckets(kind, contestID, limit)
}

func containsIgnoreCase(list []string, needle string) bool {
	n := strings.ToUpper(strings.TrimSpace(needle))
	for _, item := range list {
		if strings.ToUpper(strings.TrimSpace(item)) == n {
			return true
		}
	}
	return false
}
