package middleware

import (
	"errors"
	"net/http"
	"strings"
	"sync"

	"github.com/gin-gonic/gin"
	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/integrations"
	"spotlight/backend/internal/services"
)

const (
	AuthUserContextKey  = "authUser"
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
			// AUD-AUTH-001: only a definitive rejection means a bad token. A
			// transport error/5xx means the auth backend is down — answer 503 so
			// clients don't treat a Supabase/Kong blip as session expiry.
			if errors.Is(err, integrations.ErrTokenInvalid) {
				c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"success": false, "error": "invalid token"})
			} else {
				c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{"success": false, "error": "authentication service unavailable"})
			}
			return
		}
		id, _ := info["id"].(string)
		email, _ := info["email"].(string)
		if id == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"success": false, "error": "invalid token subject"})
			return
		}
		// AUD-PERF-001: the four lookups below are mutually independent — all
		// derive only from the verified token identity — so they run
		// concurrently, cutting ~3 sequential Supabase RTTs to ~1. The checks
		// afterwards run in the same order and with the same status codes as
		// before; rejected requests simply pay for fetches they no longer need.
		var (
			status  string
			serr    error
			roles   []string
			perms   []string
			sessErr error
		)
		var wg sync.WaitGroup
		wg.Add(3)
		go func() {
			defer wg.Done()
			status, serr = rbac.GetUserStatus(id)
		}()
		go func() {
			defer wg.Done()
			roles, _ = rbac.GetUserRoles(id)
		}()
		go func() {
			defer wg.Done()
			perms, _ = rbac.GetUserPermissions(id, "global", "")
		}()
		if enforce && sessions != nil {
			wg.Add(1)
			go func() {
				defer wg.Done()
				_, sessErr = sessions.ValidateAccess(token)
			}()
		}
		wg.Wait()

		// Fail closed on a lookup ERROR: GetUserStatus returns ("pending", err)
		// when PostgREST/Supabase is unreachable, and treating that as an allowed
		// status let suspended/locked accounts through for the whole outage.
		// A missing row still resolves to ("pending", nil) and is allowed —
		// pending is a real status, not an error signal. Same pattern as the
		// admin-console gate (admin_console_rbac.go resolveVerifiedIdentity).
		if serr != nil {
			c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{"success": false, "error": "account status check unavailable"})
			return
		}
		if status == "suspended" || status == "locked" || status == "deleted" {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"success": false, "error": "account restricted"})
			return
		}
		// Session revocation enforcement (fail-closed when enabled).
		if enforce && sessions != nil && sessErr != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"success": false, "error": "session revoked"})
			return
		}
		au := domain.AuthenticatedUser{ID: id, Email: email, Status: status, Roles: roles, Permissions: perms}
		c.Set(AuthUserContextKey, au)
		c.Set(AuthTokenContextKey, token)
		// Mirror the authenticated user's id/email into the plain string context keys
		// that downstream module middleware (requireUserID) and handlers read. This is
		// set HERE — before c.Next() — because RequireAuthContext advances the chain
		// itself; module wrappers that mirror user_id AFTER calling this handler do so
		// too late (the downstream handler has already run). Setting it centrally makes
		// the codebase-wide "user_id set by RequireAuthContext" assumption actually true.
		c.Set("user_id", id)
		c.Set("user_email", email)
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
