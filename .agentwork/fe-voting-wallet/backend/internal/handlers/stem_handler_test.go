package handlers

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestCreateSchool_Validation(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := NewStemHandler(nil)
	r := gin.New()
	r.POST("/schools", h.CreateSchool)

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/schools", bytes.NewBufferString(`{"state":"Lagos"}`))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestCreateSchool_InvalidArtifactURL(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := NewStemHandler(nil)
	r := gin.New()
	r.POST("/schools", h.CreateSchool)

	w := httptest.NewRecorder()
	req := httptest.NewRequest(
		http.MethodPost,
		"/schools",
		bytes.NewBufferString(`{"schoolName":"Test School","registrationDocumentUrl":"https://cdn.example.com/doc.exe"}`),
	)
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestCreateSchoolProfile_Validation(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := NewStemHandler(nil)
	r := gin.New()
	r.POST("/profiles", h.CreateSchoolProfile)

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/profiles", bytes.NewBufferString(`{"roleType":"SCHOOL_ADMIN"}`))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestCreateContest_Validation(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := NewStemHandler(nil)
	r := gin.New()
	r.POST("/contests", h.CreateContest)

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/contests", bytes.NewBufferString(`{"name":"My Contest"}`))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestCheckEligibility_Validation(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := NewStemHandler(nil)
	r := gin.New()
	r.POST("/eligibility", h.CheckEligibility)

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/eligibility", bytes.NewBufferString(`{"participantType":"SCHOOL_TEAM"}`))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestUpdateSubmissionStatus_Validation(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := NewStemHandler(nil)
	r := gin.New()
	r.PATCH("/submissions/:id/status", h.UpdateSubmissionStatus)

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPatch, "/submissions/abc/status", bytes.NewBufferString(`{"reviewStage":"screening"}`))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestCreateJudgingScore_Validation(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := NewStemHandler(nil)
	r := gin.New()
	r.POST("/judging/scores", h.CreateJudgingScore)

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/judging/scores", bytes.NewBufferString(`{"overallScore":78}`))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestLeaderboardSlices_Validation(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := NewStemHandler(nil)
	r := gin.New()
	r.GET("/leaderboard/slices", h.LeaderboardSlices)

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/leaderboard/slices?by=state", nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestJudgingScores_Validation(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := NewStemHandler(nil)
	r := gin.New()
	r.GET("/judging/scores", h.JudgingScores)

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/judging/scores", nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestCreateJudgingRubric_Validation(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := NewStemHandler(nil)
	r := gin.New()
	r.POST("/judging/rubrics", h.CreateJudgingRubric)

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/judging/rubrics", bytes.NewBufferString(`{"name":"Default Rubric"}`))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestCreateEmergingInnovator_InvalidArtifactURL(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := NewStemHandler(nil)
	r := gin.New()
	r.POST("/emerging", h.CreateEmergingInnovator)

	w := httptest.NewRecorder()
	req := httptest.NewRequest(
		http.MethodPost,
		"/emerging",
		bytes.NewBufferString(`{"fullName":"Jane Doe","email":"jane@example.com","videoDemoUrl":"https://cdn.example.com/video.exe"}`),
	)
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestJudgingCriteria_Validation(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := NewStemHandler(nil)
	r := gin.New()
	r.GET("/judging/criteria", h.JudgingCriteria)

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/judging/criteria", nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestCreateJudgeAssignment_Validation(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := NewStemHandler(nil)
	r := gin.New()
	r.POST("/judging/assignments", h.CreateJudgeAssignment)

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/judging/assignments", bytes.NewBufferString(`{"contestId":"c1"}`))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestUpdateJudgingScoreReviewState_Validation(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := NewStemHandler(nil)
	r := gin.New()
	r.PATCH("/judging/scores/:id/review-state", h.UpdateJudgingScoreReviewState)

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPatch, "/judging/scores/abc/review-state", bytes.NewBufferString(`{"isLocked":true}`))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestUpdateJudgingScoreReviewState_LockedWithoutReason(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := NewStemHandler(nil)
	r := gin.New()
	r.PATCH("/judging/scores/:id/review-state", h.UpdateJudgingScoreReviewState)

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPatch, "/judging/scores/abc/review-state", bytes.NewBufferString(`{"reviewStatus":"locked","isLocked":true}`))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestCreateJudgeAssignment_InvalidStatus(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := NewStemHandler(nil)
	r := gin.New()
	r.POST("/judging/assignments", h.CreateJudgeAssignment)

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/judging/assignments", bytes.NewBufferString(`{"contestId":"c1","applicationId":"a1","judgeUserId":"j1","status":"unknown"}`))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestUpdateJudgeAssignmentConflict_Validation(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := NewStemHandler(nil)
	r := gin.New()
	r.PATCH("/judging/assignments/:id/conflict", h.UpdateJudgeAssignmentConflict)

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPatch, "/judging/assignments/x/conflict", bytes.NewBufferString(`{"hasConflict":true}`))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}

	w2 := httptest.NewRecorder()
	req2 := httptest.NewRequest(http.MethodPatch, "/judging/assignments/x/conflict", bytes.NewBufferString(`{"hasConflict":false,"status":"flagged_conflict"}`))
	req2.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w2, req2)
	if w2.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w2.Code)
	}
}
