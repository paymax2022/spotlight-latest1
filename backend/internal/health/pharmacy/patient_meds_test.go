package healthpharmacy

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

// Guards must reject before any query runs (nil-db Service panics on fallthrough).
func TestPatientMeds_Guards(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := NewHandler(&Service{}, nil)

	anon := gin.New()
	anon.GET("/medications", h.Medications)
	anon.GET("/refills", h.Refills)
	anon.POST("/orders/:id/reorder", h.Reorder)
	for _, tc := range []struct{ method, path string }{
		{http.MethodGet, "/medications"},
		{http.MethodGet, "/refills"},
		{http.MethodPost, "/orders/" + uuidOK + "/reorder"},
	} {
		w := httptest.NewRecorder()
		anon.ServeHTTP(w, httptest.NewRequestWithContext(t.Context(), tc.method, tc.path, nil))
		if w.Code != http.StatusUnauthorized {
			t.Fatalf("%s %s: status = %d, want 401", tc.method, tc.path, w.Code)
		}
	}

	r, h2 := uuidGuardRouter()
	r.POST("/orders/:id/reorder", h2.Reorder)
	r.POST("/refills/:id/schedule", h2.ScheduleRefill)
	if w := postJSON(t, r, "/orders/nope/reorder", `{}`); w.Code != http.StatusBadRequest {
		t.Fatalf("malformed order id: %d", w.Code)
	}
	if w := postJSON(t, r, "/refills/nope/schedule", `{}`); w.Code != http.StatusBadRequest {
		t.Fatalf("malformed refill id: %d", w.Code)
	}
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/refills/"+uuidOK+"/schedule", strings.NewReader(`{bad`))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("bad body: %d", w.Code)
	}
}
