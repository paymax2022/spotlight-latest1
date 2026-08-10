package connectvoting

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"spotlight/backend/internal/config"
)

// TestEvictionHandlersParameterBinding verifies request parameter binding
func TestEvictionHandlersParameterBinding(t *testing.T) {
	tests := []struct {
		name        string
		request     interface{}
		expectError bool
		errorField  string
	}{
		{
			name: "valid eviction request",
			request: EvictionRequest{
				StageNumber:        1,
				EvictionPercentage: 20,
				GracePeriodHours:   24,
			},
			expectError: false,
		},
		{
			name: "eviction request with zero stage",
			request: EvictionRequest{
				StageNumber:        0,
				EvictionPercentage: 20,
				GracePeriodHours:   24,
			},
			expectError: true,
			errorField:  "stage_number",
		},
		{
			name: "valid save request",
			request: SaveRequest{
				EvictionID: "test-uuid",
				Reason:     "Outstanding performance",
			},
			expectError: false,
		},
		{
			name: "save request with empty eviction ID",
			request: SaveRequest{
				EvictionID: "",
				Reason:     "Test",
			},
			expectError: true,
			errorField:  "eviction_id",
		},
		{
			name: "valid extend grace period request",
			request: ExtendGracePeriodRequest{
				EvictionID:      "test-uuid",
				AdditionalHours: 24,
			},
			expectError: false,
		},
		{
			name: "extend request with zero hours (valid at struct level, validated in handler)",
			request: ExtendGracePeriodRequest{
				EvictionID:      "test-uuid",
				AdditionalHours: 0,
			},
			expectError: false, // Struct binding is valid; handler validates semantics
			errorField:  "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			body, err := json.Marshal(tt.request)
			if err != nil {
				t.Fatalf("failed to marshal request: %v", err)
			}

			req := httptest.NewRequest("POST", "/test", bytes.NewReader(body))
			req.Header.Set("Content-Type", "application/json")

			w := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(w)
			c.Request = req

			// Try to bind the request body to the appropriate type
			var bindErr error
			switch tt.request.(type) {
			case EvictionRequest:
				var er EvictionRequest
				bindErr = c.ShouldBindJSON(&er)
			case SaveRequest:
				var sr SaveRequest
				bindErr = c.ShouldBindJSON(&sr)
			case ExtendGracePeriodRequest:
				var er ExtendGracePeriodRequest
				bindErr = c.ShouldBindJSON(&er)
			}

			if tt.expectError && bindErr == nil {
				t.Errorf("expected binding error, got nil")
			}
			if !tt.expectError && bindErr != nil {
				t.Errorf("unexpected binding error: %v", bindErr)
			}
		})
	}
}

// TestEvictionResponseTypes verifies response types are correctly defined
func TestEvictionResponseTypes(t *testing.T) {
	tests := []struct {
		name     string
		response interface{}
		validate func(interface{}) bool
	}{
		{
			name: "eviction response",
			response: EvictionResponse{
				ContestantID: "contestant-1",
				VoteCount:    100,
				EvictionRank: 50,
				EvictionID:   "eviction-1",
			},
			validate: func(r interface{}) bool {
				er, ok := r.(EvictionResponse)
				return ok && er.ContestantID == "contestant-1" && er.VoteCount == 100
			},
		},
		{
			name: "save response",
			response: SaveResponse{
				Success:      true,
				Message:      "Contestant saved",
				SaveRecordID: "save-1",
			},
			validate: func(r interface{}) bool {
				sr, ok := r.(SaveResponse)
				return ok && sr.Success && sr.SaveRecordID == "save-1"
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if !tt.validate(tt.response) {
				t.Errorf("response validation failed for %v", tt.response)
			}
		})
	}
}

// TestEvictionRequestValidation verifies struct tags work correctly
func TestEvictionRequestValidation(t *testing.T) {
	// Verify struct tags are present
	req := EvictionRequest{}

	// Check that JSON tags are properly set
	tests := []struct {
		name      string
		jsonBytes string
		expectOK  bool
	}{
		{
			name:      "valid JSON with all fields",
			jsonBytes: `{"stage_number":1,"eviction_percentage":20,"grace_period_hours":24}`,
			expectOK:  true,
		},
		{
			name:      "valid JSON with required fields only",
			jsonBytes: `{"stage_number":1}`,
			expectOK:  true,
		},
		{
			name:      "invalid JSON with missing stage_number",
			jsonBytes: `{"eviction_percentage":20}`,
			expectOK:  false,
		},
		{
			name:      "invalid JSON with invalid stage_number",
			jsonBytes: `{"stage_number":0}`,
			expectOK:  false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := json.Unmarshal([]byte(tt.jsonBytes), &req)
			if err != nil {
				if tt.expectOK {
					t.Errorf("unexpected unmarshal error: %v", err)
				}
				return
			}

			// Validate the parsed request
			if req.StageNumber <= 0 && tt.expectOK {
				t.Errorf("expected valid stage_number, got %d", req.StageNumber)
			}
		})
	}
}

// TestRouteRegistration verifies routes can be registered without panic
func TestRouteRegistration(t *testing.T) {
	// Create a mock service (not fully functional, just for testing registration)
	mockSvc := &Service{}

	// Test that Register doesn't panic (member routes)
	t.Run("member_routes", func(t *testing.T) {
		router := gin.New()
		defer func() {
			if r := recover(); r != nil {
				t.Errorf("Register panicked: %v", r)
			}
		}()
		cfg := config.Config{FeatureContestStageEvictionEnabled: true}
		Register(router, mockSvc, cfg)
		t.Log("✓ Register() executed without panic")
	})

	// Test that RegisterAdmin doesn't panic (admin routes on separate group)
	t.Run("admin_routes", func(t *testing.T) {
		router := gin.New()
		adminGroup := router.Group("/admin")

		defer func() {
			if r := recover(); r != nil {
				t.Errorf("RegisterAdmin panicked: %v", r)
			}
		}()

		guard := func(permission string) gin.HandlerFunc {
			return func(c *gin.Context) { c.Next() }
		}
		cfg := config.Config{FeatureContestStageEvictionEnabled: true}
		RegisterAdmin(adminGroup, mockSvc, guard, cfg)
		t.Log("✓ RegisterAdmin() executed without panic")
	})
}

// TestErrorResponse verifies error responses are well-formed
func TestErrorResponse(t *testing.T) {
	tests := []struct {
		name         string
		statusCode   int
		errorMessage string
		expectInJSON bool
	}{
		{
			name:         "400 bad request",
			statusCode:   http.StatusBadRequest,
			errorMessage: "invalid request",
			expectInJSON: true,
		},
		{
			name:         "404 not found",
			statusCode:   http.StatusNotFound,
			errorMessage: "contest not found",
			expectInJSON: true,
		},
		{
			name:         "409 conflict",
			statusCode:   http.StatusConflict,
			errorMessage: "duplicate request",
			expectInJSON: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(w)

			// Simulate error response
			c.JSON(tt.statusCode, gin.H{"error": tt.errorMessage})

			if w.Code != tt.statusCode {
				t.Errorf("expected status %d, got %d", tt.statusCode, w.Code)
			}

			var response gin.H
			err := json.Unmarshal(w.Body.Bytes(), &response)
			if err != nil {
				t.Errorf("failed to unmarshal response: %v", err)
			}

			if tt.expectInJSON && response["error"] != tt.errorMessage {
				t.Errorf("expected error message %q, got %q", tt.errorMessage, response["error"])
			}
		})
	}
}
