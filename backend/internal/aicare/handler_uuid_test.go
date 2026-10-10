package aicare

// w12 health-lane regression: the aicare :id path param feeds
// WHERE id=$1 on support_sessions.id (uuid). Before the gate, a malformed
// value produced a raw driver error that Escalate/Resolve relayed verbatim
// into a 400 body, and the denial mapping itself was split (400 on
// SendMessage/Escalate/Resolve vs 404 on GetHistory). Now: malformed → 400
// naming the field (nil-dependency Service — any fallthrough past the gate
// nil-pointer panics, not merely fails); a session that is missing OR owned
// by someone else → the single uniform 404 (the service fuses ownership into
// every query's WHERE clause, so the cases are indistinguishable by
// construction — no existence oracle).

import (
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

const uuidOK = "3f0a1c9e-0000-4000-8000-000000000001"

func uuidGuardRouter() (*gin.Engine, *Handler) {
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

func TestSessionPathID_Malformed_Is400(t *testing.T) {
	r, h := uuidGuardRouter()
	r.GET("/sessions/:id/messages", h.GetHistory)
	r.POST("/sessions/:id/messages", h.SendMessage)
	r.POST("/sessions/:id/escalate", h.Escalate)
	r.POST("/sessions/:id/resolve", h.Resolve)

	if w := getReq(t, r, "/sessions/not-a-uuid/messages"); w.Code != http.StatusBadRequest {
		t.Fatalf("GET messages: status = %d, want 400 (got %s)", w.Code, w.Body.String())
	}
	for _, tc := range []struct{ path, body string }{
		{"/sessions/not-a-uuid/messages", `{"content":"hi"}`},
		{"/sessions/not-a-uuid/escalate", `{}`},
		{"/sessions/not-a-uuid/resolve", `{}`},
	} {
		w := postJSON(t, r, tc.path, tc.body)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("POST %s: status = %d, want 400 (got %s)", tc.path, w.Code, w.Body.String())
		}
		if !strings.Contains(w.Body.String(), "session id") {
			t.Fatalf("POST %s: body must name the field, got %s", tc.path, w.Body.String())
		}
	}
}

// failSessionErr is the uniform denial contract: missing-or-foreign → 404,
// own-session state refusal → 400, anything else → 500 (never a driver error
// surfaced as a client error).
func TestFailSessionErr_UniformDenial(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cases := []struct {
		name string
		err  error
		want int
	}{
		{"not found sentinel", ErrSessionNotFound, http.StatusNotFound},
		{"wrapped not found", fmt.Errorf("load: %w", ErrSessionNotFound), http.StatusNotFound},
		{"resolved-state refusal", ErrSessionResolved, http.StatusBadRequest},
		{"internal", errors.New("aicare: load session: boom"), http.StatusInternalServerError},
	}
	for _, tc := range cases {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		failSessionErr(c, tc.err)
		if w.Code != tc.want {
			t.Fatalf("%s: status = %d, want %d", tc.name, w.Code, tc.want)
		}
	}
}
