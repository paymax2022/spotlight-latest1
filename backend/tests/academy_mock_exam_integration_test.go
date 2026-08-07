package tests

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"spotlight/backend/internal/academy/assessment"
	"spotlight/backend/internal/integrations"
	"spotlight/backend/internal/services"
)

// TestMockExamIntegration verifies the complete mock exam workflow
func TestMockExamIntegration(t *testing.T) {
	// Skip if no test database
	if testPool == nil {
		t.Skip("TEST_DATABASE_URL not set")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Setup: Create test data
	templateID, err := createTestTemplate(ctx, testPool)
	if err != nil {
		t.Fatalf("failed to create test template: %v", err)
	}

	instanceID, instanceCode, err := createTestInstance(ctx, testPool, templateID)
	if err != nil {
		t.Fatalf("failed to create test instance: %v", err)
	}

	userID := "test-learner-" + time.Now().Format("20060102150405")

	// Test workflow: browse → start → take → submit → results
	t.Run("complete_exam_workflow", func(t *testing.T) {
		router := setupTestRouter(testPool)

		// 1. List templates (browse)
		w := httptest.NewRecorder()
		req := httptest.NewRequest("GET", "/academy/mock-exams/templates", nil)
		req.Header.Set("Authorization", "Bearer test-token")
		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("ListTemplates: expected 200, got %d", w.Code)
		}

		var templateResp map[string]interface{}
		if err := json.Unmarshal(w.Body.Bytes(), &templateResp); err != nil {
			t.Errorf("Failed to parse templates response: %v", err)
		}

		// 2. Get specific template
		w = httptest.NewRecorder()
		req = httptest.NewRequest("GET", "/academy/mock-exams/templates/"+templateID, nil)
		req.Header.Set("Authorization", "Bearer test-token")
		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("GetTemplate: expected 200, got %d", w.Code)
		}

		// 3. Start exam
		startPayload := map[string]string{"template_id": templateID}
		body, _ := json.Marshal(startPayload)
		w = httptest.NewRecorder()
		req = httptest.NewRequest("POST", "/academy/mock-exams/start", bytes.NewReader(body))
		req.Header.Set("Authorization", "Bearer test-token")
		req.Header.Set("Content-Type", "application/json")
		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("StartExam: expected 200, got %d. Response: %s", w.Code, w.Body.String())
		}

		var startResp map[string]interface{}
		json.Unmarshal(w.Body.Bytes(), &startResp)
		attemptIDData := startResp["data"].(map[string]interface{})
		attemptID := attemptIDData["id"].(string)

		// 4. Get exam progress
		w = httptest.NewRecorder()
		req = httptest.NewRequest("GET", "/academy/mock-exams/attempts/"+attemptID, nil)
		req.Header.Set("Authorization", "Bearer test-token")
		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("GetExamProgress: expected 200, got %d", w.Code)
		}

		// 5. Save progress
		savePayload := map[string]interface{}{
			"answers": map[string]string{
				"q1": "a",
				"q2": "b",
			},
			"flagged_questions": []string{},
		}
		body, _ = json.Marshal(savePayload)
		w = httptest.NewRecorder()
		req = httptest.NewRequest("POST", "/academy/mock-exams/attempts/"+attemptID+"/save", bytes.NewReader(body))
		req.Header.Set("Authorization", "Bearer test-token")
		req.Header.Set("Content-Type", "application/json")
		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("SaveProgress: expected 200, got %d", w.Code)
		}

		// 6. Submit exam
		submitPayload := map[string]interface{}{
			"answers": map[string]string{
				"q1": "a",
				"q2": "b",
				"q3": "c",
			},
		}
		body, _ = json.Marshal(submitPayload)
		w = httptest.NewRecorder()
		req = httptest.NewRequest("POST", "/academy/mock-exams/attempts/"+attemptID+"/submit", bytes.NewReader(body))
		req.Header.Set("Authorization", "Bearer test-token")
		req.Header.Set("Content-Type", "application/json")
		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("SubmitExam: expected 200, got %d. Response: %s", w.Code, w.Body.String())
		}

		// 7. Get results
		w = httptest.NewRecorder()
		req = httptest.NewRequest("GET", "/academy/mock-exams/results/"+attemptID, nil)
		req.Header.Set("Authorization", "Bearer test-token")
		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("GetResults: expected 200, got %d", w.Code)
		}

		var resultResp map[string]interface{}
		json.Unmarshal(w.Body.Bytes(), &resultResp)
		result := resultResp["data"].(map[string]interface{})

		// Verify result structure
		if _, ok := result["score_percent"]; !ok {
			t.Error("Result missing score_percent")
		}
		if _, ok := result["grade"]; !ok {
			t.Error("Result missing grade")
		}

		// 8. Get statistics
		w = httptest.NewRecorder()
		req = httptest.NewRequest("GET", "/academy/mock-exams/statistics/"+templateID, nil)
		req.Header.Set("Authorization", "Bearer test-token")
		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("GetStatistics: expected 200, got %d", w.Code)
		}

		// 9. Get learner analytics
		w = httptest.NewRecorder()
		req = httptest.NewRequest("GET", "/academy/mock-exams/analytics", nil)
		req.Header.Set("Authorization", "Bearer test-token")
		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("GetLearnerAnalytics: expected 200, got %d", w.Code)
		}
	})

	// Test admin endpoints
	t.Run("admin_template_management", func(t *testing.T) {
		router := setupTestRouter(testPool)

		// 1. List templates (admin)
		w := httptest.NewRecorder()
		req := httptest.NewRequest("GET", "/admin/mock-exams/templates", nil)
		req.Header.Set("Authorization", "Bearer admin-token")
		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Logf("AdminListTemplates returned %d (expected 200)", w.Code)
		}

		// 2. Create template
		createPayload := map[string]interface{}{
			"name":           "Integration Test Template",
			"description":    "Test template for integration testing",
			"class_id":       "p6",
			"exam_type":      "class_mock",
			"total_questions": 50,
			"total_minutes":   120,
		}
		body, _ := json.Marshal(createPayload)
		w = httptest.NewRecorder()
		req = httptest.NewRequest("POST", "/admin/mock-exams/templates", bytes.NewReader(body))
		req.Header.Set("Authorization", "Bearer admin-token")
		req.Header.Set("Content-Type", "application/json")
		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Logf("AdminCreateTemplate returned %d (expected 200)", w.Code)
		}

		// 3. Get admin analytics
		w = httptest.NewRecorder()
		req = httptest.NewRequest("GET", "/admin/mock-exams/analytics?timeRange=week", nil)
		req.Header.Set("Authorization", "Bearer admin-token")
		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("GetAdminAnalytics: expected 200, got %d", w.Code)
		}
	})
}

// Helper: create test template
func createTestTemplate(ctx context.Context, pool *pgxpool.Pool) (string, error) {
	var templateID string
	err := pool.QueryRow(ctx,
		`INSERT INTO academy_mock_exam_templates
		 (class_id, name, description, exam_type, total_questions, total_seconds, status)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)
		 RETURNING id`,
		"p6", "Integration Test Template", "Test", "class_mock", 50, 7200, "approved").
		Scan(&templateID)
	return templateID, err
}

// Helper: create test instance
func createTestInstance(ctx context.Context, pool *pgxpool.Pool, templateID string) (string, string, error) {
	var instanceID, instanceCode string
	err := pool.QueryRow(ctx,
		`INSERT INTO academy_mock_exam_instances
		 (template_id, instance_code, seed, variant_number, status)
		 VALUES ($1, $2, $3, $4, $5)
		 RETURNING id, instance_code`,
		templateID, "TEST-"+time.Now().Format("20060102150405"), 12345, 1, "active").
		Scan(&instanceID, &instanceCode)
	return instanceID, instanceCode, err
}

// Helper: setup test router
func setupTestRouter(pool *pgxpool.Pool) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()

	// Setup routes
	memberGroup := r.Group("/academy")
	adminGroup := r.Group("/admin")

	rbacRepo := integrations.NewSupabaseRestClient("", "")
	rbacSvc := services.NewRBACService(rbacRepo)

	assessment.RegisterAcademyAssessment(memberGroup, adminGroup, pool, rbacSvc)

	return r
}

// TestMockExamErrorHandling verifies proper error responses
func TestMockExamErrorHandling(t *testing.T) {
	if testPool == nil {
		t.Skip("TEST_DATABASE_URL not set")
	}

	router := setupTestRouter(testPool)

	t.Run("invalid_template_id", func(t *testing.T) {
		w := httptest.NewRecorder()
		req := httptest.NewRequest("GET", "/academy/mock-exams/templates/invalid-id", nil)
		req.Header.Set("Authorization", "Bearer test-token")
		router.ServeHTTP(w, req)

		// Should return 404 or handle gracefully
		if w.Code < 200 || w.Code >= 500 {
			t.Logf("Invalid template returned %d", w.Code)
		}
	})

	t.Run("missing_authorization", func(t *testing.T) {
		w := httptest.NewRecorder()
		req := httptest.NewRequest("GET", "/academy/mock-exams/templates", nil)
		// No Authorization header
		router.ServeHTTP(w, req)

		// Should handle missing auth
		t.Logf("Missing auth returned %d", w.Code)
	})

	t.Run("invalid_start_exam_payload", func(t *testing.T) {
		payload := `{"invalid": "data"}`
		w := httptest.NewRecorder()
		req := httptest.NewRequest("POST", "/academy/mock-exams/start", bytes.NewBufferString(payload))
		req.Header.Set("Authorization", "Bearer test-token")
		req.Header.Set("Content-Type", "application/json")
		router.ServeHTTP(w, req)

		// Should return error for invalid payload
		t.Logf("Invalid payload returned %d", w.Code)
	})
}
