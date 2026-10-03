package connectassess

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	"spotlight/backend/internal/arena/quiz"
	arenasvc "spotlight/backend/internal/arena/service"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const keyError = "error"

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

// quizScorer adapts the reused Naija Driver quiz engine to the Scorer interface.
// It REUSES (never forks) quiz.Repository (questions + append-only idempotent
// attempts), quiz.Service.StageView (contestant-safe question envelope) and
// quiz.Service.ScorePlayAlong (marking + attempt persistence).
type quizScorer struct{ svc *quiz.Service }

// NewQuizScorer builds the engine-backed scorer over the shared pool.
// The engine's ScorePlayAlong delegates engagement/credential/cashback to a
// PlayAlongPort; skill assessments want NONE of that — only the raw score plus the
// append-only attempt row. So we inject a no-op PlayAlong port. The engine's
// ContestantPort is used only by the proctored Theory-exam path (never reached
// here), so it is nil.
func NewQuizScorer(pool *pgxpool.Pool) Scorer {
	svc := quiz.NewService(quiz.NewRepository(pool), noopPlayAlong{}, nil)
	return &quizScorer{svc: svc}
}

func (s *quizScorer) StageView(ctx context.Context, competitionID, bankKey, rubricVersion string, stage int) (quiz.StageView, error) {
	return s.svc.StageView(ctx, competitionID, bankKey, rubricVersion, stage)
}

func (s *quizScorer) Score(ctx context.Context, competitionID, bankKey, rubricVersion, takerID string, stage int, answers []Answer, idemKey string) (int, int, error) {
	qa := make([]quiz.Answer, len(answers))
	for i, a := range answers {
		qa[i] = quiz.Answer{QuestionID: a.QuestionID, OptionID: a.OptionID}
	}
	res, err := s.svc.ScorePlayAlong(ctx, competitionID, bankKey, rubricVersion, takerID, stage, qa, idemKey)
	if err != nil {
		return 0, 0, err
	}
	return res.Score, res.Total, nil
}

// noopPlayAlong satisfies quiz.PlayAlongPort with a no-op: skill assessments must
// NOT touch the arena engagement/credential/cashback rail. The engine still writes
// the append-only arena_quiz_attempt row before calling this.
type noopPlayAlong struct{}

func (noopPlayAlong) Attempt(_ context.Context, _, _, _ string, _ arenasvc.AttemptPayload) (*arenasvc.AttemptResult, error) {
	return &arenasvc.AttemptResult{}, nil
}

// Domain errors (mapped to HTTP status by the handler).
var (
	ErrNotFound     = errors.New("connect: assessment not found")
	ErrInvalidInput = errors.New("connect: invalid input")
	ErrMissingIdem  = errors.New("connect: Idempotency-Key required")
	ErrInactive     = errors.New("connect: assessment is not active")
)

// CooldownDuration is the wait after a FAILED attempt before a retry may START
// (SA-04). Derived from the last recorded attempt's timestamp.
const CooldownDuration = 24 * time.Hour

// SingleStage: skill assessments are single-stage quizzes over the reused engine
// (the Naija Driver engine is multi-stage; a skill bank uses stage 1 only).
const SingleStage = 1

// CooldownError signals a retry is still in cooldown; carries the unlock time so
// the handler can surface a countdown (SA-04) without re-deriving it.
type CooldownError struct{ Until time.Time }

func (e *CooldownError) Error() string { return "connect: assessment retry is in cooldown" }

// Assessment maps a skill (domain,title,pass_threshold) onto a reused quiz bank
// keyed by (BankKey, Version). Version == the quiz rubric_version; it IS the
// versioned question bank a badge is bound to (PN-12).
type Assessment struct {
	ID            string    `json:"id"`
	Domain        string    `json:"domain"`
	Title         string    `json:"title"`
	BankKey       string    `json:"bankKey"`
	Version       string    `json:"assessmentVersion"` // == quiz rubric_version (PN-12)
	PassThreshold int       `json:"passThreshold"`     // percent 1..100
	Active        bool      `json:"active"`
	CreatedAt     time.Time `json:"createdAt"`
}

// Badge is one append-only, permanently versioned skill credential (PN-5/PN-12).
type Badge struct {
	ID           string    `json:"id"`
	UserID       string    `json:"userId"`
	AssessmentID string    `json:"assessmentId"`
	Domain       string    `json:"domain"`
	Version      string    `json:"assessmentVersion"` // frozen at issue-time (PN-12)
	Score        int       `json:"score"`
	PassedAt     time.Time `json:"passedAt"`
}

// BadgeInsert is the append-only badge write DTO.
type BadgeInsert struct {
	UserID         string
	AssessmentID   string
	Version        string
	Domain         string
	Score          int
	IdempotencyKey string
}

// AttemptMeta is the read-only projection of the most-recent quiz attempt used to
// enforce the SA-04 retry cooldown (read-only reuse of arena_quiz_attempt).
type AttemptMeta struct {
	Passed    bool
	CreatedAt time.Time
}

// Answer mirrors quiz.Answer (question external id + chosen option index) for the
// submit payload, keeping this package's HTTP surface decoupled from the engine's.
type Answer struct {
	QuestionID string `json:"questionId"`
	OptionID   string `json:"optionId"`
}

// UpsertInput is the admin catalogue write (ADM-SA-01, versioned CRUD). A new
// Version yields a NEW assessment (never mutates an issued badge's meaning).
type UpsertInput struct {
	Domain        string `json:"domain" binding:"required"`
	Title         string `json:"title" binding:"required"`
	BankKey       string `json:"bankKey" binding:"required"`
	Version       string `json:"assessmentVersion" binding:"required"`
	PassThreshold int    `json:"passThreshold"`
	Active        *bool  `json:"active"`
}

// GradeResult is the SA-03 submit outcome. State is the terminal grade
// PASSED | FAILED. Badge is present only on PASSED. CooldownUntil is set on FAILED.
type GradeResult struct {
	AttemptID     string     `json:"attemptId"`
	State         string     `json:"state"`
	Score         int        `json:"score"`
	Total         int        `json:"total"`
	Passed        bool       `json:"passed"`
	Badge         *Badge     `json:"badge,omitempty"`
	CooldownUntil *time.Time `json:"cooldownUntil,omitempty"`
}

// Auditor mirrors the per-package Connect audit interface.
type Auditor interface {
	WriteAudit(ctx context.Context, action, actorID, entityType, entityID string, newValue map[string]any) error
}

// LoyaltyAwarder is the loyalty rail: on a passed assessment we emit
// skill_verified ONCE per (user, assessment, version) — deduped by the badge's
// unique key, not per attempt (see §8 loyalty triggers of the PRD).
type LoyaltyAwarder interface {
	AwardFor(ctx context.Context, userID, module, trigger, ref string) error
}

// Handler is the Gin HTTP surface for skill assessments.
type Handler struct{ svc *Service }

// NewHandler builds the handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func fail(c *gin.Context, err error) {
	var cool *CooldownError
	switch {
	case errors.As(err, &cool):
		c.JSON(http.StatusTooManyRequests, gin.H{
			keyError: httperr.Msg(c, http.StatusTooManyRequests, cool), "cooldownUntil": cool.Until,
		})
	case errors.Is(err, ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{keyError: httperr.Msg(c, http.StatusNotFound, err)})
	case errors.Is(err, ErrInvalidInput):
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
	case errors.Is(err, ErrMissingIdem):
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
	case errors.Is(err, ErrInactive):
		c.JSON(http.StatusConflict, gin.H{keyError: httperr.Msg(c, http.StatusConflict, err)})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
	}
}

// Catalogue — GET /assessments (SA-01).
func (h *Handler) Catalogue(c *gin.Context) {
	out, err := h.svc.Catalogue(c.Request.Context())
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// StartAttempt — POST /assessments/:id/attempts (SA-02). Idempotency-Key required.
func (h *Handler) StartAttempt(c *gin.Context) {
	if ginutil.IdempotencyKey(c) == "" {
		fail(c, ErrMissingIdem)
		return
	}
	out, err := h.svc.Start(c.Request.Context(), ginutil.UserID(c), c.Param("id"))
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

// Submit — PATCH /assessments/:id/attempts/:attemptId/submit (SA-03).
// Idempotency-Key required.
func (h *Handler) Submit(c *gin.Context) {
	idem := ginutil.IdempotencyKey(c)
	if idem == "" {
		fail(c, ErrMissingIdem)
		return
	}
	var body struct {
		Answers []Answer `json:"answers"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	out, err := h.svc.Submit(c.Request.Context(), ginutil.UserID(c), c.Param("id"), c.Param("attemptId"), body.Answers, idem)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// MyBadges — GET /assessment-badges (SA-03 profile surface).
func (h *Handler) MyBadges(c *gin.Context) {
	out, err := h.svc.Badges(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// AdminList — GET /assessments (admin, ADM-SA-01).
func (h *Handler) AdminList(c *gin.Context) {
	out, err := h.svc.AdminList(c.Request.Context())
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// AdminUpsert — POST /assessments (admin, ADM-SA-01).
func (h *Handler) AdminUpsert(c *gin.Context) {
	var in UpsertInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	a, err := h.svc.AdminUpsert(c.Request.Context(), ginutil.UserID(c), in)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": a})
}

// Register wires Phase 6F onto the shared Connect member + admin route groups
// (both already have RequireAuthContext + user_id set). Admin routes add per-route
// RBAC connect.assessment.review (ADM-SA-01). This package does NOT edit any shared
// route file — the orchestrator calls this Register.
//
//	Register(member, admin *gin.RouterGroup, pool *pgxpool.Pool,
//	         rbac services.RBACService, loyalty LoyaltyAwarder, audit Auditor)
func Register(member, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService, loyalty LoyaltyAwarder, audit Auditor) {
	svc := NewService(NewRepository(pool), NewQuizScorer(pool), loyalty, audit)
	h := NewHandler(svc)

	g := member.Group("/networking/assessments")
	g.GET("", h.Catalogue) // SA-01
	g.POST("/:id/attempts", h.StartAttempt)
	g.PATCH("/:id/attempts/:attemptId/submit", h.Submit)

	// Badges live on a distinct path (not /assessments/badges) so the static child
	// never conflicts with the /:id param child in Gin's route tree.
	member.GET("/networking/assessment-badges", h.MyBadges) // SA-03 profile badges

	ag := admin.Group("/networking/assessments")
	ag.GET("", middleware.RequirePermission(rbac, "connect.assessment.review"), h.AdminList)
	ag.POST("", middleware.RequirePermission(rbac, "connect.assessment.review"), h.AdminUpsert)
}

// Repository is the pgxpool store for the Connect-owned catalogue + append-only
// badge ledger. It also performs a single READ-ONLY query against the reused
// arena_quiz_attempt table to derive the SA-04 cooldown (the quiz engine owns all
// WRITES to arena_quiz_* — we never mutate them here).
type Repository struct{ pool *pgxpool.Pool }

// NewRepository builds the assessments repository.
func NewRepository(pool *pgxpool.Pool) *Repository { return &Repository{pool: pool} }

const assessmentCols = `id, domain, title, bank_key, rubric_version, pass_threshold, active, created_at`

func scanAssessment(row pgx.Row) (Assessment, error) {
	var a Assessment
	if err := row.Scan(&a.ID, &a.Domain, &a.Title, &a.BankKey, &a.Version,
		&a.PassThreshold, &a.Active, &a.CreatedAt); err != nil {
		return Assessment{}, err
	}
	return a, nil
}

// ListActive returns the active catalogue (SA-01), ordered by domain.
func (r *Repository) ListActive(ctx context.Context) ([]Assessment, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT `+assessmentCols+` FROM connect_skill_assessments WHERE active ORDER BY domain, title`)
	if err != nil {
		return nil, fmt.Errorf("connect: list assessments: %w", err)
	}
	defer rows.Close()
	out := []Assessment{}
	for rows.Next() {
		a, err := scanAssessment(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// ListAll returns the full catalogue incl. inactive (admin, ADM-SA-01).
func (r *Repository) ListAll(ctx context.Context) ([]Assessment, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT `+assessmentCols+` FROM connect_skill_assessments ORDER BY domain, rubric_version`)
	if err != nil {
		return nil, fmt.Errorf("connect: list assessments (admin): %w", err)
	}
	defer rows.Close()
	out := []Assessment{}
	for rows.Next() {
		a, err := scanAssessment(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// Get resolves an assessment by id.
func (r *Repository) Get(ctx context.Context, id string) (*Assessment, error) {
	a, err := scanAssessment(r.pool.QueryRow(ctx,
		`SELECT `+assessmentCols+` FROM connect_skill_assessments WHERE id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("connect: get assessment: %w", err)
	}
	return &a, nil
}

// LastAttempt reads the most-recent recorded quiz attempt for (assessment, user)
// to enforce the SA-04 cooldown. READ-ONLY reuse of arena_quiz_attempt: the quiz
// engine wrote the row (mode PLAYALONG, competition_id == assessment id). Returns
// nil when the user has never attempted this assessment.
func (r *Repository) LastAttempt(ctx context.Context, assessmentID, userID string) (*AttemptMeta, error) {
	var m AttemptMeta
	err := r.pool.QueryRow(ctx, `
		SELECT passed, created_at FROM arena_quiz_attempt
		 WHERE competition_id = $1 AND taker_id = $2 AND mode = 'PLAYALONG'
		 ORDER BY created_at DESC LIMIT 1`, assessmentID, userID).Scan(&m.Passed, &m.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("connect: last attempt: %w", err)
	}
	return &m, nil
}

// IssueBadge appends a skill badge idempotently. The composite UNIQUE
// (user_id, assessment_id, assessment_version) makes this once-per-version:
// issued=true ONLY on the first insert (RETURNING fires), so callers can gate the
// loyalty emission on it. On a conflict it loads and returns the existing badge
// with issued=false. Append-only: never UPDATE/DELETE.
func (r *Repository) IssueBadge(ctx context.Context, in BadgeInsert) (bool, *Badge, error) {
	var err error

	var b Badge
	err = r.pool.QueryRow(ctx, `
		INSERT INTO connect_skill_badges
			(user_id, assessment_id, assessment_version, score, idempotency_key)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (user_id, assessment_id, assessment_version) DO NOTHING
		RETURNING id, user_id, assessment_id, assessment_version, score, passed_at`,
		in.UserID, in.AssessmentID, in.Version, in.Score, in.IdempotencyKey).
		Scan(&b.ID, &b.UserID, &b.AssessmentID, &b.Version, &b.Score, &b.PassedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		// Already earned for this version — load the existing badge (no re-issue).
		existing, gerr := r.getBadge(ctx, in.UserID, in.AssessmentID, in.Version)
		if gerr != nil {
			return false, nil, gerr
		}
		existing.Domain = in.Domain
		return false, existing, nil
	}
	if err != nil {
		return false, nil, fmt.Errorf("connect: issue badge: %w", err)
	}
	b.Domain = in.Domain
	return true, &b, nil
}

func (r *Repository) getBadge(ctx context.Context, userID, assessmentID, version string) (*Badge, error) {
	var b Badge
	err := r.pool.QueryRow(ctx, `
		SELECT id, user_id, assessment_id, assessment_version, score, passed_at
		  FROM connect_skill_badges
		 WHERE user_id = $1 AND assessment_id = $2 AND assessment_version = $3`,
		userID, assessmentID, version).
		Scan(&b.ID, &b.UserID, &b.AssessmentID, &b.Version, &b.Score, &b.PassedAt)
	if err != nil {
		return nil, fmt.Errorf("connect: get badge: %w", err)
	}
	return &b, nil
}

// ListBadges returns a user's earned badges (joined to the catalogue for domain).
func (r *Repository) ListBadges(ctx context.Context, userID string) ([]Badge, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT b.id, b.user_id, b.assessment_id, a.domain, b.assessment_version, b.score, b.passed_at
		  FROM connect_skill_badges b
		  JOIN connect_skill_assessments a ON a.id = b.assessment_id
		 WHERE b.user_id = $1
		 ORDER BY b.passed_at DESC`, userID)
	if err != nil {
		return nil, fmt.Errorf("connect: list badges: %w", err)
	}
	defer rows.Close()
	out := []Badge{}
	for rows.Next() {
		var b Badge
		if err := rows.Scan(&b.ID, &b.UserID, &b.AssessmentID, &b.Domain,
			&b.Version, &b.Score, &b.PassedAt); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// Upsert creates/updates an assessment definition (ADM-SA-01). The conflict target
// (domain, rubric_version) means a NEW version is a NEW row: editing questions =
// bumping the version, never re-pointing an already-issued badge (PN-12).
func (r *Repository) Upsert(ctx context.Context, in UpsertInput) (*Assessment, error) {
	threshold := in.PassThreshold
	if threshold <= 0 || threshold > 100 {
		threshold = 70
	}
	active := true
	if in.Active != nil {
		active = *in.Active
	}
	a, err := scanAssessment(r.pool.QueryRow(ctx, `
		INSERT INTO connect_skill_assessments (domain, title, bank_key, rubric_version, pass_threshold, active)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (domain, rubric_version) DO UPDATE SET
			title = EXCLUDED.title, bank_key = EXCLUDED.bank_key,
			pass_threshold = EXCLUDED.pass_threshold, active = EXCLUDED.active
		RETURNING `+assessmentCols, in.Domain, in.Title, in.BankKey, in.Version, threshold, active))
	if err != nil {
		return nil, fmt.Errorf("connect: upsert assessment: %w", err)
	}
	return &a, nil
}
