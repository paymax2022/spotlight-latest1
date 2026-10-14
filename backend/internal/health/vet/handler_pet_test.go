package healthvet

// Pet endpoints are checked with a nil-dependency Service, like the other
// handler guards: any input that gets past the handler's own checks would
// nil-pointer panic rather than pass quietly.

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func petRouter() *gin.Engine {
	r, h := uuidGuardRouter()
	r.POST("/pets", h.CreatePet)
	r.GET("/pets/:id", h.GetPet)
	r.PUT("/pets/:id", h.UpdatePet)
	return r
}

func doReq(t *testing.T, r *gin.Engine, method, path, body, idem string) *httptest.ResponseRecorder {
	req := httptest.NewRequestWithContext(t.Context(), method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if idem != "" {
		req.Header.Set("Idempotency-Key", idem)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func TestPetGet_MalformedID_Is400BeforeService(t *testing.T) {
	w := doReq(t, petRouter(), http.MethodGet, "/pets/not-a-uuid", "", "")
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status %d, want 400: %s", w.Code, w.Body.String())
	}
}

func TestPetUpdate_MalformedID_Is400BeforeService(t *testing.T) {
	w := doReq(t, petRouter(), http.MethodPut, "/pets/xyz", `{"name":"Bella","species":"DOG","breed":"Mutt"}`, "")
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status %d, want 400: %s", w.Code, w.Body.String())
	}
}

func TestPetUpdate_FutureBirthDate_Is422BeforeService(t *testing.T) {
	body := `{"name":"Bella","species":"DOG","breed":"Mutt","birth_date":"2999-01-01"}`
	w := doReq(t, petRouter(), http.MethodPut, "/pets/"+uuidOK, body, "")
	if w.Code != http.StatusUnprocessableEntity || !strings.Contains(w.Body.String(), "cannot be in the future") {
		t.Fatalf("status %d body %s, want 422 future-date", w.Code, w.Body.String())
	}
}

func TestPetCreate_FutureBirthDate_Is422BeforeService(t *testing.T) {
	body := `{"name":"Bella","species":"DOG","breed":"Mutt","birth_date":"2999-01-01"}`
	w := doReq(t, petRouter(), http.MethodPost, "/pets", body, "pet-key-000001")
	if w.Code != http.StatusUnprocessableEntity || !strings.Contains(w.Body.String(), "cannot be in the future") {
		t.Fatalf("status %d body %s, want 422 future-date", w.Code, w.Body.String())
	}
}

func TestPetCreate_MissingBreed_Is422BeforeService(t *testing.T) {
	w := doReq(t, petRouter(), http.MethodPost, "/pets", `{"name":"Bella","species":"DOG"}`, "pet-key-000002")
	if w.Code != http.StatusUnprocessableEntity || !strings.Contains(w.Body.String(), "Choose a breed") {
		t.Fatalf("status %d body %s, want 422 breed", w.Code, w.Body.String())
	}
}
