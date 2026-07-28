package feessession

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// Handler exposes AcademicSession + Class routes over Gin. The router will mount these
// under /internal/edtech-fees/schools/:schoolId/{sessions,classes} (build-spec §6).
// Router registration into RegisterAcademy is owned by the QA/integration task — see
// RegisterFeesSession for the groups this package expects.
type Handler struct {
	svc *Service
}

// NewHandler builds the session/class handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func uid(c *gin.Context) string {
	if v := c.GetString("user_id"); v != "" {
		return v
	}
	if u, ok := middleware.GetAuthenticatedUser(c); ok {
		return u.ID
	}
	return ""
}

func (h *Handler) requireUser(c *gin.Context) (string, bool) {
	u := uid(c)
	if u == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return "", false
	}
	return u, true
}

func (h *Handler) fail(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "not_found", "message": err.Error()})
	case errors.Is(err, ErrForbidden):
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden", "message": err.Error()})
	case errors.Is(err, ErrUnauthenticated):
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated", "message": err.Error()})
	case errors.Is(err, ErrMissingName):
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing_name", "message": err.Error()})
	case errors.Is(err, ErrInvalidDate):
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_date", "message": err.Error()})
	case errors.Is(err, ErrInvalidStatus):
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_status", "message": err.Error()})
	case errors.Is(err, ErrIllegalTransition):
		c.JSON(http.StatusConflict, gin.H{"error": "illegal_transition", "message": err.Error()})
	case errors.Is(err, ErrSchoolMismatch):
		c.JSON(http.StatusConflict, gin.H{"error": "school_mismatch", "message": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal", "message": err.Error()})
	}
}

// RegisterFeesSession wires session + class routes onto the passed member group (routes
// are per-school under /schools/:schoolId). nil pool/groups are skipped.
//
//	member: POST /schools/:schoolId/sessions            create session
//	        GET  /schools/:schoolId/sessions            list sessions
//	        GET  /schools/:schoolId/sessions/:sessionId get session
//	        POST /schools/:schoolId/sessions/:sessionId/status  guarded status change
//	        POST /schools/:schoolId/classes             create class
//	        GET  /schools/:schoolId/classes             list classes (?session= filter)
//	        GET  /schools/:schoolId/classes/:classId    get class
//	        PATCH/schools/:schoolId/classes/:classId    update class
func RegisterFeesSession(member, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService) *Handler {
	if pool == nil {
		return nil
	}
	h := NewHandler(NewService(pool))
	if member != nil {
		g := member.Group("/schools/:schoolId")
		g.POST("/sessions", h.CreateSession)
		g.GET("/sessions", h.ListSessions)
		g.GET("/sessions/:sessionId", h.GetSession)
		g.POST("/sessions/:sessionId/status", h.SetSessionStatus)
		g.POST("/classes", h.CreateClass)
		g.GET("/classes", h.ListClasses)
		g.GET("/classes/:classId", h.GetClass)
		g.PATCH("/classes/:classId", h.UpdateClass)
	}
	// admin group reserved for future platform-scoped listing; rbac kept in signature
	// so the integration task can gate admin variants without a signature change.
	_ = admin
	_ = rbac
	return h
}

// ── Session handlers ────────────────────────────────────────────────────────────

func (h *Handler) CreateSession(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	var req CreateSessionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.CreateSession(c.Request.Context(), u, c.Param("schoolId"), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

func (h *Handler) ListSessions(c *gin.Context) {
	out, err := h.svc.ListSessions(c.Request.Context(), c.Param("schoolId"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) GetSession(c *gin.Context) {
	out, err := h.svc.GetSession(c.Request.Context(), c.Param("sessionId"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) SetSessionStatus(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	var req UpdateSessionStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.SetSessionStatus(c.Request.Context(), u, c.Param("sessionId"), SessionStatus(req.Status))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// ── Class handlers ──────────────────────────────────────────────────────────────

func (h *Handler) CreateClass(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	var req CreateClassRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.CreateClass(c.Request.Context(), u, c.Param("schoolId"), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

func (h *Handler) ListClasses(c *gin.Context) {
	out, err := h.svc.ListClasses(c.Request.Context(), c.Param("schoolId"), c.Query("session"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) GetClass(c *gin.Context) {
	out, err := h.svc.GetClass(c.Request.Context(), c.Param("classId"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) UpdateClass(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	var req UpdateClassRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.UpdateClass(c.Request.Context(), u, c.Param("classId"), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}
