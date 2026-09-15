package middleware

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// RequireStemRoles enforces a STEM sub-role header for protected admin STEM
// endpoints. If no roles are configured, middleware allows all requests.
//
// AUTH-020: the `x-stem-role` header is client-supplied and NOT independently
// verified against any real RBAC role — the RBAC model has no OPERATIONS_MANAGER,
// CONTEST_MANAGER, SCHOOL_ADMIN, TEACHER_COACH, JUDGE, MENTOR, or SPONSOR role
// today (see public.roles / 20260527100000_enterprise_auth_rbac.sql and the
// module-specific *_rbac.sql migrations for the pattern a real one would follow).
// Trusting it as sole proof of identity would be the same anti-pattern
// RequireAdminConsoleRole (admin_console_rbac.go) was rewritten to eliminate.
//
// It is NOT sole proof of identity here: this middleware refuses to run at all
// unless a real, cryptographically-verified admin identity already exists on the
// request context — i.e. RequireAdminConsoleRole (or an equivalent real-auth
// middleware) has already run and set "adminUserID". In the live router
// (router.go), stemRead/stemManage are sub-groups of adminGroup, which requires
// RequireAdminConsoleRole before this middleware ever runs, so only a caller
// holding a real "super-admin" or "system-admin" RBAC role can reach this check
// at all; the header then only narrows what that already-trusted caller claims
// to be doing, never grants access to someone unauthenticated. This check makes
// that a structural guarantee instead of an assumption about router wiring: if
// this middleware is ever mounted somewhere that skips real auth, it now fails
// closed instead of silently trusting the header as if it were an identity.
//
// Follow-up (deferred, not done here — needs a new additive migration + RBAC
// role/permission seed, out of this fix's scope): give STEM staff real,
// individually-assigned RBAC roles (OPERATIONS_MANAGER, CONTEST_MANAGER,
// SCHOOL_ADMIN, TEACHER_COACH, JUDGE, MENTOR, SPONSOR) the way
// 20260919000200_restaurant_admin_rbac.sql and 20261231000000_connect_contests_admin_rbac.sql
// did for their modules, then replace the header check below with a real
// rbac.GetUserRoles(userID) lookup, same as RequireAdminConsoleRole does today.
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
		// Fail closed: this is a coarse, additive narrowing on top of real auth,
		// never a substitute for it. If nothing upstream established a real
		// admin identity (see doc comment above), refuse rather than fall back
		// to trusting the client-supplied header on its own.
		if _, ok := c.Get("adminUserID"); !ok {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"success": false,
				"error":   "stem role check requires a verified admin session",
			})
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
