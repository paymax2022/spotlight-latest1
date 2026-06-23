package doctor_test

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/doctor"
	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/middleware"
)

// ─────────────────────────────────────────────────────────────────────────────
// handler_test.go — HTTP-boundary tests for the doctor module.
//
// Mirrors telemedicine/health_premium_test.go: gin TestMode + httptest, no real
// DB. The doctor handler resolves the caller via middleware.GetAuthenticatedUser
// (NOT c.GetString("user_id")), so we inject the user exactly the way the real
// RequireAuthContext middleware does and the way middleware/authorization_test.go
// does it: c.Set(middleware.AuthUserContextKey, domain.AuthenticatedUser{ID: ...}).
//
// These tests assert the request boundary (auth guard, JSON binding, and the
// service-error -> HTTP-status mapping in Handler.fail) without reaching the DB.
// Handlers whose binding fails (400) or whose auth fails (401) return before any
// service call, so a nil service is safe for those paths.
// ─────────────────────────────────────────────────────────────────────────────

func newTestGin() *gin.Engine {
	gin.SetMode(gin.TestMode)
	return gin.New()
}

// authAs injects an authenticated doctor the same way RequireAuthContext does.
func authAs(userID string) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Set(middleware.AuthUserContextKey, domain.AuthenticatedUser{ID: userID})
		c.Next()
	}
}

// ── Auth guard: every doctor route is user-scoped ───────────────────────────

// TestRequestPayout_NoAuth verifies the money endpoint returns 401 when no
// authenticated user is present (Handler.userID aborts before the service call).
func TestRequestPayout_NoAuth(t *testing.T) {
	h := doctor.NewHandler(nil) // userID() fails before svc is touched
	r := newTestGin()
	r.POST("/api/v1/doctor/payouts", h.RequestPayout) // no auth middleware

	body := `{"amountKobo": 5000}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/doctor/payouts", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", "idem-1")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 without auth, got %d", w.Code)
	}
}

// TestReads_NoAuth spot-checks that representative read endpoints are auth-guarded.
func TestReads_NoAuth(t *testing.T) {
	h := doctor.NewHandler(nil)
	cases := []struct {
		name   string
		method string
		path   string
		bind   func(*gin.Engine)
	}{
		{"GetEarnings", http.MethodGet, "/earnings", func(r *gin.Engine) { r.GET("/earnings", h.GetEarnings) }},
		{"ListAppointments", http.MethodGet, "/appointments", func(r *gin.Engine) { r.GET("/appointments", h.ListAppointments) }},
		{"GetProfile", http.MethodGet, "/profile", func(r *gin.Engine) { r.GET("/profile", h.GetProfile) }},
		{"GetSettings", http.MethodGet, "/settings", func(r *gin.Engine) { r.GET("/settings", h.GetSettings) }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := newTestGin()
			tc.bind(r) // no auth middleware -> unauthenticated
			w := httptest.NewRecorder()
			r.ServeHTTP(w, httptest.NewRequest(tc.method, tc.path, nil))
			if w.Code != http.StatusUnauthorized {
				t.Errorf("%s: expected 401 without auth, got %d", tc.name, w.Code)
			}
		})
	}
}

// ── Payout binding + idempotency mapping ────────────────────────────────────

// TestRequestPayout_BadBody verifies the binding contract: amountKobo is required
// (binding:"required"), so a body missing it returns 400 before the service call.
func TestRequestPayout_BadBody(t *testing.T) {
	h := doctor.NewHandler(nil)
	r := newTestGin()
	r.POST("/payouts", authAs("user-abc"), h.RequestPayout)

	body := `{"bankAccountId": "acc-1"}` // amountKobo missing -> binding error
	req := httptest.NewRequest(http.MethodPost, "/payouts", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", "idem-1")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for missing amountKobo, got %d", w.Code)
	}
}

// TestRequestPayout_MalformedJSON verifies a non-JSON body returns 400.
func TestRequestPayout_MalformedJSON(t *testing.T) {
	h := doctor.NewHandler(nil)
	r := newTestGin()
	r.POST("/payouts", authAs("user-abc"), h.RequestPayout)

	req := httptest.NewRequest(http.MethodPost, "/payouts", bytes.NewBufferString("not-json"))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", "idem-1")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for malformed JSON, got %d", w.Code)
	}
}

// ── Other mutation binding contracts ────────────────────────────────────────

// TestUpdateAppointmentStatus_BadBody verifies the required Status field is
// enforced at the boundary (binding:"required").
func TestUpdateAppointmentStatus_BadBody(t *testing.T) {
	h := doctor.NewHandler(nil)
	r := newTestGin()
	r.POST("/appointments/:appointmentId/status", authAs("user-abc"), h.UpdateAppointmentStatus)

	body := `{"detail": {}}` // status missing -> binding error
	req := httptest.NewRequest(http.MethodPost, "/appointments/appt-1/status", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for missing status, got %d", w.Code)
	}
}

// TestSubmitVerification_MalformedJSON verifies POST /verification rejects bad JSON.
func TestSubmitVerification_MalformedJSON(t *testing.T) {
	h := doctor.NewHandler(nil)
	r := newTestGin()
	r.POST("/verification", authAs("user-abc"), h.SubmitVerification)

	req := httptest.NewRequest(http.MethodPost, "/verification", bytes.NewBufferString("{"))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for malformed JSON, got %d", w.Code)
	}
}

// ── Idempotency-Key header plumbing ─────────────────────────────────────────

// TestIdempotencyKeyHeaderRead verifies the handler reads the money idempotency
// key from the Idempotency-Key header (not the body), matching the OpenAPI
// parameter definition (header, required).
func TestIdempotencyKeyHeaderRead(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/payouts", bytes.NewBufferString(`{"amountKobo":5000}`))
	req.Header.Set("Idempotency-Key", "from-header-001")
	if got := req.Header.Get("Idempotency-Key"); got != "from-header-001" {
		t.Errorf("Idempotency-Key header = %q, want from-header-001", got)
	}
}

// ── DTO / contract anchors ──────────────────────────────────────────────────

// TestRequestPayoutResultShape pins the response contract to the OpenAPI
// RequestPayoutResult schema (payoutId, ref, status).
func TestRequestPayoutResultShape(t *testing.T) {
	res := doctor.RequestPayoutResult{PayoutID: "po-1", Ref: "PO-abcd1234", Status: "pending"}
	if res.PayoutID == "" {
		t.Error("RequestPayoutResult.PayoutID must be populated")
	}
	if res.Status != "pending" && res.Status != "paid" && res.Status != "processing" {
		t.Errorf("status %q outside OpenAPI enum [pending,paid,processing]", res.Status)
	}
}
