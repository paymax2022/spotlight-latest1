package healthscheduling

// w12 sweep regression: the appointment :id path param and the Request
// provider_id body field feed uuid columns — a malformed value used to reach
// pgx and surface as a driver error. The handlers must reject it 400 before
// the service runs, so these tests use a nil-dependency Service: any
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

func TestAppointmentPathID_Malformed_Are400(t *testing.T) {
	r, h := uuidRouter()
	r.POST("/appointments/:id/transition", h.Transition)
	r.POST("/appointments/:id/reschedule", h.Reschedule)
	for _, p := range []string{
		"/appointments/not-a-uuid/transition",
		"/appointments/not-a-uuid/reschedule",
	} {
		if w := postJSON(t, r, p, `{}`); w.Code != http.StatusBadRequest {
			t.Fatalf("POST %s: status = %d, want 400 (got %s)", p, w.Code, w.Body.String())
		}
	}
}

func TestRequest_MalformedProviderID_Is400(t *testing.T) {
	r, h := uuidRouter()
	r.POST("/appointments", h.Request)
	w := postJSON(t, r, "/appointments",
		`{"provider_id":"nope","subject_type":"HUMAN","visit_type":"TELE","slot_start":"2030-01-01T10:00:00Z","slot_end":"2030-01-01T10:30:00Z"}`)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (got %s)", w.Code, w.Body.String())
	}
}

// schedulingFail folds ErrAppointmentNotFound (missing OR non-party — uniform)
// to 404; slot/state refusals keep 409.
func TestSchedulingFail_Mapping(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	schedulingFail(c, ErrAppointmentNotFound)
	if w.Code != http.StatusNotFound {
		t.Fatalf("sentinel status = %d, want 404", w.Code)
	}
	for _, err := range []error{ErrSlotTaken, errors.New("scheduling: illegal transition")} {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		schedulingFail(c, err)
		if w.Code != http.StatusConflict {
			t.Fatalf("%v: status = %d, want 409", err, w.Code)
		}
	}
}
