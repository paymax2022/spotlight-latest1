package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/services"
)

type rbacHandlerTestService struct{}

func (rbacHandlerTestService) GetUserRoles(string) ([]string, error)                            { return nil, nil }
func (rbacHandlerTestService) GetUserScopes(string) ([]domain.UserScope, error)                 { return nil, nil }
func (rbacHandlerTestService) GetUserPermissions(string, string, string) ([]string, error)      { return nil, nil }
func (rbacHandlerTestService) CheckPermission(string, string, string, string) (bool, error)     { return true, nil }
func (rbacHandlerTestService) ListRoles() ([]domain.Role, error)                                 { return nil, nil }
func (rbacHandlerTestService) CreateRole(domain.Role) (domain.Role, error)                       { return domain.Role{}, nil }
func (rbacHandlerTestService) UpdateRole(string, domain.Role) (domain.Role, error)               { return domain.Role{}, nil }
func (rbacHandlerTestService) CloneRole(string, string, string) (domain.Role, error)             { return domain.Role{}, nil }
func (rbacHandlerTestService) DeleteRole(string) error                                            { return nil }
func (rbacHandlerTestService) ListPermissions() ([]domain.Permission, error)                      { return nil, nil }
func (rbacHandlerTestService) CreatePermission(p domain.Permission) (domain.Permission, error)    { p.ID = "perm-created"; return p, nil }
func (rbacHandlerTestService) UpdatePermission(id string, p domain.Permission) (domain.Permission, error) {
	p.ID = id
	return p, nil
}
func (rbacHandlerTestService) GetPermissionMatrix() (services.PermissionMatrix, error)           { return services.PermissionMatrix{}, nil }
func (rbacHandlerTestService) AssignPermissionToRole(string, string, string) error               { return nil }
func (rbacHandlerTestService) RemovePermissionFromRole(string, string) error                      { return nil }
func (rbacHandlerTestService) DeletePermission(string) error                                      { return nil }
func (rbacHandlerTestService) AssignRoleToUser(string, string, string, string, string) error     { return nil }
func (rbacHandlerTestService) RemoveRoleFromUser(string, string, string) error                    { return nil }
func (rbacHandlerTestService) GetUserStatus(string) (string, error)                               { return "active", nil }
func (rbacHandlerTestService) SuspendUser(string) error                                            { return nil }
func (rbacHandlerTestService) UnsuspendUser(string) error                                          { return nil }
func (rbacHandlerTestService) LockUser(string) error                                               { return nil }
func (rbacHandlerTestService) UnlockUser(string) error                                             { return nil }
func (rbacHandlerTestService) ListAdminUsers(domain.AdminUserFilter) ([]domain.AdminUser, error) { return nil, nil }
func (rbacHandlerTestService) GetAdminUser(string) (domain.AdminUser, error)                      { return domain.AdminUser{}, nil }
func (rbacHandlerTestService) UpdateAdminUser(string, map[string]any) (domain.AdminUser, error)  { return domain.AdminUser{}, nil }
func (rbacHandlerTestService) BulkAssignRoleToUsers(string, string, string, string, []string) []services.BulkOpResult {
	return nil
}
func (rbacHandlerTestService) BulkAssignRolesToUser(string, string, string, string, []string) []services.BulkOpResult {
	return nil
}
func (rbacHandlerTestService) BulkAssignPermissionsToRole(string, string, []string) []services.BulkOpResult {
	return nil
}

type auditNoop struct{}

func (auditNoop) LogAction(string, string, string, string, string, string, map[string]any, map[string]any, string, string, string) {
}
func (auditNoop) LogLogin(string, string, string, string, string, string, map[string]any) {}
func (auditNoop) ListAuditLogs(domain.AuditFilter) ([]map[string]any, error)         { return nil, nil }
func (auditNoop) ListLoginActivity(domain.AuditFilter) ([]map[string]any, error)      { return nil, nil }
func (auditNoop) ListSecurityEvents(domain.AuditFilter) ([]map[string]any, error)     { return nil, nil }

func TestCreatePermission_Success(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := NewRBACHandler(rbacHandlerTestService{}, auditNoop{})
	r := gin.New()
	r.POST("/permissions", h.CreatePermission)

	body := `{"name":"View Users","slug":"users.view","module":"users","resource":"profile","action":"view","description":"Can view"}`
	req := httptest.NewRequest(http.MethodPost, "/permissions", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d", w.Code)
	}
	var payload map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &payload)
	if payload["success"] != true {
		t.Fatalf("expected success=true")
	}
	perm, ok := payload["permission"].(map[string]any)
	if !ok || perm["id"] == nil {
		t.Fatalf("expected permission payload with id")
	}
}

func TestUpdatePermission_Success(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := NewRBACHandler(rbacHandlerTestService{}, auditNoop{})
	r := gin.New()
	r.PATCH("/permissions/:permissionId", h.UpdatePermission)

	body := `{"name":"Edit Users","module":"users","resource":"profile","action":"update","description":"Can edit"}`
	req := httptest.NewRequest(http.MethodPatch, "/permissions/perm-1", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	var payload map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &payload)
	if payload["success"] != true {
		t.Fatalf("expected success=true")
	}
	perm, ok := payload["permission"].(map[string]any)
	if !ok || perm["id"] != "perm-1" {
		t.Fatalf("expected updated permission id=perm-1")
	}
}
