package middleware

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// RequireAdmin protects admin endpoints during transition.
// If ADMIN_API_KEY is set, requests must include x-admin-api-key header with exact match.
// If ADMIN_API_KEY is empty, middleware allows all requests (dev mode).
func RequireAdmin(expectedKey string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if expectedKey == "" {
			c.Next()
			return
		}
		if c.GetHeader("x-admin-api-key") != expectedKey {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"success": false, "error": "unauthorized"})
			return
		}
		c.Next()
	}
}
