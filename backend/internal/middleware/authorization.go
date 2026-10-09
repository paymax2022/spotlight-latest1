package middleware

import (
	"net/http"
	"slices"

	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/services"

	"github.com/gin-gonic/gin"
)

// hasEffectivePermission mirrors user_has_permission()'s semantics using the
// roles/permissions the auth middleware already resolved for THIS request —
// super-admin passes unconditionally, otherwise the permission must be in the
// effective set (AUD-PERF-001: saves a Supabase RTT on the allow path).
func hasEffectivePermission(u domain.AuthenticatedUser, permission string) bool {
	return slices.Contains(u.Roles, "super-admin") || slices.Contains(u.Permissions, permission)
}

func RequirePermission(rbac services.RBACService, permission string) gin.HandlerFunc {
	return func(c *gin.Context) {
		u, ok := GetAuthenticatedUser(c)
		if !ok {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"success": false, "error": "unauthenticated"})
			return
		}
		// Local hit avoids the extra RTT; a miss falls back to the RPC so a
		// silently-failed permissions fetch upstream can never widen a denial
		// into an outage of every permission-gated route.
		if !hasEffectivePermission(u, permission) {
			allowed, err := rbac.CheckPermission(u.ID, permission, "global", "")
			if err != nil || !allowed {
				c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"success": false, "error": "forbidden"})
				return
			}
		}
		c.Next()
	}
}

func RequireScopedPermission(rbac services.RBACService, permission string, scopeType string, scopeIDParam string) gin.HandlerFunc {
	return func(c *gin.Context) {
		u, ok := GetAuthenticatedUser(c)
		if !ok {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"success": false, "error": "unauthenticated"})
			return
		}
		scopeID := c.Param(scopeIDParam)
		allowed, err := rbac.CheckPermission(u.ID, permission, scopeType, scopeID)
		if err != nil || !allowed {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"success": false, "error": "forbidden"})
			return
		}
		c.Next()
	}
}
