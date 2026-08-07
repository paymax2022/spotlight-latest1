package connectvoting

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

// Handler exposes contests + free/paid voting over HTTP.
type Handler struct{ svc *Service }

// NewHandler builds a voting handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func userID(c *gin.Context) string  { return c.GetString("user_id") }
func idemKey(c *gin.Context) string { return c.GetHeader("Idempotency-Key") }

func mapError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrMissingIdem):
		c.JSON(http.StatusBadRequest, gin.H{"error": "Idempotency-Key header required"})
	case errors.Is(err, ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "contest not found"})
	case errors.Is(err, ErrContestClosed), errors.Is(err, ErrPaidUnavailable),
		errors.Is(err, ErrInvalidAmount), errors.Is(err, ErrInvalidQuantity):
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	case errors.Is(err, ErrFreeVoteUsed):
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
	case errors.Is(err, ErrVelocity):
		c.JSON(http.StatusTooManyRequests, gin.H{"error": err.Error()})
	default:
		msg := err.Error()
		switch {
		case strings.Contains(msg, "insufficient funds"):
			c.JSON(http.StatusPaymentRequired, gin.H{"error": "insufficient wallet balance"})
		case strings.Contains(msg, "duplicate"):
			c.JSON(http.StatusConflict, gin.H{"error": "duplicate request"})
		case strings.Contains(msg, "limit"), strings.Contains(msg, "disabled"):
			c.JSON(http.StatusForbidden, gin.H{"error": "transaction limit exceeded"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": "vote failed"})
		}
	}
}

// ListContests — GET /api/v1/connect/contests (member).
func (h *Handler) ListContests(c *gin.Context) {
	limit := 0
	if v := c.Query("limit"); v != "" {
		limit, _ = strconv.Atoi(v)
	}
	out, err := h.svc.ListContests(c.Request.Context(), limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// GetContest — GET /api/v1/connect/contests/:id (member).
func (h *Handler) GetContest(c *gin.Context) {
	out, err := h.svc.GetContest(c.Request.Context(), c.Param("id"))
	if err != nil {
		mapError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// FreeVote — POST /api/v1/connect/contests/:id/vote (member). No money.
func (h *Handler) FreeVote(c *gin.Context) {
	uid := userID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	var req FreeVoteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	v, err := h.svc.FreeVote(c.Request.Context(), c.Param("id"), uid, req)
	if err != nil {
		mapError(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": v})
}

// PaidVote — POST /api/v1/connect/contests/:id/paid-vote (member, Idempotency-Key).
func (h *Handler) PaidVote(c *gin.Context) {
	uid := userID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	var req PaidVoteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	v, err := h.svc.PaidVote(c.Request.Context(), c.Param("id"), uid, idemKey(c), req)
	if err != nil {
		mapError(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": v})
}

// Results — GET /api/v1/connect/contests/:id/results (member).
func (h *Handler) Results(c *gin.Context) {
	out, err := h.svc.Results(c.Request.Context(), c.Param("id"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// PermissionGuard mirrors middleware.RequirePermission: route file supplies
// a factory that builds the per-permission gin.HandlerFunc.
type PermissionGuard func(permission string) gin.HandlerFunc

// Register wires the voting routes onto the auth-gated member group.
func Register(member gin.IRouter, svc *Service) {
	h := NewHandler(svc)
	member.GET("/contests", h.ListContests)
	member.GET("/contests/:id", h.GetContest)
	member.POST("/contests/:id/vote", h.FreeVote)      // free
	member.POST("/contests/:id/paid-vote", h.PaidVote) // Idempotency-Key required
	member.GET("/contests/:id/results", h.Results)

	// Stage eviction routes (admin/judge) — wired without RBAC guards here;
	// admin routes with guards are in RegisterAdmin.
	member.GET("/contests/:id/stages/:stageNum/contestants", h.GetContestantsByStage)
	member.GET("/contests/:id/evictions", h.GetEvictions)
	member.POST("/contests/:id/stages/:stageNum/evict", h.TriggerEvictions)
	member.POST("/contests/:id/save", h.SaveContestant)
	member.POST("/contests/:id/extend-grace-period", h.ExtendGracePeriod)
	member.POST("/contests/:id/stages/:stageNum/finalize-evictions", h.FinalizeEvictions)
	member.POST("/contests/:id/admin-vote", h.AdminVote)
}

// RegisterAdmin wires admin eviction routes with RBAC permission guards.
// The caller passes a guard factory (built from middleware.RequirePermission + the RBAC
// service) so each route enforces its connect.contests.* permission.
func RegisterAdmin(admin gin.IRouter, svc *Service, guard PermissionGuard) {
	h := NewHandler(svc)
	g := admin.Group("/contests")

	// Admin-only eviction management
	g.POST("/:id/stages/:stageNum/evict",
		guard("connect.contests.manage"),
		h.TriggerEvictions)
	g.POST("/:id/extend-grace-period",
		guard("connect.contests.manage"),
		h.ExtendGracePeriod)
	g.POST("/:id/stages/:stageNum/finalize-evictions",
		guard("connect.contests.manage"),
		h.FinalizeEvictions)
	g.POST("/:id/admin-vote",
		guard("connect.contests.manage"),
		h.AdminVote)

	// Judge/admin save (can have different permission if needed)
	g.POST("/:id/save",
		guard("connect.contests.judge"),
		h.SaveContestant)

	// View routes (lower permission level)
	g.GET("/:id/evictions",
		guard("connect.contests.view"),
		h.GetEvictions)
	g.GET("/:id/stages/:stageNum/contestants",
		guard("connect.contests.view"),
		h.GetContestantsByStage)
}
