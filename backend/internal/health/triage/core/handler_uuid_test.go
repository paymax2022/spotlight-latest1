package core

// w12 sweep regression: the session :id path param and the StartSession
// profile_id body field feed uuid columns — a malformed value used to reach
// pgx and surface as a driver error. The handlers must reject it 400 before
// the service runs, so these tests use a nil-dependency SessionService: any
// fallthrough past the new guards would nil-pointer panic, not merely fail.

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
	h := NewHandler(&SessionService{})
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

func TestSessionPathID_Malformed_Are400(t *testing.T) {
	r, h := uuidRouter()
	r.POST("/sessions/:id/intake", h.SubmitIntake)
	r.POST("/sessions/:id/answer", h.Answer)
	r.GET("/sessions/:id", h.GetSession)
	for _, p := range []string{"/sessions/not-a-uuid/intake", "/sessions/not-a-uuid/answer"} {
		if w := postJSON(t, r, p, `{}`); w.Code != http.StatusBadRequest {
			t.Fatalf("POST %s: status = %d, want 400 (got %s)", p, w.Code, w.Body.String())
		}
	}
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/sessions/not-a-uuid", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("GET: status = %d, want 400 (got %s)", w.Code, w.Body.String())
	}
}

func TestStartSession_MalformedProfileID_Is400(t *testing.T) {
	r, h := uuidRouter()
	r.POST("/sessions", h.StartSession)
	w := postJSON(t, r, "/sessions", `{"profile_id":"nope"}`)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (got %s)", w.Code, w.Body.String())
	}
}

// triageFail folds ErrSessionNotFound / ErrProfileNotFound (missing OR foreign —
// owner-fused loads make them uniform) to 404; domain errors keep 409.
func TestTriageFail_SentinelIs404DomainIs409(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, err := range []error{ErrSessionNotFound, ErrProfileNotFound} {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		triageFail(c, err)
		if w.Code != http.StatusNotFound {
			t.Fatalf("%v: status = %d, want 404", err, w.Code)
		}
	}
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	triageFail(c, errors.New("core: illegal transition"))
	if w.Code != http.StatusConflict {
		t.Fatalf("domain error status = %d, want 409", w.Code)
	}
}
