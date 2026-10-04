package learn

import (
	"errors"
	"net/http"
	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"

	"github.com/gin-gonic/gin"
)

// Handler exposes the Learn Center member API. user_id is set on the gin context
// by the auth middleware (read via ginutil.UserID). All content reads are
// authenticated but not owner-scoped (content is public-to-members); the only
// mutation (submitQuiz) is scored server-side and attributed to the caller.
// Responses are returned as the raw payload (no envelope) to match the mobile
// api wrapper's unwrap(res.data?.data ?? res.data), mirroring the invest module.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// errMap carries the sentinel→status mapping for learn handlers. Unknown errors
// map to 500 but keep a generic body — internal error text never leaks.
var errMap = httperr.New(http.StatusInternalServerError,
	httperr.R(http.StatusNotFound, ErrNotFound),
	httperr.R(http.StatusForbidden, ErrForbidden),
	httperr.R(http.StatusBadRequest, ErrBadInput),
)

func httpErr(c *gin.Context, err error) {
	if code := errMap.Code(err); code == http.StatusInternalServerError {
		c.JSON(code, gin.H{"error": "something went wrong"})
		return
	}
	errMap.Write(c, err)
}

// GetPaths — GET /paths
func (h *Handler) GetPaths(c *gin.Context) {
	paths, err := h.svc.ListPaths(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, paths)
}

// GetPath — GET /paths/:id
func (h *Handler) GetPath(c *gin.Context) {
	p, err := h.svc.GetPath(c.Request.Context(), ginutil.UserID(c), c.Param("id"))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, p)
}

// GetLesson — GET /lessons/:id (marks the lesson read for the caller)
func (h *Handler) GetLesson(c *gin.Context) {
	l, err := h.svc.GetLesson(c.Request.Context(), ginutil.UserID(c), c.Param("id"))
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
	uid := ginutil.UserID(c)
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

// Paymax Invest · Learn Center — domain model.
// The Learn Center is an education-first, read-mostly surface. Content
// (paths / lessons / quizzes / glossary) is server-driven config: the mobile
// client renders exactly what the payload describes (see mobile
// features/learn/types/learn.types.ts — this model is its server counterpart).
// The ONLY mutation is submitting a quiz for scoring. Scoring is authoritative
// on the server (the client never decides pass/fail): the answer key lives in
// learn_quiz_options.is_correct and is never serialised to the client.

// LearnLevel is the audience / track a path belongs to (drives chip styling
// client-side). Kept as an open string enum, validated at the DB CHECK.
type LearnLevel string

const (
	LevelBeginner LearnLevel = "beginner"
	LevelStock    LearnLevel = "stock"
	LevelCrypto   LearnLevel = "crypto"
	LevelWealth   LearnLevel = "wealth"
)

// LessonKind is how a lesson is consumed.
type LessonKind string

const (
	LessonArticle LessonKind = "article"
	LessonVideo   LessonKind = "video"
)

// LearnPath is a curated track of lessons. progress_pct is per-learner and is
// derived from learn_lesson_progress (server-tracked), not stored on the path.
type LearnPath struct {
	ID          string     `json:"id"`
	Title       string     `json:"title"`
	Description string     `json:"description"`
	IconColor   string     `json:"iconColor"`
	Level       LearnLevel `json:"level"`
	LessonIDs   []string   `json:"lessonIds"`
	ProgressPct int        `json:"progressPct"`
}

// Lesson is a single article or video unit inside a path.
type Lesson struct {
	ID           string     `json:"id"`
	PathID       string     `json:"pathId"`
	Title        string     `json:"title"`
	DurationMins int        `json:"durationMins"`
	Kind         LessonKind `json:"kind"`
	Body         string     `json:"body"`
	Summary      string     `json:"summary"`
}

// QuizOption — note: `correct` is only ever populated server-side during scoring
// and is omitted from the client-facing quiz payload (json:"correct" is always
// false in the GET quiz response; the answer key never leaves the server).
type QuizOption struct {
	ID      string `json:"id"`
	Label   string `json:"label"`
	Correct bool   `json:"correct"`
}

type QuizQuestion struct {
	ID      string       `json:"id"`
	Prompt  string       `json:"prompt"`
	Options []QuizOption `json:"options"`
}

// Quiz is an optional knowledge check attached to a lesson.
type Quiz struct {
	ID        string         `json:"id"`
	LessonID  string         `json:"lessonId"`
	Questions []QuizQuestion `json:"questions"`
}

// QuizAnswers maps questionId → chosen optionId (the submit body).
type QuizAnswers map[string]string

// QuizResult is the server-authoritative scoring result.
type QuizResult struct {
	Score  int  `json:"score"`
	Total  int  `json:"total"`
	Passed bool `json:"passed"`
}

// GlossaryTerm is a plain-English definition.
type GlossaryTerm struct {
	Term       string `json:"term"`
	Definition string `json:"definition"`
}

// QuizPassRatio mirrors the mobile QUIZ_PASS_RATIO — pass threshold is a
// fraction of correct answers. Kept server-side so the client can never lower it.
const QuizPassRatio = 0.7

// Sentinel errors — mapped to HTTP status in the handler.
var (
	ErrNotFound  = errors.New("learn: not found")
	ErrForbidden = errors.New("learn: forbidden")
	ErrBadInput  = errors.New("learn: invalid input")
)

// RegisterLearn mounts the Learn Center member routes on the provided group.
// The caller passes a group already scoped to /learn and already carrying the
// auth middleware (user_id mirrored onto the gin context), matching the mobile
// base path /api/v1/learn/*.
//
//	GET  /paths                     — list published learning paths
//	GET  /paths/:id                 — single path detail
//	GET  /lessons/:id               — single lesson (marks read → advances progress)
//	GET  /lessons/:id/quiz          — quiz for a lesson (404 → none)
//	POST /quizzes/:id/submit        — score a quiz submission (server-authoritative)
//	GET  /glossary                  — alphabetical glossary
func RegisterLearn(g *gin.RouterGroup, h *Handler) {
	g.GET("/paths", h.GetPaths)
	g.GET("/paths/:id", h.GetPath)
	g.GET("/lessons/:id", h.GetLesson)
	g.GET("/lessons/:id/quiz", h.GetQuiz)
	g.POST("/quizzes/:id/submit", h.SubmitQuiz)
	g.GET("/glossary", h.GetGlossary)
}
