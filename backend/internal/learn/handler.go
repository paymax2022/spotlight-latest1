package learn

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// Handler exposes the Learn Center member API. user_id is set on the gin context
// by the auth middleware (c.GetString("user_id")). All content reads are
// authenticated but not owner-scoped (content is public-to-members); the only
// mutation (submitQuiz) is scored server-side and attributed to the caller.
//
// Responses are returned as the raw payload (no envelope) to match the mobile
// api wrapper's unwrap(res.data?.data ?? res.data), mirroring the invest module.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func userID(c *gin.Context) string { return c.GetString("user_id") }

func httpErr(c *gin.Context, err error) {
	switch err {
	case ErrNotFound:
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
	case ErrForbidden:
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
	case ErrBadInput:
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "something went wrong"})
	}
}

// GetPaths — GET /paths
func (h *Handler) GetPaths(c *gin.Context) {
	paths, err := h.svc.ListPaths(c.Request.Context(), userID(c))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, paths)
}

// GetPath — GET /paths/:id
func (h *Handler) GetPath(c *gin.Context) {
	p, err := h.svc.GetPath(c.Request.Context(), userID(c), c.Param("id"))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, p)
}

// GetLesson — GET /lessons/:id (marks the lesson read for the caller)
func (h *Handler) GetLesson(c *gin.Context) {
	l, err := h.svc.GetLesson(c.Request.Context(), userID(c), c.Param("id"))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, l)
}

// GetQuiz — GET /lessons/:id/quiz (404 → lesson has no quiz; mobile treats as null)
func (h *Handler) GetQuiz(c *gin.Context) {
	q, err := h.svc.GetQuiz(c.Request.Context(), c.Param("id"))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, q)
}

// SubmitQuiz — POST /quizzes/:id/submit  { answers: { questionId: optionId } }
// Scored server-side; the client never decides pass/fail.
func (h *Handler) SubmitQuiz(c *gin.Context) {
	uid := userID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	var req struct {
		Answers QuizAnswers `json:"answers"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	res, err := h.svc.SubmitQuiz(c.Request.Context(), uid, c.Param("id"), req.Answers)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// GetGlossary — GET /glossary
func (h *Handler) GetGlossary(c *gin.Context) {
	terms, err := h.svc.Glossary(c.Request.Context())
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, terms)
}
