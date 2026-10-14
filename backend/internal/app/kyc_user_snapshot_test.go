package app

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
)

const snapshotUser = "33333333-3333-4333-8333-333333333333"

func runSnapshot(t *testing.T, id string, profile kycSnapshotProfileFn, openCase kycSnapshotOpenCaseFn) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/users/:id", kycUserSnapshotHandler(profile, openCase))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/users/"+id, nil))
	return w
}

func TestKYCUserSnapshotHandler(t *testing.T) {
	okProfile := func(context.Context, string) (int, string, error) { return 2, "verified", nil }
	noCase := func(context.Context, string) (string, bool, error) { return "", false, nil }
	tests := []struct {
		name       string
		id         string
		profile    kycSnapshotProfileFn
		openCase   kycSnapshotOpenCaseFn
		wantStatus int
		wantBody   string
	}{
		{"snapshot without an open case", snapshotUser, okProfile, noCase, 200, `"openCaseId":null`},
		{"snapshot with an open case", snapshotUser, okProfile,
			func(context.Context, string) (string, bool, error) { return "case-1", true, nil }, 200, `"openCaseId":"case-1"`},
		{"malformed id is 400 and never reaches the db", "not-a-uuid",
			func(context.Context, string) (int, string, error) {
				t.Fatal("profile queried for a malformed id")
				return 0, "", nil
			},
			noCase, 400, ""},
		{"unknown user is 404 not 500", snapshotUser,
			func(context.Context, string) (int, string, error) {
				return 0, "", fmt.Errorf("kyc: get profile: %w", pgx.ErrNoRows)
			},
			noCase, 404, ""},
		{"other profile failure is 500 with a generic message", snapshotUser,
			func(context.Context, string) (int, string, error) { return 0, "", errors.New("pq: secret detail") },
			noCase, 500, `"error":"failed to load kyc profile"`},
		{"open-case failure is 500", snapshotUser, okProfile,
			func(context.Context, string) (string, bool, error) { return "", false, errors.New("boom") }, 500, `"error":"failed to load review case"`},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			w := runSnapshot(t, tc.id, tc.profile, tc.openCase)
			if w.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d (%s)", w.Code, tc.wantStatus, w.Body.String())
			}
			if tc.wantBody != "" && !strings.Contains(w.Body.String(), tc.wantBody) {
				t.Fatalf("body %s missing %s", w.Body.String(), tc.wantBody)
			}
			if strings.Contains(w.Body.String(), "secret detail") {
				t.Fatalf("internal error text leaked: %s", w.Body.String())
			}
		})
	}
}
