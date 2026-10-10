package credential

// w12 sweep regression: the :docId/:recordId path params and the
// application_id body/query fields feed uuid columns — a malformed value used
// to reach the store and surface as a driver error. The handlers must reject
// it 400 before the service runs, so these tests use a nil-dependency Service:
// any fallthrough past the new guards would nil-pointer panic, not merely fail.

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

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

func getReq(t *testing.T, r *gin.Engine, path string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, path, nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func TestDocRecordPathIDs_Malformed_Are400(t *testing.T) {
	r, h := uuidRouter()
	r.GET("/verification/documents/:docId/url", h.MyDocURL)
	r.GET("/verification/reviewer/documents/:docId/url", h.ReviewerDocURL)
	r.GET("/verification/:recordId", h.GetRecord)
	r.POST("/verification/:recordId/decision", h.Decide)
	for _, p := range []string{
		"/verification/documents/not-a-uuid/url",
		"/verification/reviewer/documents/not-a-uuid/url",
		"/verification/not-a-uuid",
	} {
		if w := getReq(t, r, p); w.Code != http.StatusBadRequest {
			t.Fatalf("GET %s: status = %d, want 400 (got %s)", p, w.Code, w.Body.String())
		}
	}
	if w := postJSON(t, r, "/verification/not-a-uuid/decision", `{"action":"reject"}`); w.Code != http.StatusBadRequest {
		t.Fatalf("decision: status = %d, want 400 (got %s)", w.Code, w.Body.String())
	}
}

func TestApplicationIDFields_Malformed_Are400(t *testing.T) {
	r, h := uuidRouter()
	r.POST("/verification/submit", h.Submit)
	r.GET("/verification/status", h.MyStatus)
	if w := postJSON(t, r, "/verification/submit",
		`{"application_id":"x","reg_number":"VCN-1","full_name":"Dr A","consent":true}`); w.Code != http.StatusBadRequest {
		t.Fatalf("submit: status = %d, want 400 (got %s)", w.Code, w.Body.String())
	}
	if w := getReq(t, r, "/verification/status?application_id=x"); w.Code != http.StatusBadRequest {
		t.Fatalf("status: code = %d, want 400 (got %s)", w.Code, w.Body.String())
	}
}
