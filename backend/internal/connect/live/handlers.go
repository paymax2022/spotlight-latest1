package connectlive

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func uid(c *gin.Context) string { return c.GetString("user_id") }

// fail maps a service error to an HTTP status.
func fail(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
	case errors.Is(err, ErrNotHost):
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
	case errors.Is(err, ErrBadState), errors.Is(err, ErrCohostFull),
		errors.Is(err, ErrBadModeration), errors.Is(err, ErrInvalidInput):
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
	case errors.Is(err, ErrRTCUnconfig):
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
	}
}

// Create — POST /live/sessions.
func (h *Handler) Create(c *gin.Context) {
	var in CreateSessionInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	sess, err := h.svc.CreateSession(c.Request.Context(), uid(c), in)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": sess})
}

// Start — POST /live/sessions/:id/start.
func (h *Handler) Start(c *gin.Context) {
	sess, err := h.svc.Start(c.Request.Context(), uid(c), c.Param("id"))
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": sess})
}

// End — POST /live/sessions/:id/end.
func (h *Handler) End(c *gin.Context) {
	sess, err := h.svc.End(c.Request.Context(), uid(c), c.Param("id"))
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": sess})
}

// Discover — GET /live/sessions?low_bandwidth=&limit=.
func (h *Handler) Discover(c *gin.Context) {
	low, _ := strconv.ParseBool(c.Query("low_bandwidth"))
	limit, _ := strconv.Atoi(c.Query("limit"))
	out, err := h.svc.Discover(c.Request.Context(), low, limit)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// Get — GET /live/sessions/:id.
func (h *Handler) Get(c *gin.Context) {
	sess, err := h.svc.Get(c.Request.Context(), c.Param("id"))
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": sess})
}

// Cohost — POST /live/sessions/:id/cohost (invite or accept/decline).
func (h *Handler) Cohost(c *gin.Context) {
	var in CohostInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	p, err := h.svc.Cohost(c.Request.Context(), uid(c), c.Param("id"), in)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": p})
}

// PK — POST /live/sessions/:id/pk (create battle / apply non-cash score).
func (h *Handler) PK(c *gin.Context) {
	var in PKInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	b, err := h.svc.PK(c.Request.Context(), uid(c), c.Param("id"), in)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": b})
}

// Moderate — POST /live/sessions/:id/moderate (mute/unmute/kick).
func (h *Handler) Moderate(c *gin.Context) {
	var in ModerateInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.Moderate(c.Request.Context(), uid(c), c.Param("id"), in); err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"ok": true}})
}

// RTCToken — POST /live/sessions/:id/rtc-token.
func (h *Handler) RTCToken(c *gin.Context) {
	tok, err := h.svc.IssueRTCToken(c.Request.Context(), uid(c), c.Param("id"))
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": tok})
}

// --- Admin ---

// AdminList — GET /live/sessions (admin moderation view).
func (h *Handler) AdminList(c *gin.Context) {
	limit, _ := strconv.Atoi(c.Query("limit"))
	out, err := h.svc.AdminList(c.Request.Context(), limit)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// AdminTerminate — POST /live/sessions/:id/terminate.
func (h *Handler) AdminTerminate(c *gin.Context) {
	sess, err := h.svc.AdminTerminate(c.Request.Context(), uid(c), c.Param("id"))
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": sess})
}

// Register wires the live module onto the shared Connect member + admin groups
// (both already carry RequireAuthContext + user_id). Admin routes add per-route
// RBAC (connect.live.*). The RTC issuer is supplied by the caller from config —
// provider secrets are never read here.
func Register(member, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService, audit Auditor, rtc RTCTokenIssuer) {
	svc := NewService(NewRepository(pool), audit, rtc)
	h := NewHandler(svc)

	g := member.Group("/live")
	g.POST("/sessions", h.Create)
	g.GET("/sessions", h.Discover)
	g.GET("/sessions/:id", h.Get)
	g.POST("/sessions/:id/start", h.Start)
	g.POST("/sessions/:id/end", h.End)
	g.POST("/sessions/:id/cohost", h.Cohost)
	g.POST("/sessions/:id/pk", h.PK)
	g.POST("/sessions/:id/moderate", h.Moderate)
	g.POST("/sessions/:id/rtc-token", h.RTCToken)

	ag := admin.Group("/live")
	ag.GET("/sessions",
		middleware.RequirePermission(rbac, "connect.live.view"), h.AdminList)
	ag.POST("/sessions/:id/terminate",
		middleware.RequirePermission(rbac, "connect.live.moderate"), h.AdminTerminate)
}
