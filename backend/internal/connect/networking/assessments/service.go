package connectassess

import (
	"context"
	"time"

	"github.com/google/uuid"

	"spotlight/backend/internal/arena/quiz"
)

// Repo is the persistence surface the service depends on (concrete: *Repository).
type Repo interface {
	ListActive(ctx context.Context) ([]Assessment, error)
	ListAll(ctx context.Context) ([]Assessment, error)
	Get(ctx context.Context, id string) (*Assessment, error)
	LastAttempt(ctx context.Context, assessmentID, userID string) (*AttemptMeta, error)
	IssueBadge(ctx context.Context, in BadgeInsert) (issued bool, badge *Badge, err error)
	ListBadges(ctx context.Context, userID string) ([]Badge, error)
	Upsert(ctx context.Context, in UpsertInput) (*Assessment, error)
}

// Scorer is the REUSED Naija Driver quiz engine, narrowed to what a skill
// assessment needs. StageView returns the contestant-safe (answers-stripped)
// question envelope for the runner; Score marks answers, appends the idempotent
// append-only attempt row and returns score/total. NO scoring math is
// re-implemented in this package — it is delegated to quiz.ScorePlayAlong / mark().
type Scorer interface {
	StageView(ctx context.Context, competitionID, bankKey, rubricVersion string, stage int) (quiz.StageView, error)
	Score(ctx context.Context, competitionID, bankKey, rubricVersion, takerID string, stage int, answers []Answer, idemKey string) (score, total int, err error)
}

// Service orchestrates the thin assessment wrapper over the quiz engine.
type Service struct {
	repo    Repo
	scorer  Scorer
	loyalty LoyaltyAwarder
	audit   Auditor
	now     func() time.Time
}

// NewService builds the assessments service.
func NewService(repo Repo, scorer Scorer, loyalty LoyaltyAwarder, audit Auditor) *Service {
	return &Service{repo: repo, scorer: scorer, loyalty: loyalty, audit: audit, now: time.Now}
}

// StartResult is the SA-02 start envelope: a fresh attempt id + the contestant-safe
// question stage.
type StartResult struct {
	AttemptID  string         `json:"attemptId"`
	Assessment Assessment     `json:"assessment"`
	Stage      quiz.StageView `json:"stage"`
}

// Catalogue lists active assessments (SA-01).
func (s *Service) Catalogue(ctx context.Context) ([]Assessment, error) {
	return s.repo.ListActive(ctx)
}

// Start begins an attempt (SA-02): enforces the SA-04 cooldown, then returns the
// answers-stripped question stage from the reused engine. No attempt row is
// persisted at start — the append-only attempt is recorded on Submit by the engine.
func (s *Service) Start(ctx context.Context, userID, assessmentID string) (*StartResult, error) {
	a, err := s.repo.Get(ctx, assessmentID)
	if err != nil {
		return nil, err
	}
	if !a.Active {
		return nil, ErrInactive
	}
	// SA-04: a FAILED attempt starts a cooldown before the next attempt may begin.
	last, err := s.repo.LastAttempt(ctx, assessmentID, userID)
	if err != nil {
		return nil, err
	}
	if last != nil && !last.Passed {
		if until := last.CreatedAt.Add(CooldownDuration); s.now().Before(until) {
			return nil, &CooldownError{Until: until}
		}
	}
	stage, err := s.scorer.StageView(ctx, assessmentID, a.BankKey, a.Version, SingleStage)
	if err != nil {
		return nil, err
	}
	return &StartResult{AttemptID: uuid.NewString(), Assessment: *a, Stage: stage}, nil
}

// Submit scores an attempt (SA-03). It delegates marking + the append-only,
// idempotent attempt row to the reused engine (Scorer.Score → quiz.ScorePlayAlong),
// then grades against THIS assessment's pass_threshold.
//
// PN-5: a badge is issued strictly inside the passed branch — a FAILED or
// incomplete attempt issues nothing. PN-12: the badge records a.Version (the exact
// question-bank version). Loyalty skill_verified is emitted ONCE per
// (user, assessment, version): only when IssueBadge reports a fresh insert.
func (s *Service) Submit(ctx context.Context, userID, assessmentID, attemptID string, answers []Answer, idemKey string) (*GradeResult, error) {
	if idemKey == "" {
		return nil, ErrMissingIdem
	}
	a, err := s.repo.Get(ctx, assessmentID)
	if err != nil {
		return nil, err
	}
	if !a.Active {
		return nil, ErrInactive
	}

	score, total, err := s.scorer.Score(ctx, assessmentID, a.BankKey, a.Version, userID, SingleStage, answers, idemKey)
	if err != nil {
		return nil, err
	}
	passed := total > 0 && score*100 >= a.PassThreshold*total

	res := &GradeResult{AttemptID: attemptID, State: "FAILED", Score: score, Total: total, Passed: passed}
	_ = s.audit.WriteAudit(ctx, "connect.assessment.submitted", userID,
		"connect_skill_assessment", assessmentID, map[string]any{
			"attemptId": attemptID, "score": score, "total": total,
			"passed": passed, "assessmentVersion": a.Version,
		})

	if !passed {
		// SA-04: seed the retry cooldown from now.
		until := s.now().Add(CooldownDuration)
		res.CooldownUntil = &until
		return res, nil
	}

	// PASSED → issue the badge tied to (assessment_id, assessment_version) ONLY here.
	issued, badge, err := s.repo.IssueBadge(ctx, BadgeInsert{
		UserID: userID, AssessmentID: assessmentID, Version: a.Version,
		Domain: a.Domain, Score: score, IdempotencyKey: idemKey,
	})
	if err != nil {
		return nil, err
	}
	res.State = "PASSED"
	res.Badge = badge

	if issued {
		// Emit loyalty ONCE per (user, assessment, version): gated on the fresh
		// badge insert, so replays / extra passing attempts never re-award.
		_ = s.loyalty.AwardFor(ctx, userID, "connect", "skill_verified", "skill_badge:"+badge.ID)
		_ = s.audit.WriteAudit(ctx, "connect.assessment.badge_issued", userID,
			"connect_skill_badge", badge.ID, map[string]any{
				"assessmentId": assessmentID, "assessmentVersion": a.Version, "score": score,
			})
	}
	return res, nil
}

// Badges returns a user's earned badges (SA-03 profile surface).
func (s *Service) Badges(ctx context.Context, userID string) ([]Badge, error) {
	return s.repo.ListBadges(ctx, userID)
}

// --- Admin (ADM-SA-01) ---

// AdminList returns the full catalogue incl. inactive/older versions.
func (s *Service) AdminList(ctx context.Context) ([]Assessment, error) {
	return s.repo.ListAll(ctx)
}

// AdminUpsert creates/versions an assessment definition.
func (s *Service) AdminUpsert(ctx context.Context, actorID string, in UpsertInput) (*Assessment, error) {
	if in.Domain == "" || in.Title == "" || in.BankKey == "" || in.Version == "" {
		return nil, ErrInvalidInput
	}
	a, err := s.repo.Upsert(ctx, in)
	if err != nil {
		return nil, err
	}
	_ = s.audit.WriteAudit(ctx, "connect.assessment.upsert", actorID,
		"connect_skill_assessment", a.ID, map[string]any{
			"domain": a.Domain, "assessmentVersion": a.Version, "active": a.Active,
		})
	return a, nil
}
