package restaurant

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

// Query validation fails before any DB access, so a nil-pool Service suffices.
func TestAdminReports_BadQueryRejected(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := &Handler{svc: &Service{}}
	r := gin.New()
	r.GET("/gmv", h.AdminReportGMV)
	r.GET("/export", h.AdminReportExport)
	for _, tc := range []struct{ path string }{
		{"/gmv?group_by=year"},
		{"/gmv?from=nope"},
		{"/gmv?from=2025-02-01&to=2025-01-01"},
		{"/gmv?restaurant_id=not-a-uuid"},
		{"/export?kind=bogus"},
		{"/export?kind=gmv&format=xlsx"},
	} {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, tc.path, nil))
		if w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), "error") {
			t.Errorf("%s: got %d %s, want 400", tc.path, w.Code, w.Body.String())
		}
	}
}
