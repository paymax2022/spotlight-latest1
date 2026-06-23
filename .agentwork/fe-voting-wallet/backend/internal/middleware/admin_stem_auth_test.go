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
	r.Use(RequireAdmin("secret-key"))
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
	admin.Use(RequireAdmin("secret-key"))

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
	admin.Use(RequireAdmin("secret-key"))

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
	admin.Use(RequireAdmin("secret-key"))

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

