package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

// fakeVerifiedAdmin stands in for RequireAdminConsoleRole having already run
// and resolved a real, cryptographically-verified admin identity: it sets only
// the context key RequireStemRoles checks for, without any of the real
// bearer-token/Supabase/RBAC machinery — keeping these unit tests focused on
// RequireStemRoles's own logic.
func fakeVerifiedAdmin(c *gin.Context) {
	c.Set("adminUserID", "test-admin-user")
	c.Next()
}

func TestRequireStemRoles_MissingRole(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(fakeVerifiedAdmin)
	rbac := &fakeConsoleRBAC{roles: []string{"registered-user"}}
	r.Use(RequireStemRoles(rbac, "ADMIN"))
	r.GET("/x", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"ok": true}) })

	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", w.Code)
	}
}

func TestRequireStemRoles_AllowedRole(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(fakeVerifiedAdmin)
	// 'system-admin' is aliased to "ADMIN" by normalizeStemRoleSlug — see
	// stem_authz.go's doc comment.
	rbac := &fakeConsoleRBAC{roles: []string{"system-admin"}}
	r.Use(RequireStemRoles(rbac, "ADMIN", "SUPER_ADMIN"))
	r.GET("/x", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"ok": true}) })

	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

// AUTH-020: RequireStemRoles must never be usable as a standalone auth gate.
// A request with no real verified admin identity on the context (i.e.
// RequireAdminConsoleRole or equivalent never ran) must be refused before the
// RBAC role lookup is even attempted — a nil rbac proves that.
func TestRequireStemRoles_FailsClosedWithoutVerifiedAdmin(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	// Deliberately NOT using fakeVerifiedAdmin here.
	r.Use(RequireStemRoles(nil, "ADMIN", "SUPER_ADMIN"))
	r.GET("/x", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"ok": true}) })

	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 (no verified admin identity on context), got %d", w.Code)
	}
}

// AUTH-020 follow-up: a client-supplied x-stem-role header must no longer be
// trusted for anything — a verified admin whose REAL roles don't include the
// header's claimed role must still be refused.
func TestRequireStemRoles_HeaderIsNoLongerTrusted(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(fakeVerifiedAdmin)
	rbac := &fakeConsoleRBAC{roles: []string{"judge"}}
	r.Use(RequireStemRoles(rbac, "SUPER_ADMIN"))
	r.GET("/x", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"ok": true}) })

	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	req.Header.Set("x-stem-role", "super_admin") // claims a role the caller does not really hold
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 (header must not override the real RBAC role), got %d", w.Code)
	}
}

// A GetUserRoles lookup failure must fail closed, not fall through as if the
// caller held no roles were somehow still authorized.
func TestRequireStemRoles_FailsClosedOnRoleLookupError(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(fakeVerifiedAdmin)
	rbac := &fakeConsoleRBAC{roles: []string{"super-admin"}, rolesErr: httptestErrStatusLookup}
	r.Use(RequireStemRoles(rbac, "SUPER_ADMIN"))
	r.GET("/x", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"ok": true}) })

	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Fatalf("role lookup error: expected 403, got %d", w.Code)
	}
}

// The five STEM roles seeded in 20270205000000_stem_admin_rbac_roles.sql
// (plus the two pre-existing ones) must each resolve through the real RBAC
// lookup to the STEM role name router.go allow-lists use.
func TestRequireStemRoles_RealRoleSlugsResolve(t *testing.T) {
	cases := []struct {
		slug string
		want string
	}{
		{"super-admin", "SUPER_ADMIN"},
		{"system-admin", "ADMIN"},
		{"operations-manager", "OPERATIONS_MANAGER"},
		{"contest-manager", "CONTEST_MANAGER"},
		{"school-admin", "SCHOOL_ADMIN"},
		{"teacher-coach", "TEACHER_COACH"},
		{"judge", "JUDGE"},
		{"mentor", "MENTOR"},
		{"sponsor", "SPONSOR"},
	}
	for _, tc := range cases {
		t.Run(tc.slug, func(t *testing.T) {
			gin.SetMode(gin.TestMode)
			r := gin.New()
			r.Use(fakeVerifiedAdmin)
			rbac := &fakeConsoleRBAC{roles: []string{tc.slug}}
			r.Use(RequireStemRoles(rbac, tc.want))
			r.GET("/x", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"ok": true}) })

			req := httptest.NewRequest(http.MethodGet, "/x", nil)
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code != http.StatusOK {
				t.Fatalf("slug %q -> %q: expected 200, got %d", tc.slug, tc.want, w.Code)
			}
		})
	}
}

// When no roles are configured (len(allowed) == 0), RequireStemRoles is a
// no-op regardless of auth context or rbac — this is pre-existing behavior
// (used where no STEM gating is desired) and must not regress. A nil rbac
// proves the lookup is never attempted.
func TestRequireStemRoles_NoRolesConfigured_NoopEvenWithoutVerifiedAdmin(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(RequireStemRoles(nil))
	r.GET("/x", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"ok": true}) })

	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}
