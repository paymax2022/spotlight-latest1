package healthlab

// Prod-sweep regression (health-verticals probe): an omitted or malformed
// uuid-typed field used to reach a provider-gate/catalog query as "" or "xyz",
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

// ─── object-load :id gates (w12) — every path param that feeds a
// WHERE id=$1 uuid-column load must 400 before the service runs. ───

func getReq(t *testing.T, r *gin.Engine, path string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, path, nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func TestOrderPathIDs_Malformed_Are400(t *testing.T) {
	r, h := uuidGuardRouter()
	for _, tc := range []struct {
		method, path string
		handler      gin.HandlerFunc
	}{
		{http.MethodGet, "/orders/:id", h.Get},
		{http.MethodGet, "/orders/:id/results", h.Results},
		{http.MethodGet, "/orders/:id/custody", h.Custody},
		{http.MethodPost, "/orders/:id/schedule", h.Schedule},
		{http.MethodPost, "/orders/:id/collect", h.Collect},
		{http.MethodPost, "/orders/:id/release", h.Release},
		{http.MethodPost, "/orders/:id/cancel", h.Cancel},
	} {
		switch tc.method {
		case http.MethodGet:
			r.GET(tc.path, tc.handler)
		case http.MethodPost:
			r.POST(tc.path, tc.handler)
		}
	}
	for _, p := range []struct{ method, url string }{
		{http.MethodGet, "/orders/not-a-uuid"},
		{http.MethodGet, "/orders/not-a-uuid/results"},
		{http.MethodGet, "/orders/not-a-uuid/custody"},
		{http.MethodPost, "/orders/not-a-uuid/schedule"},
		{http.MethodPost, "/orders/not-a-uuid/collect"},
		{http.MethodPost, "/orders/not-a-uuid/release"},
		{http.MethodPost, "/orders/not-a-uuid/cancel"},
	} {
		var w *httptest.ResponseRecorder
		if p.method == http.MethodGet {
			w = getReq(t, r, p.url)
		} else {
			w = postJSON(t, r, p.url, `{}`)
		}
		if w.Code != http.StatusBadRequest {
			t.Fatalf("%s %s: status = %d, want 400 (got %s)", p.method, p.url, w.Code, w.Body.String())
		}
		if !strings.Contains(w.Body.String(), "uuid") {
			t.Fatalf("%s %s: body must name the field, got %s", p.method, p.url, w.Body.String())
		}
	}
}

func TestSamplePathIDs_Malformed_Are400(t *testing.T) {
	r, h := uuidGuardRouter()
	r.POST("/samples/:id/accession", h.Accession)
	r.POST("/samples/:id/handover", h.Handover)
	r.POST("/samples/:id/breach", h.FlagBreach)
	for _, p := range []string{
		"/samples/not-a-uuid/accession",
		"/samples/not-a-uuid/handover",
		"/samples/not-a-uuid/breach",
	} {
		w := postJSON(t, r, p, `{}`)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("POST %s: status = %d, want 400 (got %s)", p, w.Code, w.Body.String())
		}
	}
}

func TestHandover_MalformedCustodianID_Is400(t *testing.T) {
	r, h := uuidGuardRouter()
	r.POST("/samples/:id/handover", h.Handover)
	w := postJSON(t, r, "/samples/"+uuidOK+"/handover", `{"to_custodian_id":"x"}`)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (got %s)", w.Code, w.Body.String())
	}
}

func TestEnterResults_MalformedIDs_Are400(t *testing.T) {
	r, h := uuidGuardRouter()
	r.POST("/orders/:id/results", h.EnterResults)
	// malformed path :id
	if w := postJSON(t, r, "/orders/not-a-uuid/results", `{"results":[]}`); w.Code != http.StatusBadRequest {
		t.Fatalf("path id: status = %d, want 400 (got %s)", w.Code, w.Body.String())
	}
	// malformed results[].test_id
	w := postJSON(t, r, "/orders/"+uuidOK+"/results",
		`{"results":[{"test_id":"x","value":"1","status":"NORMAL"}]}`)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("test_id: status = %d, want 400 (got %s)", w.Code, w.Body.String())
	}
}

func TestAdminUUIDFilters_Malformed_Are400(t *testing.T) {
	r, h := uuidGuardRouter()
	r.GET("/admin/orders", h.AdminListOrders)
	r.GET("/admin/custody-audit", h.AdminCustodyAudit)
	r.GET("/admin/escalations", h.AdminEscalations)
	for _, p := range []string{
		"/admin/orders?lab_provider_id=zzz",
		"/admin/custody-audit?lab_provider_id=zzz",
		"/admin/custody-audit?sample_id=zzz",
		"/admin/escalations?lab_provider_id=zzz",
	} {
		if w := getReq(t, r, p); w.Code != http.StatusBadRequest {
			t.Fatalf("GET %s: status = %d, want 400 (got %s)", p, w.Code, w.Body.String())
		}
	}
}

func TestAdminDeactivateTest_MalformedPathID_Is400(t *testing.T) {
	r, h := uuidGuardRouter()
	r.POST("/admin/tests/:id/deactivate", h.AdminDeactivateTest)
	if w := postJSON(t, r, "/admin/tests/not-a-uuid/deactivate", `{}`); w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (got %s)", w.Code, w.Body.String())
	}
}

// The w12 uniform-denial fold: a foreign order is refused with the same
// ErrOrderNotFound a missing one yields, and the handler maps that sentinel
// (or the sample twin) to 404 — never a distinct 403/409 oracle.
func TestFailOrder_SentinelIs404DomainIsFallback(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, sent := range []error{ErrOrderNotFound, ErrSampleNotFound} {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		failOrder(c, http.StatusConflict, sent)
		if w.Code != http.StatusNotFound {
			t.Fatalf("%v: status = %d, want 404", sent, w.Code)
		}
	}
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	failOrder(c, http.StatusConflict, errors.New("lab: illegal transition"))
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
