package learn

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ──────────────────────────────────────────────────────────────────────────
// Learn Center — ADMIN content management.
//
// This file adds the content-authoring surface on top of the read-mostly
// member API in service.go/handler.go/routes.go (none of those files are
// modified here — additive only, per house brownfield-safety rules).
//
// Scope: create/update/delete for learn_paths, learn_lessons, learn_quizzes
// (+ questions/options), and learn_glossary. All mutations are RBAC-gated at
// the route layer (see RegisterLearnAdmin) and audited via the existing
// nil-safe Auditor sink (learn.Service.audit / AdminService.audit).
//
// The answer key (learn_quiz_options.is_correct) IS returned to admins here
// (unlike the member-facing GetQuiz), since content authors must see/edit it.
// ──────────────────────────────────────────────────────────────────────────

// AdminService owns the content-authoring mutations. It shares the same pool
// (and, optionally, the same Auditor) as the read-mostly Service.
type AdminService struct {
	db    *pgxpool.Pool
	audit Auditor
}

func NewAdminService(db *pgxpool.Pool, audit Auditor) *AdminService {
	return &AdminService{db: db, audit: audit}
}

func (s *AdminService) log(actor, action, resType, resID string, oldV, newV map[string]any) {
	if s.audit == nil {
		return
	}
	s.audit.LogAction(actor, "", action, "learn", resType, resID, oldV, newV, "", "", "info")
}

func newID(prefix string) string {
	return prefix + "_" + strings.ReplaceAll(uuid.New().String(), "-", "")[:20]
}

// ───────────────────────── Admin DTOs ─────────────────────────

type AdminPathInput struct {
	ID          string     `json:"id"`
	Title       string     `json:"title" binding:"required"`
	Description string     `json:"description"`
	IconColor   string     `json:"iconColor"`
	Level       LearnLevel `json:"level" binding:"required"`
	SortOrder   int        `json:"sortOrder"`
	Published   *bool      `json:"published"`
}

type AdminLessonInput struct {
	ID           string     `json:"id"`
	PathID       string     `json:"pathId" binding:"required"`
	Title        string     `json:"title" binding:"required"`
	DurationMins int        `json:"durationMins"`
	Kind         LessonKind `json:"kind" binding:"required"`
	Body         string     `json:"body"`
	Summary      string     `json:"summary"`
	SortOrder    int        `json:"sortOrder"`
}

type AdminQuizOptionInput struct {
	ID        string `json:"id"`
	Label     string `json:"label" binding:"required"`
	IsCorrect bool   `json:"isCorrect"`
	SortOrder int    `json:"sortOrder"`
}

type AdminQuizQuestionInput struct {
	ID        string                 `json:"id"`
	Prompt    string                 `json:"prompt" binding:"required"`
	SortOrder int                    `json:"sortOrder"`
	Options   []AdminQuizOptionInput `json:"options"`
}

type AdminQuizInput struct {
	ID        string                   `json:"id"`
	LessonID  string                   `json:"lessonId" binding:"required"`
	Questions []AdminQuizQuestionInput `json:"questions"`
}

type AdminGlossaryInput struct {
	Term       string `json:"term" binding:"required"`
	Definition string `json:"definition" binding:"required"`
}

var isValidLevel = map[LearnLevel]bool{LevelBeginner: true, LevelStock: true, LevelCrypto: true, LevelWealth: true}
var isValidLessonKind = map[LessonKind]bool{LessonArticle: true, LessonVideo: true}

// ───────────────────────── Paths ─────────────────────────

func (s *AdminService) ListPathsAdmin(ctx context.Context) ([]LearnPath, error) {
	const q = `SELECT id, title, description, icon_color, level FROM learn_paths ORDER BY sort_order, title`
	rows, err := s.db.Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("learn admin: list paths: %w", err)
	}
	defer rows.Close()
	out := []LearnPath{}
	for rows.Next() {
		var p LearnPath
		var level string
		if err := rows.Scan(&p.ID, &p.Title, &p.Description, &p.IconColor, &level); err != nil {
			return nil, err
		}
		p.Level = LearnLevel(level)
		out = append(out, p)
	}
	return out, rows.Err()
}

func (s *AdminService) CreatePath(ctx context.Context, actor string, in AdminPathInput) (*LearnPath, error) {
	if !isValidLevel[in.Level] {
		return nil, ErrBadInput
	}
	id := in.ID
	if id == "" {
		id = newID("path")
	}
	published := true
	if in.Published != nil {
		published = *in.Published
	}
	const ins = `INSERT INTO learn_paths (id, title, description, icon_color, level, sort_order, published)
	             VALUES ($1,$2,$3,$4,$5,$6,$7)`
	if _, err := s.db.Exec(ctx, ins, id, in.Title, in.Description, in.IconColor, string(in.Level), in.SortOrder, published); err != nil {
		return nil, fmt.Errorf("learn admin: create path: %w", err)
	}
	s.log(actor, "learn.admin.path.create", "learn_path", id, nil, map[string]any{"title": in.Title, "level": in.Level})
	return &LearnPath{ID: id, Title: in.Title, Description: in.Description, IconColor: in.IconColor, Level: in.Level}, nil
}

func (s *AdminService) UpdatePath(ctx context.Context, actor, id string, in AdminPathInput) (*LearnPath, error) {
	if !isValidLevel[in.Level] {
		return nil, ErrBadInput
	}
	published := true
	if in.Published != nil {
		published = *in.Published
	}
	const upd = `UPDATE learn_paths SET title=$2, description=$3, icon_color=$4, level=$5, sort_order=$6, published=$7 WHERE id=$1`
	ct, err := s.db.Exec(ctx, upd, id, in.Title, in.Description, in.IconColor, string(in.Level), in.SortOrder, published)
	if err != nil {
		return nil, fmt.Errorf("learn admin: update path: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	s.log(actor, "learn.admin.path.update", "learn_path", id, nil, map[string]any{"title": in.Title, "level": in.Level})
	return &LearnPath{ID: id, Title: in.Title, Description: in.Description, IconColor: in.IconColor, Level: in.Level}, nil
}

func (s *AdminService) DeletePath(ctx context.Context, actor, id string) error {
	ct, err := s.db.Exec(ctx, `DELETE FROM learn_paths WHERE id=$1`, id)
	if err != nil {
		return fmt.Errorf("learn admin: delete path: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	s.log(actor, "learn.admin.path.delete", "learn_path", id, nil, nil)
	return nil
}

// ───────────────────────── Lessons ─────────────────────────

func (s *AdminService) CreateLesson(ctx context.Context, actor string, in AdminLessonInput) (*Lesson, error) {
	if !isValidLessonKind[in.Kind] {
		return nil, ErrBadInput
	}
	id := in.ID
	if id == "" {
		id = newID("les")
	}
	const ins = `INSERT INTO learn_lessons (id, path_id, title, duration_mins, kind, body, summary, sort_order)
	             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`
	if _, err := s.db.Exec(ctx, ins, id, in.PathID, in.Title, in.DurationMins, string(in.Kind), in.Body, in.Summary, in.SortOrder); err != nil {
		return nil, fmt.Errorf("learn admin: create lesson: %w", err)
	}
	s.log(actor, "learn.admin.lesson.create", "learn_lesson", id, nil, map[string]any{"title": in.Title, "pathId": in.PathID})
	return &Lesson{ID: id, PathID: in.PathID, Title: in.Title, DurationMins: in.DurationMins, Kind: in.Kind, Body: in.Body, Summary: in.Summary}, nil
}

func (s *AdminService) UpdateLesson(ctx context.Context, actor, id string, in AdminLessonInput) (*Lesson, error) {
	if !isValidLessonKind[in.Kind] {
		return nil, ErrBadInput
	}
	const upd = `UPDATE learn_lessons SET path_id=$2, title=$3, duration_mins=$4, kind=$5, body=$6, summary=$7, sort_order=$8 WHERE id=$1`
	ct, err := s.db.Exec(ctx, upd, id, in.PathID, in.Title, in.DurationMins, string(in.Kind), in.Body, in.Summary, in.SortOrder)
	if err != nil {
		return nil, fmt.Errorf("learn admin: update lesson: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	s.log(actor, "learn.admin.lesson.update", "learn_lesson", id, nil, map[string]any{"title": in.Title})
	return &Lesson{ID: id, PathID: in.PathID, Title: in.Title, DurationMins: in.DurationMins, Kind: in.Kind, Body: in.Body, Summary: in.Summary}, nil
}

func (s *AdminService) DeleteLesson(ctx context.Context, actor, id string) error {
	ct, err := s.db.Exec(ctx, `DELETE FROM learn_lessons WHERE id=$1`, id)
	if err != nil {
		return fmt.Errorf("learn admin: delete lesson: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	s.log(actor, "learn.admin.lesson.delete", "learn_lesson", id, nil, nil)
	return nil
}

// ───────────────────────── Quizzes (+questions/options) ─────────────────────────

// AdminGetQuiz returns a quiz WITH the answer key (admin-only view).
func (s *AdminService) AdminGetQuiz(ctx context.Context, quizID string) (*Quiz, error) {
	q, err := s.loadQuizAdmin(ctx, quizID)
	if err != nil {
		return nil, err
	}
	return q, nil
}

func (s *AdminService) loadQuizAdmin(ctx context.Context, quizID string) (*Quiz, error) {
	var q Quiz
	if err := s.db.QueryRow(ctx, `SELECT id, lesson_id FROM learn_quizzes WHERE id=$1`, quizID).Scan(&q.ID, &q.LessonID); err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("learn admin: load quiz: %w", err)
	}
	rows, err := s.db.Query(ctx, `SELECT id, prompt FROM learn_quiz_questions WHERE quiz_id=$1 ORDER BY sort_order`, quizID)
	if err != nil {
		return nil, fmt.Errorf("learn admin: quiz questions: %w", err)
	}
	defer rows.Close()
	var questions []QuizQuestion
	for rows.Next() {
		var qq QuizQuestion
		if err := rows.Scan(&qq.ID, &qq.Prompt); err != nil {
			return nil, err
		}
		questions = append(questions, qq)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range questions {
		orows, err := s.db.Query(ctx, `SELECT id, label, is_correct FROM learn_quiz_options WHERE question_id=$1 ORDER BY sort_order`, questions[i].ID)
		if err != nil {
			return nil, fmt.Errorf("learn admin: quiz options: %w", err)
		}
		var opts []QuizOption
		for orows.Next() {
			var o QuizOption
			if err := orows.Scan(&o.ID, &o.Label, &o.Correct); err != nil {
				orows.Close()
				return nil, err
			}
			opts = append(opts, o)
		}
		orows.Close()
		questions[i].Options = opts
	}
	q.Questions = questions
	return &q, nil
}

// CreateQuiz creates a quiz (optionally with nested questions/options) for a
// lesson, all inside one transaction (a quiz with a partial question set is an
// illegal state).
func (s *AdminService) CreateQuiz(ctx context.Context, actor string, in AdminQuizInput) (*Quiz, error) {
	id := in.ID
	if id == "" {
		id = newID("quiz")
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("learn admin: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `INSERT INTO learn_quizzes (id, lesson_id) VALUES ($1,$2)`, id, in.LessonID); err != nil {
		return nil, fmt.Errorf("learn admin: create quiz: %w", err)
	}
	if err := insertQuestions(ctx, tx, id, in.Questions); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("learn admin: commit quiz: %w", err)
	}
	s.log(actor, "learn.admin.quiz.create", "learn_quiz", id, nil, map[string]any{"lessonId": in.LessonID, "questions": len(in.Questions)})
	return s.loadQuizAdmin(ctx, id)
}

// UpdateQuiz replaces a quiz's questions/options wholesale (simplest correct
// model for admin authoring — avoids partial-diff bugs). Transactional.
func (s *AdminService) UpdateQuiz(ctx context.Context, actor, id string, in AdminQuizInput) (*Quiz, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("learn admin: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	ct, err := tx.Exec(ctx, `UPDATE learn_quizzes SET lesson_id=$2 WHERE id=$1`, id, in.LessonID)
	if err != nil {
		return nil, fmt.Errorf("learn admin: update quiz: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	// Wipe and re-insert questions/options (cascades via FK ON DELETE CASCADE).
	if _, err := tx.Exec(ctx, `DELETE FROM learn_quiz_questions WHERE quiz_id=$1`, id); err != nil {
		return nil, fmt.Errorf("learn admin: clear questions: %w", err)
	}
	if err := insertQuestions(ctx, tx, id, in.Questions); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("learn admin: commit quiz update: %w", err)
	}
	s.log(actor, "learn.admin.quiz.update", "learn_quiz", id, nil, map[string]any{"questions": len(in.Questions)})
	return s.loadQuizAdmin(ctx, id)
}

func insertQuestions(ctx context.Context, tx pgx.Tx, quizID string, questions []AdminQuizQuestionInput) error {
	for _, q := range questions {
		qID := q.ID
		if qID == "" {
			qID = newID("qq")
		}
		if _, err := tx.Exec(ctx, `INSERT INTO learn_quiz_questions (id, quiz_id, prompt, sort_order) VALUES ($1,$2,$3,$4)`,
			qID, quizID, q.Prompt, q.SortOrder); err != nil {
			return fmt.Errorf("learn admin: insert question: %w", err)
		}
		for _, o := range q.Options {
			oID := o.ID
			if oID == "" {
				oID = newID("qo")
			}
			if _, err := tx.Exec(ctx, `INSERT INTO learn_quiz_options (id, question_id, label, is_correct, sort_order) VALUES ($1,$2,$3,$4,$5)`,
				oID, qID, o.Label, o.IsCorrect, o.SortOrder); err != nil {
				return fmt.Errorf("learn admin: insert option: %w", err)
			}
		}
	}
	return nil
}

func (s *AdminService) DeleteQuiz(ctx context.Context, actor, id string) error {
	ct, err := s.db.Exec(ctx, `DELETE FROM learn_quizzes WHERE id=$1`, id)
	if err != nil {
		return fmt.Errorf("learn admin: delete quiz: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	s.log(actor, "learn.admin.quiz.delete", "learn_quiz", id, nil, nil)
	return nil
}

// ───────────────────────── Glossary ─────────────────────────

func (s *AdminService) UpsertGlossary(ctx context.Context, actor string, in AdminGlossaryInput) (*GlossaryTerm, error) {
	const ins = `INSERT INTO learn_glossary (term, definition) VALUES ($1,$2)
	             ON CONFLICT (term) DO UPDATE SET definition=EXCLUDED.definition`
	if _, err := s.db.Exec(ctx, ins, in.Term, in.Definition); err != nil {
		return nil, fmt.Errorf("learn admin: upsert glossary: %w", err)
	}
	s.log(actor, "learn.admin.glossary.upsert", "learn_glossary", in.Term, nil, map[string]any{"definition": in.Definition})
	return &GlossaryTerm{Term: in.Term, Definition: in.Definition}, nil
}

func (s *AdminService) DeleteGlossary(ctx context.Context, actor, term string) error {
	ct, err := s.db.Exec(ctx, `DELETE FROM learn_glossary WHERE term=$1`, term)
	if err != nil {
		return fmt.Errorf("learn admin: delete glossary: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	s.log(actor, "learn.admin.glossary.delete", "learn_glossary", term, nil, nil)
	return nil
}

// ───────────────────────── Admin handler ─────────────────────────

type AdminHandler struct {
	svc *AdminService
}

func NewAdminHandler(svc *AdminService) *AdminHandler { return &AdminHandler{svc: svc} }

func adminActor(c *gin.Context) string { return c.GetString("user_id") }

// RegisterLearnAdmin mounts the Learn Center CONTENT ADMIN routes on the
// provided group. The caller is responsible for RBAC-gating each route (see
// backend/internal/app/learn_routes.go) — this function only wires paths to
// handlers, matching the association/routes.go convention of leaving
// permission middleware to the app registration layer.
//
//	GET    /admin/paths            — list every path (incl. unpublished)
//	POST   /admin/paths            — create a path
//	PUT    /admin/paths/:id        — update a path
//	DELETE /admin/paths/:id        — delete a path
//	POST   /admin/lessons          — create a lesson
//	PUT    /admin/lessons/:id      — update a lesson
//	DELETE /admin/lessons/:id      — delete a lesson
//	GET    /admin/quizzes/:id      — quiz WITH answer key
//	POST   /admin/quizzes          — create a quiz (+questions/options)
//	PUT    /admin/quizzes/:id      — replace a quiz's questions/options
//	DELETE /admin/quizzes/:id      — delete a quiz
//	POST   /admin/glossary         — create/update a glossary term
//	DELETE /admin/glossary/:term   — delete a glossary term
func RegisterLearnAdmin(g *gin.RouterGroup, h *AdminHandler) {
	g.GET("/paths", h.ListPaths)
	g.POST("/paths", h.CreatePath)
	g.PUT("/paths/:id", h.UpdatePath)
	g.DELETE("/paths/:id", h.DeletePath)

	g.POST("/lessons", h.CreateLesson)
	g.PUT("/lessons/:id", h.UpdateLesson)
	g.DELETE("/lessons/:id", h.DeleteLesson)

	g.GET("/quizzes/:id", h.GetQuiz)
	g.POST("/quizzes", h.CreateQuiz)
	g.PUT("/quizzes/:id", h.UpdateQuiz)
	g.DELETE("/quizzes/:id", h.DeleteQuiz)

	g.POST("/glossary", h.UpsertGlossary)
	g.DELETE("/glossary/:term", h.DeleteGlossary)
}

func (h *AdminHandler) ListPaths(c *gin.Context) {
	out, err := h.svc.ListPathsAdmin(c.Request.Context())
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
}

func (h *AdminHandler) CreatePath(c *gin.Context) {
	var in AdminPathInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	p, err := h.svc.CreatePath(c.Request.Context(), adminActor(c), in)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, p)
}

func (h *AdminHandler) UpdatePath(c *gin.Context) {
	var in AdminPathInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	p, err := h.svc.UpdatePath(c.Request.Context(), adminActor(c), c.Param("id"), in)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, p)
}

func (h *AdminHandler) DeletePath(c *gin.Context) {
	if err := h.svc.DeletePath(c.Request.Context(), adminActor(c), c.Param("id")); err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *AdminHandler) CreateLesson(c *gin.Context) {
	var in AdminLessonInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	l, err := h.svc.CreateLesson(c.Request.Context(), adminActor(c), in)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, l)
}

func (h *AdminHandler) UpdateLesson(c *gin.Context) {
	var in AdminLessonInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	l, err := h.svc.UpdateLesson(c.Request.Context(), adminActor(c), c.Param("id"), in)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, l)
}

func (h *AdminHandler) DeleteLesson(c *gin.Context) {
	if err := h.svc.DeleteLesson(c.Request.Context(), adminActor(c), c.Param("id")); err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *AdminHandler) GetQuiz(c *gin.Context) {
	q, err := h.svc.AdminGetQuiz(c.Request.Context(), c.Param("id"))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, q)
}

func (h *AdminHandler) CreateQuiz(c *gin.Context) {
	var in AdminQuizInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	q, err := h.svc.CreateQuiz(c.Request.Context(), adminActor(c), in)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, q)
}

func (h *AdminHandler) UpdateQuiz(c *gin.Context) {
	var in AdminQuizInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	q, err := h.svc.UpdateQuiz(c.Request.Context(), adminActor(c), c.Param("id"), in)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, q)
}

func (h *AdminHandler) DeleteQuiz(c *gin.Context) {
	if err := h.svc.DeleteQuiz(c.Request.Context(), adminActor(c), c.Param("id")); err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *AdminHandler) UpsertGlossary(c *gin.Context) {
	var in AdminGlossaryInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	t, err := h.svc.UpsertGlossary(c.Request.Context(), adminActor(c), in)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, t)
}

func (h *AdminHandler) DeleteGlossary(c *gin.Context) {
	if err := h.svc.DeleteGlossary(c.Request.Context(), adminActor(c), c.Param("term")); err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
