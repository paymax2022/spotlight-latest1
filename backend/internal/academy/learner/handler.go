package learner

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Handler exposes the per-learner surface over Gin. All routes are member-scoped
// to the authenticated user (uid); there are no admin routes.
type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func uid(c *gin.Context) string { return c.GetString("user_id") }

// RegisterAcademyLearner mounts the /learner routes on the academy member group
// (→ /api/finance/academy/learner/...). Always-on: personal data + curriculum
// search need no feature flag.
func RegisterAcademyLearner(member *gin.RouterGroup, pool *pgxpool.Pool) {
	h := NewHandler(NewService(pool))
	lg := member.Group("/learner")
	lg.GET("/search", h.Search)
	lg.GET("/bookmarks", h.ListBookmarks)
	lg.POST("/bookmarks", h.CreateBookmark)
	lg.DELETE("/bookmarks/:id", h.DeleteBookmark)
	lg.GET("/notes", h.ListNotes)
	lg.POST("/notes", h.CreateNote)
	lg.DELETE("/notes/:id", h.DeleteNote)
	lg.GET("/daily-goal", h.DailyGoal)
}

func (h *Handler) unauth(c *gin.Context) bool {
	if uid(c) == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return true
	}
	return false
}

// Responses are returned BARE (no {data} envelope) to match the mobile contract.

func (h *Handler) Search(c *gin.Context) {
	if h.unauth(c) {
		return
	}
	out, err := h.svc.Search(c.Request.Context(), c.Query("q"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
		return
	}
	c.JSON(http.StatusOK, out)
}

func (h *Handler) ListBookmarks(c *gin.Context) {
	if h.unauth(c) {
		return
	}
	out, err := h.svc.ListBookmarks(c.Request.Context(), uid(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
		return
	}
	c.JSON(http.StatusOK, out)
}

func (h *Handler) CreateBookmark(c *gin.Context) {
	if h.unauth(c) {
		return
	}
	var req CreateBookmarkRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.CreateBookmark(c.Request.Context(), uid(c), req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
		return
	}
	c.JSON(http.StatusCreated, out)
}

func (h *Handler) DeleteBookmark(c *gin.Context) {
	if h.unauth(c) {
		return
	}
	if err := h.svc.DeleteBookmark(c.Request.Context(), uid(c), c.Param("id")); err != nil {
		h.failDelete(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) ListNotes(c *gin.Context) {
	if h.unauth(c) {
		return
	}
	out, err := h.svc.ListNotes(c.Request.Context(), uid(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
		return
	}
	c.JSON(http.StatusOK, out)
}

func (h *Handler) CreateNote(c *gin.Context) {
	if h.unauth(c) {
		return
	}
	var req CreateNoteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.CreateNote(c.Request.Context(), uid(c), req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
		return
	}
	c.JSON(http.StatusCreated, out)
}

func (h *Handler) DeleteNote(c *gin.Context) {
	if h.unauth(c) {
		return
	}
	if err := h.svc.DeleteNote(c.Request.Context(), uid(c), c.Param("id")); err != nil {
		h.failDelete(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) DailyGoal(c *gin.Context) {
	if h.unauth(c) {
		return
	}
	out, err := h.svc.DailyGoal(c.Request.Context(), uid(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
		return
	}
	c.JSON(http.StatusOK, out)
}

func (h *Handler) failDelete(c *gin.Context, err error) {
	if errors.Is(err, ErrNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "not_found"})
		return
	}
	c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
}
