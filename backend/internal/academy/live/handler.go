package live

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

const keyUnauthenticated = "unauthenticated"

const keyMessage = "message"

const keyInvalidInput = "invalid_input"

const keyIllegalTransition = "illegal_transition"

const keyError = "error"

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
// authUserID adapts middleware.GetAuthenticatedUser to ginutil.UserID’s
// fallback signature for contexts missing the "user_id" key.
func authUserID(c *gin.Context) string {
	if u, ok := middleware.GetAuthenticatedUser(c); ok {
		return u.ID
	}
	return ""
}

func (h *Handler) fail(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{keyError: "not_found", keyMessage: httperr.Msg(c, http.StatusNotFound, err)})
	case errors.Is(err, ErrIllegalTransition):
		c.JSON(http.StatusConflict, gin.H{keyError: keyIllegalTransition, keyMessage: httperr.Msg(c, http.StatusConflict, err)})
	case errors.Is(err, ErrChildSafety):
		c.JSON(http.StatusForbidden, gin.H{keyError: "child_safety_blocked", keyMessage: httperr.Msg(c, http.StatusForbidden, err)})
	case errors.Is(err, ErrInvalidInput):
		c.JSON(http.StatusBadRequest, gin.H{keyError: keyInvalidInput, keyMessage: httperr.Msg(c, http.StatusBadRequest, err)})
	case errors.Is(err, ErrProvider):
		c.JSON(http.StatusBadGateway, gin.H{keyError: "provider_error", keyMessage: httperr.Msg(c, http.StatusBadGateway, err)})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{keyError: "internal", keyMessage: httperr.Msg(c, http.StatusInternalServerError, err)})
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

	member.GET("/live/sessions", h.ListSessions)
	member.GET("/live/sessions/:id", h.GetSession)
	member.POST("/live/sessions/:id/join", h.JoinSession)
	member.GET("/community/groups", h.ListGroups)
	member.POST("/community/groups", h.CreateGroup)
	member.POST("/community/groups/:id/join", h.JoinGroup)
	member.GET("/community/discussions", h.ListDiscussions)
	member.POST("/community/discussions", h.PostDiscussion)
	member.POST("/moderation/report", h.ReportContent)

	admin.GET("/live/sessions", guard("academy.live"), h.AdminListSessions)
	admin.GET("/live/replays", guard("academy.live"), h.AdminListReplays)
	admin.POST("/live/sessions", guard("academy.live"), h.AdminScheduleSession)
	admin.POST("/live/sessions/:id/start", guard("academy.live"), h.AdminStartSession)
	admin.POST("/live/sessions/:id/end", guard("academy.live"), h.AdminEndSession)
	admin.POST("/live/sessions/:id/cancel", guard("academy.live"), h.AdminCancelSession)

	admin.GET("/moderation/reports", guard("academy.moderation"), h.AdminListReports)
	admin.POST("/moderation/reports/:id/decide", guard("academy.moderation"), h.AdminDecideReport)
	admin.POST("/moderation/reports/:id/triage", guard("academy.moderation"), h.AdminTriageReport)
	admin.POST("/moderation/reports/:id/escalate", guard("academy.moderation"), h.AdminEscalateReport)
}

func (h *Handler) ListSessions(c *gin.Context) {
	limit, _ := strconv.Atoi(c.Query("limit"))
	out, err := h.svc.ListSessions(c.Request.Context(), SessionFilter{View: c.Query("view"), Limit: limit})
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// GetSession returns a single live session by id (public catalog read; same
// LiveSession shape as the ListSessions list item).
func (h *Handler) GetSession(c *gin.Context) {
	out, err := h.svc.GetSession(c.Request.Context(), c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) JoinSession(c *gin.Context) {
	u := ginutil.UserID(c, authUserID)
	if u == "" {
		c.JSON(http.StatusUnauthorized, gin.H{keyError: keyUnauthenticated})
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
	u := ginutil.UserID(c, authUserID)
	if u == "" {
		c.JSON(http.StatusUnauthorized, gin.H{keyError: keyUnauthenticated})
		return
	}
	var req CreateGroupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: keyInvalidInput, keyMessage: httperr.Msg(c, http.StatusBadRequest, err)})
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
	u := ginutil.UserID(c, authUserID)
	if u == "" {
		c.JSON(http.StatusUnauthorized, gin.H{keyError: keyUnauthenticated})
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
	u := ginutil.UserID(c, authUserID)
	if u == "" {
		c.JSON(http.StatusUnauthorized, gin.H{keyError: keyUnauthenticated})
		return
	}
	var req PostDiscussionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: keyInvalidInput, keyMessage: httperr.Msg(c, http.StatusBadRequest, err)})
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
	u := ginutil.UserID(c, authUserID)
	if u == "" {
		c.JSON(http.StatusUnauthorized, gin.H{keyError: keyUnauthenticated})
		return
	}
	var req ReportContentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: keyInvalidInput, keyMessage: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	out, err := h.svc.ReportContent(c.Request.Context(), u, req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

func (h *Handler) AdminScheduleSession(c *gin.Context) {
	var req ScheduleSessionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: keyInvalidInput, keyMessage: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	out, err := h.svc.ScheduleSession(c.Request.Context(), ginutil.UserID(c, authUserID), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

func (h *Handler) AdminStartSession(c *gin.Context) {
	out, err := h.svc.StartSession(c.Request.Context(), ginutil.UserID(c, authUserID), c.Param("id"))
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
	out, err := h.svc.EndSession(c.Request.Context(), ginutil.UserID(c, authUserID), c.Param("id"), req.ReplayRef)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) AdminCancelSession(c *gin.Context) {
	out, err := h.svc.CancelSession(c.Request.Context(), ginutil.UserID(c, authUserID), c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// AdminListSessions lists ALL live sessions regardless of state (admin-wide oversight).
func (h *Handler) AdminListSessions(c *gin.Context) {
	limit, _ := strconv.Atoi(c.Query("limit"))
	out, err := h.svc.ListAllSessions(c.Request.Context(), limit)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// AdminListReplays lists ended sessions that have a stored replay reference.
func (h *Handler) AdminListReplays(c *gin.Context) {
	limit, _ := strconv.Atoi(c.Query("limit"))
	out, err := h.svc.ListReplays(c.Request.Context(), limit)
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
		c.JSON(http.StatusBadRequest, gin.H{keyError: keyInvalidInput, keyMessage: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	out, err := h.svc.DecideReport(c.Request.Context(), ginutil.UserID(c, authUserID), c.Param("id"), req.Action)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// AdminTriageReport moves a report into triaged (guarded transition + audit; sibling of decide).
func (h *Handler) AdminTriageReport(c *gin.Context) {
	out, err := h.svc.TriageReport(c.Request.Context(), ginutil.UserID(c, authUserID), c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// AdminEscalateReport moves a report into escalated (guarded transition + audit; sibling of decide).
func (h *Handler) AdminEscalateReport(c *gin.Context) {
	out, err := h.svc.EscalateReport(c.Request.Context(), ginutil.UserID(c, authUserID), c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}
