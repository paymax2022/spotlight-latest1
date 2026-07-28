package services

import (
	"errors"
	"testing"

	"spotlight/backend/internal/domain"
)

type stubRBACRepo struct {
	role             domain.Role
	permission       domain.Permission
	roles            []string
	superAdminCount  int
	deleteRoleCalled bool
	assignCalled     bool
	removeCalled     bool
	createPermCalled bool
	updatePermCalled bool
}

func (s *stubRBACRepo) GetUserStatus(string) (string, error)                        { return "active", nil }
func (s *stubRBACRepo) GetUserRoles(string) ([]string, error)                       { return s.roles, nil }
func (s *stubRBACRepo) GetUserScopes(string) ([]domain.UserScope, error)            { return nil, nil }
func (s *stubRBACRepo) GetUserPermissions(string, string, string) ([]string, error) { return nil, nil }
func (s *stubRBACRepo) HasPermission(string, string, string, string) (bool, error)  { return false, nil }
func (s *stubRBACRepo) ListRoles() ([]domain.Role, error) {
	return []domain.Role{{ID: "r1", Name: "A", Slug: "a"}}, nil
}
func (s *stubRBACRepo) CreateRole(domain.Role) (domain.Role, error) { return domain.Role{}, nil }
func (s *stubRBACRepo) UpdateRole(string, domain.Role) (domain.Role, error) {
	return domain.Role{}, nil
}
func (s *stubRBACRepo) CloneRole(string, string, string) (domain.Role, error) {
	return domain.Role{}, nil
}
func (s *stubRBACRepo) DeleteRole(string) error             { s.deleteRoleCalled = true; return nil }
func (s *stubRBACRepo) GetRole(string) (domain.Role, error) { return s.role, nil }
func (s *stubRBACRepo) ListPermissions() ([]domain.Permission, error) {
	return []domain.Permission{{Slug: "x"}}, nil
}
func (s *stubRBACRepo) CreatePermission(domain.Permission) (domain.Permission, error) {
	s.createPermCalled = true
	return domain.Permission{ID: "p-new", Name: "New", Slug: "new.slug"}, nil
}
func (s *stubRBACRepo) UpdatePermission(string, domain.Permission) (domain.Permission, error) {
	s.updatePermCalled = true
	return domain.Permission{ID: "p-upd", Name: "Updated", Slug: "updated.slug"}, nil
}
func (s *stubRBACRepo) GetPermission(string) (domain.Permission, error) { return s.permission, nil }
func (s *stubRBACRepo) ListRolePermissionPairs() (map[string]map[string]bool, error) {
	return map[string]map[string]bool{"r1": {"x": true}}, nil
}
func (s *stubRBACRepo) AssignPermissionToRole(string, string) error {
	s.assignCalled = true
	return nil
}
func (s *stubRBACRepo) RemovePermissionFromRole(string, string) error                 { return nil }
func (s *stubRBACRepo) DeletePermission(string) error                                 { return nil }
func (s *stubRBACRepo) AssignRoleToUser(string, string, string, string, string) error { return nil }
func (s *stubRBACRepo) RemoveRoleFromUser(string, string) error                       { s.removeCalled = true; return nil }
func (s *stubRBACRepo) CountActiveSuperAdmins() (int, error)                          { return s.superAdminCount, nil }
func (s *stubRBACRepo) SuspendUser(string) error                                      { return nil }
func (s *stubRBACRepo) UnsuspendUser(string) error                                    { return nil }
func (s *stubRBACRepo) LockUser(string) error                                         { return nil }
func (s *stubRBACRepo) UnlockUser(string) error                                       { return nil }
func (s *stubRBACRepo) ListAdminUsers(domain.AdminUserFilter) ([]domain.AdminUser, error) {
	return nil, nil
}
func (s *stubRBACRepo) GetAdminUser(string) (domain.AdminUser, error) { return domain.AdminUser{}, nil }
func (s *stubRBACRepo) UpdateAdminUser(string, map[string]any) (domain.AdminUser, error) {
	return domain.AdminUser{}, nil
}

func TestDeleteSystemRoleDenied(t *testing.T) {
	repo := &stubRBACRepo{role: domain.Role{IsSystem: true}}
	svc := NewRBACService(repo)
	if err := svc.DeleteRole("r1"); err == nil {
		t.Fatalf("expected error for system role delete")
	}
	if repo.deleteRoleCalled {
		t.Fatalf("delete should not be called")
	}
}

func TestDeleteSystemPermissionDenied(t *testing.T) {
	repo := &stubRBACRepo{permission: domain.Permission{IsSystem: true}}
	svc := NewRBACService(repo)
	if err := svc.DeletePermission("p1"); err == nil {
		t.Fatalf("expected error for system permission delete")
	}
}

func TestCriticalPermissionRequiresSuperAdmin(t *testing.T) {
	repo := &stubRBACRepo{permission: domain.Permission{Slug: "votes.override"}, roles: []string{"system-admin"}}
	svc := NewRBACService(repo)
	if err := svc.AssignPermissionToRole("u1", "r1", "p1"); err == nil {
		t.Fatalf("expected error for non-super admin")
	}
	if repo.assignCalled {
		t.Fatalf("assign should not be called")
	}
}

func TestCannotRemoveLastSuperAdmin(t *testing.T) {
	repo := &stubRBACRepo{role: domain.Role{Slug: "super-admin"}, superAdminCount: 1}
	svc := NewRBACService(repo)
	if err := svc.RemoveRoleFromUser("actor", "u1", "r1"); err == nil {
		t.Fatalf("expected last super admin protection error")
	}
	if repo.removeCalled {
		t.Fatalf("remove should not be called")
	}
}

func TestAllowRemoveSuperAdminWhenMoreThanOne(t *testing.T) {
	repo := &stubRBACRepo{role: domain.Role{Slug: "super-admin"}, superAdminCount: 2}
	svc := NewRBACService(repo)
	if err := svc.RemoveRoleFromUser("actor", "u1", "r1"); err != nil {
		t.Fatalf("expected removal allowed, got %v", err)
	}
	if !repo.removeCalled {
		t.Fatalf("remove should be called")
	}
}

func TestNonCriticalPermissionCanBeAssignedByAdmin(t *testing.T) {
	repo := &stubRBACRepo{permission: domain.Permission{Slug: "contest.update"}, roles: []string{"system-admin"}}
	svc := NewRBACService(repo)
	if err := svc.AssignPermissionToRole("u1", "r1", "p1"); err != nil {
		t.Fatalf("expected assignment to pass, got %v", err)
	}
	if !repo.assignCalled {
		t.Fatalf("assign should be called")
	}
}

func TestBulkAssignPermissionsEnforcesCriticalGate(t *testing.T) {
	// A non-super admin bulk-assigning a critical permission must fail that item
	// (the per-item AssignPermissionToRole gate is preserved through the bulk path).
	repo := &stubRBACRepo{permission: domain.Permission{Slug: "votes.override"}, roles: []string{"system-admin"}}
	svc := NewRBACService(repo)
	results := svc.BulkAssignPermissionsToRole("u1", "r1", []string{"p1", "p2"})
	if len(results) != 2 {
		t.Fatalf("expected 2 results, got %d", len(results))
	}
	for _, res := range results {
		if res.Success {
			t.Fatalf("expected critical-permission assignment to be denied for non-super admin")
		}
	}
	if repo.assignCalled {
		t.Fatalf("repo assign should not be called when gate denies")
	}
}

func TestBulkAssignRolesToUserPassesThrough(t *testing.T) {
	repo := &stubRBACRepo{}
	svc := NewRBACService(repo)
	results := svc.BulkAssignRolesToUser("u1", "global", "", "actor", []string{"r1", "r2", ""})
	// Empty role ids are skipped; two valid grants succeed.
	if len(results) != 2 {
		t.Fatalf("expected 2 results (empty skipped), got %d", len(results))
	}
	for _, res := range results {
		if !res.Success {
			t.Fatalf("expected success, got error %q", res.Error)
		}
	}
}

func TestGetPermissionMatrix(t *testing.T) {
	repo := &stubRBACRepo{}
	svc := NewRBACService(repo)
	matrix, err := svc.GetPermissionMatrix()
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if len(matrix.Rows) == 0 || len(matrix.PermissionSlugs) == 0 {
		t.Fatalf("expected matrix data")
	}
}

func TestCreatePermissionPassesThrough(t *testing.T) {
	repo := &stubRBACRepo{}
	svc := NewRBACService(repo)
	_, err := svc.CreatePermission(domain.Permission{Name: "A", Slug: "a.b.c", Module: "a", Resource: "b", Action: "c"})
	if err != nil {
		t.Fatalf("expected create permission success: %v", err)
	}
	if !repo.createPermCalled {
		t.Fatalf("expected repository create permission call")
	}
}

func TestUpdateSystemPermissionDenied(t *testing.T) {
	repo := &stubRBACRepo{permission: domain.Permission{IsSystem: true}}
	svc := NewRBACService(repo)
	_, err := svc.UpdatePermission("p1", domain.Permission{Name: "x"})
	if err == nil {
		t.Fatalf("expected error for system permission update")
	}
	if repo.updatePermCalled {
		t.Fatalf("repo update should not be called")
	}
}

func TestUpdateNonSystemPermissionAllowed(t *testing.T) {
	repo := &stubRBACRepo{permission: domain.Permission{IsSystem: false}}
	svc := NewRBACService(repo)
	_, err := svc.UpdatePermission("p1", domain.Permission{Name: "x"})
	if err != nil {
		t.Fatalf("expected update success: %v", err)
	}
	if !repo.updatePermCalled {
		t.Fatalf("expected repo update call")
	}
}

type stubRBACRepoErr struct{}

func (s *stubRBACRepoErr) GetUserStatus(string) (string, error)  { return "", errors.New("x") }
func (s *stubRBACRepoErr) GetUserRoles(string) ([]string, error) { return nil, errors.New("x") }
func (s *stubRBACRepoErr) GetUserScopes(string) ([]domain.UserScope, error) {
	return nil, errors.New("x")
}
func (s *stubRBACRepoErr) GetUserPermissions(string, string, string) ([]string, error) {
	return nil, errors.New("x")
}
func (s *stubRBACRepoErr) HasPermission(string, string, string, string) (bool, error) {
	return false, errors.New("x")
}
func (s *stubRBACRepoErr) ListRoles() ([]domain.Role, error) { return nil, errors.New("x") }
func (s *stubRBACRepoErr) CreateRole(domain.Role) (domain.Role, error) {
	return domain.Role{}, errors.New("x")
}
func (s *stubRBACRepoErr) UpdateRole(string, domain.Role) (domain.Role, error) {
	return domain.Role{}, errors.New("x")
}
func (s *stubRBACRepoErr) CloneRole(string, string, string) (domain.Role, error) {
	return domain.Role{}, errors.New("x")
}
func (s *stubRBACRepoErr) DeleteRole(string) error                       { return errors.New("x") }
func (s *stubRBACRepoErr) GetRole(string) (domain.Role, error)           { return domain.Role{}, errors.New("x") }
func (s *stubRBACRepoErr) ListPermissions() ([]domain.Permission, error) { return nil, errors.New("x") }
func (s *stubRBACRepoErr) CreatePermission(domain.Permission) (domain.Permission, error) {
	return domain.Permission{}, errors.New("x")
}
func (s *stubRBACRepoErr) UpdatePermission(string, domain.Permission) (domain.Permission, error) {
	return domain.Permission{}, errors.New("x")
}
func (s *stubRBACRepoErr) GetPermission(string) (domain.Permission, error) {
	return domain.Permission{}, errors.New("x")
}
func (s *stubRBACRepoErr) ListRolePermissionPairs() (map[string]map[string]bool, error) {
	return nil, errors.New("x")
}
func (s *stubRBACRepoErr) AssignPermissionToRole(string, string) error   { return errors.New("x") }
func (s *stubRBACRepoErr) RemovePermissionFromRole(string, string) error { return errors.New("x") }
func (s *stubRBACRepoErr) DeletePermission(string) error                 { return errors.New("x") }
func (s *stubRBACRepoErr) AssignRoleToUser(string, string, string, string, string) error {
	return errors.New("x")
}
func (s *stubRBACRepoErr) RemoveRoleFromUser(string, string) error { return errors.New("x") }
func (s *stubRBACRepoErr) CountActiveSuperAdmins() (int, error)    { return 0, errors.New("x") }
func (s *stubRBACRepoErr) SuspendUser(string) error                { return errors.New("x") }
func (s *stubRBACRepoErr) UnsuspendUser(string) error              { return errors.New("x") }
func (s *stubRBACRepoErr) LockUser(string) error                   { return errors.New("x") }
func (s *stubRBACRepoErr) UnlockUser(string) error                 { return errors.New("x") }
func (s *stubRBACRepoErr) ListAdminUsers(domain.AdminUserFilter) ([]domain.AdminUser, error) {
	return nil, errors.New("x")
}
func (s *stubRBACRepoErr) GetAdminUser(string) (domain.AdminUser, error) {
	return domain.AdminUser{}, errors.New("x")
}
func (s *stubRBACRepoErr) UpdateAdminUser(string, map[string]any) (domain.AdminUser, error) {
	return domain.AdminUser{}, errors.New("x")
}
