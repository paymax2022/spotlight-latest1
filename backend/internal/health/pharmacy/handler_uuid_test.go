package healthpharmacy

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

func get(t *testing.T, r *gin.Engine, path string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, path, nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func TestUpsertProduct_MissingProviderID_Is400(t *testing.T) {
	r, h := uuidGuardRouter()
	r.POST("/products", h.UpsertProduct)
	w := postJSON(t, r, "/products", `{"name":"Paracetamol","price_kobo":500}`)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (got %s)", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "pharmacy_provider_id") {
		t.Fatalf("body must name the missing field, got %s", w.Body.String())
	}
}

func TestUpsertProduct_MalformedIDs_Are400(t *testing.T) {
	r, h := uuidGuardRouter()
	r.POST("/products", h.UpsertProduct)
	for _, body := range []string{
		`{"pharmacy_provider_id":"not-a-uuid"}`,
		`{"id":"x","pharmacy_provider_id":"` + uuidOK + `"}`,
	} {
		w := postJSON(t, r, "/products", body)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("body %s: status = %d, want 400 (got %s)", body, w.Code, w.Body.String())
		}
	}
}

func TestCreateOrder_MalformedIDs_Are400(t *testing.T) {
	r, h := uuidGuardRouter()
	r.POST("/orders", h.CreateOrder)
	for _, body := range []string{
		`{}`,
		`{"pharmacy_provider_id":"not-a-uuid"}`,
		`{"pharmacy_provider_id":"` + uuidOK + `","prescription_id":"x"}`,
		`{"pharmacy_provider_id":"` + uuidOK + `","search_event_id":"x"}`,
		`{"pharmacy_provider_id":"` + uuidOK + `","lines":[{"product_id":"x","quantity":1}]}`,
	} {
		w := postJSON(t, r, "/orders", body)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("body %s: status = %d, want 400 (got %s)", body, w.Code, w.Body.String())
		}
	}
}

func TestListProducts_MalformedProviderFilter_Is400(t *testing.T) {
	r, h := uuidGuardRouter()
	r.GET("/products", h.ListProducts)
	if w := get(t, r, "/products?pharmacy_provider_id=zzz"); w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (got %s)", w.Code, w.Body.String())
	}
}

func TestUpsertPharmacyProfile_MalformedPathID_Is400(t *testing.T) {
	r, h := uuidGuardRouter()
	r.POST("/pharmacies/:id/profile", h.UpsertPharmacyProfile)
	w := postJSON(t, r, "/pharmacies/not-a-uuid/profile", `{"address":"1 Main St"}`)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (got %s)", w.Code, w.Body.String())
	}
}

func TestListPharmacyReviews_MalformedPathID_Is400(t *testing.T) {
	r, h := uuidGuardRouter()
	r.GET("/pharmacies/:id/reviews", h.ListPharmacyReviews)
	if w := get(t, r, "/pharmacies/not-a-uuid/reviews"); w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (got %s)", w.Code, w.Body.String())
	}
}

// ─── object-load :id gates (w12) — every path param that feeds a
// WHERE id=$1 uuid-column load must 400 before the service runs. ───

func TestObjectPathIDs_Malformed_Are400(t *testing.T) {
	r, h := uuidGuardRouter()
	r.GET("/products/:id", h.GetProduct)
	r.GET("/pharmacies/:id", h.GetPharmacy)
	r.GET("/orders/:id", h.Get)
	r.POST("/prescriptions/:id/verify", h.VerifyPrescription)
	r.POST("/orders/:id/confirm", h.Confirm)
	r.POST("/orders/:id/dispense", h.Dispense)
	r.POST("/orders/:id/dispatch", h.Dispatch)
	r.POST("/orders/:id/complete", h.Complete)
	r.POST("/orders/:id/cancel", h.Cancel)
	r.POST("/orders/:id/reviews", h.SubmitReview)
	for _, p := range []string{
		"/products/not-a-uuid",
		"/pharmacies/not-a-uuid",
		"/orders/not-a-uuid",
	} {
		if w := get(t, r, p); w.Code != http.StatusBadRequest {
			t.Fatalf("GET %s: status = %d, want 400 (got %s)", p, w.Code, w.Body.String())
		}
	}
	for _, p := range []string{
		"/prescriptions/not-a-uuid/verify",
		"/orders/not-a-uuid/confirm",
		"/orders/not-a-uuid/dispense",
		"/orders/not-a-uuid/dispatch",
		"/orders/not-a-uuid/complete",
		"/orders/not-a-uuid/cancel",
		"/orders/not-a-uuid/reviews",
	} {
		w := postJSON(t, r, p, `{}`)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("POST %s: status = %d, want 400 (got %s)", p, w.Code, w.Body.String())
		}
	}
}

func TestAdminUUIDParams_Malformed_Are400(t *testing.T) {
	r, h := uuidGuardRouter()
	r.GET("/admin/orders", h.AdminListOrders)
	r.GET("/admin/orders/:id", h.AdminGetOrder)
	r.GET("/admin/dispense-audit", h.AdminDispenseAudit)
	r.POST("/admin/products/:id/recall", h.AdminRecallProduct)
	for _, p := range []string{
		"/admin/orders?pharmacy_provider_id=zzz",
		"/admin/orders/not-a-uuid",
		"/admin/dispense-audit?pharmacy_provider_id=zzz",
	} {
		if w := get(t, r, p); w.Code != http.StatusBadRequest {
			t.Fatalf("GET %s: status = %d, want 400 (got %s)", p, w.Code, w.Body.String())
		}
	}
	if w := postJSON(t, r, "/admin/products/not-a-uuid/recall", `{}`); w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (got %s)", w.Code, w.Body.String())
	}
}

// The w12 uniform-denial fold: a foreign order is refused with the same
// ErrOrderNotFound a missing one yields, and the handler maps that sentinel
// to 404 — never a distinct 403/409/422 oracle.
func TestFailOrder_SentinelIs404DomainIsFallback(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	failOrder(c, http.StatusUnprocessableEntity, ErrOrderNotFound)
	if w.Code != http.StatusNotFound {
		t.Fatalf("sentinel status = %d, want 404", w.Code)
	}
	w = httptest.NewRecorder()
	c, _ = gin.CreateTestContext(w)
	failOrder(c, http.StatusUnprocessableEntity, errors.New("pharmacy: order must be completed"))
	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("domain error status = %d, want 422", w.Code)
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
