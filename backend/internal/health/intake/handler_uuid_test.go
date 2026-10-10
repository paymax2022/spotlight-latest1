package healthintake

// w12 sweep regression: the :schemaId path param feeds a uuid-column object
// load — a malformed value used to reach pgx and surface as a driver error.
// The handler must reject it 400 before the service runs, so these tests use a
// nil-dependency Service: any fallthrough past the new guard would nil-pointer
// panic, not merely fail.

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

func TestSchemaID_Malformed_Is400(t *testing.T) {
	r, h := uuidRouter()
	r.GET("/intake/:schemaId", h.GetSchema)
	r.POST("/intake/:schemaId/submit", h.Submit)
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/intake/not-a-uuid", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("GET: status = %d, want 400 (got %s)", w.Code, w.Body.String())
	}
	req = httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/intake/not-a-uuid/submit", strings.NewReader(`{"answers":{}}`))
	req.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("POST: status = %d, want 400 (got %s)", w.Code, w.Body.String())
	}
}
