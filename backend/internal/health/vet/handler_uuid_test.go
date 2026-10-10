package healthvet

// Prod-sweep regression (health-verticals probe): an omitted or malformed
// uuid-typed field used to reach a provider-gate/lookup query as "" or "xyz",
// hit Postgres "invalid input syntax for type uuid", and surface as a
// sanitized 422 "internal server error". The handlers must reject it 400
// before the service/gate runs — so these tests run with a nil-dependency
// Service: any fallthrough past the new guards would nil-pointer panic, not
// merely fail.

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

const uuidOK = "3f0a1c9e-0000-4000-8000-000000000001"

func uuidGuardRouter() (*gin.Engine, *Handler) {
	gin.SetMode(gin.TestMode)
	h := NewHandler(&Service{}, nil)
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

func TestUpsertService_MissingProviderID_Is400(t *testing.T) {
	r, h := uuidGuardRouter()
	r.POST("/services", h.UpsertService)
	w := postJSON(t, r, "/services", `{"name":"Consult","price_kobo":5000}`)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (got %s)", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "provider_id") {
		t.Fatalf("body must name the missing field, got %s", w.Body.String())
	}
}

func TestUpsertService_MalformedPinnedID_Is400(t *testing.T) {
	r, h := uuidGuardRouter()
	r.POST("/services", h.UpsertService)
	w := postJSON(t, r, "/services", `{"id":"x","provider_id":"`+uuidOK+`","name":"Consult","visit_type":"TELE","price_kobo":5000}`)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (got %s)", w.Code, w.Body.String())
	}
}

func TestBook_MalformedPetID_Is400(t *testing.T) {
	r, h := uuidGuardRouter()
	r.POST("/appointments", h.Book)
	w := postJSON(t, r, "/appointments",
		`{"provider_id":"`+uuidOK+`","pet_id":"not-a-uuid","service_id":"`+uuidOK+`","visit_type":"TELE"}`)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (got %s)", w.Code, w.Body.String())
	}
}

func TestBook_MalformedServiceID_Is400(t *testing.T) {
	r, h := uuidGuardRouter()
	r.POST("/appointments", h.Book)
	w := postJSON(t, r, "/appointments",
		`{"provider_id":"`+uuidOK+`","pet_id":"`+uuidOK+`","service_id":"nope","visit_type":"TELE"}`)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (got %s)", w.Code, w.Body.String())
	}
}

func TestScheduleVaccination_MalformedPetPathID_Is400(t *testing.T) {
	r, h := uuidGuardRouter()
	r.POST("/pets/:id/vaccinations", h.ScheduleVaccination)
	w := postJSON(t, r, "/pets/not-a-uuid/vaccinations", `{"vaccine":"rabies","due_at":"2030-01-01T00:00:00Z"}`)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (got %s)", w.Code, w.Body.String())
	}
}

func TestCompleteConsult_MalformedHandoffIDs_Are400(t *testing.T) {
	r, h := uuidGuardRouter()
	r.POST("/consults/:id/complete", h.CompleteConsult)
	for _, body := range []string{
		`{"pharmacy_provider_id":"x"}`,
		`{"lab_provider_id":"x"}`,
		`{"lab_provider_id":"` + uuidOK + `","lab_test_ids":["x"]}`,
	} {
		w := postJSON(t, r, "/consults/"+uuidOK+"/complete", body)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("body %s: status = %d, want 400 (got %s)", body, w.Code, w.Body.String())
		}
	}
}

// ─── object-load :id gates (w12) — every path param that feeds a
// WHERE id=$1 uuid-column load must 400 before the service runs. ───

func getReq(t *testing.T, r *gin.Engine, path string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, path, nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func TestAppointmentPathIDs_Malformed_Are400(t *testing.T) {
	r, h := uuidGuardRouter()
	r.GET("/appointments/:id", h.Get)
	r.POST("/appointments/:id/accept", h.Accept)
	r.POST("/appointments/:id/confirm", h.Confirm)
	r.POST("/appointments/:id/cancel", h.Cancel)
	r.POST("/appointments/:id/dispatch", h.Dispatch)
	r.POST("/consults/:id/start", h.StartConsult)
	r.POST("/consults/:id/complete", h.CompleteConsult)
	if w := getReq(t, r, "/appointments/not-a-uuid"); w.Code != http.StatusBadRequest {
		t.Fatalf("GET: status = %d, want 400 (got %s)", w.Code, w.Body.String())
	}
	for _, p := range []string{
		"/appointments/not-a-uuid/accept",
		"/appointments/not-a-uuid/confirm",
		"/appointments/not-a-uuid/cancel",
		"/appointments/not-a-uuid/dispatch",
		"/consults/not-a-uuid/start",
		"/consults/not-a-uuid/complete",
	} {
		w := postJSON(t, r, p, `{}`)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("POST %s: status = %d, want 400 (got %s)", p, w.Code, w.Body.String())
		}
	}
}

func TestAdminProviderFilter_Malformed_Is400(t *testing.T) {
	r, h := uuidGuardRouter()
	r.GET("/admin/appointments", h.AdminListAppointments)
	r.GET("/admin/erx-audit", h.AdminERxAudit)
	for _, p := range []string{
		"/admin/appointments?provider_id=zzz",
		"/admin/erx-audit?provider_id=zzz",
	} {
		if w := getReq(t, r, p); w.Code != http.StatusBadRequest {
			t.Fatalf("GET %s: status = %d, want 400 (got %s)", p, w.Code, w.Body.String())
		}
	}
}

func TestAdminDeactivateService_MalformedPathID_Is400(t *testing.T) {
	r, h := uuidGuardRouter()
	r.POST("/admin/services/:id/deactivate", h.AdminDeactivateService)
	if w := postJSON(t, r, "/admin/services/not-a-uuid/deactivate", `{}`); w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (got %s)", w.Code, w.Body.String())
	}
}

// The w12 uniform-denial fold: a foreign appointment is refused with the same
// ErrAppointmentNotFound a missing one yields, and the handler maps that
// sentinel to 404 — never a distinct 403/409 "forbidden" oracle.
func TestFailVet_SentinelIs404DomainIsFallback(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	failVet(c, http.StatusConflict, ErrAppointmentNotFound)
	if w.Code != http.StatusNotFound {
		t.Fatalf("sentinel status = %d, want 404", w.Code)
	}
	w = httptest.NewRecorder()
	c, _ = gin.CreateTestContext(w)
	failVet(c, http.StatusConflict, errors.New("vet: illegal transition"))
	if w.Code != http.StatusConflict {
		t.Fatalf("domain error status = %d, want 409", w.Code)
	}
}

// A driver-shaped error string must never reach the client verbatim — the
// sanitiser replaces it with the status's generic message at any status.
func TestFailErr_SanitizesDriverText(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	failErr(c, http.StatusConflict, errors.New(`ERROR: invalid input syntax for type uuid: "x" (SQLSTATE 22P02)`))
	if strings.Contains(w.Body.String(), "SQLSTATE") || strings.Contains(w.Body.String(), "syntax") {
		t.Fatalf("driver text leaked: %s", w.Body.String())
	}
}
