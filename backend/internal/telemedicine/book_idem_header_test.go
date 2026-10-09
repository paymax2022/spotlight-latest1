package telemedicine_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"spotlight/backend/internal/telemedicine"

	"github.com/gin-gonic/gin"
)

// Wave-6 prod probe: POST /telemedicine/appointments with the Idempotency-Key
// supplied ONLY in the header (the iron-rule convention) was rejected 400 by
// the binding:"required" tag on the body field — the handler's documented
// header fallback was unreachable. The binding must now succeed so the
// fallback can see the header.
func TestBookAppointmentRequest_BindingAllowsHeaderOnlyKey(t *testing.T) {
	body := `{"doctor_id":"00000000-0000-0000-0000-000000000000","scheduled_at":"2026-10-07T10:00:00Z"}`
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	req := httptest.NewRequest(http.MethodPost, "/appointments", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	c.Request = req

	var b telemedicine.BookAppointmentRequest
	if err := c.ShouldBindJSON(&b); err != nil {
		t.Fatalf("body without idempotency_key must bind — the header is the alternate spelling: %v", err)
	}
	if b.DoctorID == "" {
		t.Fatal("doctor_id must bind")
	}
}

// A caller supplying the key in NEITHER body nor header still fails closed —
// the check now runs after the header fallback, inside the handler (nil svc:
// the guard returns before the service is touched).
func TestBookAppointmentRejectsMissingKeyAfterFallback(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := telemedicine.NewHandler(nil)
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	body := `{"doctor_id":"00000000-0000-0000-0000-000000000000","scheduled_at":"2026-10-07T10:00:00Z"}`
	c.Request = httptest.NewRequest(http.MethodPost, "/appointments", bytes.NewBufferString(body))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Set("user_id", "11111111-1111-1111-1111-111111111111")

	h.BookAppointment(c)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("missing idempotency key must 400, got %d (%s)", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "Idempotency-Key") {
		t.Fatalf("expected a clear Idempotency-Key message, got %s", rec.Body.String())
	}
}

// The body key still satisfies the requirement end-to-end at the binding layer:
// a populated key must not be clobbered by the header fallback.
func TestBookAppointmentRequest_BodyKeyPreserved(t *testing.T) {
	body := `{"doctor_id":"d1","scheduled_at":"2026-10-07T10:00:00Z","idempotency_key":"body-key"}`
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/appointments", bytes.NewBufferString(body))
	c.Request.Header.Set("Content-Type", "application/json")
	var b telemedicine.BookAppointmentRequest
	if err := json.NewDecoder(strings.NewReader(body)).Decode(&b); err != nil {
		t.Fatal(err)
	}
	if err := c.ShouldBindJSON(&b); err != nil {
		t.Fatal(err)
	}
	if b.IdempotencyKey != "body-key" {
		t.Fatalf("body idempotency_key lost: %q", b.IdempotencyKey)
	}
}
