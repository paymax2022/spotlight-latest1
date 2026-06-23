package handlers

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

type RBACHandler struct {
	svc   services.RBACService
	audit services.AuditService
}

func NewRBACHandler(svc services.RBACService, audit services.AuditService) *RBACHandler {
	return &RBACHandler{svc: svc, audit: audit}
}

func (h *RBACHandler) Me(c *gin.Context) {
	u, ok := middleware.GetAuthenticatedUser(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": "unauthenticated"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "user": u})
}

func (h *RBACHandler) ListRoles(c *gin.Context) {
	rows, err := h.svc.ListRoles()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "roles": rows})
}

func (h *RBACHandler) CreateRole(c *gin.Context) {
	var in domain.Role
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid payload"})
		return
	}
	in.Slug = strings.TrimSpace(in.Slug)
	if in.Slug == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "role slug is required"})
		return
	}
	created, err := h.svc.CreateRole(in)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}
	if actor, ok := middleware.GetAuthenticatedUser(c); ok {
		h.audit.LogAction(actor.ID, "", "role.create", "rbac", "role", created.ID, nil, map[string]any{"slug": created.Slug}, c.ClientIP(), c.Request.UserAgent(), "high")
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "role": created})
}

func (h *RBACHandler) UpdateRole(c *gin.Context) {
	roleID := c.Param("id")
	actor, _ := middleware.GetAuthenticatedUser(c)
	var in domain.Role
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid payload"})
		return
	}
	updated, err := h.svc.UpdateRole(roleID, in)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}
	h.audit.LogAction(actor.ID, "", "role.update", "rbac", "role", roleID, nil, map[string]any{"name": updated.Name, "isActive": updated.IsActive}, c.ClientIP(), c.Request.UserAgent(), "high")
	c.JSON(http.StatusOK, gin.H{"success": true, "role": updated})
}

func (h *RBACHandler) CloneRole(c *gin.Context) {
	sourceRoleID := c.Param("id")
	actor, _ := middleware.GetAuthenticatedUser(c)
	var in struct {
		Name string `json:"name"`
		Slug string `json:"slug"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || strings.TrimSpace(in.Name) == "" || strings.TrimSpace(in.Slug) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "name and slug are required"})
		return
	}
	cloned, err := h.svc.CloneRole(sourceRoleID, in.Name, in.Slug)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}
	h.audit.LogAction(actor.ID, "", "role.clone", "rbac", "role", cloned.ID, nil, map[string]any{"sourceRoleId": sourceRoleID, "slug": cloned.Slug}, c.ClientIP(), c.Request.UserAgent(), "high")
	c.JSON(http.StatusCreated, gin.H{"success": true, "role": cloned})
}

func (h *RBACHandler) ListPermissions(c *gin.Context) {
	rows, err := h.svc.ListPermissions()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "permissions": rows})
}

func (h *RBACHandler) CreatePermission(c *gin.Context) {
	actor, _ := middleware.GetAuthenticatedUser(c)
	var in domain.Permission
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid payload"})
		return
	}
	if strings.TrimSpace(in.Name) == "" || strings.TrimSpace(in.Slug) == "" || strings.TrimSpace(in.Module) == "" || strings.TrimSpace(in.Resource) == "" || strings.TrimSpace(in.Action) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "name, slug, module, resource, action are required"})
		return
	}
	created, err := h.svc.CreatePermission(in)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}
	h.audit.LogAction(actor.ID, "", "permission.create", "rbac", "permission", created.ID, nil, map[string]any{"slug": created.Slug}, c.ClientIP(), c.Request.UserAgent(), "high")
	c.JSON(http.StatusCreated, gin.H{"success": true, "permission": created})
}

func (h *RBACHandler) UpdatePermission(c *gin.Context) {
	permissionID := c.Param("permissionId")
	actor, _ := middleware.GetAuthenticatedUser(c)
	var in domain.Permission
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid payload"})
		return
	}
	updated, err := h.svc.UpdatePermission(permissionID, in)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}
	h.audit.LogAction(actor.ID, "", "permission.update", "rbac", "permission", permissionID, nil, map[string]any{"name": updated.Name}, c.ClientIP(), c.Request.UserAgent(), "high")
	c.JSON(http.StatusOK, gin.H{"success": true, "permission": updated})
}

func (h *RBACHandler) PermissionMatrix(c *gin.Context) {
	matrix, err := h.svc.GetPermissionMatrix()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "matrix": matrix})
}

func (h *RBACHandler) AssignPermissionToRole(c *gin.Context) {
	roleID := c.Param("id")
	actor, _ := middleware.GetAuthenticatedUser(c)
	var in struct {
		PermissionID string `json:"permissionId"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || strings.TrimSpace(in.PermissionID) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "permissionId is required"})
		return
	}
	if err := h.svc.AssignPermissionToRole(actor.ID, roleID, in.PermissionID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}
	if actor.ID != "" {
		h.audit.LogAction(actor.ID, "", "role.permission.assign", "rbac", "role_permission", roleID, nil, map[string]any{"permissionId": in.PermissionID}, c.ClientIP(), c.Request.UserAgent(), "high")
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// BulkAssignPermissionsToRole assigns MANY permissions to ONE role in a single
// call. Permission-gated upstream (permissions.assign); critical-permission and
// super-admin checks are enforced per-item inside the service. Each successful
// assignment is audited.
func (h *RBACHandler) BulkAssignPermissionsToRole(c *gin.Context) {
	roleID := c.Param("id")
	actor, _ := middleware.GetAuthenticatedUser(c)
	var in struct {
		PermissionIDs []string `json:"permissionIds"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || len(in.PermissionIDs) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "permissionIds is required"})
		return
	}
	results := h.svc.BulkAssignPermissionsToRole(actor.ID, roleID, in.PermissionIDs)
	for _, res := range results {
		if res.Success {
			h.audit.LogAction(actor.ID, "", "role.permission.assign", "rbac", "role_permission", roleID, nil, map[string]any{"permissionId": res.ID, "bulk": true}, c.ClientIP(), c.Request.UserAgent(), "high")
		}
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "results": results})
}

func (h *RBACHandler) AssignRoleToUser(c *gin.Context) {
	userID := c.Param("id")
	actor, _ := middleware.GetAuthenticatedUser(c)
	var in struct {
		RoleID    string `json:"roleId"`
		ScopeType string `json:"scopeType"`
		ScopeID   string `json:"scopeId"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || strings.TrimSpace(in.RoleID) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "roleId is required"})
		return
	}
	if err := h.svc.AssignRoleToUser(userID, in.RoleID, in.ScopeType, in.ScopeID, actor.ID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}
	h.audit.LogAction(actor.ID, userID, "user.role.assign", "rbac", "user_role", userID, nil, map[string]any{"roleId": in.RoleID, "scopeType": in.ScopeType, "scopeId": in.ScopeID}, c.ClientIP(), c.Request.UserAgent(), "high")
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func (h *RBACHandler) DeleteRole(c *gin.Context) {
	roleID := c.Param("id")
	actor, _ := middleware.GetAuthenticatedUser(c)
	if err := h.svc.DeleteRole(roleID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}
	h.audit.LogAction(actor.ID, "", "role.delete", "rbac", "role", roleID, nil, nil, c.ClientIP(), c.Request.UserAgent(), "critical")
	c.JSON(http.StatusOK, gin.H{"success": true})
}
func (h *RBACHandler) DeletePermission(c *gin.Context) {
	permissionID := c.Param("permissionId")
	actor, _ := middleware.GetAuthenticatedUser(c)
	if err := h.svc.DeletePermission(permissionID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}
	h.audit.LogAction(actor.ID, "", "permission.delete", "rbac", "permission", permissionID, nil, nil, c.ClientIP(), c.Request.UserAgent(), "critical")
	c.JSON(http.StatusOK, gin.H{"success": true})
}
func (h *RBACHandler) RemovePermissionFromRole(c *gin.Context) {
	roleID := c.Param("id")
	permissionID := c.Param("permissionId")
	actor, _ := middleware.GetAuthenticatedUser(c)
	if err := h.svc.RemovePermissionFromRole(roleID, permissionID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}
	h.audit.LogAction(actor.ID, "", "role.permission.remove", "rbac", "role_permission", roleID, nil, map[string]any{"permissionId": permissionID}, c.ClientIP(), c.Request.UserAgent(), "high")
	c.JSON(http.StatusOK, gin.H{"success": true})
}
func (h *RBACHandler) RemoveRoleFromUser(c *gin.Context) {
	userID := c.Param("id")
	roleID := c.Param("roleId")
	actor, _ := middleware.GetAuthenticatedUser(c)
	if err := h.svc.RemoveRoleFromUser(actor.ID, userID, roleID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}
	h.audit.LogAction(actor.ID, userID, "user.role.remove", "rbac", "user_role", userID, nil, map[string]any{"roleId": roleID}, c.ClientIP(), c.Request.UserAgent(), "critical")
	c.JSON(http.StatusOK, gin.H{"success": true})
}
func (h *RBACHandler) SuspendUser(c *gin.Context) {
	userID := c.Param("id")
	actor, _ := middleware.GetAuthenticatedUser(c)
	if err := h.svc.SuspendUser(userID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}
	h.audit.LogAction(actor.ID, userID, "user.suspend", "users", "user", userID, nil, map[string]any{"status": "suspended"}, c.ClientIP(), c.Request.UserAgent(), "high")
	c.JSON(http.StatusOK, gin.H{"success": true})
}
func (h *RBACHandler) UnsuspendUser(c *gin.Context) {
	userID := c.Param("id")
	actor, _ := middleware.GetAuthenticatedUser(c)
	if err := h.svc.UnsuspendUser(userID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}
	h.audit.LogAction(actor.ID, userID, "user.unsuspend", "users", "user", userID, nil, map[string]any{"status": "active"}, c.ClientIP(), c.Request.UserAgent(), "high")
	c.JSON(http.StatusOK, gin.H{"success": true})
}
func (h *RBACHandler) LockUser(c *gin.Context) {
	userID := c.Param("id")
	actor, _ := middleware.GetAuthenticatedUser(c)
	if err := h.svc.LockUser(userID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}
	h.audit.LogAction(actor.ID, userID, "user.lock", "users", "user", userID, nil, map[string]any{"status": "locked"}, c.ClientIP(), c.Request.UserAgent(), "high")
	c.JSON(http.StatusOK, gin.H{"success": true})
}
func (h *RBACHandler) UnlockUser(c *gin.Context) {
	userID := c.Param("id")
	actor, _ := middleware.GetAuthenticatedUser(c)
	if err := h.svc.UnlockUser(userID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}
	h.audit.LogAction(actor.ID, userID, "user.unlock", "users", "user", userID, nil, map[string]any{"status": "active"}, c.ClientIP(), c.Request.UserAgent(), "high")
	c.JSON(http.StatusOK, gin.H{"success": true})
}
