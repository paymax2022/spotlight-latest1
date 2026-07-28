package live

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// Handler exposes the academy live + community + moderation surface over Gin.
//   - member: list/join live sessions, study groups, Q&A discussions, report content.
//   - admin : schedule/start/end sessions (academy.live), review/decide reports
//     (academy.moderation).
type Handler struct {
	svc *Service
}

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
	case errors.Is(err, ErrChildSafety):
		c.JSON(http.StatusForbidden, gin.H{"error": "child_safety_blocked", "message": err.Error()})
	case errors.Is(err, ErrInvalidInput):
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
	case errors.Is(err, ErrProvider):
		c.JSON(http.StatusBadGateway, gin.H{"error": "provider_error", "message": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal", "message": err.Error()})
	}
}

// RegisterAcademyLive wires the live/community/moderation routes. Member routes use
// BARE subpaths (the aggregator passes the /api/finance/academy base group). Admin
// routes are gated with middleware.RequirePermission(rbac, perm):
//   - academy.live       — schedule/start/end live sessions.
//   - academy.moderation — review the queue + decide reports.
//
// rooms is the injected streaming provider; nil degrades to a deterministic stub.
func RegisterAcademyLive(member, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService, rooms LiveRoomProvider) {
	svc := NewService(pool, rooms)
	h := NewHandler(svc)
	guard := func(p string) gin.HandlerFunc { return middleware.RequirePermission(rbac, p) }

	// ── Member ──
	member.GET("/live/sessions", h.ListSessions)
	member.POST("/live/sessions/:id/join", h.JoinSession)
	member.GET("/community/groups", h.ListGroups)
	member.POST("/community/groups", h.CreateGroup)
	member.POST("/community/groups/:id/join", h.JoinGroup)
	member.GET("/community/discussions", h.ListDiscussions)
	member.POST("/community/discussions", h.PostDiscussion)
	member.POST("/moderation/report", h.ReportContent)

	// ── Admin: live-session management (academy.live) ──
	admin.POST("/live/sessions", guard("academy.live"), h.AdminScheduleSession)
	admin.POST("/live/sessions/:id/start", guard("academy.live"), h.AdminStartSession)
	admin.POST("/live/sessions/:id/end", guard("academy.live"), h.AdminEndSession)
	admin.POST("/live/sessions/:id/cancel", guard("academy.live"), h.AdminCancelSession)

	// ── Admin: moderation (academy.moderation) ──
	admin.GET("/moderation/reports", guard("academy.moderation"), h.AdminListReports)
	admin.POST("/moderation/reports/:id/decide", guard("academy.moderation"), h.AdminDecideReport)
}

// ── Member handlers ──────────────────────────────────────────────────────────

func (h *Handler) ListSessions(c *gin.Context) {
	limit, _ := strconv.Atoi(c.Query("limit"))
	out, err := h.svc.ListSessions(c.Request.Context(), SessionFilter{View: c.Query("view"), Limit: limit})
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) JoinSession(c *gin.Context) {
	u := uid(c)
	if u == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	sess, token, err := h.svc.JoinSession(c.Request.Context(), u, c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"session": sess, "token": token}})
}

func (h *Handler) ListGroups(c *gin.Context) {
	limit, _ := strconv.Atoi(c.Query("limit"))
	out, err := h.svc.ListGroups(c.Request.Context(), limit)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) CreateGroup(c *gin.Context) {
	u := uid(c)
	if u == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	var req CreateGroupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.CreateGroup(c.Request.Context(), u, req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

func (h *Handler) JoinGroup(c *gin.Context) {
	u := uid(c)
	if u == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	if err := h.svc.JoinGroup(c.Request.Context(), u, c.Param("id")); err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"group_id": c.Param("id"), "joined": true}})
}

func (h *Handler) ListDiscussions(c *gin.Context) {
	limit, _ := strconv.Atoi(c.Query("limit"))
	out, err := h.svc.ListDiscussions(c.Request.Context(), c.Query("scope"), c.Query("ref_id"), limit)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) PostDiscussion(c *gin.Context) {
	u := uid(c)
	if u == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	var req PostDiscussionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.PostDiscussion(c.Request.Context(), u, req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

func (h *Handler) ReportContent(c *gin.Context) {
	u := uid(c)
	if u == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	var req ReportContentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.ReportContent(c.Request.Context(), u, req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

// ── Admin handlers ────────────────────────────────────────────────────────────

func (h *Handler) AdminScheduleSession(c *gin.Context) {
	var req ScheduleSessionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.ScheduleSession(c.Request.Context(), uid(c), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

func (h *Handler) AdminStartSession(c *gin.Context) {
	out, err := h.svc.StartSession(c.Request.Context(), uid(c), c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) AdminEndSession(c *gin.Context) {
	var req struct {
		ReplayRef string `json:"replay_ref"`
	}
	_ = c.ShouldBindJSON(&req) // body optional
	out, err := h.svc.EndSession(c.Request.Context(), uid(c), c.Param("id"), req.ReplayRef)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) AdminCancelSession(c *gin.Context) {
	out, err := h.svc.CancelSession(c.Request.Context(), uid(c), c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) AdminListReports(c *gin.Context) {
	limit, _ := strconv.Atoi(c.Query("limit"))
	out, err := h.svc.ListReports(c.Request.Context(), c.Query("state"), limit)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) AdminDecideReport(c *gin.Context) {
	var req DecideReportRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.DecideReport(c.Request.Context(), uid(c), c.Param("id"), req.Action)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}
