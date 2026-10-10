package healthconsult

// w12 sweep regression: the consult :id path param feeds uuid-column object
// loads — a malformed value used to reach pgx and surface as a driver error.
// The handlers must reject it 400 before the service runs, so these tests use
// a nil-dependency Service: any fallthrough past the new guards would
// nil-pointer panic, not merely fail.

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

func TestConsultPathID_Malformed_Are400(t *testing.T) {
	r, h := uuidRouter()
	r.POST("/consults/:id/start", h.Start)
	r.POST("/consults/:id/complete", h.Complete)
	r.POST("/consults/:id/lobby", h.Lobby)
	r.POST("/consults/:id/notes", h.AddNote)
	for _, p := range []string{
		"/consults/not-a-uuid/start",
		"/consults/not-a-uuid/complete",
		"/consults/not-a-uuid/lobby",
		"/consults/not-a-uuid/notes",
	} {
		if w := postJSON(t, r, p, `{}`); w.Code != http.StatusBadRequest {
			t.Fatalf("POST %s: status = %d, want 400 (got %s)", p, w.Code, w.Body.String())
		}
	}
}

// consultFail folds ErrConsultNotFound (missing OR non-party — uniform) to 404;
// ErrInvalidInput → 400; state refusals → 409.
func TestConsultFail_Mapping(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cases := []struct {
		err  error
		want int
	}{
		{ErrConsultNotFound, http.StatusNotFound},
		{ErrInvalidInput, http.StatusBadRequest},
		{errors.New("consult: illegal transition"), http.StatusConflict},
	}
	for _, tc := range cases {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		consultFail(c, tc.err)
		if w.Code != tc.want {
			t.Fatalf("%v: status = %d, want %d", tc.err, w.Code, tc.want)
		}
	}
}
