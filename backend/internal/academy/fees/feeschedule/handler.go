package feesfeeschedule

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// Handler exposes FeeSchedule routes over Gin. The router mounts create under
// /internal/edtech-fees/schools/{id}/fee-schedules (build-spec §6). Router registration
// into RegisterAcademy is owned by the QA/integration task — see RegisterFeesFeeSchedule.
type Handler struct {
	svc *Service
}

// NewHandler builds the fee-schedule handler.
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
	case errors.Is(err, ErrUnauthenticated):
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated", "message": err.Error()})
	case errors.Is(err, ErrMissingName):
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing_name", "message": err.Error()})
	case errors.Is(err, ErrInvalidAmount):
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_amount", "message": err.Error()})
	case errors.Is(err, ErrInvalidDate):
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_date", "message": err.Error()})
	case errors.Is(err, ErrFeeScheduleImmutable):
		// SF-1: the schedule is locked or referenced by an invoice — 409 Conflict.
		c.JSON(http.StatusConflict, gin.H{"error": "fee_schedule_immutable", "message": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal", "message": err.Error()})
	}
}

// RegisterFeesFeeSchedule wires the fee-schedule routes onto the member group. The Lock
// route is exposed but is intended for the invoice service (E2) to call on first issue —
// the integration task decides whether to gate it as internal-only.
//
//	member: POST  /schools/:schoolId/fee-schedules            create (unlocked) schedule
//	        GET   /schools/:schoolId/fee-schedules            list (?session=&class=)
//	        GET   /fee-schedules/:id                          get
//	        PATCH /fee-schedules/:id                          update (refused once locked — SF-1)
//	        POST  /fee-schedules/:id/lock                     mark immutable (invoice issue)
func RegisterFeesFeeSchedule(member, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService) *Handler {
	if pool == nil {
		return nil
	}
	h := NewHandler(NewService(pool))
	if member != nil {
		sg := member.Group("/schools/:schoolId")
		sg.POST("/fee-schedules", h.Create)
		sg.GET("/fee-schedules", h.List)

		fg := member.Group("/fee-schedules")
		fg.GET("/:id", h.Get)
		fg.PATCH("/:id", h.Update)
		fg.POST("/:id/lock", h.Lock)
	}
	_ = admin
	_ = rbac
	return h
}

// ── Handlers ────────────────────────────────────────────────────────────────────

func (h *Handler) Create(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	var req CreateFeeScheduleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	// Bind the school id from the path when present (route is per-school).
	if sid := c.Param("schoolId"); sid != "" {
		req.SchoolID = sid
	}
	out, err := h.svc.Create(c.Request.Context(), u, req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

func (h *Handler) List(c *gin.Context) {
	out, err := h.svc.List(c.Request.Context(), c.Param("schoolId"), c.Query("session"), c.Query("class"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) Get(c *gin.Context) {
	out, err := h.svc.Get(c.Request.Context(), c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) Update(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	var req UpdateFeeScheduleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.Update(c.Request.Context(), u, c.Param("id"), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) Lock(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	out, err := h.svc.Lock(c.Request.Context(), u, c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}
