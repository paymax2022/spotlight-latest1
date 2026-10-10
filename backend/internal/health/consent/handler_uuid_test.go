package healthconsent

// w12 sweep regression: the consent body ids feed uuid columns — a malformed
// consent_id/grantee_id/subject_owner_id used to reach pgx and surface as a
// driver error. The handler must reject it 400 before the service runs, so
// these tests use a nil-dependency Service: any fallthrough past the new
// guards would nil-pointer panic, not merely fail.

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

const uuidOK = "3f0a1c9e-0000-4000-8000-000000000001"

func uuidRouter() (*gin.Engine, *Handler) {
	gin.SetMode(gin.TestMode)
	h := NewHandler(&Service{})
	r := gin.New()
	r.Use(func(c *gin.Context) { c.Set("user_id", "u-1") })
	return r, h
}

func postJSON(t *testing.T, r *gin.Engine, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func TestConsentBodyIDs_Malformed_Are400(t *testing.T) {
	r, h := uuidRouter()
	r.POST("/consent", h.Grant)
	for _, body := range []string{
		`{"action":"revoke","consent_id":"x"}`,
		`{"action":"grant","grantee_id":"x","scope":"RECORDS"}`,
		`{"action":"grant","grantee_id":"` + uuidOK + `","subject_owner_id":"x","scope":"RECORDS"}`,
	} {
		if w := postJSON(t, r, "/consent", body); w.Code != http.StatusBadRequest {
			t.Fatalf("body %s: status = %d, want 400 (got %s)", body, w.Code, w.Body.String())
		}
	}
}
