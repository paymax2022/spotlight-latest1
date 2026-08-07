package connectmatching

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

// Handler exposes the Phase-1 likes + matches endpoints.
type Handler struct{ svc *Service }

// NewHandler builds the matching HTTP handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// Like — POST /api/v1/connect/likes (authenticated member).
// Idempotent (Idempotency-Key honoured by clients; uniqueness enforced in DB).
// A match is created ONLY on a mutual like.
func (h *Handler) Like(c *gin.Context) {
	uid := c.GetString("user_id")
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	var req LikeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	res, err := h.svc.Like(c.Request.Context(), uid, req.ToProfile, req.Kind)
	if err != nil {
		switch {
		case errors.Is(err, ErrNoProfile):
			c.JSON(http.StatusBadRequest, gin.H{"error": "create your profile first"})
		case errors.Is(err, ErrSelfLike):
			c.JSON(http.StatusBadRequest, gin.H{"error": "cannot like your own profile"})
		case errors.Is(err, ErrNeedsCredits):
			c.JSON(http.StatusPaymentRequired, gin.H{"error": "out of super-like credits", "upsell": "pass_super5"})
		case errors.Is(err, ErrBlocked), errors.Is(err, ErrRestricted), errors.Is(err, ErrIneligibleTarget):
			c.JSON(http.StatusForbidden, gin.H{"error": "not allowed"})
		default:
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		}
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": res})
}

// ListMatches — GET /api/v1/connect/matches?limit= (authenticated member).
func (h *Handler) ListMatches(c *gin.Context) {
	uid := c.GetString("user_id")
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	limit := 0
	if v := c.Query("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			limit = n
		}
	}
	matches, err := h.svc.ListMatches(c.Request.Context(), uid, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not list matches"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": matches})
}
