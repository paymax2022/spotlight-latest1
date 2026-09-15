package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"spotlight/backend/internal/integrations"
)

func TestRequireAdmin_MissingAPIKey(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(RequireAdmin("secret-key", "production"))
	r.GET("/admin/stem/overview", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"ok": true}) })

	req := httptest.NewRequest(http.MethodGet, "/admin/stem/overview", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

// stemTestRouter mirrors production router.go's ADR-057 wiring exactly:
// RequireAdmin (shared API key) + RequireVerifiedIdentity (real bearer-token
// identity, no console-admin role floor) + RequireStemRoles (the actual
// per-route STEM role check) — using the real Supabase/RBAC-shaped code
// paths (a fake GoTrue server + fakeConsoleRBAC), not a shortcut stand-in, so
// these tests exercise the real production chain end to end.
func stemTestRouter(t *testing.T, userID string, rbac *fakeConsoleRBAC, allowedRoles ...string) (*gin.Engine, string) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	srv := fakeAuthServer(t, userID)
	supabase := integrations.NewSupabaseRestClient(srv.URL, "test-key")

	r := gin.New()
	admin := r.Group("/admin")
	admin.Use(RequireAdmin("secret-key", "production"))
	admin.Use(RequireVerifiedIdentity(supabase, rbac))

	stem := admin.Group("/stem")
	stem.Use(RequireStemRoles(rbac, allowedRoles...))
	stem.GET("/submissions", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"ok": true}) })
	stem.PATCH("/submissions/abc/status", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"ok": true}) })

	return r, "Bearer any-token-the-fake-server-accepts"
}

func doStemRequest(r *gin.Engine, method, path, bearer string) int {
	req := httptest.NewRequest(method, path, nil)
	req.Header.Set("x-admin-api-key", "secret-key")
	req.Header.Set("Authorization", bearer)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w.Code
}

func TestRequireAdmin_AndStemRole_MissingStemRole(t *testing.T) {
	// Verified identity, but their real RBAC roles hold none of the STEM
	// roles this group allows.
	rbac := &fakeConsoleRBAC{status: "active", roles: []string{"registered-user"}}
	r, bearer := stemTestRouter(t, "user-1", rbac, "SUPER_ADMIN", "ADMIN", "OPERATIONS_MANAGER", "CONTEST_MANAGER", "JUDGE")

	if code := doStemRequest(r, http.MethodGet, "/admin/stem/submissions", bearer); code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", code)
	}
}

func TestRequireAdmin_AndStemRole_DisallowedStemRole(t *testing.T) {
	// A real 'judge' is a valid STEM role, just not one the manage group allows.
	rbac := &fakeConsoleRBAC{status: "active", roles: []string{"judge"}}
	r, bearer := stemTestRouter(t, "user-judge", rbac, "SUPER_ADMIN", "ADMIN", "OPERATIONS_MANAGER", "CONTEST_MANAGER")

	if code := doStemRequest(r, http.MethodPatch, "/admin/stem/submissions/abc/status", bearer); code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", code)
	}
}

func TestRequireAdmin_AndStemRole_AllowedManageRole(t *testing.T) {
	rbac := &fakeConsoleRBAC{status: "active", roles: []string{"contest-manager"}}
	r, bearer := stemTestRouter(t, "user-cm", rbac, "SUPER_ADMIN", "ADMIN", "OPERATIONS_MANAGER", "CONTEST_MANAGER")

	if code := doStemRequest(r, http.MethodPatch, "/admin/stem/submissions/abc/status", bearer); code != http.StatusOK {
		t.Fatalf("expected 200, got %d", code)
	}
}

// ADR-057: the whole point of this fix. A real person holding ONLY 'judge' —
// neither 'super-admin' nor 'system-admin' — used to be refused at the outer
// RequireAdminConsoleRole gate before RequireStemRoles ever ran, no matter
// what STEM roles it allowed (see ADR-056 point 6). RequireVerifiedIdentity
// has no such floor, so this caller now reaches a stemRead-shaped route on
// their real 'judge' role alone.
func TestRequireAdmin_AndStemRole_JudgeOnlyReachesStemReadWithoutPlatformAdminRole(t *testing.T) {
	rbac := &fakeConsoleRBAC{status: "active", roles: []string{"judge"}}
	r, bearer := stemTestRouter(t, "user-judge-only", rbac,
		"SUPER_ADMIN", "ADMIN", "OPERATIONS_MANAGER", "CONTEST_MANAGER", "SCHOOL_ADMIN", "TEACHER_COACH", "JUDGE", "MENTOR", "SPONSOR")

	if code := doStemRequest(r, http.MethodGet, "/admin/stem/submissions", bearer); code != http.StatusOK {
		t.Fatalf("judge-only caller should reach stemRead: expected 200, got %d", code)
	}
}

// Same caller, same real role, but against the narrower stemManage allow-list
// (no JUDGE) — still correctly refused. Confirms ADR-057 widened WHO can
// reach the STEM routes without widening WHAT any given STEM role can do.
func TestRequireAdmin_AndStemRole_JudgeOnlyStillDeniedStemManage(t *testing.T) {
	rbac := &fakeConsoleRBAC{status: "active", roles: []string{"judge"}}
	r, bearer := stemTestRouter(t, "user-judge-only", rbac, "SUPER_ADMIN", "ADMIN", "OPERATIONS_MANAGER", "CONTEST_MANAGER")

	if code := doStemRequest(r, http.MethodPatch, "/admin/stem/submissions/abc/status", bearer); code != http.StatusForbidden {
		t.Fatalf("judge-only caller must still be denied stemManage: expected 403, got %d", code)
	}
}

// A caller with NO recognized role at all (not even a STEM one) is refused —
// RequireVerifiedIdentity removes the platform-admin floor, it doesn't make
// the route unauthenticated.
func TestRequireAdmin_AndStemRole_NoRoleAtAllIsRefused(t *testing.T) {
	rbac := &fakeConsoleRBAC{status: "active", roles: []string{"registered-user"}}
	r, bearer := stemTestRouter(t, "user-none", rbac,
		"SUPER_ADMIN", "ADMIN", "OPERATIONS_MANAGER", "CONTEST_MANAGER", "SCHOOL_ADMIN", "TEACHER_COACH", "JUDGE", "MENTOR", "SPONSOR")

	if code := doStemRequest(r, http.MethodGet, "/admin/stem/submissions", bearer); code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", code)
	}
}

// AUTH-020: the shared x-admin-api-key alone (RequireAdmin) is NOT a verified
// identity — it's a gate satisfied by any caller who holds the key, including
// the admin-proxy's own unconditional attachment of it. Without
// RequireVerifiedIdentity (or equivalent) also running, a request carrying a
// valid API key must still be refused before any RBAC role lookup happens —
// a nil rbac here proves the lookup is never attempted.
func TestRequireAdmin_AndStemRole_APIKeyAloneIsNotVerifiedAdmin(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()

	admin := r.Group("/admin")
	admin.Use(RequireAdmin("secret-key", "production"))
	// Deliberately no RequireVerifiedIdentity / RequireAdminConsoleRole here.

	stemManage := admin.Group("/stem")
	stemManage.Use(RequireStemRoles(nil, "SUPER_ADMIN", "ADMIN", "OPERATIONS_MANAGER", "CONTEST_MANAGER"))
	stemManage.PATCH("/submissions/abc/status", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"ok": true}) })

	req := httptest.NewRequest(http.MethodPatch, "/admin/stem/submissions/abc/status", nil)
	req.Header.Set("x-admin-api-key", "secret-key")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 (API key alone must not satisfy the stem role check), got %d", w.Code)
	}
}
