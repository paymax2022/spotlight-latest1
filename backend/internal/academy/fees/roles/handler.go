package feesroles

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// Handler exposes the EdTech staff role-management surface over Gin. All routes are
// per-school scoped: the actor must hold PermAssignRoles at the school (enforced in the
// service AND, at the router, via middleware.RequireScopedPermission so the check is
// double-gated). The service layer is the fail-closed source of truth.
type Handler struct {
	svc *Service
}

// NewHandler builds the roles handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// uid resolves the authenticated user (RequireAuthContext sets c.Set("user_id", …)).
func uid(c *gin.Context) string {
	if v := c.GetString("user_id"); v != "" {
		return v
	}
	if u, ok := middleware.GetAuthenticatedUser(c); ok {
		return u.ID
	}
	return ""
}

func (h *Handler) requireUser(c *gin.Context) (string, bool) {
	u := uid(c)
	if u == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return "", false
	}
	return u, true
}

// fail maps sentinel errors to stable snake_case codes + HTTP statuses (mirrors edupay).
func (h *Handler) fail(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrUnauthenticated):
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated", "message": err.Error()})
	case errors.Is(err, ErrForbidden):
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden", "message": err.Error()})
	case errors.Is(err, ErrInvalidRole):
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_staff_role", "message": err.Error()})
	case errors.Is(err, ErrMissingSchool):
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing_school_id", "message": err.Error()})
	case errors.Is(err, ErrMissingUser):
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing_user_id", "message": err.Error()})
	case errors.Is(err, ErrRoleNotFound):
		c.JSON(http.StatusConflict, gin.H{"error": "role_not_found", "message": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal", "message": err.Error()})
	}
}

// rbacServiceAdapter bridges the full services.RBACService to the narrow in-package
// RBACGateway, converting []domain.Role → []roleRow. This keeps feesroles decoupled from
// the domain package while REUSING the exact enterprise RBAC service (no parallel authz).
type rbacServiceAdapter struct {
	rbac services.RBACService
}

func (a rbacServiceAdapter) CheckPermission(userID, permission, scopeType, scopeID string) (bool, error) {
	return a.rbac.CheckPermission(userID, permission, scopeType, scopeID)
}
func (a rbacServiceAdapter) AssignRoleToUser(userID, roleID, scopeType, scopeID, assignedBy string) error {
	return a.rbac.AssignRoleToUser(userID, roleID, scopeType, scopeID, assignedBy)
}
func (a rbacServiceAdapter) RemoveRoleFromUser(actorUserID, userID, roleID string) error {
	return a.rbac.RemoveRoleFromUser(actorUserID, userID, roleID)
}
func (a rbacServiceAdapter) ListRoles() ([]roleRow, error) {
	roles, err := a.rbac.ListRoles()
	if err != nil {
		return nil, err
	}
	out := make([]roleRow, 0, len(roles))
	for _, r := range roles {
		out = append(out, roleRow{ID: r.ID, Slug: r.Slug, Name: r.Name})
	}
	return out, nil
}

// RegisterFeesRoles wires the staff-role routes onto the school-scoped admin group. Routes
// are keyed by :schoolId and gated with RequireScopedPermission(PermAssignRoles,'school')
// — the same permission the service enforces, so the check is applied at both layers. nil
// pool / group is skipped. The QA/integration task calls this from RegisterAcademy.
//
//	POST   /schools/:schoolId/staff        assign a staff role   {userId, role}
//	DELETE /schools/:schoolId/staff        revoke a staff role   {userId, role}
//	GET    /schools/:schoolId/staff        list staff + roles
func RegisterFeesRoles(admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService) *Handler {
	if pool == nil || rbac == nil {
		return nil
	}
	svc := NewService(rbacServiceAdapter{rbac: rbac}, NewRepository(pool))
	h := NewHandler(svc)

	if admin != nil {
		g := admin.Group("/schools/:schoolId/staff")
		g.Use(middleware.RequireScopedPermission(rbac, PermAssignRoles, ScopeTypeSchool, "schoolId"))
		g.POST("", h.Assign)
		g.DELETE("", h.Revoke)
		g.GET("", h.List)
	}
	return h
}

// ── Handlers ──────────────────────────────────────────────────────────────────────

func (h *Handler) Assign(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	var req AssignRoleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	if err := h.svc.AssignRole(c.Request.Context(), c.Param("schoolId"), req.UserID, StaffRole(req.Role), u); err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": gin.H{
		"schoolId": c.Param("schoolId"), "userId": req.UserID, "role": req.Role,
	}})
}

func (h *Handler) Revoke(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	var req RevokeRoleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	if err := h.svc.RevokeRole(c.Request.Context(), c.Param("schoolId"), req.UserID, StaffRole(req.Role), u); err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"revoked": true}})
}

func (h *Handler) List(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	out, err := h.svc.ListStaff(c.Request.Context(), c.Param("schoolId"), u)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}
