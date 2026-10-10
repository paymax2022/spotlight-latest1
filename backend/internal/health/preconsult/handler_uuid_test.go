package preconsult

// w12 sweep regression: the :appointmentId path param feeds uuid-column object
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

func TestAppointmentID_Malformed_Are400(t *testing.T) {
	r, h := uuidRouter()
	r.GET("/intake/appointments/:appointmentId", h.GetAppointmentIntake)
	r.POST("/intake/appointments/:appointmentId/draft", h.SaveDraft)
	r.POST("/intake/appointments/:appointmentId/submit", h.Submit)
	r.POST("/intake/appointments/:appointmentId/attachments/presign", h.PresignAttachment)
	r.POST("/intake/appointments/:appointmentId/attachments", h.RecordAttachment)
	r.GET("/intake/appointments/:appointmentId/doctor-summary", h.DoctorSummary)
	for _, p := range []string{
		"/intake/appointments/not-a-uuid",
		"/intake/appointments/not-a-uuid/doctor-summary",
	} {
		if w := getReq(t, r, p); w.Code != http.StatusBadRequest {
			t.Fatalf("GET %s: status = %d, want 400 (got %s)", p, w.Code, w.Body.String())
		}
	}
	for _, p := range []string{
		"/intake/appointments/not-a-uuid/draft",
		"/intake/appointments/not-a-uuid/submit",
		"/intake/appointments/not-a-uuid/attachments/presign",
		"/intake/appointments/not-a-uuid/attachments",
	} {
		if w := postJSON(t, r, p, `{}`); w.Code != http.StatusBadRequest {
			t.Fatalf("POST %s: status = %d, want 400 (got %s)", p, w.Code, w.Body.String())
		}
	}
}

// preconsultFail folds ErrAppointmentNotFound / ErrIntakeNotFound (missing OR
// foreign — uniform) to 404; the default status applies to anything else.
func TestPreconsultFail_Mapping(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cases := []struct {
		err     error
		defCode int
		want    int
	}{
		{ErrAppointmentNotFound, http.StatusForbidden, http.StatusNotFound},
		{ErrIntakeNotFound, http.StatusBadRequest, http.StatusNotFound},
		{ErrUploadsNotConfigured, http.StatusBadRequest, http.StatusServiceUnavailable},
		{errors.New("preconsult: invalid"), http.StatusBadRequest, http.StatusBadRequest},
	}
	for _, tc := range cases {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		preconsultFail(c, tc.err, tc.defCode)
		if w.Code != tc.want {
			t.Fatalf("%v: status = %d, want %d", tc.err, w.Code, tc.want)
		}
	}
}
