package telemedicine_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/telemedicine"
)

// Input validation happens before any DB access, so a nil-pool service is enough.
func TestAdminAppointmentHandlers_RejectBadInputBeforeDB(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := telemedicine.NewHandler(telemedicine.NewService(nil, nil))
	r := gin.New()
	r.GET("/appointments/:id", h.AdminGetAppointment)
	r.POST("/appointments/:id/cancel", h.AdminCancelAppointment)
	r.POST("/appointments/:id/reassign", h.AdminReassignAppointment)

	id := "3f2b1c4e-8a9d-4e0b-9c1d-2a3b4c5d6e7f"
	cases := []struct {
		name, method, path, key, body string
		want                          int
	}{
		{"detail bad id", http.MethodGet, "/appointments/nope", "", "", http.StatusBadRequest},
		{"cancel bad id", http.MethodPost, "/appointments/nope/cancel", "key-12345678", `{"reason":"x"}`, http.StatusBadRequest},
		{"cancel no key", http.MethodPost, "/appointments/" + id + "/cancel", "", `{"reason":"x"}`, http.StatusBadRequest},
		{"cancel short key", http.MethodPost, "/appointments/" + id + "/cancel", "short", `{"reason":"x"}`, http.StatusBadRequest},
		{"cancel no reason", http.MethodPost, "/appointments/" + id + "/cancel", "key-12345678", `{"reason":"  "}`, http.StatusBadRequest},
		{"reassign bad doctor", http.MethodPost, "/appointments/" + id + "/reassign", "key-12345678", `{"doctor_id":"x","reason":"r"}`, http.StatusBadRequest},
		{"reassign no key", http.MethodPost, "/appointments/" + id + "/reassign", "", `{"doctor_id":"` + id + `","reason":"r"}`, http.StatusBadRequest},
		{"reassign no reason", http.MethodPost, "/appointments/" + id + "/reassign", "key-12345678", `{"doctor_id":"` + id + `"}`, http.StatusBadRequest},
	}
	for _, tc := range cases {
		w := httptest.NewRecorder()
		req := httptest.NewRequestWithContext(context.Background(), tc.method, tc.path, strings.NewReader(tc.body))
		req.Header.Set("Content-Type", "application/json")
		if tc.key != "" {
			req.Header.Set("Idempotency-Key", tc.key)
		}
		r.ServeHTTP(w, req)
		if w.Code != tc.want {
			t.Errorf("%s: %d, want %d (%s)", tc.name, w.Code, tc.want, w.Body)
		}
	}
}
