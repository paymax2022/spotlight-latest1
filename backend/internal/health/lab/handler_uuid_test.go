package healthlab

// Prod-sweep regression (health-verticals probe): an omitted or malformed
// uuid-typed field used to reach a provider-gate/catalog query as "" or "xyz",
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

func TestUpsertTest_MissingProviderID_Is400(t *testing.T) {
	r, h := uuidGuardRouter()
	r.POST("/tests", h.UpsertTest)
	w := postJSON(t, r, "/tests", `{"name":"FBC","price_kobo":5000}`)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (got %s)", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "lab_provider_id") {
		t.Fatalf("body must name the missing field, got %s", w.Body.String())
	}
}

func TestUpsertTest_MalformedProviderID_Is400(t *testing.T) {
	r, h := uuidGuardRouter()
	r.POST("/tests", h.UpsertTest)
	w := postJSON(t, r, "/tests", `{"lab_provider_id":"not-a-uuid","name":"FBC","price_kobo":5000}`)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (got %s)", w.Code, w.Body.String())
	}
}

func TestUpsertTest_MalformedPinnedID_Is400(t *testing.T) {
	r, h := uuidGuardRouter()
	r.POST("/tests", h.UpsertTest)
	w := postJSON(t, r, "/tests", `{"id":"x","lab_provider_id":"`+uuidOK+`","name":"FBC","price_kobo":5000}`)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (got %s)", w.Code, w.Body.String())
	}
}

func TestListTests_MalformedProviderFilter_Is400(t *testing.T) {
	r, h := uuidGuardRouter()
	r.GET("/tests", h.ListTests)
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/tests?lab_provider_id=zzz", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (got %s)", w.Code, w.Body.String())
	}
}

func TestListPackages_MalformedProviderFilter_Is400(t *testing.T) {
	r, h := uuidGuardRouter()
	r.GET("/packages", h.ListPackages)
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/packages?lab_provider_id=zzz", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (got %s)", w.Code, w.Body.String())
	}
}

func TestCreateOrder_MalformedTestID_Is400(t *testing.T) {
	r, h := uuidGuardRouter()
	r.POST("/orders", h.CreateOrder)
	w := postJSON(t, r, "/orders",
		`{"lab_provider_id":"`+uuidOK+`","collection_method":"WALK_IN","idempotency_key":"k1","test_ids":["nope"]}`)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (got %s)", w.Code, w.Body.String())
	}
}
