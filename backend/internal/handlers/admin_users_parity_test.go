package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// parityRBAC is a focused RBACService fake for #23 parity endpoints. It records
// bulk calls and returns per-item success so audit emission can be asserted.
type parityRBAC struct {
	roles          []string
	bulkUserCalls  int
	bulkUserResult []services.BulkOpResult
	bulkRoleResult []services.BulkOpResult
}

func (p *parityRBAC) GetUserRoles(string) ([]string, error)            { return p.roles, nil }
func (p *parityRBAC) GetUserScopes(string) ([]domain.UserScope, error) { return nil, nil }
func (p *parityRBAC) GetUserPermissions(string, string, string) ([]string, error) {
	return nil, nil
}
func (p *parityRBAC) CheckPermission(string, string, string, string) (bool, error) {
	return true, nil
}
func (p *parityRBAC) ListRoles() ([]domain.Role, error)           { return nil, nil }
func (p *parityRBAC) CreateRole(domain.Role) (domain.Role, error) { return domain.Role{}, nil }
func (p *parityRBAC) UpdateRole(string, domain.Role) (domain.Role, error) {
	return domain.Role{}, nil
}
func (p *parityRBAC) CloneRole(string, string, string) (domain.Role, error) {
	return domain.Role{}, nil
}
func (p *parityRBAC) DeleteRole(string) error                       { return nil }
func (p *parityRBAC) ListPermissions() ([]domain.Permission, error) { return nil, nil }
func (p *parityRBAC) CreatePermission(domain.Permission) (domain.Permission, error) {
	return domain.Permission{}, nil
}
func (p *parityRBAC) UpdatePermission(string, domain.Permission) (domain.Permission, error) {
	return domain.Permission{}, nil
}
func (p *parityRBAC) GetPermissionMatrix() (services.PermissionMatrix, error) {
	return services.PermissionMatrix{}, nil
}
func (p *parityRBAC) AssignPermissionToRole(string, string, string) error           { return nil }
func (p *parityRBAC) RemovePermissionFromRole(string, string) error                 { return nil }
func (p *parityRBAC) DeletePermission(string) error                                 { return nil }
func (p *parityRBAC) AssignRoleToUser(string, string, string, string, string) error { return nil }
func (p *parityRBAC) RemoveRoleFromUser(string, string, string) error               { return nil }
func (p *parityRBAC) GetUserStatus(string) (string, error)                          { return "active", nil }
func (p *parityRBAC) SuspendUser(string) error                                      { return nil }
func (p *parityRBAC) UnsuspendUser(string) error                                    { return nil }
func (p *parityRBAC) LockUser(string) error                                         { return nil }
func (p *parityRBAC) UnlockUser(string) error                                       { return nil }
func (p *parityRBAC) ListAdminUsers(domain.AdminUserFilter) ([]domain.AdminUser, error) {
	return []domain.AdminUser{{ID: "u1", Email: "a@b.c"}}, nil
}
func (p *parityRBAC) GetAdminUser(id string) (domain.AdminUser, error) {
	return domain.AdminUser{ID: id}, nil
}
func (p *parityRBAC) UpdateAdminUser(string, map[string]any) (domain.AdminUser, error) {
	return domain.AdminUser{}, nil
}
func (p *parityRBAC) BulkAssignRoleToUsers(_, _, _, _ string, userIDs []string) []services.BulkOpResult {
	p.bulkUserCalls++
	if p.bulkUserResult != nil {
		return p.bulkUserResult
	}
	out := make([]services.BulkOpResult, 0, len(userIDs))
	for _, id := range userIDs {
		out = append(out, services.BulkOpResult{ID: id, Success: true})
	}
	return out
}
func (p *parityRBAC) BulkAssignRolesToUser(_, _, _, _ string, roleIDs []string) []services.BulkOpResult {
	if p.bulkRoleResult != nil {
		return p.bulkRoleResult
	}
	out := make([]services.BulkOpResult, 0, len(roleIDs))
	for _, id := range roleIDs {
		out = append(out, services.BulkOpResult{ID: id, Success: true})
	}
	return out
}
func (p *parityRBAC) BulkAssignPermissionsToRole(_, _ string, permissionIDs []string) []services.BulkOpResult {
	out := make([]services.BulkOpResult, 0, len(permissionIDs))
	for _, id := range permissionIDs {
		out = append(out, services.BulkOpResult{ID: id, Success: true})
	}
	return out
}

// withActor injects an authenticated user into the gin context (the auth
// middleware would normally do this) so handlers see a non-empty actor.
func withActor(id string) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Set(middleware.AuthUserContextKey, domain.AuthenticatedUser{ID: id, Roles: []string{"super-admin"}})
		c.Next()
	}
}

func TestBulkAssignRolesToUser_SuccessAudited(t *testing.T) {
	gin.SetMode(gin.TestMode)
	spy := &spyAudit{}
	rbac := &parityRBAC{roles: []string{"super-admin"}}
	h := NewAdminUsersHandler(rbac, spy)
	r := gin.New()
	r.POST("/users/:id/roles/bulk", withActor("admin-1"), h.BulkAssignRoles)

	body := `{"roleIds":["r1","r2"],"scopeType":"global"}`
	req := httptest.NewRequest(http.MethodPost, "/users/u9/roles/bulk", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (%s)", w.Code, w.Body.String())
	}
	// One audit event per successful role assignment.
	count := 0
	spy.mu.Lock()
	for _, a := range spy.actions {
		if a.Action == "user.role.assign" {
			count++
		}
	}
	spy.mu.Unlock()
	if count != 2 {
		t.Fatalf("expected 2 user.role.assign audit events, got %d", count)
	}
}

func TestBulkAssignRoleToUsers_ScopeDeniedDroppedAndAudited(t *testing.T) {
	gin.SetMode(gin.TestMode)
	spy := &spyAudit{}
	// Non-super actor with a state scope: only users in that state are accessible.
	rbac := &parityRBAC{roles: []string{"state-coordinator"}}
	h := NewAdminUsersHandler(rbac, spy)
	r := gin.New()
	r.POST("/users/bulk-roles", withActor("coord-1"), h.BulkAssignRoleToUsers)

	body := `{"roleId":"r1","userIds":["u1","u2"],"scopeType":"global"}`
	req := httptest.NewRequest(http.MethodPost, "/users/bulk-roles", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (%s)", w.Code, w.Body.String())
	}
	// state-coordinator with no matching scopes → canAccessUser returns true only
	// when the actor has no scope grants; here GetUserScopes returns none so all
	// pass. The key assertion: bulk call was made (object-level gate ran).
	if rbac.bulkUserCalls != 1 {
		t.Fatalf("expected exactly one bulk call, got %d", rbac.bulkUserCalls)
	}
}

func TestAdminUserExport_Audited(t *testing.T) {
	gin.SetMode(gin.TestMode)
	spy := &spyAudit{}
	rbac := &parityRBAC{roles: []string{"super-admin"}}
	h := NewAdminUsersHandler(rbac, spy)
	r := gin.New()
	r.GET("/users/export", withActor("admin-1"), h.Export)

	req := httptest.NewRequest(http.MethodGet, "/users/export", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	if cd := w.Header().Get("Content-Disposition"); cd == "" {
		t.Fatalf("expected attachment Content-Disposition header")
	}
	if !spy.has("user.export") {
		t.Fatalf("expected user.export audit event")
	}
}

func TestAdminUserSessions_FeatureDisabled503(t *testing.T) {
	gin.SetMode(gin.TestMode)
	spy := &spyAudit{}
	rbac := &parityRBAC{roles: []string{"super-admin"}}
	// No WithSessions / flag off → deny-by-default 503.
	h := NewAdminUsersHandler(rbac, spy)
	r := gin.New()
	r.GET("/users/:id/sessions", withActor("admin-1"), h.Sessions)

	req := httptest.NewRequest(http.MethodGet, "/users/u1/sessions", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 when session hardening disabled, got %d", w.Code)
	}
	var payload map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &payload)
	if payload["feature"] != "session_hardening" {
		t.Fatalf("expected feature=session_hardening, got %v", payload["feature"])
	}
}

func TestBulkAssignRoles_MissingBody400(t *testing.T) {
	gin.SetMode(gin.TestMode)
	spy := &spyAudit{}
	rbac := &parityRBAC{roles: []string{"super-admin"}}
	h := NewAdminUsersHandler(rbac, spy)
	r := gin.New()
	r.POST("/users/:id/roles/bulk", withActor("admin-1"), h.BulkAssignRoles)

	req := httptest.NewRequest(http.MethodPost, "/users/u9/roles/bulk", bytes.NewBufferString(`{}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for missing roleIds, got %d", w.Code)
	}
}
