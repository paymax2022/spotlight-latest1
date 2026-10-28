package prescriptions

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestMaskPatient(t *testing.T) {
	cases := []struct{ name, id, want string }{
		{"Aisha Mohammed", "x", "Aisha M•••"},
		{"  Chinedu   Okafor Eze ", "x", "Chinedu E•••"},
		{"Bola", "x", "B•••"},
		{"", "pat-123456789", "pat-1234…"},
		{"", "short", "short"},
		{"", "", "Unknown"},
	}
	for _, c := range cases {
		if got := maskPatient(c.name, c.id); got != c.want {
			t.Errorf("maskPatient(%q,%q)=%q want %q", c.name, c.id, got, c.want)
		}
	}
	// the masked form must never contain the surname or the full id
	if m := maskPatient("Aisha Mohammed", "pat-123456789"); strings.Contains(m, "ohammed") {
		t.Errorf("surname leaked: %q", m)
	}
	if m := maskPatient("", "pat-123456789"); strings.Contains(m, "56789") {
		t.Errorf("id tail leaked: %q", m)
	}
}

func TestClampPage(t *testing.T) {
	if l, o := clampPage(0, -5); l != defaultLimit || o != 0 {
		t.Errorf("got %d,%d", l, o)
	}
	if l, _ := clampPage(1000, 0); l != defaultLimit {
		t.Errorf("limit over max should fall back to default, got %d", l)
	}
	if l, o := clampPage(50, 10); l != 50 || o != 10 {
		t.Errorf("got %d,%d", l, o)
	}
}

func TestLikeEscape(t *testing.T) {
	if got := likeEscape(`50%_off\`); got != `50\%\_off\\` {
		t.Errorf("got %q", got)
	}
}

// A service with a nil DB never reaches the database when validation fails.
func TestValidationRejectsBeforeDB(t *testing.T) {
	s := NewService(nil)
	ctx := context.Background()
	bad := []ListQuery{
		{Status: "bogus"},
		{DoctorID: "not-a-uuid"},
		{From: "2026/01/01"},
		{To: "nope"},
		{From: "2026-02-01", To: "2026-01-01"},
		{Q: strings.Repeat("x", maxQueryLen+1)},
	}
	for i, q := range bad {
		if _, _, err := s.List(ctx, q); !errors.Is(err, ErrValidation) {
			t.Errorf("case %d: want ErrValidation, got %v", i, err)
		}
	}
	if _, _, err := s.ListRefills(ctx, PageQuery{Status: "weird"}); !errors.Is(err, ErrValidation) {
		t.Errorf("refills status: %v", err)
	}
	if _, _, err := s.ListFulfilments(ctx, PageQuery{Status: "DROP TABLE"}); !errors.Is(err, ErrValidation) {
		t.Errorf("fulfilments status: %v", err)
	}
	if _, err := s.Get(ctx, "admin", "not-a-uuid"); !errors.Is(err, ErrNotFound) {
		t.Errorf("get bad id: %v", err)
	}
	const id = "22222222-2222-2222-2222-222222222222"
	if _, err := s.SetFlag(ctx, "", id, true, "reason"); !errors.Is(err, ErrValidation) {
		t.Errorf("missing actor: %v", err)
	}
	if _, err := s.SetFlag(ctx, "a", id, true, "no"); !errors.Is(err, ErrValidation) {
		t.Errorf("short reason: %v", err)
	}
	if _, err := s.SetFlag(ctx, "a", id, true, strings.Repeat("x", 501)); !errors.Is(err, ErrValidation) {
		t.Errorf("long reason: %v", err)
	}
	if _, err := s.SetFlag(ctx, "a", "nope", false, ""); !errors.Is(err, ErrNotFound) {
		t.Errorf("bad id: %v", err)
	}
}

// RBAC wiring: every read route is behind view, every mutation behind manage, and a
// request denied by the middleware never reaches a handler (nil DB would panic).
func TestRegisterRBACWiring(t *testing.T) {
	gin.SetMode(gin.TestMode)
	var viewHits, manageHits int
	allow := func(counter *int, deny bool) gin.HandlerFunc {
		return func(c *gin.Context) {
			*counter++
			if deny {
				c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "forbidden"})
				return
			}
			c.Next()
		}
	}
	r := gin.New()
	register(r.Group("/api/v1/telemedicine/admin"), NewService(nil), allow(&viewHits, true), allow(&manageHits, true))

	reads := []string{"/prescriptions", "/prescriptions/summary", "/prescriptions/fulfilments",
		"/prescriptions/refills", "/prescriptions/22222222-2222-2222-2222-222222222222"}
	for _, p := range reads {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/telemedicine/admin"+p, nil))
		if w.Code != http.StatusForbidden {
			t.Errorf("GET %s: want 403 from view guard, got %d", p, w.Code)
		}
	}
	if viewHits != len(reads) || manageHits != 0 {
		t.Errorf("reads must hit only the view guard: view=%d manage=%d", viewHits, manageHits)
	}
	viewHits = 0
	for _, p := range []string{"/flag", "/unflag"} {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(http.MethodPost,
			"/api/v1/telemedicine/admin/prescriptions/22222222-2222-2222-2222-222222222222"+p, strings.NewReader(`{"reason":"abc"}`)))
		if w.Code != http.StatusForbidden {
			t.Errorf("POST %s: want 403 from manage guard, got %d", p, w.Code)
		}
	}
	if manageHits != 2 || viewHits != 0 {
		t.Errorf("mutations must hit only the manage guard: view=%d manage=%d", viewHits, manageHits)
	}
}

func TestStaticRoutesBeatIDParam(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	pass := func(c *gin.Context) { c.Next() }
	// Handlers are real; with a nil DB the summary route would panic if it were
	// captured by /:id, so reaching the 401 below proves /:id (needs a user) did not match.
	register(r.Group("/a"), NewService(nil), pass, pass)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/a/prescriptions/refills?status=weird", nil))
	if w.Code != http.StatusBadRequest {
		t.Errorf("refills route should validate status (400), got %d", w.Code)
	}
	w = httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/a/prescriptions/22222222-2222-2222-2222-222222222222", nil))
	if w.Code != http.StatusUnauthorized {
		t.Errorf("detail without an authenticated user must be 401, got %d", w.Code)
	}
}
