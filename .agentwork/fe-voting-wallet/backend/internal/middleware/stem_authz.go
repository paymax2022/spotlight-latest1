package middleware

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// RequireStemRoles enforces a STEM role header for protected admin STEM endpoints.
// If no roles are configured, middleware allows all requests.
func RequireStemRoles(allowedRoles ...string) gin.HandlerFunc {
	allowed := map[string]struct{}{}
	for _, role := range allowedRoles {
		r := strings.ToUpper(strings.TrimSpace(role))
		if r != "" {
			allowed[r] = struct{}{}
		}
	}

	return func(c *gin.Context) {
		if len(allowed) == 0 {
			c.Next()
			return
		}
		role := strings.ToUpper(strings.TrimSpace(c.GetHeader("x-stem-role")))
		if role == "" {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"success": false, "error": "missing stem role"})
			return
		}
		if _, ok := allowed[role]; !ok {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"success": false, "error": "insufficient stem role"})
			return
		}
		c.Next()
	}
}

