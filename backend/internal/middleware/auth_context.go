package middleware

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/integrations"
	"spotlight/backend/internal/services"
)

const (
	AuthUserContextKey = "authUser"
	AuthTokenContextKey = "authToken"
)

func RequireAuthContext(supabase *integrations.SupabaseRestClient, rbac services.RBACService) gin.HandlerFunc {
	return requireAuth(supabase, rbac, nil, false)
}

// RequireAuthContextWithSessions is RequireAuthContext plus an auth_session
// revocation check. When enforce is true (feature flag ON) a request whose
// access token maps to a revoked/expired session is rejected 401 — fail-closed.
// When enforce is false it behaves exactly like RequireAuthContext (no-op check)
// so the flag-off path preserves existing behaviour.
func RequireAuthContextWithSessions(supabase *integrations.SupabaseRestClient, rbac services.RBACService, sessions services.SessionService, enforce bool) gin.HandlerFunc {
	return requireAuth(supabase, rbac, sessions, enforce)
}

func requireAuth(supabase *integrations.SupabaseRestClient, rbac services.RBACService, sessions services.SessionService, enforce bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		h := strings.TrimSpace(c.GetHeader("Authorization"))
		if !strings.HasPrefix(strings.ToLower(h), "bearer ") {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"success": false, "error": "missing bearer token"})
			return
		}
		token := strings.TrimSpace(h[7:])
		info, err := supabase.AuthUser(token)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"success": false, "error": "invalid token"})
			return
		}
		id, _ := info["id"].(string)
		email, _ := info["email"].(string)
		if id == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"success": false, "error": "invalid token subject"})
			return
		}
		status, _ := rbac.GetUserStatus(id)
		if status == "suspended" || status == "locked" || status == "deleted" {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"success": false, "error": "account restricted"})
			return
		}
		// Session revocation enforcement (fail-closed when enabled).
		if enforce && sessions != nil {
			if _, serr := sessions.ValidateAccess(token); serr != nil {
				c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"success": false, "error": "session revoked"})
				return
			}
		}
		roles, _ := rbac.GetUserRoles(id)
		perms, _ := rbac.GetUserPermissions(id, "global", "")
		au := domain.AuthenticatedUser{ID: id, Email: email, Status: status, Roles: roles, Permissions: perms}
		c.Set(AuthUserContextKey, au)
		c.Set(AuthTokenContextKey, token)
		c.Next()
	}
}

func GetAuthenticatedUser(c *gin.Context) (domain.AuthenticatedUser, bool) {
	v, ok := c.Get(AuthUserContextKey)
	if !ok {
		return domain.AuthenticatedUser{}, false
	}
	u, ok := v.(domain.AuthenticatedUser)
	return u, ok
}
