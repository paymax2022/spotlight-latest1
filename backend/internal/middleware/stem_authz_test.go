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
	r.Use(RequireStemRoles("ADMIN"))
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
	r.Use(RequireStemRoles("ADMIN", "SUPER_ADMIN"))
	r.GET("/x", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"ok": true}) })

	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	req.Header.Set("x-stem-role", "admin")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

// AUTH-020: RequireStemRoles must never be usable as a standalone auth gate.
// A request carrying a perfectly valid x-stem-role header, but with no real
// verified admin identity on the context (i.e. RequireAdminConsoleRole or
// equivalent never ran), must be refused — the header alone proves nothing.
func TestRequireStemRoles_FailsClosedWithoutVerifiedAdmin(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	// Deliberately NOT using fakeVerifiedAdmin here.
	r.Use(RequireStemRoles("ADMIN", "SUPER_ADMIN"))
	r.GET("/x", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"ok": true}) })

	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	req.Header.Set("x-stem-role", "admin")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 (no verified admin identity on context), got %d", w.Code)
	}
}

// When no roles are configured (len(allowed) == 0), RequireStemRoles is a
// no-op regardless of auth context — this is pre-existing behavior (used
// where no STEM gating is desired) and must not regress with the fail-closed
// check added above.
func TestRequireStemRoles_NoRolesConfigured_NoopEvenWithoutVerifiedAdmin(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(RequireStemRoles())
	r.GET("/x", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"ok": true}) })

	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}
