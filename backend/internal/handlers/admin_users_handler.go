package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

type AdminUsersHandler struct {
	svc   services.RBACService
	audit services.AuditService
	// sessions is OPTIONAL — used only for the read-only per-user session/security
	// view. It composes the #19 session surface without duplicating its routes.
	// sessionsEnabled mirrors FEATURE_SESSION_HARDENING_ENABLED (deny/503 when off).
	sessions        services.SessionService
	sessionsEnabled bool
}

func NewAdminUsersHandler(svc services.RBACService, audit services.AuditService) *AdminUsersHandler {
	return &AdminUsersHandler{svc: svc, audit: audit}
}

// WithSessions wires the session service for the per-user session view. Additive;
// returns the same handler for router chaining. When the feature flag is off the
// view endpoint returns 503 (matching the rest of the session surface).
func (h *AdminUsersHandler) WithSessions(sessions services.SessionService, enabled bool) *AdminUsersHandler {
	h.sessions = sessions
	h.sessionsEnabled = enabled
	return h
}

func filterFromQuery(c *gin.Context) domain.AdminUserFilter {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "100"))
	return domain.AdminUserFilter{
		Role:     c.Query("role"),
		UserType: c.Query("userType"),
		Status:   c.Query("status"),
		State:    c.Query("state"),
		Program:  c.Query("program"),
		Contest:  c.Query("contest"),
		School:   c.Query("school"),
		Country:  c.Query("country"),
		Search:   c.Query("search"),
		Limit:    limit,
	}
}

func (h *AdminUsersHandler) List(c *gin.Context) {
	rows, err := h.svc.ListAdminUsers(filterFromQuery(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	actor, _ := middleware.GetAuthenticatedUser(c)
	filtered := h.applyScopeFilter(actor.ID, rows)
	c.JSON(http.StatusOK, gin.H{"success": true, "users": filtered})
}

// Export returns the scoped admin-user list as a downloadable JSON attachment.
// Same authz/scope rules as List; the act of exporting is audited (PII export).
func (h *AdminUsersHandler) Export(c *gin.Context) {
	rows, err := h.svc.ListAdminUsers(filterFromQuery(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	actor, _ := middleware.GetAuthenticatedUser(c)
	filtered := h.applyScopeFilter(actor.ID, rows)
	payload, err := json.MarshalIndent(filtered, "", "  ")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "export failed"})
		return
	}
	h.audit.LogAction(actor.ID, "", "user.export", "users", "user", "", nil, map[string]any{"count": len(filtered)}, c.ClientIP(), c.Request.UserAgent(), "high")
	c.Header("Content-Disposition", "attachment; filename=admin-users.json")
	c.Data(http.StatusOK, "application/json", payload)
}

func (h *AdminUsersHandler) Get(c *gin.Context) {
	userID := c.Param("id")
	row, err := h.svc.GetAdminUser(userID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "user not found"})
		return
	}
	actor, _ := middleware.GetAuthenticatedUser(c)
	if !h.canAccessUser(actor.ID, row) {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "error": "forbidden by scope"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "user": row})
}

func (h *AdminUsersHandler) Update(c *gin.Context) {
	userID := c.Param("id")
	actor, _ := middleware.GetAuthenticatedUser(c)
	current, err := h.svc.GetAdminUser(userID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "user not found"})
		return
	}
	if !h.canAccessUser(actor.ID, current) {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "error": "forbidden by scope"})
		return
	}
	var patch map[string]any
	if err := c.ShouldBindJSON(&patch); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid payload"})
		return
	}
	updated, err := h.svc.UpdateAdminUser(userID, patch)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}
	h.audit.LogAction(actor.ID, userID, "user.update", "users", "user", userID, nil, patch, c.ClientIP(), c.Request.UserAgent(), "high")
	c.JSON(http.StatusOK, gin.H{"success": true, "user": updated})
}

// Sessions is the read-only per-user session/security view. It composes the #19
// session surface (no duplicate routes). Object-level authz: the caller must be
// able to access the target user under the same scope rules as Get. Feature-gated
// behind FEATURE_SESSION_HARDENING_ENABLED → 503 when off.
func (h *AdminUsersHandler) Sessions(c *gin.Context) {
	if h.sessions == nil || !h.sessionsEnabled {
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "error": "feature_disabled", "feature": "session_hardening"})
		return
	}
	userID := c.Param("id")
	target, err := h.svc.GetAdminUser(userID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "user not found"})
		return
	}
	actor, _ := middleware.GetAuthenticatedUser(c)
	if !h.canAccessUser(actor.ID, target) {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "error": "forbidden by scope"})
		return
	}
	list, err := h.sessions.ListMySessions(userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not load sessions"})
		return
	}
	out := make([]gin.H, 0, len(list))
	for _, s := range list {
		out = append(out, gin.H{
			"id": s.ID, "device": s.DeviceFingerprint, "ip": s.IPAddress,
			"userAgent": s.UserAgent, "rotationCounter": s.RotationCounter,
			"lastSeenAt": s.LastSeenAt, "expiresAt": s.ExpiresAt, "createdAt": s.CreatedAt,
		})
	}
	// Read-only view is audited at low severity (security review surface).
	h.audit.LogAction(actor.ID, userID, "user.sessions.view", "users", "user", userID, nil, map[string]any{"sessionCount": len(out)}, c.ClientIP(), c.Request.UserAgent(), "info")
	c.JSON(http.StatusOK, gin.H{"success": true, "sessions": out})
}

// BulkAssignRoles assigns MULTIPLE roles to ONE user in a single call.
// Permission-gated upstream (users.roles.assign). Each item is audited.
func (h *AdminUsersHandler) BulkAssignRoles(c *gin.Context) {
	userID := c.Param("id")
	actor, _ := middleware.GetAuthenticatedUser(c)
	var in struct {
		RoleIDs   []string `json:"roleIds"`
		ScopeType string   `json:"scopeType"`
		ScopeID   string   `json:"scopeId"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || len(in.RoleIDs) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "roleIds is required"})
		return
	}
	// Object-level authz on the target user before mutating grants.
	target, err := h.svc.GetAdminUser(userID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "user not found"})
		return
	}
	if !h.canAccessUser(actor.ID, target) {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "error": "forbidden by scope"})
		return
	}
	results := h.svc.BulkAssignRolesToUser(userID, in.ScopeType, in.ScopeID, actor.ID, in.RoleIDs)
	for _, res := range results {
		if res.Success {
			h.audit.LogAction(actor.ID, userID, "user.role.assign", "rbac", "user_role", userID, nil, map[string]any{"roleId": res.ID, "scopeType": in.ScopeType, "scopeId": in.ScopeID, "bulk": true}, c.ClientIP(), c.Request.UserAgent(), "high")
		}
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "results": results})
}

// BulkAssignRoleToUsers assigns ONE role to MANY users in a single call.
// Permission-gated upstream (users.roles.assign). Each successful item is audited.
func (h *AdminUsersHandler) BulkAssignRoleToUsers(c *gin.Context) {
	actor, _ := middleware.GetAuthenticatedUser(c)
	var in struct {
		RoleID    string   `json:"roleId"`
		UserIDs   []string `json:"userIds"`
		ScopeType string   `json:"scopeType"`
		ScopeID   string   `json:"scopeId"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || strings.TrimSpace(in.RoleID) == "" || len(in.UserIDs) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "roleId and userIds are required"})
		return
	}
	// Object-level authz: drop any target the actor cannot access (deny-by-default).
	allowed := make([]string, 0, len(in.UserIDs))
	for _, uid := range in.UserIDs {
		target, err := h.svc.GetAdminUser(strings.TrimSpace(uid))
		if err != nil {
			continue
		}
		if h.canAccessUser(actor.ID, target) {
			allowed = append(allowed, strings.TrimSpace(uid))
		}
	}
	results := h.svc.BulkAssignRoleToUsers(in.RoleID, in.ScopeType, in.ScopeID, actor.ID, allowed)
	for _, res := range results {
		if res.Success {
			h.audit.LogAction(actor.ID, res.ID, "user.role.assign", "rbac", "user_role", res.ID, nil, map[string]any{"roleId": in.RoleID, "scopeType": in.ScopeType, "scopeId": in.ScopeID, "bulk": true}, c.ClientIP(), c.Request.UserAgent(), "high")
		}
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "results": results})
}

func (h *AdminUsersHandler) applyScopeFilter(actorID string, users []domain.AdminUser) []domain.AdminUser {
	out := make([]domain.AdminUser, 0, len(users))
	for _, u := range users {
		if h.canAccessUser(actorID, u) {
			out = append(out, u)
		}
	}
	return out
}

func (h *AdminUsersHandler) canAccessUser(actorID string, target domain.AdminUser) bool {
	if strings.TrimSpace(actorID) == "" {
		return false
	}
	roles, _ := h.svc.GetUserRoles(actorID)
	for _, r := range roles {
		if r == "super-admin" || r == "system-admin" {
			return true
		}
	}
	scopes, _ := h.svc.GetUserScopes(actorID)
	allowedStates := map[string]struct{}{}
	allowedPrograms := map[string]struct{}{}
	allowedContests := map[string]struct{}{}
	allowedSchools := map[string]struct{}{}
	for _, s := range scopes {
		if s.ScopeType == "state" && strings.TrimSpace(s.ScopeID) != "" {
			allowedStates[strings.ToLower(strings.TrimSpace(s.ScopeID))] = struct{}{}
		}
		if s.ScopeType == "program" && strings.TrimSpace(s.ScopeID) != "" {
			allowedPrograms[strings.ToLower(strings.TrimSpace(s.ScopeID))] = struct{}{}
		}
		if s.ScopeType == "contest" && strings.TrimSpace(s.ScopeID) != "" {
			allowedContests[strings.ToLower(strings.TrimSpace(s.ScopeID))] = struct{}{}
		}
		if s.ScopeType == "school" && strings.TrimSpace(s.ScopeID) != "" {
			allowedSchools[strings.ToLower(strings.TrimSpace(s.ScopeID))] = struct{}{}
		}
	}
	if len(allowedStates) == 0 && len(allowedPrograms) == 0 && len(allowedContests) == 0 && len(allowedSchools) == 0 {
		return true
	}
	if len(allowedStates) > 0 {
		if _, ok := allowedStates[strings.ToLower(strings.TrimSpace(target.State))]; ok {
			return true
		}
	}
	if len(allowedPrograms) > 0 {
		if _, ok := allowedPrograms[strings.ToLower(strings.TrimSpace(target.ProgramID))]; ok {
			return true
		}
	}
	if len(allowedContests) > 0 {
		if _, ok := allowedContests[strings.ToLower(strings.TrimSpace(target.ContestID))]; ok {
			return true
		}
	}
	if len(allowedSchools) > 0 {
		if _, ok := allowedSchools[strings.ToLower(strings.TrimSpace(target.SchoolID))]; ok {
			return true
		}
	}
	return false
}
