package repositories

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/integrations"
)

type RBACSupabaseRepository struct {
	client *integrations.SupabaseRestClient
}

func NewRBACSupabaseRepository(client *integrations.SupabaseRestClient) *RBACSupabaseRepository {
	return &RBACSupabaseRepository{client: client}
}

func (r *RBACSupabaseRepository) GetUserStatus(userID string) (string, error) {
	var rows []struct {
		Status string `json:"status"`
	}
	err := r.client.REST(http.MethodGet, "platform_users", map[string]string{"select": "status", "id": "eq." + userID, "limit": "1"}, nil, &rows)
	if err != nil || len(rows) == 0 {
		if err == nil {
			return "pending", nil
		}
		return "pending", err
	}
	return strings.ToLower(strings.TrimSpace(rows[0].Status)), nil
}

func (r *RBACSupabaseRepository) GetUserRoles(userID string) ([]string, error) {
	var roleRows []struct {
		Roles struct {
			Slug string `json:"slug"`
		} `json:"roles"`
	}
	err := r.client.REST(http.MethodGet, "user_roles", map[string]string{
		"select": "roles!inner(slug)", "user_id": "eq." + userID, "is_active": "eq.true",
	}, nil, &roleRows)
	if err != nil {
		return nil, err
	}
	out := make([]string, 0, len(roleRows))
	for _, row := range roleRows {
		if s := strings.TrimSpace(row.Roles.Slug); s != "" {
			out = append(out, s)
		}
	}
	return out, nil
}

func (r *RBACSupabaseRepository) GetUserScopes(userID string) ([]domain.UserScope, error) {
	var rows []struct {
		ScopeType string `json:"scope_type"`
		ScopeID   string `json:"scope_id"`
	}
	err := r.client.REST(http.MethodGet, "user_roles", map[string]string{
		"select":    "scope_type,scope_id",
		"user_id":   "eq." + userID,
		"is_active": "eq.true",
	}, nil, &rows)
	if err != nil {
		return nil, err
	}
	out := make([]domain.UserScope, 0, len(rows))
	for _, row := range rows {
		out = append(out, domain.UserScope{ScopeType: row.ScopeType, ScopeID: row.ScopeID})
	}
	return out, nil
}

func (r *RBACSupabaseRepository) GetUserPermissions(userID string, scopeType string, scopeID string) ([]string, error) {
	if scopeType == "" {
		scopeType = "global"
	}
	payload := map[string]any{"p_user_id": userID, "p_scope_type": scopeType, "p_scope_id": emptyToNilRBAC(scopeID)}
	var rows []struct {
		PermissionSlug string `json:"permission_slug"`
	}
	if err := r.client.RPC("effective_permissions", payload, &rows); err != nil {
		return nil, err
	}
	out := make([]string, 0, len(rows))
	for _, row := range rows {
		out = append(out, row.PermissionSlug)
	}
	return out, nil
}

func (r *RBACSupabaseRepository) HasPermission(userID string, permission string, scopeType string, scopeID string) (bool, error) {
	if scopeType == "" {
		scopeType = "global"
	}
	var ok bool
	err := r.client.RPC("user_has_permission", map[string]any{"p_user_id": userID, "p_permission_slug": permission, "p_scope_type": scopeType, "p_scope_id": emptyToNilRBAC(scopeID)}, &ok)
	return ok, err
}

func (r *RBACSupabaseRepository) ListRoles() ([]domain.Role, error) {
	var rows []domain.Role
	err := r.client.REST(http.MethodGet, "roles", map[string]string{"select": "id,name,slug,description,role_type,is_system_role,is_active,created_at", "order": "created_at.asc"}, nil, &rows)
	return rows, err
}

func (r *RBACSupabaseRepository) GetRole(roleID string) (domain.Role, error) {
	var rows []domain.Role
	err := r.client.REST(http.MethodGet, "roles", map[string]string{"select": "id,name,slug,description,role_type,is_system_role,is_active,created_at", "id": "eq." + roleID, "limit": "1"}, nil, &rows)
	if err != nil {
		return domain.Role{}, err
	}
	if len(rows) == 0 {
		return domain.Role{}, fmt.Errorf("role not found")
	}
	return rows[0], nil
}

func (r *RBACSupabaseRepository) CreateRole(role domain.Role) (domain.Role, error) {
	payload := map[string]any{
		"name": role.Name, "slug": role.Slug, "description": role.Description, "role_type": role.RoleType,
		"is_system_role": false, "is_active": true,
	}
	var rows []domain.Role
	err := r.client.REST(http.MethodPost, "roles", map[string]string{"select": "id,name,slug,description,role_type,is_system_role,is_active,created_at", "on_conflict": "slug"}, payload, &rows)
	if err != nil {
		return domain.Role{}, err
	}
	if len(rows) == 0 {
		return domain.Role{}, fmt.Errorf("create role failed")
	}
	return rows[0], nil
}

func (r *RBACSupabaseRepository) UpdateRole(roleID string, role domain.Role) (domain.Role, error) {
	payload := map[string]any{"name": role.Name, "description": role.Description, "role_type": role.RoleType, "is_active": role.IsActive}
	var rows []domain.Role
	err := r.client.REST(http.MethodPatch, "roles", map[string]string{"id": "eq." + roleID, "select": "id,name,slug,description,role_type,is_system_role,is_active,created_at"}, payload, &rows)
	if err != nil {
		return domain.Role{}, err
	}
	if len(rows) == 0 {
		return domain.Role{}, fmt.Errorf("role not found")
	}
	return rows[0], nil
}

func (r *RBACSupabaseRepository) CloneRole(sourceRoleID string, newName, newSlug string) (domain.Role, error) {
	source, err := r.GetRole(sourceRoleID)
	if err != nil {
		return domain.Role{}, err
	}
	created, err := r.CreateRole(domain.Role{Name: newName, Slug: newSlug, Description: source.Description, RoleType: source.RoleType})
	if err != nil {
		return domain.Role{}, err
	}
	var pairs []struct {
		PermissionID string `json:"permission_id"`
	}
	if err := r.client.REST(http.MethodGet, "role_permissions", map[string]string{"select": "permission_id", "role_id": "eq." + sourceRoleID}, nil, &pairs); err == nil {
		for _, p := range pairs {
			_ = r.AssignPermissionToRole(created.ID, p.PermissionID)
		}
	}
	return created, nil
}

func (r *RBACSupabaseRepository) DeleteRole(roleID string) error {
	return r.client.REST(http.MethodDelete, "roles", map[string]string{"id": "eq." + roleID}, nil, nil)
}

func (r *RBACSupabaseRepository) ListPermissions() ([]domain.Permission, error) {
	var rows []domain.Permission
	err := r.client.REST(http.MethodGet, "permissions", map[string]string{"select": "id,name,slug,module,resource,action,description,is_system_permission", "order": "module.asc,slug.asc"}, nil, &rows)
	return rows, err
}

func (r *RBACSupabaseRepository) CreatePermission(permission domain.Permission) (domain.Permission, error) {
	payload := map[string]any{
		"name":                 permission.Name,
		"slug":                 permission.Slug,
		"module":               permission.Module,
		"resource":             permission.Resource,
		"action":               permission.Action,
		"description":          permission.Description,
		"is_system_permission": false,
	}
	var rows []domain.Permission
	err := r.client.REST(http.MethodPost, "permissions", map[string]string{"select": "id,name,slug,module,resource,action,description,is_system_permission"}, payload, &rows)
	if err != nil {
		return domain.Permission{}, err
	}
	if len(rows) == 0 {
		return domain.Permission{}, fmt.Errorf("permission create failed")
	}
	return rows[0], nil
}

func (r *RBACSupabaseRepository) UpdatePermission(permissionID string, permission domain.Permission) (domain.Permission, error) {
	payload := map[string]any{
		"name":        permission.Name,
		"module":      permission.Module,
		"resource":    permission.Resource,
		"action":      permission.Action,
		"description": permission.Description,
	}
	var rows []domain.Permission
	err := r.client.REST(http.MethodPatch, "permissions", map[string]string{"id": "eq." + permissionID, "select": "id,name,slug,module,resource,action,description,is_system_permission"}, payload, &rows)
	if err != nil {
		return domain.Permission{}, err
	}
	if len(rows) == 0 {
		return domain.Permission{}, fmt.Errorf("permission not found")
	}
	return rows[0], nil
}

func (r *RBACSupabaseRepository) GetPermission(permissionID string) (domain.Permission, error) {
	var rows []domain.Permission
	err := r.client.REST(http.MethodGet, "permissions", map[string]string{"select": "id,name,slug,module,resource,action,description,is_system_permission", "id": "eq." + permissionID, "limit": "1"}, nil, &rows)
	if err != nil {
		return domain.Permission{}, err
	}
	if len(rows) == 0 {
		return domain.Permission{}, fmt.Errorf("permission not found")
	}
	return rows[0], nil
}

func (r *RBACSupabaseRepository) ListRolePermissionPairs() (map[string]map[string]bool, error) {
	var rows []struct {
		RoleID      string `json:"role_id"`
		Permissions struct {
			Slug string `json:"slug"`
		} `json:"permissions"`
	}
	err := r.client.REST(http.MethodGet, "role_permissions", map[string]string{"select": "role_id,permissions!inner(slug)"}, nil, &rows)
	if err != nil {
		return nil, err
	}
	out := map[string]map[string]bool{}
	for _, row := range rows {
		if _, ok := out[row.RoleID]; !ok {
			out[row.RoleID] = map[string]bool{}
		}
		if row.Permissions.Slug != "" {
			out[row.RoleID][row.Permissions.Slug] = true
		}
	}
	return out, nil
}

func (r *RBACSupabaseRepository) AssignPermissionToRole(roleID string, permissionID string) error {
	payload := map[string]any{"role_id": roleID, "permission_id": permissionID, "created_at": time.Now().UTC().Format(time.RFC3339Nano)}
	return r.client.REST(http.MethodPost, "role_permissions", map[string]string{}, payload, nil)
}

func (r *RBACSupabaseRepository) RemovePermissionFromRole(roleID string, permissionID string) error {
	return r.client.REST(http.MethodDelete, "role_permissions", map[string]string{"role_id": "eq." + roleID, "permission_id": "eq." + permissionID}, nil, nil)
}

func (r *RBACSupabaseRepository) DeletePermission(permissionID string) error {
	return r.client.REST(http.MethodDelete, "permissions", map[string]string{"id": "eq." + permissionID}, nil, nil)
}

func (r *RBACSupabaseRepository) AssignRoleToUser(userID string, roleID string, scopeType string, scopeID string, assignedBy string) error {
	if scopeType == "" {
		scopeType = "global"
	}
	payload := map[string]any{"user_id": userID, "role_id": roleID, "scope_type": scopeType, "scope_id": emptyToNilRBAC(scopeID), "assigned_by": emptyToNilRBAC(assignedBy), "is_active": true}
	return r.client.REST(http.MethodPost, "user_roles", map[string]string{}, payload, nil)
}

func (r *RBACSupabaseRepository) RemoveRoleFromUser(userID, roleID string) error {
	return r.client.REST(http.MethodDelete, "user_roles", map[string]string{"user_id": "eq." + userID, "role_id": "eq." + roleID}, nil, nil)
}

func (r *RBACSupabaseRepository) CountActiveSuperAdmins() (int, error) {
	var rows []map[string]any
	err := r.client.REST(http.MethodGet, "user_roles", map[string]string{"select": "id,roles!inner(slug)", "is_active": "eq.true", "roles.slug": "eq.super-admin", "limit": "1000"}, nil, &rows)
	if err != nil {
		return 0, err
	}
	return len(rows), nil
}

func (r *RBACSupabaseRepository) SuspendUser(userID string) error {
	return r.client.REST(http.MethodPatch, "platform_users", map[string]string{"id": "eq." + userID}, map[string]any{"status": "suspended"}, nil)
}
func (r *RBACSupabaseRepository) UnsuspendUser(userID string) error {
	return r.client.REST(http.MethodPatch, "platform_users", map[string]string{"id": "eq." + userID}, map[string]any{"status": "active"}, nil)
}
func (r *RBACSupabaseRepository) LockUser(userID string) error {
	return r.client.REST(http.MethodPatch, "platform_users", map[string]string{"id": "eq." + userID}, map[string]any{"status": "locked", "failed_login_attempts": 10}, nil)
}
func (r *RBACSupabaseRepository) UnlockUser(userID string) error {
	return r.client.REST(http.MethodPatch, "platform_users", map[string]string{"id": "eq." + userID}, map[string]any{"status": "active", "failed_login_attempts": 0, "locked_until": nil}, nil)
}

func emptyToNilRBAC(v string) any {
	if strings.TrimSpace(v) == "" {
		return nil
	}
	return v
}

func readMetadataString(m map[string]any, key string) string {
	if m == nil {
		return ""
	}
	v, ok := m[key]
	if !ok || v == nil {
		return ""
	}
	s, ok := v.(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(s)
}

func (r *RBACSupabaseRepository) ListAdminUsers(filter domain.AdminUserFilter) ([]domain.AdminUser, error) {
	if filter.Limit <= 0 || filter.Limit > 500 {
		filter.Limit = 100
	}
	q := map[string]string{
		"select": "id,first_name,last_name,email,phone,user_type,status,profile_completed,created_at,profiles!left(state,country)",
		"order":  "created_at.desc",
		"limit":  fmt.Sprintf("%d", filter.Limit),
	}
	if v := strings.TrimSpace(filter.Status); v != "" {
		q["status"] = "eq." + v
	}
	if v := strings.TrimSpace(filter.UserType); v != "" {
		q["user_type"] = "eq." + v
	}
	if v := strings.TrimSpace(filter.Search); v != "" {
		q["or"] = fmt.Sprintf("(email.ilike.*%s*,first_name.ilike.*%s*,last_name.ilike.*%s*)", v, v, v)
	}

	var rows []struct {
		ID               string `json:"id"`
		FirstName        string `json:"first_name"`
		LastName         string `json:"last_name"`
		Email            string `json:"email"`
		Phone            string `json:"phone"`
		UserType         string `json:"user_type"`
		Status           string `json:"status"`
		ProfileCompleted bool   `json:"profile_completed"`
		CreatedAt        string `json:"created_at"`
		Profiles         []struct {
			State    string         `json:"state"`
			Country  string         `json:"country"`
			Metadata map[string]any `json:"metadata"`
		} `json:"profiles"`
	}
	if err := r.client.REST(http.MethodGet, "platform_users", q, nil, &rows); err != nil {
		return nil, err
	}
	out := make([]domain.AdminUser, 0, len(rows))
	for _, row := range rows {
		state, country, programID, contestID, schoolID := "", "", "", "", ""
		if len(row.Profiles) > 0 {
			state, country = row.Profiles[0].State, row.Profiles[0].Country
			programID = readMetadataString(row.Profiles[0].Metadata, "program_id")
			contestID = readMetadataString(row.Profiles[0].Metadata, "contest_id")
			schoolID = readMetadataString(row.Profiles[0].Metadata, "school_id")
		}
		if filter.State != "" && !strings.EqualFold(strings.TrimSpace(filter.State), strings.TrimSpace(state)) {
			continue
		}
		// #23 parity: additional scoped filters (program/contest/school/country).
		if filter.Program != "" && !strings.EqualFold(strings.TrimSpace(filter.Program), strings.TrimSpace(programID)) {
			continue
		}
		if filter.Contest != "" && !strings.EqualFold(strings.TrimSpace(filter.Contest), strings.TrimSpace(contestID)) {
			continue
		}
		if filter.School != "" && !strings.EqualFold(strings.TrimSpace(filter.School), strings.TrimSpace(schoolID)) {
			continue
		}
		if filter.Country != "" && !strings.EqualFold(strings.TrimSpace(filter.Country), strings.TrimSpace(country)) {
			continue
		}
		out = append(out, domain.AdminUser{ID: row.ID, FirstName: row.FirstName, LastName: row.LastName, Email: row.Email, Phone: row.Phone, UserType: row.UserType, Status: row.Status, ProfileCompleted: row.ProfileCompleted, State: state, Country: country, ProgramID: programID, ContestID: contestID, SchoolID: schoolID, CreatedAt: row.CreatedAt})
	}
	return out, nil
}

func (r *RBACSupabaseRepository) GetAdminUser(userID string) (domain.AdminUser, error) {
	rows, err := r.ListAdminUsers(domain.AdminUserFilter{Limit: 1})
	if err != nil {
		return domain.AdminUser{}, err
	}
	for _, row := range rows {
		if row.ID == userID {
			return row, nil
		}
	}
	return domain.AdminUser{}, fmt.Errorf("user not found")
}

func (r *RBACSupabaseRepository) UpdateAdminUser(userID string, patch map[string]any) (domain.AdminUser, error) {
	allowed := map[string]bool{"first_name": true, "last_name": true, "phone": true, "user_type": true, "status": true, "profile_completed": true}
	payload := map[string]any{}
	for k, v := range patch {
		if allowed[k] {
			payload[k] = v
		}
	}
	if len(payload) == 0 {
		return domain.AdminUser{}, fmt.Errorf("no updatable fields provided")
	}
	var rows []struct {
		ID string `json:"id"`
	}
	if err := r.client.REST(http.MethodPatch, "platform_users", map[string]string{"id": "eq." + userID, "select": "id"}, payload, &rows); err != nil {
		return domain.AdminUser{}, err
	}
	if len(rows) == 0 {
		return domain.AdminUser{}, fmt.Errorf("user not found")
	}
	return r.GetAdminUser(userID)
}
