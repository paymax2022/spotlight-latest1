package services

import (
	"fmt"
	"strings"

	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/repositories"
)

type PermissionMatrixRow struct {
	RoleID      string          `json:"roleId"`
	RoleName    string          `json:"roleName"`
	RoleSlug    string          `json:"roleSlug"`
	Permissions map[string]bool `json:"permissions"`
}

type PermissionMatrix struct {
	PermissionSlugs []string              `json:"permissionSlugs"`
	Rows            []PermissionMatrixRow `json:"rows"`
}

type RBACService interface {
	GetUserRoles(userID string) ([]string, error)
	GetUserScopes(userID string) ([]domain.UserScope, error)
	GetUserPermissions(userID, scopeType, scopeID string) ([]string, error)
	CheckPermission(userID, permission, scopeType, scopeID string) (bool, error)
	ListRoles() ([]domain.Role, error)
	CreateRole(role domain.Role) (domain.Role, error)
	UpdateRole(roleID string, role domain.Role) (domain.Role, error)
	CloneRole(sourceRoleID, newName, newSlug string) (domain.Role, error)
	DeleteRole(roleID string) error
	ListPermissions() ([]domain.Permission, error)
	CreatePermission(permission domain.Permission) (domain.Permission, error)
	UpdatePermission(permissionID string, permission domain.Permission) (domain.Permission, error)
	GetPermissionMatrix() (PermissionMatrix, error)
	AssignPermissionToRole(actorUserID, roleID, permissionID string) error
	RemovePermissionFromRole(roleID, permissionID string) error
	DeletePermission(permissionID string) error
	AssignRoleToUser(userID, roleID, scopeType, scopeID, assignedBy string) error
	RemoveRoleFromUser(actorUserID, userID, roleID string) error
	GetUserStatus(userID string) (string, error)
	SuspendUser(userID string) error
	UnsuspendUser(userID string) error
	LockUser(userID string) error
	UnlockUser(userID string) error
	ListAdminUsers(filter domain.AdminUserFilter) ([]domain.AdminUser, error)
	GetAdminUser(userID string) (domain.AdminUser, error)
	UpdateAdminUser(userID string, patch map[string]any) (domain.AdminUser, error)
}

type rbacService struct{ repo repositories.RBACRepository }

func NewRBACService(repo repositories.RBACRepository) RBACService { return &rbacService{repo: repo} }
func (s *rbacService) GetUserRoles(userID string) ([]string, error) {
	return s.repo.GetUserRoles(userID)
}
func (s *rbacService) GetUserScopes(userID string) ([]domain.UserScope, error) {
	return s.repo.GetUserScopes(userID)
}
func (s *rbacService) GetUserPermissions(userID, scopeType, scopeID string) ([]string, error) {
	return s.repo.GetUserPermissions(userID, scopeType, scopeID)
}
func (s *rbacService) CheckPermission(userID, permission, scopeType, scopeID string) (bool, error) {
	return s.repo.HasPermission(userID, permission, scopeType, scopeID)
}
func (s *rbacService) ListRoles() ([]domain.Role, error) { return s.repo.ListRoles() }
func (s *rbacService) CreateRole(role domain.Role) (domain.Role, error) {
	return s.repo.CreateRole(role)
}
func (s *rbacService) UpdateRole(roleID string, role domain.Role) (domain.Role, error) {
	existing, err := s.repo.GetRole(roleID)
	if err != nil {
		return domain.Role{}, err
	}
	if existing.IsSystem {
		return domain.Role{}, fmt.Errorf("system roles cannot be updated")
	}
	return s.repo.UpdateRole(roleID, role)
}
func (s *rbacService) CloneRole(sourceRoleID, newName, newSlug string) (domain.Role, error) {
	if strings.TrimSpace(newName) == "" || strings.TrimSpace(newSlug) == "" {
		return domain.Role{}, fmt.Errorf("new name and slug are required")
	}
	return s.repo.CloneRole(sourceRoleID, newName, newSlug)
}
func (s *rbacService) DeleteRole(roleID string) error {
	role, err := s.repo.GetRole(roleID)
	if err != nil {
		return err
	}
	if role.IsSystem {
		return fmt.Errorf("system roles cannot be deleted")
	}
	return s.repo.DeleteRole(roleID)
}
func (s *rbacService) ListPermissions() ([]domain.Permission, error) { return s.repo.ListPermissions() }
func (s *rbacService) CreatePermission(permission domain.Permission) (domain.Permission, error) {
	return s.repo.CreatePermission(permission)
}
func (s *rbacService) UpdatePermission(permissionID string, permission domain.Permission) (domain.Permission, error) {
	existing, err := s.repo.GetPermission(permissionID)
	if err != nil {
		return domain.Permission{}, err
	}
	if existing.IsSystem {
		return domain.Permission{}, fmt.Errorf("system permissions cannot be updated")
	}
	return s.repo.UpdatePermission(permissionID, permission)
}
func (s *rbacService) GetPermissionMatrix() (PermissionMatrix, error) {
	roles, err := s.repo.ListRoles()
	if err != nil {
		return PermissionMatrix{}, err
	}
	perms, err := s.repo.ListPermissions()
	if err != nil {
		return PermissionMatrix{}, err
	}
	pairs, err := s.repo.ListRolePermissionPairs()
	if err != nil {
		return PermissionMatrix{}, err
	}
	out := PermissionMatrix{PermissionSlugs: make([]string, 0, len(perms)), Rows: make([]PermissionMatrixRow, 0, len(roles))}
	for _, p := range perms {
		out.PermissionSlugs = append(out.PermissionSlugs, p.Slug)
	}
	for _, r := range roles {
		row := PermissionMatrixRow{RoleID: r.ID, RoleName: r.Name, RoleSlug: r.Slug, Permissions: map[string]bool{}}
		for _, p := range perms {
			row.Permissions[p.Slug] = pairs[r.ID][p.Slug]
		}
		out.Rows = append(out.Rows, row)
	}
	return out, nil
}
func (s *rbacService) AssignPermissionToRole(actorUserID, roleID, permissionID string) error {
	perm, err := s.repo.GetPermission(permissionID)
	if err != nil {
		return err
	}
	critical := map[string]struct{}{"votes.override": {}, "payments.refund": {}, "permissions.assign": {}, "roles.delete": {}, "users.roles.assign": {}, "permissions.delete": {}}
	if _, ok := critical[strings.TrimSpace(perm.Slug)]; ok {
		roles, _ := s.repo.GetUserRoles(actorUserID)
		isSuper := false
		for _, r := range roles {
			if r == "super-admin" {
				isSuper = true
				break
			}
		}
		if !isSuper {
			return fmt.Errorf("critical permissions can only be assigned by super admin")
		}
	}
	return s.repo.AssignPermissionToRole(roleID, permissionID)
}
func (s *rbacService) RemovePermissionFromRole(roleID, permissionID string) error {
	return s.repo.RemovePermissionFromRole(roleID, permissionID)
}
func (s *rbacService) DeletePermission(permissionID string) error {
	perm, err := s.repo.GetPermission(permissionID)
	if err != nil {
		return err
	}
	if perm.IsSystem {
		return fmt.Errorf("system permissions cannot be deleted")
	}
	return s.repo.DeletePermission(permissionID)
}
func (s *rbacService) AssignRoleToUser(userID, roleID, scopeType, scopeID, assignedBy string) error {
	return s.repo.AssignRoleToUser(userID, roleID, scopeType, scopeID, assignedBy)
}
func (s *rbacService) RemoveRoleFromUser(actorUserID, userID, roleID string) error {
	role, err := s.repo.GetRole(roleID)
	if err != nil {
		return err
	}
	if role.Slug == "super-admin" {
		total, err := s.repo.CountActiveSuperAdmins()
		if err != nil {
			return err
		}
		if total <= 1 {
			return fmt.Errorf("cannot remove last super admin")
		}
	}
	return s.repo.RemoveRoleFromUser(userID, roleID)
}
func (s *rbacService) GetUserStatus(userID string) (string, error) {
	return s.repo.GetUserStatus(userID)
}
func (s *rbacService) SuspendUser(userID string) error   { return s.repo.SuspendUser(userID) }
func (s *rbacService) UnsuspendUser(userID string) error { return s.repo.UnsuspendUser(userID) }
func (s *rbacService) LockUser(userID string) error      { return s.repo.LockUser(userID) }
func (s *rbacService) UnlockUser(userID string) error    { return s.repo.UnlockUser(userID) }
func (s *rbacService) ListAdminUsers(filter domain.AdminUserFilter) ([]domain.AdminUser, error) {
	return s.repo.ListAdminUsers(filter)
}
func (s *rbacService) GetAdminUser(userID string) (domain.AdminUser, error) {
	return s.repo.GetAdminUser(userID)
}
func (s *rbacService) UpdateAdminUser(userID string, patch map[string]any) (domain.AdminUser, error) {
	return s.repo.UpdateAdminUser(userID, patch)
}
