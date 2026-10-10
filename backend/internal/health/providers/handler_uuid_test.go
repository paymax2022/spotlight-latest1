package healthproviders

// w12 sweep regression: the provider-application :id path param feeds
// uuid-column object loads — a malformed value used to reach pgx and surface
// as a driver error. The handlers must reject it 400 before the service runs,
// so these tests use a nil-dependency Service: any fallthrough past the new
// guards would nil-pointer panic, not merely fail.

import (
	"errors"
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

func TestApplicationPathID_Malformed_Are400(t *testing.T) {
	r, h := uuidRouter()
	r.GET("/applications/:id", h.Get)
	r.POST("/applications/:id/credentials", h.AddCredential)
	r.POST("/applications/:id/credentials/presign", h.PresignCredential)
	r.POST("/applications/:id/submit", h.Submit)
	r.POST("/applications/:id/decision", h.Decision)
	if w := getReq(t, r, "/applications/not-a-uuid"); w.Code != http.StatusBadRequest {
		t.Fatalf("GET: status = %d, want 400 (got %s)", w.Code, w.Body.String())
	}
	for _, p := range []string{
		"/applications/not-a-uuid/credentials",
		"/applications/not-a-uuid/credentials/presign",
		"/applications/not-a-uuid/submit",
		"/applications/not-a-uuid/decision",
	} {
		if w := postJSON(t, r, p, `{}`); w.Code != http.StatusBadRequest {
			t.Fatalf("POST %s: status = %d, want 400 (got %s)", p, w.Code, w.Body.String())
		}
	}
}

// providerFail folds ErrApplicationNotFound (missing OR foreign — uniform) to
// 404; state refusals keep 409.
func TestProviderFail_Mapping(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	providerFail(c, ErrApplicationNotFound)
	if w.Code != http.StatusNotFound {
		t.Fatalf("sentinel status = %d, want 404", w.Code)
	}
	w = httptest.NewRecorder()
	c, _ = gin.CreateTestContext(w)
	providerFail(c, errors.New("providers: illegal transition"))
	if w.Code != http.StatusConflict {
		t.Fatalf("domain error status = %d, want 409", w.Code)
	}
}
