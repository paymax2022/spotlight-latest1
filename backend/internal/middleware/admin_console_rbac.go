package middleware

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// AdminRole is an admin console role that gates which endpoints they can access.
type AdminRole string

const (
	RoleSuperAdmin       AdminRole = "SuperAdmin"
	RoleComplianceAdmin  AdminRole = "ComplianceAdmin"
	RoleTradingOpsAdmin  AdminRole = "TradingOpsAdmin"
	RoleProductAdmin     AdminRole = "ProductAdmin"
	RoleFinanceAdmin     AdminRole = "FinanceAdmin"
	RoleSupportAdmin     AdminRole = "SupportAdmin"
	RoleRiskAdmin        AdminRole = "RiskAdmin"
	RoleContentAdmin     AdminRole = "ContentAdmin"
)

// RequireAdminConsoleRole validates that the X-Admin-Role header is present and valid.
// It does NOT yet enforce per-endpoint permission checks — that's a future phase.
// For now, any valid role can access any /api/v1/admin/* endpoint.
//
// Future: extend this to check specific permissions per role per endpoint.
func RequireAdminConsoleRole() gin.HandlerFunc {
	return func(c *gin.Context) {
		role := c.GetHeader("X-Admin-Role")
		if role == "" {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error": "missing X-Admin-Role header",
			})
			c.Abort()
			return
		}

		// Validate that the role is one of the known roles.
		validRoles := map[string]bool{
			string(RoleSuperAdmin):      true,
			string(RoleComplianceAdmin): true,
			string(RoleTradingOpsAdmin): true,
			string(RoleProductAdmin):    true,
			string(RoleFinanceAdmin):    true,
			string(RoleSupportAdmin):    true,
			string(RoleRiskAdmin):       true,
			string(RoleContentAdmin):    true,
		}

		if !validRoles[role] {
			c.JSON(http.StatusForbidden, gin.H{
				"error": "invalid admin role",
			})
			c.Abort()
			return
		}

		// TODO: In a future phase, check specific permissions for the endpoint.
		// For now, store the role in the context for audit logging.
		c.Set("adminRole", role)
		c.Next()
	}
}

// RequireAdminConsolePermission is a future helper that will check specific permissions.
// For now, it's a stub. After we build the permissions system, this will verify
// that the role has the required permission before allowing the endpoint to proceed.
func RequireAdminConsolePermission(permission string) gin.HandlerFunc {
	return func(c *gin.Context) {
		// TODO: Query the role's permissions from the RBAC table, check if they have this permission.
		// For now, just allow all valid roles through (they already passed RequireAdminConsoleRole).
		c.Next()
	}
}

// AdminRoleFromContext extracts the admin role from the request context.
// Returns empty string if not set (should not happen if RequireAdminConsoleRole middleware ran).
func AdminRoleFromContext(c *gin.Context) string {
	role, ok := c.Get("adminRole")
	if !ok {
		return ""
	}
	return role.(string)
}
