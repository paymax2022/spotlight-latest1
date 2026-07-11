package connectfeed

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// Handler exposes the content/feed endpoints over HTTP.
type Handler struct{ svc *Service }

// NewHandler builds a feed handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func uid(c *gin.Context) string     { return c.GetString("user_id") }
func idemKey(c *gin.Context) string { return c.GetHeader("Idempotency-Key") }

func fail(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
	case errors.Is(err, ErrMissingIdem):
		c.JSON(http.StatusBadRequest, gin.H{"error": "Idempotency-Key header required"})
	case errors.Is(err, ErrInvalidInput):
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
	}
}

func parseLimit(c *gin.Context) int {
	if n, err := strconv.Atoi(c.Query("limit")); err == nil {
		return n
	}
	return 0
}

// Compose — POST /networking/posts (member, Idempotency-Key required).
func (h *Handler) Compose(c *gin.Context) {
	var in ComposePostInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	p, err := h.svc.Compose(c.Request.Context(), uid(c), idemKey(c), in)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": p})
}

// PostDetail — GET /networking/posts/:id (member).
func (h *Handler) PostDetail(c *gin.Context) {
	p, err := h.svc.Post(c.Request.Context(), c.Param("id"))
	if err != nil {
		fail(c, err)
		return
	}
	comments, err := h.svc.Comments(c.Request.Context(), p.ID)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"post": p, "comments": comments}})
}

// React — POST /networking/posts/:id/reactions (member, Idempotency-Key required).
func (h *Handler) React(c *gin.Context) {
	var in ReactInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	res, err := h.svc.React(c.Request.Context(), uid(c), idemKey(c), c.Param("id"), in)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": res})
}

// Comment — POST /networking/posts/:id/comments (member, Idempotency-Key required).
func (h *Handler) Comment(c *gin.Context) {
	var in CommentInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	cm, err := h.svc.Comment(c.Request.Context(), uid(c), idemKey(c), c.Param("id"), in)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": cm})
}

// Feed — GET /networking/feed?limit= (member). Main PN-3-ranked content feed.
func (h *Handler) Feed(c *gin.Context) {
	out, err := h.svc.Feed(c.Request.Context(), parseLimit(c))
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// HashtagFeed — GET /networking/topics/:tag?limit= (member). PN-3-ranked, filtered.
func (h *Handler) HashtagFeed(c *gin.Context) {
	out, err := h.svc.HashtagFeed(c.Request.Context(), c.Param("tag"), parseLimit(c))
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// Moderate — POST /networking/posts/:id/moderation (admin, ADM-CN-01).
func (h *Handler) Moderate(c *gin.Context) {
	var in ModerationInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	p, err := h.svc.Moderate(c.Request.Context(), uid(c), c.Param("id"), in)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": p})
}

// Register wires the content/feed module onto the shared Connect member + admin
// groups. Member routes live under /networking; the admin content-moderation
// endpoint (ADM-CN-01) is gated by RequirePermission(rbac,"connect.moderation.manage").
func Register(member, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService, audit Auditor) {
	svc := NewService(NewRepository(pool), audit)
	h := NewHandler(svc)

	g := member.Group("/networking")
	g.POST("/posts", h.Compose)                    // Idempotency-Key required
	g.GET("/posts/:id", h.PostDetail)
	g.POST("/posts/:id/reactions", h.React)        // Idempotency-Key required
	g.POST("/posts/:id/comments", h.Comment)       // Idempotency-Key required
	g.GET("/feed", h.Feed)                          // main ranked feed (PN-3)
	g.GET("/topics/:tag", h.HashtagFeed)            // hashtag/topic feed (PN-3)

	ag := admin.Group("/networking")
	ag.POST("/posts/:id/moderation",
		middleware.RequirePermission(rbac, "connect.moderation.manage"), h.Moderate)
}
