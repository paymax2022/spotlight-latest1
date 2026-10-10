package core

import (
	"errors"
	"net/http"
	"spotlight/backend/internal/health/triage"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
	"time"

	"spotlight/backend/go-common/ginutil"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// parseDOB parses a YYYY-MM-DD date of birth; an empty/invalid value yields nil so
// the engine simply runs without an age band (it never receives the raw string).
func parseDOB(s string) *time.Time {
	if s == "" {
		return nil
	}
	t, err := time.Parse("2006-01-02", s)
	if err != nil {
		return nil
	}
	return &t
}

// handler.go — gin handlers for the AI Symptom Checker. The acting user id is
// ALWAYS taken from c.GetString("user_id") (mirrored by the finance auth chain) so
// a caller can never act as another identity (object-level authZ). Every response
// carries the SC-1 framing (possible causes, not diagnosis) via the service view.
type Handler struct{ svc *SessionService }

// NewHandler builds the handler.
func NewHandler(svc *SessionService) *Handler { return &Handler{svc: svc} }

// uuidPathID gates the :id path parameter before it reaches pgx —
// health_triage_sessions.id is uuid, so a malformed value otherwise surfaces as
// a driver error instead of a clean 400.
func uuidPathID(c *gin.Context) bool {
	if _, err := uuid.Parse(c.Param("id")); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "id must be a uuid")
		return false
	}
	return true
}

// triageFail maps service errors: ErrSessionNotFound / ErrProfileNotFound
// (missing OR non-owner — owner-fused loads make them uniform) → 404; anything
// else → 409 (state refusals). FailOK sanitizes the message.
func triageFail(c *gin.Context, err error) {
	if errors.Is(err, ErrSessionNotFound) || errors.Is(err, ErrProfileNotFound) {
		ginutil.FailOK(c, http.StatusNotFound, "session not found")
		return
	}
	ginutil.FailOK(c, http.StatusConflict, err.Error())
}

// ListProfiles — GET /health/triage/profiles
func (h *Handler) ListProfiles(c *gin.Context) {
	id := ginutil.UserID(c)
	if id == "" {
		ginutil.FailOK(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	out, err := h.svc.ListProfiles(c.Request.Context(), id)
	if err != nil {
		ginutil.FailOK(c, http.StatusInternalServerError, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "profiles": out})
}

// CreateProfile — POST /health/triage/profiles
func (h *Handler) CreateProfile(c *gin.Context) {
	id := ginutil.UserID(c)
	if id == "" {
		ginutil.FailOK(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req struct {
		Kind       string `json:"kind"`
		Name       string `json:"name"`
		Sex        string `json:"sex"`
		DOB        string `json:"dob"` // YYYY-MM-DD
		IsPregnant bool   `json:"is_pregnant"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "invalid body")
		return
	}
	dob := parseDOB(req.DOB)
	p, err := h.svc.CreateProfile(c.Request.Context(), id, req.Kind, req.Name, req.Sex, dob, req.IsPregnant)
	if err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, err.Error())
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "profile": p})
}

// StartSession — POST /health/triage/sessions
func (h *Handler) StartSession(c *gin.Context) {
	id := ginutil.UserID(c)
	if id == "" {
		ginutil.FailOK(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req StartParams
	if err := c.ShouldBindJSON(&req); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "invalid body")
		return
	}
	// profile_id feeds a uuid column + the owner-fused profile load — gate first.
	if req.ProfileID != nil && *req.ProfileID != "" {
		if _, perr := uuid.Parse(*req.ProfileID); perr != nil {
			ginutil.FailOK(c, http.StatusBadRequest, "profile_id must be a uuid")
			return
		}
	}
	sess, err := h.svc.StartSession(c.Request.Context(), id, req)
	if err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, err.Error())
		return
	}
	// SC-8: surface the mandatory disclaimer from the first response onward.
	c.JSON(http.StatusCreated, gin.H{"success": true, "session": sess, "disclaimer": Disclaimer})
}

// SubmitIntake — POST /health/triage/sessions/:id/intake
func (h *Handler) SubmitIntake(c *gin.Context) {
	id := ginutil.UserID(c)
	if id == "" {
		ginutil.FailOK(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req IntakeParams
	if err := c.ShouldBindJSON(&req); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "invalid body")
		return
	}
	if !uuidPathID(c) {
		return
	}
	view, err := h.svc.SubmitIntake(c.Request.Context(), id, c.Param("id"), req)
	if err != nil {
		triageFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "result": view})
}

// Answer — POST /health/triage/sessions/:id/answer
func (h *Handler) Answer(c *gin.Context) {
	id := ginutil.UserID(c)
	if id == "" {
		ginutil.FailOK(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req struct {
		Code  string `json:"code"`
		Value string `json:"value"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "invalid body")
		return
	}
	if !uuidPathID(c) {
		return
	}
	view, err := h.svc.Answer(c.Request.Context(), id, c.Param("id"), req.Code, req.Value)
	if err != nil {
		triageFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "result": view})
}

// GetSession — GET /health/triage/sessions/:id
func (h *Handler) GetSession(c *gin.Context) {
	id := ginutil.UserID(c)
	if id == "" {
		ginutil.FailOK(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	if !uuidPathID(c) {
		return
	}
	view, err := h.svc.GetSession(c.Request.Context(), id, c.Param("id"))
	if err != nil {
		triageFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "result": view})
}

// RegisterHealthTriageCore wires the AI Symptom Checker CORE orchestration onto
// the finance member group + a health admin group. The integration owner calls
// this from the aggregator under the triage feature flag — this file edits no
// existing routing file.
//   - member: /api/finance/health/triage/*  (member-authenticated; user_id mirrored)
//   - admin : /api/health/admin/* + RBAC health.triage.admin (per route)
//
// Dependency injection (nil → mock-first / deterministic safety net):
//   - engine    nil → triage.MockEngine            (licensed engine when configured)
//   - extractor nil → triage.MockExtractor          (LLM extractor when configured)
//   - redflag   nil → LayeredRedFlag(Default, nil)  (deterministic SC-2 safety net)
//
// The vault + audit sinks are wired by the orchestrator (nil is safe). The engine
// always runs DE-IDENTIFIED (SC-7) and the red-flag layer always overrides toward
// higher urgency (SC-2/SC-3) regardless of which engine is injected.
func RegisterHealthTriageCore(
	member, admin *gin.RouterGroup,
	pool *pgxpool.Pool,
	rbac services.RBACService,
	engine triage.EngineProvider,
	extractor triage.EvidenceExtractor,
	redflag triage.RedFlagEngine,
) {
	if pool == nil {
		return
	}
	if engine == nil {
		engine = triage.MockEngine{}
	}
	if extractor == nil {
		extractor = triage.MockExtractor{}
	}
	if redflag == nil {
		redflag = NewLayeredRedFlag(triage.DefaultRedFlagEngine{}, nil)
	}

	// Audit + vault sinks are left nil here; the orchestrator may inject them via a
	// NewSessionService call instead, but the default wiring is nil-safe (SC-12
	// auditing degrades to no-op rather than failing the money/no-money path).
	svc := NewSessionService(pool, engine, extractor, redflag, nil, nil)
	h := NewHandler(svc)

	g := member.Group("/health/triage")
	g.GET("/profiles", h.ListProfiles)
	g.POST("/profiles", h.CreateProfile)
	g.POST("/sessions", h.StartSession)
	g.POST("/sessions/:id/intake", h.SubmitIntake)
	g.POST("/sessions/:id/answer", h.Answer)
	g.GET("/sessions/:id", h.GetSession)

	if admin != nil {
		ag := admin.Group("/triage")
		ag.GET("/sessions/:id",
			middleware.RequirePermission(rbac, "health.triage.admin"), h.GetSession)
	}
}
