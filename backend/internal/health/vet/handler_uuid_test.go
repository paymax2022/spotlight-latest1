package healthvet

// Prod-sweep regression (health-verticals probe): an omitted or malformed
// uuid-typed field used to reach a provider-gate/lookup query as "" or "xyz",
// hit Postgres "invalid input syntax for type uuid", and surface as a
// sanitized 422 "internal server error". The handlers must reject it 400
// before the service/gate runs — so these tests run with a nil-dependency
// Service: any fallthrough past the new guards would nil-pointer panic, not
// merely fail.

import (
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
	} {
		w := postJSON(t, r, "/consults/"+uuidOK+"/complete", body)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("body %s: status = %d, want 400 (got %s)", body, w.Code, w.Body.String())
		}
	}
}
