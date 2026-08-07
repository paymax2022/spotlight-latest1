package trade

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Service implements the academy trade domain: trade hub reads, guarded project
// submission/review, skill assessments with credential issuance, and the mentor
// directory + matching. No money path.
//
// The CredentialIssuer is INJECTED (the integration wires the credentials package to
// it). A nil issuer falls back to a no-op stub so the package runs in dev.
type Service struct {
	repo   *Repository
	issuer CredentialIssuer
}

// NewService wires the trade service. A nil issuer becomes a no-op stub.
func NewService(db *pgxpool.Pool, issuer CredentialIssuer) *Service {
	if issuer == nil {
		issuer = noopIssuer{}
	}
	return &Service{repo: NewRepository(db), issuer: issuer}
}

// Sentinel errors mapped to HTTP statuses by the handler.
var (
	ErrIllegalTransition   = errors.New("trade: illegal state transition")
	ErrInvalidInput        = errors.New("trade: invalid input")
	ErrIdempotencyRequired = errors.New("trade: idempotency key required")
)

// ── Member reads ──────────────────────────────────────────────────────────────

// GetTradeHub returns the learner's chosen trade track: every module with its ordered
// lessons and projects. tradeTrack is required (the learner's selected trade).
func (s *Service) GetTradeHub(ctx context.Context, userID, tradeTrack string) (*TradeHub, error) {
	if tradeTrack == "" {
		return nil, ErrInvalidInput
	}
	modules, err := s.repo.ListModules(ctx, tradeTrack)
	if err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(modules))
	for _, m := range modules {
		ids = append(ids, m.ID)
	}
	lessons, err := s.repo.ListLessonsForModules(ctx, ids)
	if err != nil {
		return nil, err
	}
	projects, err := s.repo.ListProjectsForModules(ctx, ids)
	if err != nil {
		return nil, err
	}

	lessonsByModule := map[string][]TradeLesson{}
	for _, l := range lessons {
		lessonsByModule[l.ModuleID] = append(lessonsByModule[l.ModuleID], l)
	}
	projectsByModule := map[string][]TradeProject{}
	for _, p := range projects {
		projectsByModule[p.ModuleID] = append(projectsByModule[p.ModuleID], p)
	}

	hub := &TradeHub{TradeTrack: tradeTrack, Modules: make([]ModuleWithLessons, 0, len(modules))}
	for _, m := range modules {
		ml := ModuleWithLessons{Module: m, Lessons: lessonsByModule[m.ID], Projects: projectsByModule[m.ID]}
		if ml.Lessons == nil {
			ml.Lessons = []TradeLesson{}
		}
		if ml.Projects == nil {
			ml.Projects = []TradeProject{}
		}
		hub.Modules = append(hub.Modules, ml)
	}
	return hub, nil
}

// GetModule returns a single module with its ordered lessons + projects.
func (s *Service) GetModule(ctx context.Context, id string) (*ModuleWithLessons, error) {
	m, err := s.repo.GetModule(ctx, id)
	if err != nil {
		return nil, err
	}
	lessons, err := s.repo.ListLessonsForModules(ctx, []string{id})
	if err != nil {
		return nil, err
	}
	projects, err := s.repo.ListProjectsForModules(ctx, []string{id})
	if err != nil {
		return nil, err
	}
	return &ModuleWithLessons{Module: *m, Lessons: lessons, Projects: projects}, nil
}

// ListTracks returns the seeded trade-track catalog (public catalog read; mirrors
// the visibility of the other trade catalog lists).
func (s *Service) ListTracks(ctx context.Context) ([]TradeTrack, error) {
	return s.repo.ListTracks(ctx)
}

// GetProject returns a single trade project by id (public catalog read; mirrors the
// row loaded during project submit).
func (s *Service) GetProject(ctx context.Context, id string) (*TradeProject, error) {
	return s.repo.GetProject(ctx, id)
}

// ── Project submission & review ───────────────────────────────────────────────

// SubmitProject opens a submission in 'submitted'. files are signed-URL refs only
// (no blobs). The referenced project must exist.
func (s *Service) SubmitProject(ctx context.Context, userID, projectID string, files []map[string]any) (*ProjectSubmission, error) {
	if userID == "" || projectID == "" {
		return nil, ErrInvalidInput
	}
	if len(files) == 0 {
		return nil, ErrInvalidInput
	}
	if _, err := s.repo.GetProject(ctx, projectID); err != nil {
		return nil, err
	}
	return s.repo.InsertSubmission(ctx, userID, projectID, files)
}

// ReviewProject runs the guarded submitted→reviewed→passed|failed review. Illegal
// transitions are rejected + audited by the repo.
func (s *Service) ReviewProject(ctx context.Context, reviewerID, submissionID string, rubricScore float64, pass bool, feedback string) (*ProjectSubmission, error) {
	if reviewerID == "" || submissionID == "" {
		return nil, ErrInvalidInput
	}
	return s.repo.ReviewSubmission(ctx, reviewerID, submissionID, rubricScore, pass, feedback)
}

// ListMySubmissions returns the learner's own submissions.
func (s *Service) ListMySubmissions(ctx context.Context, userID string) ([]ProjectSubmission, error) {
	if userID == "" {
		return nil, ErrInvalidInput
	}
	return s.repo.ListSubmissionsForUser(ctx, userID)
}

// ── Skill assessments ─────────────────────────────────────────────────────────

// ListSkillAssessments returns active assessments for a trade track (or all).
func (s *Service) ListSkillAssessments(ctx context.Context, tradeTrack string) ([]SkillAssessment, error) {
	return s.repo.ListAssessments(ctx, tradeTrack)
}

// GetSkillAssessment returns a single assessment by id (public catalog read; mirrors
// the row shape returned by ListSkillAssessments).
func (s *Service) GetSkillAssessment(ctx context.Context, id string) (*SkillAssessment, error) {
	return s.repo.GetAssessment(ctx, id)
}

// TakeSkillAssessment grades a learner's score against the assessment's pass_threshold
// and, on a PASS, issues a verifiable trade credential via the injected
// CredentialIssuer. The whole operation is IDEMPOTENT on idemKey
// (academy_skill_attempts.idempotency_key UNIQUE): a replay returns the original
// attempt with NO second credential issued.
func (s *Service) TakeSkillAssessment(ctx context.Context, userID, assessmentID string, score float64, idemKey string) (*AttemptResult, error) {
	if userID == "" || assessmentID == "" {
		return nil, ErrInvalidInput
	}
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}

	a, err := s.repo.GetAssessment(ctx, assessmentID)
	if err != nil {
		return nil, err
	}

	passed := grade(score, a.PassThreshold)

	// The issuer is invoked INSIDE the grading tx via this callback, and only on a
	// fresh PASS (the repo's unique idempotency_key guarantees at-most-once). The
	// callback returns the credential_id which the repo persists on the attempt.
	issue := func(ctx context.Context, _ pgx.Tx) (string, error) {
		credentialID, _, ierr := s.issuer.IssueTradeCredential(ctx, userID, a.TradeTrack, a.CredentialTitle)
		if ierr != nil {
			return "", ierr
		}
		return credentialID, nil
	}

	attempt, err := s.repo.GradeAttempt(ctx, userID, assessmentID, score, passed, idemKey, issue)
	if err != nil {
		return nil, err
	}

	res := &AttemptResult{
		AttemptID:    attempt.ID,
		AssessmentID: assessmentID,
		Score:        score,
		Passed:       attempt.Passed,
		CredentialID: attempt.CredentialID,
	}
	return res, nil
}

// ── Mentors ───────────────────────────────────────────────────────────────────

// ListMentors returns active mentors, optionally filtered by trade track.
func (s *Service) ListMentors(ctx context.Context, tradeTrack string) ([]Mentor, error) {
	return s.repo.ListMentors(ctx, tradeTrack)
}

// RequestMentor opens a mentor match in 'requested' for the learner.
func (s *Service) RequestMentor(ctx context.Context, learnerID, mentorID string) (*MentorMatch, error) {
	if learnerID == "" || mentorID == "" {
		return nil, ErrInvalidInput
	}
	if _, err := s.repo.GetMentor(ctx, mentorID); err != nil {
		return nil, err
	}
	return s.repo.InsertMatch(ctx, learnerID, mentorID)
}

// AcceptMatch moves a match requested→active (mentor action).
func (s *Service) AcceptMatch(ctx context.Context, actorID, matchID string) (*MentorMatch, error) {
	if actorID == "" || matchID == "" {
		return nil, ErrInvalidInput
	}
	return s.repo.TransitionMatch(ctx, actorID, matchID, MatchActive)
}

// CloseMatch moves a match requested|active→closed (mentor or learner action).
func (s *Service) CloseMatch(ctx context.Context, actorID, matchID string) (*MentorMatch, error) {
	if actorID == "" || matchID == "" {
		return nil, ErrInvalidInput
	}
	return s.repo.TransitionMatch(ctx, actorID, matchID, MatchClosed)
}

// ── Admin CRUD (academy.content) ──────────────────────────────────────────────

func (s *Service) CreateModule(ctx context.Context, actor string, req CreateModuleRequest) (*TradeModule, error) {
	if req.TradeTrack == "" || req.Title == "" {
		return nil, ErrInvalidInput
	}
	return s.repo.InsertModule(ctx, actor, req)
}

func (s *Service) UpdateModule(ctx context.Context, actor, id string, req UpdateModuleRequest) (*TradeModule, error) {
	return s.repo.UpdateModule(ctx, actor, id, req)
}

func (s *Service) CreateLesson(ctx context.Context, actor string, req CreateLessonRequest) (*TradeLesson, error) {
	if req.ModuleID == "" || req.Title == "" {
		return nil, ErrInvalidInput
	}
	return s.repo.InsertLesson(ctx, actor, req)
}

func (s *Service) UpdateLesson(ctx context.Context, actor, id string, req UpdateLessonRequest) (*TradeLesson, error) {
	return s.repo.UpdateLesson(ctx, actor, id, req)
}

func (s *Service) CreateProject(ctx context.Context, actor string, req CreateProjectRequest) (*TradeProject, error) {
	if req.ModuleID == "" || req.Title == "" {
		return nil, ErrInvalidInput
	}
	return s.repo.InsertProject(ctx, actor, req)
}

func (s *Service) UpdateProject(ctx context.Context, actor, id string, req UpdateProjectRequest) (*TradeProject, error) {
	return s.repo.UpdateProject(ctx, actor, id, req)
}

func (s *Service) CreateSkillAssessment(ctx context.Context, actor string, req CreateSkillAssessmentRequest) (*SkillAssessment, error) {
	if req.TradeTrack == "" || req.Title == "" || req.CredentialTitle == "" {
		return nil, ErrInvalidInput
	}
	return s.repo.InsertAssessment(ctx, actor, req)
}

func (s *Service) UpdateSkillAssessment(ctx context.Context, actor, id string, req UpdateSkillAssessmentRequest) (*SkillAssessment, error) {
	return s.repo.UpdateAssessment(ctx, actor, id, req)
}

// ApproveMentor registers/approves a mentor (admin academy.content).
func (s *Service) ApproveMentor(ctx context.Context, actor string, req CreateMentorRequest) (*Mentor, error) {
	if req.UserID == "" {
		return nil, ErrInvalidInput
	}
	return s.repo.InsertMentor(ctx, actor, req)
}
