package app

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/handlers"
)

const modulesPath = "/api/admin/users/11111111-1111-1111-1111-111111111111/modules"

func routeExists(r *gin.Engine, method, path string) bool {
	for _, ri := range r.Routes() {
		if ri.Method == method && ri.Path == path {
			return true
		}
	}
	return false
}

func TestAdminUserModulesRoute_AbsentWhenPoolNil(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	h := handlers.NewAdminUsersHandler(nil, nil)
	registerAdminUserModulesRoutes(r, nil, nil, h, nil)
	if routeExists(r, http.MethodGet, "/api/admin/users/:id/modules") {
		t.Fatal("route must not be registered without a pool")
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, modulesPath, nil))
	if w.Code != http.StatusNotFound {
		t.Fatalf("got %d want 404", w.Code)
	}
}

func TestAdminUserModulesRoute_PresentUnauthenticated401(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	h := handlers.NewAdminUsersHandler(nil, nil)
	// A non-nil pool pointer is enough for registration; it is never dereferenced
	// because auth rejects the request first. pgxpool.Pool zero value is unused.
	registerAdminUserModulesRoutes(r, nil, nil, h, &pgxpool.Pool{})
	if !routeExists(r, http.MethodGet, "/api/admin/users/:id/modules") {
		t.Fatal("route must be registered when a pool exists")
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, modulesPath, nil))
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("got %d want 401", w.Code)
	}
}

// Flag-off 404 is asserted at handler level: RequireAuthContext needs a live
// Supabase auth backend, so an authenticated actor cannot be faked here.
func TestAdminUserModulesRoute_FlagOffHandler404(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	h := handlers.NewAdminUsersHandler(nil, nil).WithModules(&pgxpool.Pool{}, false)
	r.GET("/api/admin/users/:id/modules", h.Modules)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, modulesPath, nil))
	if w.Code != http.StatusNotFound {
		t.Fatalf("got %d want 404", w.Code)
	}
}

func TestAdminUserModulesRoute_DoesNotShadowUserGet(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	h := handlers.NewAdminUsersHandler(nil, nil)
	r.GET("/api/admin/users/:id", func(c *gin.Context) { c.String(http.StatusOK, "user") })
	registerAdminUserModulesRoutes(r, nil, nil, h, &pgxpool.Pool{})
	if !routeExists(r, http.MethodGet, "/api/admin/users/:id") || !routeExists(r, http.MethodGet, "/api/admin/users/:id/modules") {
		t.Fatal("both routes must resolve")
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/admin/users/abc", nil))
	if w.Code != http.StatusOK || w.Body.String() != "user" {
		t.Fatalf("GET /users/:id shadowed: %d %q", w.Code, w.Body.String())
	}
}
