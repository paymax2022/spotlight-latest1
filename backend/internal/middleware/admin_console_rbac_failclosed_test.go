package middleware

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"spotlight/backend/internal/integrations"
	"spotlight/backend/internal/services"
)

// newAdminConsoleTestRouter wires RequireAdminConsoleRole behind a throwaway
// route. supabase is a client with no baseURL configured, so AuthUser fails
// fast with no network call for any test that gets far enough to invoke it;
// rbac is left nil, which is safe because every case here is rejected before
// the handler would dereference it.
func newAdminConsoleTestRouter(t *testing.T) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	supabase := integrations.NewSupabaseRestClient("", "")
	r.Use(RequireAdminConsoleRole(supabase, nil))
	r.GET("/api/v1/admin/overview-like", func(c *gin.Context) { c.Status(http.StatusOK) })
	return r
}

// AUTH-003: RequireAdminConsoleRole used to trust a client-supplied
// `X-Admin-Role` header as ground truth — any request carrying a recognised
// role NAME passed, with no proof the caller actually held it. These pin the
// corrected behaviour: a real, verified bearer token is now required before
// the role is even considered, and supabase/rbac are never dereferenced on
// this path (nil is safe here) because the missing-token check aborts first.
func TestRequireAdminConsoleRole_FailClosed(t *testing.T) {
	cases := []struct {
		name    string
		headers map[string]string
		want    int
	}{
		{
			name:    "anonymous request with no headers at all is rejected",
			headers: map[string]string{},
			want:    http.StatusUnauthorized,
		},
		{
			name:    "client-supplied X-Admin-Role alone, no bearer token, is rejected",
			headers: map[string]string{"X-Admin-Role": "SuperAdmin"},
			want:    http.StatusUnauthorized,
		},
		{
			name:    "a made-up X-Admin-Role value alone is equally rejected",
			headers: map[string]string{"X-Admin-Role": "totally-made-up-role"},
			want:    http.StatusUnauthorized,
		},
		{
			name:    "a non-bearer Authorization scheme is rejected",
			headers: map[string]string{"Authorization": "Basic dXNlcjpwYXNz", "X-Admin-Role": "SuperAdmin"},
			want:    http.StatusUnauthorized,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := newAdminConsoleTestRouter(t)

			req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/overview-like", nil)
			for k, v := range tc.headers {
				req.Header.Set(k, v)
			}
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code != tc.want {
				t.Fatalf("%s: got %d, want %d (body: %s)", tc.name, w.Code, tc.want, w.Body.String())
			}
		})
	}
}

// A well-formed bearer token that does not resolve to a real Supabase user
// must be rejected too — the gate cannot be satisfied by shape alone.
func TestRequireAdminConsoleRole_RejectsUnresolvableBearerToken(t *testing.T) {
	r := newAdminConsoleTestRouter(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/overview-like", nil)
	req.Header.Set("Authorization", "Bearer not-a-real-token")
	req.Header.Set("X-Admin-Role", "SuperAdmin")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("unresolvable bearer token: got %d, want %d (body: %s)", w.Code, http.StatusUnauthorized, w.Body.String())
	}
}

// --- AUTH-012: fail closed when GetUserStatus errors -----------------------

// fakeConsoleRBAC embeds the (large) RBACService interface as a nil value so
// only the two methods RequireAdminConsoleRole actually calls need overriding
// — any other method being invoked would nil-panic, which none of these tests
// trigger.
type fakeConsoleRBAC struct {
	services.RBACService
	roles     []string
	rolesErr  error
	status    string
	statusErr error
}

func (f *fakeConsoleRBAC) GetUserRoles(string) ([]string, error) { return f.roles, f.rolesErr }
func (f *fakeConsoleRBAC) GetUserStatus(string) (string, error)  { return f.status, f.statusErr }

// fakeAuthServer stands in for Supabase's GoTrue /auth/v1/user endpoint so a
// bearer token can resolve to a real userID without a network dependency,
// letting these tests reach the GetUserStatus/GetUserRoles checks instead of
// stopping at "missing/unresolvable bearer token" like the failclosed cases
// above.
func fakeAuthServer(t *testing.T, userID string) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/auth/v1/user" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"id": userID})
	}))
	t.Cleanup(srv.Close)
	return srv
}

func consoleRouterWithRBAC(t *testing.T, userID string, rbac services.RBACService) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	srv := fakeAuthServer(t, userID)
	supabase := integrations.NewSupabaseRestClient(srv.URL, "test-key")
	r := gin.New()
	r.Use(RequireAdminConsoleRole(supabase, rbac))
	r.GET("/api/v1/admin/overview-like", func(c *gin.Context) { c.Status(http.StatusOK) })
	return r
}

func doAuthedGet(r *gin.Engine) int {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/overview-like", nil)
	req.Header.Set("Authorization", "Bearer any-token-the-fake-server-accepts")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w.Code
}

// AUTH-012: `status, _ := rbac.GetUserStatus(userID)` used to swallow a
// lookup error entirely. GetUserStatus's own contract returns ("pending", err)
// on failure, and "pending" is not one of the blocked statuses the next line
// checks — so a transient error read as "an ordinary pending account" and fell
// through to the roles check instead of being refused outright. This pins the
// fix: an error from GetUserStatus must abort the request on its own, before
// GetUserRoles is ever consulted.
func TestRequireAdminConsoleRole_FailsClosedOnStatusLookupError(t *testing.T) {
	rbac := &fakeConsoleRBAC{
		status:    "pending", // exactly what GetUserStatus returns alongside the error
		statusErr: httptestErrStatusLookup,
		roles:     []string{"super-admin"}, // would pass if the status error were ignored
	}
	r := consoleRouterWithRBAC(t, "user-1", rbac)

	code := doAuthedGet(r)
	if code != http.StatusForbidden {
		t.Fatalf("status lookup error: got %d, want %d — the error must fail closed, not fall through as \"pending\"", code, http.StatusForbidden)
	}
}

// A clean status lookup for a real console role still succeeds — confirms the
// AUTH-012 fix didn't turn the happy path fail-closed too.
func TestRequireAdminConsoleRole_AllowsVerifiedAdminWithCleanStatus(t *testing.T) {
	rbac := &fakeConsoleRBAC{status: "active", roles: []string{"system-admin"}}
	r := consoleRouterWithRBAC(t, "user-2", rbac)

	if code := doAuthedGet(r); code != http.StatusOK {
		t.Fatalf("verified admin with clean status and a real console role: got %d, want %d", code, http.StatusOK)
	}
}

// A verified caller who simply isn't an admin (no console-eligible role) is
// still refused, independent of the AUTH-012 status-error change.
func TestRequireAdminConsoleRole_RejectsVerifiedNonAdmin(t *testing.T) {
	rbac := &fakeConsoleRBAC{status: "active", roles: []string{"customer"}}
	r := consoleRouterWithRBAC(t, "user-3", rbac)

	if code := doAuthedGet(r); code != http.StatusForbidden {
		t.Fatalf("verified non-admin role: got %d, want %d", code, http.StatusForbidden)
	}
}

var httptestErrStatusLookup = &staticErr{"platform_users lookup timed out"}

type staticErr struct{ msg string }

func (e *staticErr) Error() string { return e.msg }
