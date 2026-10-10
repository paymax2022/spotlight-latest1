package doctor

// w12 sweep regression: the MDCN review :verificationId/:docId path params
// feed uuid columns — a malformed value used to reach pgx and surface as a
// driver error. The handlers must reject it 400 before the service runs, so
// these tests use a nil-dependency service: any fallthrough past the new
// guards would nil-pointer panic, not merely fail.

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func mdcnUUIDRouter() (*gin.Engine, *MDCNReviewHandler) {
	gin.SetMode(gin.TestMode)
	h := NewMDCNReviewHandler(&MDCNReviewService{})
	r := gin.New()
	r.Use(func(c *gin.Context) { c.Set("user_id", "u-1") })
	return r, h
}

func TestMDCNPathIDs_Malformed_Are400(t *testing.T) {
	r, h := mdcnUUIDRouter()
	r.GET("/verification/:verificationId", h.GetRecord)
	r.GET("/verification/documents/:docId/url", h.DocURL)
	r.POST("/verification/:verificationId/decision", h.Decide)
	getReq := func(path string) *httptest.ResponseRecorder {
		req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, path, nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w
	}
	for _, p := range []string{"/verification/not-a-uuid", "/verification/documents/not-a-uuid/url"} {
		if w := getReq(p); w.Code != http.StatusBadRequest {
			t.Fatalf("GET %s: status = %d, want 400 (got %s)", p, w.Code, w.Body.String())
		}
	}
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost,
		"/verification/not-a-uuid/decision", strings.NewReader(`{"action":"reject"}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("decision: status = %d, want 400 (got %s)", w.Code, w.Body.String())
	}
}
