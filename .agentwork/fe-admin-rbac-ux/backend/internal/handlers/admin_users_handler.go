package handlers

import (
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
}

func NewAdminUsersHandler(svc services.RBACService, audit services.AuditService) *AdminUsersHandler {
	return &AdminUsersHandler{svc: svc, audit: audit}
}

func (h *AdminUsersHandler) List(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "100"))
	filter := domain.AdminUserFilter{
		Role: c.Query("role"), UserType: c.Query("userType"), Status: c.Query("status"), State: c.Query("state"), Program: c.Query("program"), Search: c.Query("search"), Limit: limit,
	}
	rows, err := h.svc.ListAdminUsers(filter)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	actor, _ := middleware.GetAuthenticatedUser(c)
	filtered := h.applyScopeFilter(actor.ID, rows)
	c.JSON(http.StatusOK, gin.H{"success": true, "users": filtered})
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
