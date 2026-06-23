package middleware

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"spotlight/backend/internal/services"
)

func RequirePermission(rbac services.RBACService, permission string) gin.HandlerFunc {
	return func(c *gin.Context) {
		u, ok := GetAuthenticatedUser(c)
		if !ok {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"success": false, "error": "unauthenticated"})
			return
		}
		allowed, err := rbac.CheckPermission(u.ID, permission, "global", "")
		if err != nil || !allowed {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"success": false, "error": "forbidden"})
			return
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
