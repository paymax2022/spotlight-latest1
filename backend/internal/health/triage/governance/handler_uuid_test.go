package governance

// w12 sweep regression: the content/rule :id path params feed uuid columns —
// a malformed value used to reach pgx and surface as a driver error. The
// handlers must reject it 400 before the service runs, so these tests use
// nil-store services: any fallthrough past the new guards would panic, not
// merely fail.

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func uuidRouter() (*gin.Engine, *Handler) {
	gin.SetMode(gin.TestMode)
	h := NewHandler(NewGovernanceService(nil), NewValidationService(nil), nil)
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

func TestGovPathIDs_Malformed_Are400(t *testing.T) {
	r, h := uuidRouter()
	r.PUT("/content/:id", h.EditContent)
	r.POST("/content/:id/:action", h.ContentLifecycle)
	r.PUT("/rules/:id", h.EditRule)
	r.POST("/rules/:id/:action", h.RuleLifecycle)
	putReq := func(path, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequestWithContext(t.Context(), http.MethodPut, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w
	}
	if w := putReq("/content/not-a-uuid", `{"body":"x"}`); w.Code != http.StatusBadRequest {
		t.Fatalf("EditContent: status = %d, want 400 (got %s)", w.Code, w.Body.String())
	}
	if w := putReq("/rules/not-a-uuid", `{"name":"x"}`); w.Code != http.StatusBadRequest {
		t.Fatalf("EditRule: status = %d, want 400 (got %s)", w.Code, w.Body.String())
	}
	for _, p := range []string{"/content/not-a-uuid/publish", "/rules/not-a-uuid/publish"} {
		if w := postJSON(t, r, p, `{}`); w.Code != http.StatusBadRequest {
			t.Fatalf("POST %s: status = %d, want 400 (got %s)", p, w.Code, w.Body.String())
		}
	}
}
