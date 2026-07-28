package middleware

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/services"
)

type mockRBAC struct{ allow bool }

func (m mockRBAC) GetUserRoles(string) ([]string, error)                        { return nil, nil }
func (m mockRBAC) GetUserScopes(string) ([]domain.UserScope, error)             { return nil, nil }
func (m mockRBAC) GetUserPermissions(string, string, string) ([]string, error)  { return nil, nil }
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
func (m mockRBAC) GetUserStatus(string) (string, error)                              { return "active", nil }
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

type errRBAC struct{}

func (e errRBAC) GetUserRoles(string) ([]string, error)                       { return nil, nil }
func (e errRBAC) GetUserScopes(string) ([]domain.UserScope, error)            { return nil, nil }
func (e errRBAC) GetUserPermissions(string, string, string) ([]string, error) { return nil, nil }
func (e errRBAC) CheckPermission(string, string, string, string) (bool, error) {
	return false, errors.New("x")
}
func (e errRBAC) ListRoles() ([]domain.Role, error)                     { return nil, nil }
func (e errRBAC) CreateRole(domain.Role) (domain.Role, error)           { return domain.Role{}, nil }
func (e errRBAC) UpdateRole(string, domain.Role) (domain.Role, error)   { return domain.Role{}, nil }
func (e errRBAC) CloneRole(string, string, string) (domain.Role, error) { return domain.Role{}, nil }
func (e errRBAC) DeleteRole(string) error                               { return nil }
func (e errRBAC) ListPermissions() ([]domain.Permission, error)         { return nil, nil }
func (e errRBAC) GetPermissionMatrix() (services.PermissionMatrix, error) {
	return services.PermissionMatrix{}, nil
}
func (e errRBAC) AssignPermissionToRole(string, string, string) error               { return nil }
func (e errRBAC) RemovePermissionFromRole(string, string) error                     { return nil }
func (e errRBAC) DeletePermission(string) error                                     { return nil }
func (e errRBAC) AssignRoleToUser(string, string, string, string, string) error     { return nil }
func (e errRBAC) RemoveRoleFromUser(string, string, string) error                   { return nil }
func (e errRBAC) GetUserStatus(string) (string, error)                              { return "active", nil }
func (e errRBAC) SuspendUser(string) error                                          { return nil }
func (e errRBAC) UnsuspendUser(string) error                                        { return nil }
func (e errRBAC) LockUser(string) error                                             { return nil }
func (e errRBAC) UnlockUser(string) error                                           { return nil }
func (e errRBAC) ListAdminUsers(domain.AdminUserFilter) ([]domain.AdminUser, error) { return nil, nil }
func (e errRBAC) GetAdminUser(string) (domain.AdminUser, error)                     { return domain.AdminUser{}, nil }
func (e errRBAC) UpdateAdminUser(string, map[string]any) (domain.AdminUser, error) {
	return domain.AdminUser{}, nil
}
func (e errRBAC) BulkAssignRoleToUsers(string, string, string, string, []string) []services.BulkOpResult {
	return nil
}
func (e errRBAC) BulkAssignRolesToUser(string, string, string, string, []string) []services.BulkOpResult {
	return nil
}
func (e errRBAC) BulkAssignPermissionsToRole(string, string, []string) []services.BulkOpResult {
	return nil
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
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/x", nil))
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
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/x", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}
