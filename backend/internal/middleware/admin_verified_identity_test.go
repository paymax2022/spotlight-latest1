package middleware

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"spotlight/backend/internal/integrations"
)

// RequireVerifiedIdentity shares resolveVerifiedIdentity with
// RequireAdminConsoleRole, so the failure-mode coverage below intentionally
// mirrors admin_console_rbac_failclosed_test.go's — the point of these tests
// is the one place the two middlewares diverge: RequireVerifiedIdentity has
// no consoleAdminRoleSlugs floor at all (ADR-057).

func newVerifiedIdentityTestRouter(t *testing.T) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	supabase := integrations.NewSupabaseRestClient("", "")
	r.Use(RequireVerifiedIdentity(supabase, nil))
	r.GET("/x", func(c *gin.Context) { c.Status(http.StatusOK) })
	return r
}

func TestRequireVerifiedIdentity_FailClosedWithNoToken(t *testing.T) {
	r := newVerifiedIdentityTestRouter(t)
	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestRequireVerifiedIdentity_RejectsUnresolvableBearerToken(t *testing.T) {
	r := newVerifiedIdentityTestRouter(t)
	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	req.Header.Set("Authorization", "Bearer not-a-real-token")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func verifiedIdentityRouterWithRBAC(t *testing.T, userID string, rbac *fakeConsoleRBAC) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	srv := fakeAuthServer(t, userID)
	supabase := integrations.NewSupabaseRestClient(srv.URL, "test-key")
	r := gin.New()
	r.Use(RequireVerifiedIdentity(supabase, rbac))
	r.GET("/x", func(c *gin.Context) {
		uid, _ := c.Get("adminUserID")
		c.JSON(http.StatusOK, gin.H{"adminUserID": uid})
	})
	return r
}

func doVerifiedIdentityGet(r *gin.Engine) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	req.Header.Set("Authorization", "Bearer any-token-the-fake-server-accepts")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

// The behavioral point of ADR-057: a real, verified caller holding a STEM
// role only (no super-admin/system-admin) — or even NO role at all — still
// passes RequireVerifiedIdentity. Whether they can do anything is entirely
// up to whatever role-specific middleware (RequireStemRoles) runs next.
func TestRequireVerifiedIdentity_AllowsVerifiedUserWithNoConsoleAdminRole(t *testing.T) {
	cases := []struct {
		name  string
		roles []string
	}{
		{"stem role only, no platform admin role", []string{"judge"}},
		{"no roles at all", []string{}},
		{"unrelated non-admin role", []string{"registered-user"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rbac := &fakeConsoleRBAC{status: "active", roles: tc.roles}
			r := verifiedIdentityRouterWithRBAC(t, "user-judge", rbac)

			w := doVerifiedIdentityGet(r)
			if w.Code != http.StatusOK {
				t.Fatalf("%s: expected 200, got %d (body: %s)", tc.name, w.Code, w.Body.String())
			}
		})
	}
}

func TestRequireVerifiedIdentity_SetsAdminUserIDOnContext(t *testing.T) {
	rbac := &fakeConsoleRBAC{status: "active", roles: []string{"judge"}}
	r := verifiedIdentityRouterWithRBAC(t, "user-judge-42", rbac)

	w := doVerifiedIdentityGet(r)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	if want := `"adminUserID":"user-judge-42"`; !strings.Contains(w.Body.String(), want) {
		t.Fatalf("expected body to contain %q, got %s", want, w.Body.String())
	}
}

// Still fails closed on a GetUserStatus lookup error, same as
// RequireAdminConsoleRole — the shared identity check is unchanged.
func TestRequireVerifiedIdentity_FailsClosedOnStatusLookupError(t *testing.T) {
	rbac := &fakeConsoleRBAC{
		status:    "pending",
		statusErr: httptestErrStatusLookup,
		roles:     []string{"judge"},
	}
	r := verifiedIdentityRouterWithRBAC(t, "user-1", rbac)

	w := doVerifiedIdentityGet(r)
	if w.Code != http.StatusForbidden {
		t.Fatalf("status lookup error: got %d, want 403", w.Code)
	}
}

// Still refuses a restricted account, same as RequireAdminConsoleRole — no
// role holds up a suspended/locked/deleted account.
func TestRequireVerifiedIdentity_RejectsRestrictedAccount(t *testing.T) {
	cases := []string{"suspended", "locked", "deleted"}
	for _, status := range cases {
		t.Run(status, func(t *testing.T) {
			rbac := &fakeConsoleRBAC{status: status, roles: []string{"super-admin"}}
			r := verifiedIdentityRouterWithRBAC(t, "user-1", rbac)

			w := doVerifiedIdentityGet(r)
			if w.Code != http.StatusForbidden {
				t.Fatalf("status=%s: got %d, want 403", status, w.Code)
			}
		})
	}
}
