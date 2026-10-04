package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/services"

	"github.com/gin-gonic/gin"
)

type mockRBAC struct{ allow bool }

func (m mockRBAC) GetUserRoles(context.Context, string) ([]string, error) { return nil, nil }
func (m mockRBAC) GetUserScopes(string) ([]domain.UserScope, error)       { return nil, nil }
func (m mockRBAC) GetUserPermissions(context.Context, string, string, string) ([]string, error) {
	return nil, nil
}
func (m mockRBAC) CheckPermission(string, string, string, string) (bool, error) { return m.allow, nil }
func (m mockRBAC) ListRoles() ([]domain.Role, error)                            { return nil, nil }
func (m mockRBAC) CreateRole(domain.Role) (domain.Role, error)                  { return domain.Role{}, nil }
func (m mockRBAC) UpdateRole(string, domain.Role) (domain.Role, error)          { return domain.Role{}, nil }
func (m mockRBAC) CloneRole(string, string, string) (domain.Role, error)        { return domain.Role{}, nil }
func (m mockRBAC) DeleteRole(string) error                                      { return nil }
func (m mockRBAC) ListPermissions() ([]domain.Permission, error)                { return nil, nil }
func (m mockRBAC) CreatePermission(domain.Permission) (domain.Permission, error) {
	return domain.Permission{}, nil
}
func (m mockRBAC) UpdatePermission(string, domain.Permission) (domain.Permission, error) {
	return domain.Permission{}, nil
}
func (m mockRBAC) GetPermissionMatrix() (services.PermissionMatrix, error) {
	return services.PermissionMatrix{}, nil
}
func (m mockRBAC) AssignPermissionToRole(string, string, string) error               { return nil }
func (m mockRBAC) RemovePermissionFromRole(string, string) error                     { return nil }
func (m mockRBAC) DeletePermission(string) error                                     { return nil }
func (m mockRBAC) AssignRoleToUser(string, string, string, string, string) error     { return nil }
func (m mockRBAC) RemoveRoleFromUser(string, string, string) error                   { return nil }
func (m mockRBAC) GetUserStatus(context.Context, string) (string, error)             { return "active", nil }
func (m mockRBAC) SuspendUser(string) error                                          { return nil }
func (m mockRBAC) UnsuspendUser(string) error                                        { return nil }
func (m mockRBAC) LockUser(string) error                                             { return nil }
func (m mockRBAC) UnlockUser(string) error                                           { return nil }
func (m mockRBAC) ListAdminUsers(domain.AdminUserFilter) ([]domain.AdminUser, error) { return nil, nil }
func (m mockRBAC) GetAdminUser(string) (domain.AdminUser, error)                     { return domain.AdminUser{}, nil }
func (m mockRBAC) UpdateAdminUser(string, map[string]any) (domain.AdminUser, error) {
	return domain.AdminUser{}, nil
}
func (m mockRBAC) BulkAssignRoleToUsers(string, string, string, string, []string) []services.BulkOpResult {
	return nil
}
func (m mockRBAC) BulkAssignRolesToUser(string, string, string, string, []string) []services.BulkOpResult {
	return nil
}
func (m mockRBAC) BulkAssignPermissionsToRole(string, string, []string) []services.BulkOpResult {
	return nil
}

type countingRBAC struct {
	mockRBAC

	checkCalls int
}

func (m *countingRBAC) CheckPermission(userID, permission, scopeType, scopeID string) (bool, error) {
	m.checkCalls++
	return m.allow, nil
}

func TestRequirePermissionDeniedByDefault(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set(AuthUserContextKey, domain.AuthenticatedUser{ID: "u1"})
		c.Next()
	})
	r.GET("/x", RequirePermission(mockRBAC{allow: false}, "contest.create"), func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/x", nil))
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", w.Code)
	}
}

func TestRequirePermissionAllowsWhenGranted(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set(AuthUserContextKey, domain.AuthenticatedUser{ID: "u1"})
		c.Next()
	})
	r.GET("/x", RequirePermission(mockRBAC{allow: true}, "contest.create"), func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/x", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestRequirePermissionReusesRequestPermissions(t *testing.T) {
	gin.SetMode(gin.TestMode)
	rbac := &countingRBAC{allow: false}
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set(AuthUserContextKey, domain.AuthenticatedUser{
			ID:          "u1",
			Roles:       []string{"contest-manager"},
			Permissions: []string{"contest.create"},
		})
		c.Next()
	})
	r.GET("/x", RequirePermission(rbac, "contest.create"), func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/x", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	if rbac.checkCalls != 0 {
		t.Fatalf("expected no CheckPermission RPC on cache hit, got %d", rbac.checkCalls)
	}
}

func TestRequirePermissionSuperAdminSkipsRPC(t *testing.T) {
	gin.SetMode(gin.TestMode)
	rbac := &countingRBAC{allow: false}
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set(AuthUserContextKey, domain.AuthenticatedUser{
			ID:    "u1",
			Roles: []string{"super-admin"},
		})
		c.Next()
	})
	r.GET("/x", RequirePermission(rbac, "any.permission"), func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/x", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for super-admin, got %d", w.Code)
	}
	if rbac.checkCalls != 0 {
		t.Fatalf("expected no CheckPermission RPC for super-admin, got %d", rbac.checkCalls)
	}
}

func TestRequirePermissionFallsBackToRPCOnMiss(t *testing.T) {
	gin.SetMode(gin.TestMode)
	rbac := &countingRBAC{allow: true}
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set(AuthUserContextKey, domain.AuthenticatedUser{ID: "u1"})
		c.Next()
	})
	r.GET("/x", RequirePermission(rbac, "contest.create"), func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/x", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 via RPC fallback, got %d", w.Code)
	}
	if rbac.checkCalls != 1 {
		t.Fatalf("expected 1 CheckPermission RPC on cache miss, got %d", rbac.checkCalls)
	}
}
