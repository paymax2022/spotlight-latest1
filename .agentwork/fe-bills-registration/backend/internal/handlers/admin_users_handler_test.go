package handlers

import (
	"testing"

	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/services"
)

type fakeRBACService struct {
	roles  []string
	scopes []domain.UserScope
}

func (f fakeRBACService) GetUserRoles(string) ([]string, error)            { return f.roles, nil }
func (f fakeRBACService) GetUserScopes(string) ([]domain.UserScope, error) { return f.scopes, nil }
func (f fakeRBACService) GetUserPermissions(string, string, string) ([]string, error) {
	return nil, nil
}
func (f fakeRBACService) CheckPermission(string, string, string, string) (bool, error) {
	return true, nil
}
func (f fakeRBACService) ListRoles() ([]domain.Role, error)           { return nil, nil }
func (f fakeRBACService) CreateRole(domain.Role) (domain.Role, error) { return domain.Role{}, nil }
func (f fakeRBACService) UpdateRole(string, domain.Role) (domain.Role, error) {
	return domain.Role{}, nil
}
func (f fakeRBACService) CloneRole(string, string, string) (domain.Role, error) {
	return domain.Role{}, nil
}
func (f fakeRBACService) DeleteRole(string) error                       { return nil }
func (f fakeRBACService) ListPermissions() ([]domain.Permission, error) { return nil, nil }
func (f fakeRBACService) CreatePermission(domain.Permission) (domain.Permission, error) {
	return domain.Permission{}, nil
}
func (f fakeRBACService) UpdatePermission(string, domain.Permission) (domain.Permission, error) {
	return domain.Permission{}, nil
}
func (f fakeRBACService) GetPermissionMatrix() (services.PermissionMatrix, error) {
	return services.PermissionMatrix{}, nil
}
func (f fakeRBACService) AssignPermissionToRole(string, string, string) error           { return nil }
func (f fakeRBACService) RemovePermissionFromRole(string, string) error                 { return nil }
func (f fakeRBACService) DeletePermission(string) error                                 { return nil }
func (f fakeRBACService) AssignRoleToUser(string, string, string, string, string) error { return nil }
func (f fakeRBACService) RemoveRoleFromUser(string, string, string) error               { return nil }
func (f fakeRBACService) GetUserStatus(string) (string, error)                          { return "active", nil }
func (f fakeRBACService) SuspendUser(string) error                                      { return nil }
func (f fakeRBACService) UnsuspendUser(string) error                                    { return nil }
func (f fakeRBACService) LockUser(string) error                                         { return nil }
func (f fakeRBACService) UnlockUser(string) error                                       { return nil }
func (f fakeRBACService) ListAdminUsers(domain.AdminUserFilter) ([]domain.AdminUser, error) {
	return nil, nil
}
func (f fakeRBACService) GetAdminUser(string) (domain.AdminUser, error) {
	return domain.AdminUser{}, nil
}
func (f fakeRBACService) UpdateAdminUser(string, map[string]any) (domain.AdminUser, error) {
	return domain.AdminUser{}, nil
}

type fakeAuditService struct{}

func (fakeAuditService) LogAction(string, string, string, string, string, string, map[string]any, map[string]any, string, string, string) {
}
func (fakeAuditService) LogLogin(string, string, string, string, string, string, map[string]any) {}
func (fakeAuditService) ListAuditLogs(domain.AuditFilter) ([]map[string]any, error)              { return nil, nil }
func (fakeAuditService) ListLoginActivity(domain.AuditFilter) ([]map[string]any, error) {
	return nil, nil
}
func (fakeAuditService) ListSecurityEvents(domain.AuditFilter) ([]map[string]any, error) {
	return nil, nil
}

func TestCanAccessUser_StateScope(t *testing.T) {
	h := NewAdminUsersHandler(fakeRBACService{roles: []string{"state-coordinator"}, scopes: []domain.UserScope{{ScopeType: "state", ScopeID: "Lagos"}}}, fakeAuditService{})
	if !h.canAccessUser("actor", domain.AdminUser{State: "lagos"}) {
		t.Fatalf("expected state scope allow")
	}
	if h.canAccessUser("actor", domain.AdminUser{State: "Abuja"}) {
		t.Fatalf("expected state scope deny")
	}
}

func TestCanAccessUser_ProgramContestSchoolScopes(t *testing.T) {
	h := NewAdminUsersHandler(fakeRBACService{roles: []string{"program-manager"}, scopes: []domain.UserScope{{ScopeType: "program", ScopeID: "music"}, {ScopeType: "contest", ScopeID: "contest-1"}, {ScopeType: "school", ScopeID: "school-1"}}}, fakeAuditService{})
	if !h.canAccessUser("actor", domain.AdminUser{ProgramID: "music"}) {
		t.Fatalf("expected program allow")
	}
	if !h.canAccessUser("actor", domain.AdminUser{ContestID: "contest-1"}) {
		t.Fatalf("expected contest allow")
	}
	if !h.canAccessUser("actor", domain.AdminUser{SchoolID: "school-1"}) {
		t.Fatalf("expected school allow")
	}
	if h.canAccessUser("actor", domain.AdminUser{ProgramID: "film", ContestID: "contest-2", SchoolID: "school-2"}) {
		t.Fatalf("expected deny")
	}
}

func TestCanAccessUser_SuperAdminBypass(t *testing.T) {
	h := NewAdminUsersHandler(fakeRBACService{roles: []string{"super-admin"}}, fakeAuditService{})
	if !h.canAccessUser("actor", domain.AdminUser{}) {
		t.Fatalf("expected super-admin allow")
	}
}
