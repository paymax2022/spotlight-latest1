package healthrecords

// w12 sweep regression: the :subjectId path param and the Create pet_ref body
// field feed uuid columns — a malformed value used to reach pgx and surface as
// a driver error. The handlers must reject it 400 before the service runs, so
// these tests use a nil-dependency Service: any fallthrough past the new
// guards would nil-pointer panic, not merely fail.

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

const uuidOK = "3f0a1c9e-0000-4000-8000-000000000001"

func uuidRouter() (*gin.Engine, *Handler) {
	gin.SetMode(gin.TestMode)
	h := NewHandler(&Service{}, func(c *gin.Context) bool { return false })
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

func TestSubjectID_Malformed_Are400(t *testing.T) {
	r, h := uuidRouter()
	r.GET("/records/:subjectId", h.Get)
	r.POST("/records/:subjectId/documents", h.AddDocument)
	r.POST("/records/:subjectId/erase", h.Erase)
	r.GET("/records/:subjectId/access-log", h.AccessLog)
	for _, p := range []string{"/records/not-a-uuid", "/records/not-a-uuid/access-log"} {
		if w := getReq(t, r, p); w.Code != http.StatusBadRequest {
			t.Fatalf("GET %s: status = %d, want 400 (got %s)", p, w.Code, w.Body.String())
		}
	}
	for _, p := range []string{"/records/not-a-uuid/documents", "/records/not-a-uuid/erase"} {
		if w := postJSON(t, r, p, `{}`); w.Code != http.StatusBadRequest {
			t.Fatalf("POST %s: status = %d, want 400 (got %s)", p, w.Code, w.Body.String())
		}
	}
}

// recordFail folds ErrRecordNotFound (missing, erased, OR non-owner — uniform)
// to 404; ErrInvalidInput → 400; anything else → sanitized 500.
func TestRecordFail_Mapping(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cases := []struct {
		err  error
		want int
	}{
		{ErrRecordNotFound, http.StatusNotFound},
		{ErrInvalidInput, http.StatusBadRequest},
		{errors.New("records: unexpected"), http.StatusInternalServerError},
	}
	for _, tc := range cases {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		recordFail(c, tc.err)
		if w.Code != tc.want {
			t.Fatalf("%v: status = %d, want %d", tc.err, w.Code, tc.want)
		}
	}
}
