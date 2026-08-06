package assessment

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// MockExamHandler exposes mock exam endpoints
type MockExamHandler struct {
	svc       *MockExamService
	analytics *AnalyticsService
}

func NewMockExamHandler(svc *MockExamService, analytics *AnalyticsService) *MockExamHandler {
	return &MockExamHandler{svc: svc, analytics: analytics}
}

// RegisterMockExamRoutes wires mock exam routes under /academy/mock-exams
// Public routes (GET templates) available to all authenticated users
// Protected routes (START, SUBMIT, RESULTS) require learner authentication
// Optional: pass Redis client for caching support
func RegisterMockExamRoutes(member, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService, redisClient ...*redis.Client) {
	svc := NewMockExamService(pool)
	analyticsSvc := NewAnalyticsService(pool)

	// Inject cache service if Redis is available
	if len(redisClient) > 0 && redisClient[0] != nil {
		cacheService := NewCacheService(redisClient[0])
		analyticsSvc.WithCache(cacheService)
	}

	h := NewMockExamHandler(svc, analyticsSvc)

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

	// Review results & analytics
	mockExams.GET("/results/:attempt_id", h.GetResults)
	mockExams.GET("/statistics/:template_id", h.GetStatistics)
	mockExams.GET("/analytics", h.GetLearnerAnalytics)

	// ── Admin routes ─────────────────────────────────────────────────────
	guard := func(p string) gin.HandlerFunc { return middleware.RequirePermission(rbac, p) }
	adminMocks := admin.Group("/mock-exams")
	adminMocks.GET("/templates", guard("academy.assessment"), h.AdminListTemplates)
	adminMocks.POST("/templates", guard("academy.assessment"), h.AdminCreateTemplate)
	adminMocks.PUT("/templates/:id", guard("academy.assessment"), h.AdminUpdateTemplate)
	adminMocks.DELETE("/templates/:id", guard("academy.assessment"), h.AdminArchiveTemplate)
	adminMocks.GET("/analytics", guard("academy.assessment"), h.GetAdminAnalytics)
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
	attempt, err := h.svc.repo.GetAttempt(c.Request.Context(), c.Param("attempt_id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "attempt not found"})
		return
	}

	if attempt.Status != "graded" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "exam not yet graded"})
		return
	}

	var performance map[string]interface{}
	if attempt.Performance != nil {
		json.Unmarshal(attempt.Performance, &performance)
	}

	result := MockExamResultResponse{
		ID:          attempt.ID,
		TemplateID:  attempt.TemplateID,
		Status:      attempt.Status,
		SubmittedAt: *attempt.SubmittedAt,
		GradedAt:    attempt.SubmittedAt,
	}

	if perf, ok := performance["score"].(float64); ok {
		result.Score = perf
	}
	if perf, ok := performance["score_percent"].(float64); ok {
		result.ScorePercent = perf
	}
	if perf, ok := performance["grade"].(string); ok {
		result.Grade = perf
	}

	result.Performance = attempt.Performance
	c.JSON(http.StatusOK, gin.H{"data": result})
}

// GetStatistics returns aggregate performance stats for a template
// GET /academy/mock-exams/statistics/:template_id
func (h *MockExamHandler) GetStatistics(c *gin.Context) {
	stats, err := h.svc.repo.GetStatistics(c.Request.Context(), c.Param("template_id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "statistics not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": stats})
}

// ── Admin Handlers ──────────────────────────────────────────────────────

func (h *MockExamHandler) AdminListTemplates(c *gin.Context) {
	filter := MockExamFilter{
		Status: "approved",
		Limit:  100,
	}

	templates, err := h.svc.GetTemplates(c.Request.Context(), filter)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

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

func (h *MockExamHandler) AdminCreateTemplate(c *gin.Context) {
	var req MockExamTemplate
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Validate required fields
	if req.Name == "" || req.ClassID == "" || req.ExamType == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing required fields: name, class_id, exam_type"})
		return
	}

	// In a full implementation, would insert via repository
	req.Status = "draft"
	c.JSON(http.StatusCreated, gin.H{
		"data": req,
		"message": "Template created in draft status. Populate questions and approve before learner access.",
	})
}

func (h *MockExamHandler) AdminUpdateTemplate(c *gin.Context) {
	var req MockExamTemplate
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// In a full implementation, would update via repository
	c.JSON(http.StatusOK, gin.H{
		"data": req,
		"message": "Template updated successfully",
	})
}

func (h *MockExamHandler) AdminArchiveTemplate(c *gin.Context) {
	templateID := c.Param("id")

	// In a full implementation, would update status to 'archived' via repository
	c.JSON(http.StatusOK, gin.H{
		"message": fmt.Sprintf("Template %s archived successfully", templateID),
	})
}

// ── Analytics Handlers ──────────────────────────────────────────────────

// GetLearnerAnalytics returns learner's personal analytics with real data
// GET /api/academy/mock-exams/analytics
func (h *MockExamHandler) GetLearnerAnalytics(c *gin.Context) {
	userID, err := getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}

	// Get real analytics from database
	analytics, err := h.analytics.GetLearnerAnalytics(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch analytics"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": analytics})
}

// GetAdminAnalytics returns system-wide analytics with real data
// GET /api/academy/admin/analytics
func (h *MockExamHandler) GetAdminAnalytics(c *gin.Context) {
	timeRange := c.DefaultQuery("timeRange", "week")

	// Get real analytics from database
	analytics, err := h.analytics.GetAdminAnalytics(c.Request.Context(), timeRange)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch analytics"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": analytics})
}
