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

// Register wires the voting routes onto the auth-gated member group.
func Register(member gin.IRouter, svc *Service) {
	h := NewHandler(svc)
	member.GET("/contests", h.ListContests)
	member.GET("/contests/:id", h.GetContest)
	member.POST("/contests/:id/vote", h.FreeVote)      // free
	member.POST("/contests/:id/paid-vote", h.PaidVote) // Idempotency-Key required
	member.GET("/contests/:id/results", h.Results)
}
