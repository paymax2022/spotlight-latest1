package healthrx

// w12 sweep regression: the prescription :id path param and the Issue/Send
// body ids feed uuid columns — a malformed value used to reach pgx and surface
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

func TestRxPathID_Malformed_Are400(t *testing.T) {
	r, h := uuidRouter()
	r.GET("/prescriptions/:id", h.Get)
	r.POST("/prescriptions/:id/send", h.Send)
	r.POST("/prescriptions/:id/verify", h.Verify)
	r.POST("/prescriptions/:id/dispense", h.Dispense)
	for _, p := range []string{
		"/prescriptions/not-a-uuid/send",
		"/prescriptions/not-a-uuid/verify",
		"/prescriptions/not-a-uuid/dispense",
	} {
		if w := postJSON(t, r, p, `{}`); w.Code != http.StatusBadRequest {
			t.Fatalf("POST %s: status = %d, want 400 (got %s)", p, w.Code, w.Body.String())
		}
	}
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/prescriptions/not-a-uuid", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("GET: status = %d, want 400 (got %s)", w.Code, w.Body.String())
	}
}

func TestIssue_MalformedBodyIDs_Are400(t *testing.T) {
	r, h := uuidRouter()
	r.POST("/prescriptions", h.Issue)
	for _, body := range []string{
		`{"patient_id":"x"}`,
		`{"patient_id":"` + uuidOK + `","consult_id":"x"}`,
	} {
		if w := postJSON(t, r, "/prescriptions", body); w.Code != http.StatusBadRequest {
			t.Fatalf("body %s: status = %d, want 400 (got %s)", body, w.Code, w.Body.String())
		}
	}
}

func TestSend_MalformedPharmacyID_Is400(t *testing.T) {
	r, h := uuidRouter()
	r.POST("/prescriptions/:id/send", h.Send)
	w := postJSON(t, r, "/prescriptions/"+uuidOK+"/send", `{"pharmacy_provider_id":"x"}`)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (got %s)", w.Code, w.Body.String())
	}
}

// rxFail folds ErrPrescriptionNotFound (missing OR non-party — uniform) to 404;
// ErrInvalidInput → 400; state refusals → 409.
func TestRxFail_Mapping(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cases := []struct {
		err  error
		want int
	}{
		{ErrPrescriptionNotFound, http.StatusNotFound},
		{ErrInvalidInput, http.StatusBadRequest},
		{errors.New("rx: illegal transition"), http.StatusConflict},
	}
	for _, tc := range cases {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		rxFail(c, tc.err)
		if w.Code != tc.want {
			t.Fatalf("%v: status = %d, want %d", tc.err, w.Code, tc.want)
		}
	}
}
