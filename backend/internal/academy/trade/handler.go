package trade

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// Handler exposes the academy trade surface over Gin.
//   - member: trade hub + module reads, project submit, skill-assessment take,
//     mentor directory + request.
//   - admin : modules/lessons/projects/skill-assessments CRUD, submission review,
//     mentor approval (RBAC academy.content / academy.assessment).
type Handler struct {
	svc *Service
}

// NewHandler builds the trade handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// uid resolves the authenticated user. The finance/connect groups mirror the auth
// user into c.Set("user_id", ...); fall back to the auth context if absent.
func uid(c *gin.Context) string {
	if v := c.GetString("user_id"); v != "" {
		return v
	}
	if u, ok := middleware.GetAuthenticatedUser(c); ok {
		return u.ID
	}
	return ""
}

func (h *Handler) fail(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "not_found", "message": err.Error()})
	case errors.Is(err, ErrIllegalTransition):
		c.JSON(http.StatusConflict, gin.H{"error": "illegal_transition", "message": err.Error()})
	case errors.Is(err, ErrIdempotencyRequired):
		c.JSON(http.StatusBadRequest, gin.H{"error": "idempotency_required", "message": err.Error()})
	case errors.Is(err, ErrInvalidInput):
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal", "message": err.Error()})
	}
}

// RegisterAcademyTrade wires the trade routes. Member routes use BARE subpaths (the
// aggregator passes the /api/finance/academy base group). Admin routes are gated with
// middleware.RequirePermission(rbac, perm). The CredentialIssuer is injected and made
// nil-safe (no-op stub) so the package runs in dev without the credentials package.
//
//	member: GET  /trade/hub
//	        GET  /trade/modules/:id
//	        POST /trade/projects/:id/submit
//	        POST /trade/assessments/:id/take
//	        GET  /trade/mentors
//	        POST /trade/mentors/:id/request
//	admin : /trade/modules, /trade/lessons, /trade/projects, /trade/skill-assessments
//	        CRUD (academy.content); POST /trade/submissions/:id/review
//	        (academy.content | academy.assessment); POST /trade/mentors (approval).
func RegisterAcademyTrade(member, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService, issuer CredentialIssuer) {
	svc := NewService(pool, issuer)
	h := NewHandler(svc)

	// ── Member (learner) ──
	member.GET("/trade/hub", h.GetHub)
	member.GET("/trade/tracks", h.GetTracks)
	member.GET("/trade/modules/:id", h.GetModule)
	member.GET("/trade/projects/:id", h.GetProject)
	member.POST("/trade/projects/:id/submit", h.SubmitProject)
	member.GET("/trade/submissions", h.ListMySubmissions)
	member.GET("/trade/assessments", h.ListAssessments)
	member.GET("/trade/assessments/:id", h.GetAssessment)
	member.POST("/trade/assessments/:id/take", h.TakeAssessment)
	member.GET("/trade/mentors", h.ListMentors)
	member.POST("/trade/mentors/:id/request", h.RequestMentor)
	member.POST("/trade/matches/:id/close", h.CloseMatch)

	// ── Admin ──
	guard := func(p string) gin.HandlerFunc { return middleware.RequirePermission(rbac, p) }
	const permContent = "academy.content"
	const permAssessment = "academy.assessment"

	admin.POST("/trade/modules", guard(permContent), h.AdminCreateModule)
	admin.PUT("/trade/modules/:id", guard(permContent), h.AdminUpdateModule)
	admin.POST("/trade/lessons", guard(permContent), h.AdminCreateLesson)
	admin.PUT("/trade/lessons/:id", guard(permContent), h.AdminUpdateLesson)
	admin.POST("/trade/projects", guard(permContent), h.AdminCreateProject)
	admin.PUT("/trade/projects/:id", guard(permContent), h.AdminUpdateProject)
	admin.POST("/trade/skill-assessments", guard(permContent), h.AdminCreateAssessment)
	admin.PUT("/trade/skill-assessments/:id", guard(permContent), h.AdminUpdateAssessment)
	admin.POST("/trade/mentors", guard(permContent), h.AdminApproveMentor)
	admin.POST("/trade/matches/:id/accept", guard(permContent), h.AdminAcceptMatch)

	// Review may be done by content OR assessment reviewers; gate with the broader
	// content permission (assessment reviewers also hold content in practice). The
	// service audits the reviewer regardless.
	admin.POST("/trade/submissions/:id/review", guard(permAssessment), h.AdminReviewSubmission)
}

// ── Member handlers ───────────────────────────────────────────────────────────

// GetHub returns the learner's chosen trade track (?track=plumbing).
func (h *Handler) GetHub(c *gin.Context) {
	u := uid(c)
	if u == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	track := c.Query("track")
	if track == "" {
		track = c.Query("trade_track")
	}
	out, err := h.svc.GetTradeHub(c.Request.Context(), u, track)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) GetModule(c *gin.Context) {
	out, err := h.svc.GetModule(c.Request.Context(), c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// GetTracks lists the seeded trade-track catalog (public read; mirrors GetHub's
// envelope). Mobile getTradeTracks maps this list.
func (h *Handler) GetTracks(c *gin.Context) {
	out, err := h.svc.ListTracks(c.Request.Context())
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// GetProject returns a single trade project by id (public catalog read; same
// TradeProject shape used inside GetHub/GetModule).
func (h *Handler) GetProject(c *gin.Context) {
	out, err := h.svc.GetProject(c.Request.Context(), c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) SubmitProject(c *gin.Context) {
	u := uid(c)
	if u == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	var req SubmitProjectRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.SubmitProject(c.Request.Context(), u, c.Param("id"), req.Files)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

func (h *Handler) ListMySubmissions(c *gin.Context) {
	u := uid(c)
	if u == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	out, err := h.svc.ListMySubmissions(c.Request.Context(), u)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) ListAssessments(c *gin.Context) {
	out, err := h.svc.ListSkillAssessments(c.Request.Context(), c.Query("track"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// GetAssessment returns a single skill assessment by id (public catalog read; same
// SkillAssessment shape as the ListAssessments list item).
func (h *Handler) GetAssessment(c *gin.Context) {
	out, err := h.svc.GetSkillAssessment(c.Request.Context(), c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// TakeAssessment grades a learner's score; on PASS issues a credential (idempotent on
// the Idempotency-Key header).
func (h *Handler) TakeAssessment(c *gin.Context) {
	u := uid(c)
	if u == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	var req TakeAssessmentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	idemKey := c.GetHeader("Idempotency-Key")
	out, err := h.svc.TakeSkillAssessment(c.Request.Context(), u, c.Param("id"), req.Score, idemKey)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) ListMentors(c *gin.Context) {
	out, err := h.svc.ListMentors(c.Request.Context(), c.Query("track"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) RequestMentor(c *gin.Context) {
	u := uid(c)
	if u == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	out, err := h.svc.RequestMentor(c.Request.Context(), u, c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

func (h *Handler) CloseMatch(c *gin.Context) {
	u := uid(c)
	if u == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	out, err := h.svc.CloseMatch(c.Request.Context(), u, c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// ── Admin handlers ────────────────────────────────────────────────────────────

func (h *Handler) AdminCreateModule(c *gin.Context) {
	var req CreateModuleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.CreateModule(c.Request.Context(), uid(c), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

func (h *Handler) AdminUpdateModule(c *gin.Context) {
	var req UpdateModuleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.UpdateModule(c.Request.Context(), uid(c), c.Param("id"), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) AdminCreateLesson(c *gin.Context) {
	var req CreateLessonRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.CreateLesson(c.Request.Context(), uid(c), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

func (h *Handler) AdminUpdateLesson(c *gin.Context) {
	var req UpdateLessonRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.UpdateLesson(c.Request.Context(), uid(c), c.Param("id"), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) AdminCreateProject(c *gin.Context) {
	var req CreateProjectRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.CreateProject(c.Request.Context(), uid(c), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

func (h *Handler) AdminUpdateProject(c *gin.Context) {
	var req UpdateProjectRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.UpdateProject(c.Request.Context(), uid(c), c.Param("id"), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) AdminCreateAssessment(c *gin.Context) {
	var req CreateSkillAssessmentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.CreateSkillAssessment(c.Request.Context(), uid(c), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

func (h *Handler) AdminUpdateAssessment(c *gin.Context) {
	var req UpdateSkillAssessmentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.UpdateSkillAssessment(c.Request.Context(), uid(c), c.Param("id"), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) AdminReviewSubmission(c *gin.Context) {
	var req ReviewSubmissionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.ReviewProject(c.Request.Context(), uid(c), c.Param("id"), req.RubricScore, req.Pass, req.Feedback)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) AdminApproveMentor(c *gin.Context) {
	var req CreateMentorRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.ApproveMentor(c.Request.Context(), uid(c), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

func (h *Handler) AdminAcceptMatch(c *gin.Context) {
	out, err := h.svc.AcceptMatch(c.Request.Context(), uid(c), c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}
