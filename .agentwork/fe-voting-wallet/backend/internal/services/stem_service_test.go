package services

import (
	"testing"

	"spotlight/backend/internal/domain"
)

type stubStemRepo struct {
	contest domain.StemContest
}

func (s *stubStemRepo) GetOverview() (domain.StemOverview, error)          { return domain.StemOverview{}, nil }
func (s *stubStemRepo) ListSchools(limit int) ([]domain.StemSchool, error) { return nil, nil }
func (s *stubStemRepo) CreateSchool(input domain.StemSchoolCreateInput) (domain.StemSchool, error) {
	return domain.StemSchool{}, nil
}
func (s *stubStemRepo) UpdateSchoolVerification(schoolID string, status string, reason string, actorID string) error {
	return nil
}
func (s *stubStemRepo) GetSchoolDashboard(schoolID string) (domain.StemSchoolDashboard, error) {
	return domain.StemSchoolDashboard{}, nil
}
func (s *stubStemRepo) ListSchoolProfiles(limit int) ([]domain.StemSchoolProfile, error) {
	return nil, nil
}
func (s *stubStemRepo) CreateSchoolProfile(input domain.StemSchoolProfileCreateInput) (domain.StemSchoolProfile, error) {
	return domain.StemSchoolProfile{}, nil
}
func (s *stubStemRepo) ListSchoolTeams(limit int) ([]domain.StemSchoolTeam, error) { return nil, nil }
func (s *stubStemRepo) CreateSchoolTeam(input domain.StemSchoolTeamCreateInput) (domain.StemSchoolTeam, error) {
	return domain.StemSchoolTeam{}, nil
}
func (s *stubStemRepo) ListEmergingInnovators(limit int) ([]domain.StemEmergingInnovator, error) {
	return nil, nil
}
func (s *stubStemRepo) CreateEmergingInnovator(input domain.StemEmergingInnovatorCreateInput) (domain.StemEmergingInnovator, error) {
	return domain.StemEmergingInnovator{}, nil
}
func (s *stubStemRepo) ListEmergingTeams(limit int) ([]domain.StemEmergingTeam, error) {
	return nil, nil
}
func (s *stubStemRepo) CreateEmergingTeam(input domain.StemEmergingTeamCreateInput) (domain.StemEmergingTeam, error) {
	return domain.StemEmergingTeam{}, nil
}
func (s *stubStemRepo) ListEmergingProjects(limit int) ([]domain.StemEmergingProject, error) {
	return nil, nil
}
func (s *stubStemRepo) CreateEmergingProject(input domain.StemEmergingProjectCreateInput) (domain.StemEmergingProject, error) {
	return domain.StemEmergingProject{}, nil
}
func (s *stubStemRepo) ListContests(limit int) ([]domain.StemContest, error) {
	return []domain.StemContest{s.contest}, nil
}
func (s *stubStemRepo) CreateContest(input domain.StemContestCreateInput) (domain.StemContest, error) {
	return domain.StemContest{}, nil
}
func (s *stubStemRepo) GetContestByID(contestID string) (domain.StemContest, error) {
	return s.contest, nil
}
func (s *stubStemRepo) ListLeaderboard(contestID string, limit int) ([]domain.StemLeaderboardEntry, error) {
	return []domain.StemLeaderboardEntry{}, nil
}
func (s *stubStemRepo) ListLeaderboardSlices(contestID string, by string, limit int) ([]domain.StemLeaderboardSlice, error) {
	return []domain.StemLeaderboardSlice{}, nil
}
func (s *stubStemRepo) ListSubmissions(limit int, status string) ([]domain.StemSubmission, error) {
	return []domain.StemSubmission{}, nil
}
func (s *stubStemRepo) UpdateSubmissionStatus(submissionID string, status string, reviewStage string) error {
	return nil
}
func (s *stubStemRepo) UpsertJudgingScore(score domain.StemJudgingScore) (domain.StemJudgingScore, error) {
	return domain.StemJudgingScore{}, nil
}
func (s *stubStemRepo) ListJudgingScores(applicationID string, limit int) ([]domain.StemJudgingScore, error) {
	return []domain.StemJudgingScore{}, nil
}
func (s *stubStemRepo) UpdateJudgingScoreReviewState(scoreID string, reviewStatus string, isLocked bool, lockReason string, lockedBy string) error {
	return nil
}
func (s *stubStemRepo) CreateJudgingRubric(
	rubric domain.StemJudgingRubric,
	criteria []domain.StemJudgingCriterion,
) (domain.StemJudgingRubric, []domain.StemJudgingCriterion, error) {
	return domain.StemJudgingRubric{}, []domain.StemJudgingCriterion{}, nil
}
func (s *stubStemRepo) ListJudgingRubrics(contestID string, limit int) ([]domain.StemJudgingRubric, error) {
	return []domain.StemJudgingRubric{}, nil
}
func (s *stubStemRepo) ListJudgingCriteria(rubricID string, limit int) ([]domain.StemJudgingCriterion, error) {
	return []domain.StemJudgingCriterion{}, nil
}
func (s *stubStemRepo) CreateJudgeAssignment(assignment domain.StemJudgeAssignment) (domain.StemJudgeAssignment, error) {
	return domain.StemJudgeAssignment{}, nil
}
func (s *stubStemRepo) ListJudgeAssignments(contestID string, applicationID string, judgeUserID string, limit int) ([]domain.StemJudgeAssignment, error) {
	return []domain.StemJudgeAssignment{}, nil
}
func (s *stubStemRepo) UpdateJudgeAssignmentConflict(assignmentID string, hasConflict bool, conflictReason string, status string) error {
	return nil
}
func (s *stubStemRepo) UpsertVotingRule(rule domain.StemVotingRule) (domain.StemVotingRule, error) {
	return domain.StemVotingRule{}, nil
}
func (s *stubStemRepo) ListVotingRules(contestID string, limit int) ([]domain.StemVotingRule, error) {
	return []domain.StemVotingRule{}, nil
}
func (s *stubStemRepo) CreateVotePackage(pkg domain.StemVotePackage) (domain.StemVotePackage, error) {
	return domain.StemVotePackage{}, nil
}
func (s *stubStemRepo) ListVotePackages(contestID string, limit int) ([]domain.StemVotePackage, error) {
	return []domain.StemVotePackage{}, nil
}
func (s *stubStemRepo) CreateVoteTransaction(tx domain.StemVoteTransaction) (domain.StemVoteTransaction, error) {
	return domain.StemVoteTransaction{}, nil
}
func (s *stubStemRepo) ListVoteTransactions(contestID string, limit int) ([]domain.StemVoteTransaction, error) {
	return []domain.StemVoteTransaction{}, nil
}
func (s *stubStemRepo) CreateBootcampCohort(cohort domain.StemBootcampCohort) (domain.StemBootcampCohort, error) {
	return domain.StemBootcampCohort{}, nil
}
func (s *stubStemRepo) ListBootcampCohorts(contestID string, limit int) ([]domain.StemBootcampCohort, error) {
	return []domain.StemBootcampCohort{}, nil
}
func (s *stubStemRepo) CreateBootcampTask(task domain.StemBootcampTask) (domain.StemBootcampTask, error) {
	return domain.StemBootcampTask{}, nil
}
func (s *stubStemRepo) ListBootcampTasks(cohortID string, limit int) ([]domain.StemBootcampTask, error) {
	return []domain.StemBootcampTask{}, nil
}
func (s *stubStemRepo) UpsertBootcampScore(score domain.StemBootcampScore) (domain.StemBootcampScore, error) {
	return domain.StemBootcampScore{}, nil
}
func (s *stubStemRepo) ListBootcampScores(cohortID string, applicationID string, limit int) ([]domain.StemBootcampScore, error) {
	return []domain.StemBootcampScore{}, nil
}
func (s *stubStemRepo) CreateSponsor(sponsor domain.StemSponsor) (domain.StemSponsor, error) {
	return domain.StemSponsor{}, nil
}
func (s *stubStemRepo) ListSponsors(limit int) ([]domain.StemSponsor, error) {
	return []domain.StemSponsor{}, nil
}
func (s *stubStemRepo) CreateCertificate(cert domain.StemCertificate) (domain.StemCertificate, error) {
	return domain.StemCertificate{}, nil
}
func (s *stubStemRepo) ListCertificates(limit int) ([]domain.StemCertificate, error) {
	return []domain.StemCertificate{}, nil
}
func (s *stubStemRepo) CreateBadge(badge domain.StemBadge) (domain.StemBadge, error) {
	return domain.StemBadge{}, nil
}
func (s *stubStemRepo) ListBadges(limit int) ([]domain.StemBadge, error) {
	return []domain.StemBadge{}, nil
}
func (s *stubStemRepo) AwardBadge(award domain.StemBadgeAward) (domain.StemBadgeAward, error) {
	return domain.StemBadgeAward{}, nil
}
func (s *stubStemRepo) ListBadgeAwards(applicationID string, limit int) ([]domain.StemBadgeAward, error) {
	return []domain.StemBadgeAward{}, nil
}
func (s *stubStemRepo) GetReportSummary() (domain.StemReportSummary, error) {
	return domain.StemReportSummary{}, nil
}
func (s *stubStemRepo) GetReportBuckets(kind string, contestID string, limit int) ([]domain.StemReportBucket, error) {
	return []domain.StemReportBucket{}, nil
}

func TestCheckEligibility_AllowsMatchingParticipant(t *testing.T) {
	repo := &stubStemRepo{contest: domain.StemContest{
		ID:                       "c1",
		EligibleParticipantTypes: []string{"SCHOOL_TEAM", "EMERGING_INNOVATOR"},
		EligibleStates:           []string{"LAGOS", "ABUJA"},
		EligibleSchoolLevels:     []string{"SECONDARY"},
		AllowMixedChannels:       true,
	}}
	svc := NewStemService(repo)
	out, _ := svc.CheckEligibility(domain.StemEligibilityCheckInput{
		ContestID: "c1", ParticipantType: "SCHOOL_TEAM", State: "Lagos", SchoolLevel: "Secondary", SchoolVerified: true,
	})
	if !out.Eligible {
		t.Fatalf("expected eligible=true, reasons=%v", out.Reasons)
	}
}

func TestCheckEligibility_RejectsUnverifiedSchoolParticipant(t *testing.T) {
	repo := &stubStemRepo{contest: domain.StemContest{ID: "c1", EligibleParticipantTypes: []string{"SCHOOL_TEAM"}}}
	svc := NewStemService(repo)
	out, _ := svc.CheckEligibility(domain.StemEligibilityCheckInput{ContestID: "c1", ParticipantType: "SCHOOL_TEAM", SchoolVerified: false})
	if out.Eligible {
		t.Fatalf("expected eligible=false")
	}
	if len(out.Reasons) == 0 {
		t.Fatalf("expected rejection reasons")
	}
}

func TestCheckEligibility_RejectsMixedChannelWhenDisabled(t *testing.T) {
	repo := &stubStemRepo{contest: domain.StemContest{
		ID:                       "c1",
		EligibleParticipantTypes: []string{"SCHOOL_TEAM", "EMERGING_INNOVATOR"},
		AllowMixedChannels:       false,
	}}
	svc := NewStemService(repo)
	out, _ := svc.CheckEligibility(domain.StemEligibilityCheckInput{
		ContestID: "c1", ParticipantType: "SCHOOL_TEAM", SchoolVerified: true,
	})
	if out.Eligible {
		t.Fatalf("expected eligible=false for mixed channel disabled")
	}
}
