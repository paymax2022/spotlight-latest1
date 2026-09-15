package middleware

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"spotlight/backend/internal/services"
)

// RequireStemRoles enforces which STEM sub-role an already-verified admin
// must hold for protected admin STEM endpoints. If no roles are configured,
// the middleware allows all requests.
//
// It is NOT proof of identity on its own: this middleware refuses to run at
// all unless a real, cryptographically-verified identity already exists on
// the request context — i.e. RequireVerifiedIdentity or RequireAdminConsoleRole
// (or an equivalent real-auth middleware) has already run and set
// "adminUserID". In the live router (router.go), stemRead/stemManage require
// RequireVerifiedIdentity — a real identity check with NO role floor of its
// own (see ADR-057, docs/adr/ADR-057-stem-routes-verified-identity-gate.md) —
// before this middleware ever runs, so the role decision is entirely this
// middleware's. This fails closed instead of assuming router wiring: if this
// middleware is ever mounted somewhere that skips real auth, it refuses
// rather than resolving roles for an unverified caller.
//
// AUTH-020 follow-up: previously the caller's STEM sub-role was read from a
// client-supplied `x-stem-role` header and never independently verified —
// only the outer admin identity was real, the header narrowing it was not.
// This now resolves the caller's REAL roles via rbac.GetUserRoles(userID),
// same as RequireAdminConsoleRole, and compares them against allowedRoles.
// See ADR-056 (docs/adr/ADR-056-stem-role-real-rbac.md) for the design
// decisions this rests on, and 20270205000000_stem_admin_rbac_roles.sql for
// the public.roles rows
// (operations-manager, school-admin, teacher-coach, mentor, sponsor) this
// depends on; contest-manager, judge, super-admin and system-admin already
// existed (20260527100000_enterprise_auth_rbac.sql). ADR-057 closed the
// follow-on gap ADR-056 flagged: those STEM-specific roles are now actually
// reachable by someone who holds only one of them, not just by platform
// admins who also happen to qualify via the ADMIN/SUPER_ADMIN alias.
func RequireStemRoles(rbac services.RBACService, allowedRoles ...string) gin.HandlerFunc {
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
		// admin identity (see doc comment above), refuse outright.
		adminUserIDVal, ok := c.Get("adminUserID")
		if !ok {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"success": false,
				"error":   "stem role check requires a verified admin session",
			})
			return
		}
		adminUserID, _ := adminUserIDVal.(string)
		if adminUserID == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"success": false,
				"error":   "stem role check requires a verified admin session",
			})
			return
		}

		roles, err := rbac.GetUserRoles(adminUserID)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"success": false,
				"error":   "could not resolve stem role",
			})
			return
		}
		if !hasAllowedStemRole(roles, allowed) {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"success": false, "error": "insufficient stem role"})
			return
		}
		c.Next()
	}
}

// hasAllowedStemRole checks the caller's real RBAC role slugs against the
// allow-list of STEM role names (e.g. "CONTEST_MANAGER", "SUPER_ADMIN").
func hasAllowedStemRole(roleSlugs []string, allowed map[string]struct{}) bool {
	for _, slug := range roleSlugs {
		for _, name := range normalizeStemRoleSlug(slug) {
			if _, ok := allowed[name]; ok {
				return true
			}
		}
	}
	return false
}

// normalizeStemRoleSlug converts a public.roles.slug (kebab-case, e.g.
// "contest-manager") into the STEM role name(s) router.go allow-lists
// (UPPER_SNAKE_CASE, e.g. "CONTEST_MANAGER"). This is a straight mechanical
// conversion for every STEM role slug — 'operations-manager' -> OPERATIONS_
// MANAGER, 'judge' -> JUDGE, etc. — except 'system-admin', which is the
// existing general platform-admin role (see admin_console_rbac.go's
// consoleAdminRoleSlugs) and is additionally aliased to "ADMIN", the name
// router.go's STEM allow-lists use for that same concept.
func normalizeStemRoleSlug(slug string) []string {
	norm := strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(slug), "-", "_"))
	if norm == "" {
		return nil
	}
	if slug == "system-admin" {
		return []string{norm, "ADMIN"}
	}
	return []string{norm}
}
