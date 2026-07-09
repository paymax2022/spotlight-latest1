package feescompetition

import (
	"net/http"

	"github.com/gin-gonic/gin"

	feesstatemachine "spotlight/backend/internal/academy/fees/statemachine"
)

// handler.go — HTTP surface for Competition + minor-safe leaderboard (§6 API).
// Mirrors the academy/* Register(member, admin, guard) convention. Admin routes
// (create/transition/register/record-score) are gated per-route by an injected
// RBAC guard; the public leaderboard GET is member-readable but ALWAYS runs
// through the SF-7 Serializer before responding.
//
// Wiring note (integration task): RegisterAcademyFeesCompetition is intentionally
// NOT defined here — this package exposes NewHandler + Handler.Register so the
// academy_routes integration owner composes the concrete gamification service,
// pgx repo, consent checker, and RBAC guard at the root (see the report).

// Handler exposes competition endpoints.
type Handler struct {
	svc        *Service
	serializer *Serializer
}

// NewHandler builds the handler. The serializer carries the SF-7 policy and MUST
// be non-nil for any public leaderboard route.
func NewHandler(svc *Service, serializer *Serializer) *Handler {
	return &Handler{svc: svc, serializer: serializer}
}

// httpStatusFor maps typed domain errors to HTTP codes + stable snake_case codes.
func httpStatusFor(err error) (int, string) {
	switch err {
	case feesstatemachine.ErrIllegalTransition:
		return http.StatusConflict, "illegal_transition"
	case feesstatemachine.ErrTerminal:
		return http.StatusConflict, "terminal_state"
	case ErrScoringLocked:
		return http.StatusConflict, "scoring_locked"
	case ErrRegistrationClosed:
		return http.StatusConflict, "registration_closed"
	case ErrScopeInvalid:
		return http.StatusBadRequest, "scope_invalid"
	case ErrUnknownEvent:
		return http.StatusBadRequest, "unknown_event"
	case ErrConsentRequired:
		return http.StatusForbidden, "consent_required"
	default:
		return http.StatusInternalServerError, "internal_error"
	}
}

func (h *Handler) fail(c *gin.Context, err error) {
	code, msg := httpStatusFor(err)
	c.JSON(code, gin.H{"error": msg})
}

// CreateCompetition handles POST /competitions (admin).
func (h *Handler) CreateCompetition(c *gin.Context) {
	var in CreateCompetitionRequest
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	out, err := h.svc.Create(c.Request.Context(), in)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, out)
}

// TransitionCompetition handles POST /competitions/:id/transition (admin).
func (h *Handler) TransitionCompetition(c *gin.Context) {
	var in TransitionCompetitionRequest
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	out, err := h.svc.Transition(c.Request.Context(), c.Param("id"), in.Event)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
}

// RegisterSchool handles POST /competitions/:id/register (admin/school).
func (h *Handler) RegisterSchool(c *gin.Context) {
	var in RegisterSchoolRequest
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	out, err := h.svc.Register(c.Request.Context(), c.Param("id"), in.SchoolID)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, out)
}

// RecordScore handles POST /competitions/:id/scores (admin/teacher). Rejected
// once the competition is results_pending or later (scoring lock).
func (h *Handler) RecordScore(c *gin.Context) {
	var in RecordScoreRequest
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.RecordScore(c.Request.Context(), c.Param("id"), in); err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusAccepted, gin.H{"status": "recorded"})
}

// GetLeaderboard handles GET /competitions/:id/leaderboard?scope=&subject=&period_key=&school_id=
// (member). ALWAYS applies the SF-7 serializer — a minor's row is default-stripped
// to first-name + school unless a recorded guardian consent exists.
func (h *Handler) GetLeaderboard(c *gin.Context) {
	scope := Scope(c.Query("scope"))
	if scope == "" {
		scope = ScopeNational
	}
	raw, err := h.svc.ReadLeaderboard(
		c.Request.Context(),
		c.Param("id"),
		c.Query("school_id"),
		c.Query("subject"),
		c.Query("period_key"),
		scope,
		100,
	)
	if err != nil {
		h.fail(c, err)
		return
	}
	// SF-7 default-strip happens here, before anything leaves the process.
	safe := h.serializer.SerializeList(c.Request.Context(), raw)
	c.JSON(http.StatusOK, gin.H{"scope": string(scope), "entries": safe})
}

// Register wires member (public leaderboard read) + admin (competition CRUD /
// scoring) routes. guard(permission) returns the RBAC middleware for a slug.
//
//	member:
//	  GET  /competitions/:id/leaderboard        (SF-7 serialized)
//	admin (per-route RBAC):
//	  POST /competitions                        (academy.fees.competition.manage)
//	  POST /competitions/:id/transition         (academy.fees.competition.manage)
//	  POST /competitions/:id/register           (academy.fees.competition.register)
//	  POST /competitions/:id/scores             (academy.fees.competition.score)
func (h *Handler) Register(member, admin *gin.RouterGroup, guard func(permission string) gin.HandlerFunc) {
	mg := member.Group("/competitions")
	mg.GET("/:id/leaderboard", h.GetLeaderboard)

	ag := admin.Group("/competitions")
	ag.POST("", guard("academy.fees.competition.manage"), h.CreateCompetition)
	ag.POST("/:id/transition", guard("academy.fees.competition.manage"), h.TransitionCompetition)
	ag.POST("/:id/register", guard("academy.fees.competition.register"), h.RegisterSchool)
	ag.POST("/:id/scores", guard("academy.fees.competition.score"), h.RecordScore)
}
