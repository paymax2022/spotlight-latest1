package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"spotlight/backend/internal/integrations"
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
