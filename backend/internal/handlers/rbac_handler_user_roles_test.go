package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

// erroringRolesRBAC overrides GetUserRoles to simulate a service failure.
type erroringRolesRBAC struct {
	fakeRBACService
	err error
}

func (e erroringRolesRBAC) GetUserRoles(context.Context, string) ([]string, error) {
	return nil, e.err
}

func TestRBACHandler_GetUserRoles(t *testing.T) {
	gin.SetMode(gin.TestMode)
	tests := []struct {
		name       string
		h          *RBACHandler
		wantStatus int
		wantBody   string
		wantRoles  string // substring expected in raw body
	}{
		{"happy path", NewRBACHandler(fakeRBACService{roles: []string{"admin", "support"}}, nil), 200, "", `"roles":["admin","support"]`},
		{"empty renders []", NewRBACHandler(fakeRBACService{roles: nil}, nil), 200, "", `"roles":[]`},
		{"service error", NewRBACHandler(erroringRolesRBAC{err: errors.New("boom")}, nil), 500, "", `"success":false`},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			r := gin.New()
			r.GET("/users/:id/roles", tc.h.GetUserRoles)
			w := httptest.NewRecorder()
			r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/users/u1/roles", nil))
			if w.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d (%s)", w.Code, tc.wantStatus, w.Body.String())
			}
			if !strings.Contains(w.Body.String(), tc.wantRoles) {
				t.Fatalf("body %s missing %s", w.Body.String(), tc.wantRoles)
			}
			var payload map[string]any
			if err := json.Unmarshal(w.Body.Bytes(), &payload); err != nil {
				t.Fatal(err)
			}
			if tc.wantStatus == 200 && payload["success"] != true {
				t.Fatalf("success not true: %v", payload)
			}
		})
	}
}
