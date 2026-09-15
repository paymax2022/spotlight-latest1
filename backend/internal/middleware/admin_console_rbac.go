package middleware

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"spotlight/backend/internal/integrations"
	"spotlight/backend/internal/services"
)

// AdminRole is an admin console role that gates which endpoints they can access.
type AdminRole string

const (
	RoleSuperAdmin      AdminRole = "SuperAdmin"
	RoleComplianceAdmin AdminRole = "ComplianceAdmin"
	RoleTradingOpsAdmin AdminRole = "TradingOpsAdmin"
	RoleProductAdmin    AdminRole = "ProductAdmin"
	RoleFinanceAdmin    AdminRole = "FinanceAdmin"
	RoleSupportAdmin    AdminRole = "SupportAdmin"
	RoleRiskAdmin       AdminRole = "RiskAdmin"
	RoleContentAdmin    AdminRole = "ContentAdmin"
)

// consoleAdminRoleSlugs are the real, RBAC-backed role slugs (public.roles.slug,
// seeded in 20260527100000_enterprise_auth_rbac.sql) that this console treats as
// admin-eligible. "super-admin" is the same slug public.user_has_permission()
// special-cases for unrestricted access; "system-admin" is the general platform
// admin role. Anyone holding neither is refused, regardless of what they claim
// via a client-supplied header.
var consoleAdminRoleSlugs = map[string]bool{
	"super-admin":  true,
	"system-admin": true,
}

// RequireAdminConsoleRole authenticates the caller with the same real,
// cryptographically-verified bearer-token flow as RequireAuthContext (resolves
// the user via Supabase, never trusts a client-supplied string), then checks the
// authenticated user's REAL RBAC roles against consoleAdminRoleSlugs.
//
// Previously this validated only a client-supplied `X-Admin-Role` header against
// a fixed set of role NAMES — it never verified the caller was actually that
// role, or authenticated at all. A request carrying X-Admin-Role: SuperAdmin (or
// any other listed name) passed with no proof of identity whatsoever. Worse, the
// live admin-console `/overview` endpoint isn't even wired through this
// middleware (see router.go) and was found returning real financial/operational
// data to fully anonymous requests — a separate gate's issue, not this one's,
// but proof the console's authorization story needs a real identity check
// wherever it's applied.
//
// It does NOT yet enforce per-endpoint permission checks — that's still a future
// phase, same as before. For now, any user holding one of consoleAdminRoleSlugs
// can access any /api/v1/admin/* endpoint gated by this middleware — but now
// that requires a real, verified admin identity instead of an unverified string.
//
// Future: extend this to check specific permissions per role per endpoint via
// rbac.CheckPermission, the same mechanism /api/admin/* already uses.
func RequireAdminConsoleRole(supabase *integrations.SupabaseRestClient, rbac services.RBACService) gin.HandlerFunc {
	return func(c *gin.Context) {
		h := strings.TrimSpace(c.GetHeader("Authorization"))
		if !strings.HasPrefix(strings.ToLower(h), "bearer ") {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "missing bearer token",
			})
			return
		}
		token := strings.TrimSpace(h[7:])
		info, err := supabase.AuthUser(token)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "invalid token",
			})
			return
		}
		userID, _ := info["id"].(string)
		if userID == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "invalid token subject",
			})
			return
		}

		status, _ := rbac.GetUserStatus(userID)
		if status == "suspended" || status == "locked" || status == "deleted" {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"error": "account restricted",
			})
			return
		}

		roles, err := rbac.GetUserRoles(userID)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"error": "could not resolve admin role",
			})
			return
		}

		resolvedRole := ""
		for _, slug := range roles {
			if consoleAdminRoleSlugs[strings.ToLower(strings.TrimSpace(slug))] {
				resolvedRole = slug
				break
			}
		}
		if resolvedRole == "" {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"error": "not an admin console role",
			})
			return
		}

		// The role is now the REAL, RBAC-resolved role — not the caller-supplied
		// X-Admin-Role header, which is no longer trusted for authorization and is
		// at most a UI hint the client sends for its own display purposes.
		c.Set("adminRole", resolvedRole)
		c.Set("adminUserID", userID)
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
