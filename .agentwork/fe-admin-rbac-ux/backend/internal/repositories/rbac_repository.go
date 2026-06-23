package repositories

import "spotlight/backend/internal/domain"

type RBACRepository interface {
	GetUserStatus(userID string) (string, error)
	GetUserRoles(userID string) ([]string, error)
	GetUserScopes(userID string) ([]domain.UserScope, error)
	GetUserPermissions(userID string, scopeType string, scopeID string) ([]string, error)
	HasPermission(userID string, permission string, scopeType string, scopeID string) (bool, error)
	ListRoles() ([]domain.Role, error)
	CreateRole(role domain.Role) (domain.Role, error)
	UpdateRole(roleID string, role domain.Role) (domain.Role, error)
	CloneRole(sourceRoleID string, newName, newSlug string) (domain.Role, error)
	DeleteRole(roleID string) error
	GetRole(roleID string) (domain.Role, error)
	ListPermissions() ([]domain.Permission, error)
	CreatePermission(permission domain.Permission) (domain.Permission, error)
	UpdatePermission(permissionID string, permission domain.Permission) (domain.Permission, error)
	GetPermission(permissionID string) (domain.Permission, error)
	ListRolePermissionPairs() (map[string]map[string]bool, error)
	AssignPermissionToRole(roleID string, permissionID string) error
	RemovePermissionFromRole(roleID string, permissionID string) error
	DeletePermission(permissionID string) error
	AssignRoleToUser(userID string, roleID string, scopeType string, scopeID string, assignedBy string) error
	RemoveRoleFromUser(userID, roleID string) error
	CountActiveSuperAdmins() (int, error)
	SuspendUser(userID string) error
	UnsuspendUser(userID string) error
	LockUser(userID string) error
	UnlockUser(userID string) error
	ListAdminUsers(filter domain.AdminUserFilter) ([]domain.AdminUser, error)
	GetAdminUser(userID string) (domain.AdminUser, error)
	UpdateAdminUser(userID string, patch map[string]any) (domain.AdminUser, error)
}
