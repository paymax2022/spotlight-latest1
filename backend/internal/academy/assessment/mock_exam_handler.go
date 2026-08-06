package assessment

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// MockExamHandler exposes mock exam endpoints
type MockExamHandler struct {
	svc *MockExamService
}

func NewMockExamHandler(svc *MockExamService) *MockExamHandler {
	return &MockExamHandler{svc: svc}
}

// RegisterMockExamRoutes wires mock exam routes under /academy/mock-exams
// Public routes (GET templates) available to all authenticated users
// Protected routes (START, SUBMIT, RESULTS) require learner authentication
func RegisterMockExamRoutes(member, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService) {
	svc := NewMockExamService(pool)
	h := NewMockExamHandler(svc)

	// ── Member (learner) routes ──────────────────────────────────────────
	mockExams := member.Group("/mock-exams")

	// Browse available templates
	mockExams.GET("/templates", h.ListTemplates)
	mockExams.GET("/templates/:id", h.GetTemplate)

	// Take an exam
	mockExams.POST("/start", h.StartExam)
	mockExams.GET("/attempts/:attempt_id", h.GetExamProgress)
	mockExams.POST("/attempts/:attempt_id/save", h.SaveProgress)
	mockExams.POST("/attempts/:attempt_id/submit", h.SubmitExam)

	// Review results
	mockExams.GET("/results/:attempt_id", h.GetResults)
	mockExams.GET("/statistics/:template_id", h.GetStatistics)

	// ── Admin routes ─────────────────────────────────────────────────────
	guard := func(p string) gin.HandlerFunc { return middleware.RequirePermission(rbac, p) }
	adminMocks := admin.Group("/mock-exams")
	adminMocks.GET("/templates", guard("academy.assessment"), h.AdminListTemplates)
	adminMocks.POST("/templates", guard("academy.assessment"), h.AdminCreateTemplate)
	adminMocks.PUT("/templates/:id", guard("academy.assessment"), h.AdminUpdateTemplate)
	adminMocks.DELETE("/templates/:id", guard("academy.assessment"), h.AdminArchiveTemplate)
}

// ── Helper ──────────────────────────────────────────────────────────────

func getUserID(c *gin.Context) (string, error) {
	userID := c.GetString("user_id")
	if userID == "" {
		if u, ok := middleware.GetAuthenticatedUser(c); ok {
			userID = u.ID
		}
	}
	if userID == "" {
		return "", errors.New("unauthenticated")
	}
	return userID, nil
}

// ── Member Handlers ─────────────────────────────────────────────────────

// ListTemplates returns available exam templates
// GET /academy/mock-exams/templates?class_id=P6&exam_type=class_mock&limit=20
func (h *MockExamHandler) ListTemplates(c *gin.Context) {
	filter := MockExamFilter{
		ClassID:  c.Query("class_id"),
		ExamType: c.Query("exam_type"),
		Limit:    10,
	}
	if l := c.Query("limit"); l != "" {
		if limit, err := strconv.Atoi(l); err == nil {
			filter.Limit = limit
		}
	}

	templates, err := h.svc.GetTemplates(c.Request.Context(), filter)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Convert to response format
	resp := make([]MockExamTemplateResponse, len(templates))
	for i, t := range templates {
		resp[i] = MockExamTemplateResponse{
			ID:                     t.ID,
			Name:                   t.Name,
			Description:            t.Description,
			ExamType:               t.ExamType,
			TotalQuestions:         t.TotalQuestions,
			TotalMinutes:           secsToMins(t.TotalSeconds),
			DifficultyDistribution: t.DifficultyDistribution,
			Status:                 t.Status,
		}
	}

	c.JSON(http.StatusOK, gin.H{"data": resp, "count": len(resp)})
}

// GetTemplate returns template details with available instances
// GET /academy/mock-exams/templates/:id
func (h *MockExamHandler) GetTemplate(c *gin.Context) {
	detail, err := h.svc.GetTemplate(c.Request.Context(), c.Param("id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": detail})
}

// StartExam creates a new exam attempt
// POST /academy/mock-exams/start
// Body: { "template_id": "uuid" }
func (h *MockExamHandler) StartExam(c *gin.Context) {
	userID, err := getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}

	var req StartMockExamRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	attempt, err := h.svc.StartExam(c.Request.Context(), userID, req.TemplateID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"data": attempt})
}

// GetExamProgress returns current exam state with questions
// GET /academy/mock-exams/attempts/:attempt_id
func (h *MockExamHandler) GetExamProgress(c *gin.Context) {
	progress, err := h.svc.GetExamProgress(c.Request.Context(), c.Param("attempt_id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": progress})
}

// SaveProgress saves current answers and flagged questions
// POST /academy/mock-exams/attempts/:attempt_id/save
// Body: { "answers": {...}, "flagged_questions": ["uuid", ...] }
func (h *MockExamHandler) SaveProgress(c *gin.Context) {
	var req SubmitMockExamRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.svc.SaveProgress(c.Request.Context(), c.Param("attempt_id"),
		req.Answers, req.FlaggedQuestions); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "progress_saved"})
}

// SubmitExam grades and submits the exam
// POST /academy/mock-exams/attempts/:attempt_id/submit
// Body: { "answers": {...} }
func (h *MockExamHandler) SubmitExam(c *gin.Context) {
	var req SubmitMockExamRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	result, err := h.svc.SubmitExam(c.Request.Context(), c.Param("attempt_id"), req.Answers)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": result})
}

// GetResults returns exam results and performance breakdown
// GET /academy/mock-exams/results/:attempt_id
func (h *MockExamHandler) GetResults(c *gin.Context) {
	// TODO: Implement result retrieval
	c.JSON(http.StatusOK, gin.H{"message": "results_endpoint_under_construction"})
}

// GetStatistics returns aggregate performance stats for a template
// GET /academy/mock-exams/statistics/:template_id
func (h *MockExamHandler) GetStatistics(c *gin.Context) {
	// TODO: Implement statistics retrieval
	c.JSON(http.StatusOK, gin.H{"message": "statistics_endpoint_under_construction"})
}

// ── Admin Handlers ──────────────────────────────────────────────────────

func (h *MockExamHandler) AdminListTemplates(c *gin.Context) {
	// TODO: Implement admin template listing
	c.JSON(http.StatusOK, gin.H{"message": "admin_list_endpoint_under_construction"})
}

func (h *MockExamHandler) AdminCreateTemplate(c *gin.Context) {
	// TODO: Implement template creation
	c.JSON(http.StatusOK, gin.H{"message": "admin_create_endpoint_under_construction"})
}

func (h *MockExamHandler) AdminUpdateTemplate(c *gin.Context) {
	// TODO: Implement template update
	c.JSON(http.StatusOK, gin.H{"message": "admin_update_endpoint_under_construction"})
}

func (h *MockExamHandler) AdminArchiveTemplate(c *gin.Context) {
	// TODO: Implement template archival
	c.JSON(http.StatusOK, gin.H{"message": "admin_archive_endpoint_under_construction"})
}
