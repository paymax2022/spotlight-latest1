package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
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

func TestRequireAdmin_AndStemRole_MissingStemRole(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()

	admin := r.Group("/admin")
	admin.Use(RequireAdmin("secret-key", "production"))
	// Mirrors production router.go: adminGroup requires RequireAdminConsoleRole
	// (a real, verified admin identity) BEFORE the stem sub-groups ever run.
	// fakeVerifiedAdmin stands in for that without needing Supabase/RBAC wiring.
	admin.Use(fakeVerifiedAdmin)

	stemRead := admin.Group("/stem")
	stemRead.Use(RequireStemRoles("SUPER_ADMIN", "ADMIN", "OPERATIONS_MANAGER", "CONTEST_MANAGER", "JUDGE"))
	stemRead.GET("/submissions", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"ok": true}) })

	req := httptest.NewRequest(http.MethodGet, "/admin/stem/submissions", nil)
	req.Header.Set("x-admin-api-key", "secret-key")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", w.Code)
	}
}

func TestRequireAdmin_AndStemRole_DisallowedStemRole(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()

	admin := r.Group("/admin")
	admin.Use(RequireAdmin("secret-key", "production"))
	admin.Use(fakeVerifiedAdmin)

	stemManage := admin.Group("/stem")
	stemManage.Use(RequireStemRoles("SUPER_ADMIN", "ADMIN", "OPERATIONS_MANAGER", "CONTEST_MANAGER"))
	stemManage.PATCH("/submissions/abc/status", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"ok": true}) })

	req := httptest.NewRequest(http.MethodPatch, "/admin/stem/submissions/abc/status", nil)
	req.Header.Set("x-admin-api-key", "secret-key")
	req.Header.Set("x-stem-role", "judge")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", w.Code)
	}
}

func TestRequireAdmin_AndStemRole_AllowedManageRole(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()

	admin := r.Group("/admin")
	admin.Use(RequireAdmin("secret-key", "production"))
	admin.Use(fakeVerifiedAdmin)

	stemManage := admin.Group("/stem")
	stemManage.Use(RequireStemRoles("SUPER_ADMIN", "ADMIN", "OPERATIONS_MANAGER", "CONTEST_MANAGER"))
	stemManage.PATCH("/submissions/abc/status", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"ok": true}) })

	req := httptest.NewRequest(http.MethodPatch, "/admin/stem/submissions/abc/status", nil)
	req.Header.Set("x-admin-api-key", "secret-key")
	req.Header.Set("x-stem-role", "contest_manager")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

// AUTH-020: the shared x-admin-api-key alone (RequireAdmin) is NOT a verified
// admin identity — it's a gate satisfied by any caller who holds the key,
// including the admin-proxy's own unconditional attachment of it. Without
// RequireAdminConsoleRole (or equivalent) also running, a request carrying a
// valid API key AND a self-declared x-stem-role must still be refused. This
// is the exact shape production router.go avoids by nesting stemRead/
// stemManage under adminGroup (which requires RequireAdminConsoleRole first);
// this test guards against that nesting ever being accidentally dropped.
func TestRequireAdmin_AndStemRole_APIKeyAloneIsNotVerifiedAdmin(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()

	admin := r.Group("/admin")
	admin.Use(RequireAdmin("secret-key", "production"))
	// Deliberately no fakeVerifiedAdmin / RequireAdminConsoleRole here.

	stemManage := admin.Group("/stem")
	stemManage.Use(RequireStemRoles("SUPER_ADMIN", "ADMIN", "OPERATIONS_MANAGER", "CONTEST_MANAGER"))
	stemManage.PATCH("/submissions/abc/status", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"ok": true}) })

	req := httptest.NewRequest(http.MethodPatch, "/admin/stem/submissions/abc/status", nil)
	req.Header.Set("x-admin-api-key", "secret-key")
	req.Header.Set("x-stem-role", "super_admin")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 (API key alone must not satisfy the stem role check), got %d", w.Code)
	}
}
