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
		userID, ok := resolveVerifiedIdentity(c, supabase, rbac)
		if !ok {
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
		c.Next()
	}
}

// resolveVerifiedIdentity validates the bearer token against Supabase and
// checks the account isn't suspended/locked/deleted, exactly as
// RequireAdminConsoleRole always has. On success it sets "adminUserID" on the
// context (so it is set identically regardless of which caller below
// resolved it) and returns (userID, true); on failure it has already written
// the abort response and the caller must return immediately without doing
// anything further.
//
// Split out (ADR-057) so RequireVerifiedIdentity below can share this
// identity check without also hard-requiring consoleAdminRoleSlugs — see that
// function's doc comment for why a real, distinct set of callers needs
// exactly that.
func resolveVerifiedIdentity(c *gin.Context, supabase *integrations.SupabaseRestClient, rbac services.RBACService) (string, bool) {
	h := strings.TrimSpace(c.GetHeader("Authorization"))
	if !strings.HasPrefix(strings.ToLower(h), "bearer ") {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
			"error": "missing bearer token",
		})
		return "", false
	}
	token := strings.TrimSpace(h[7:])
	info, err := supabase.AuthUser(token)
	if err != nil {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
			"error": "invalid token",
		})
		return "", false
	}
	userID, _ := info["id"].(string)
	if userID == "" {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
			"error": "invalid token subject",
		})
		return "", false
	}

	// AUTH-012: GetUserStatus returns ("pending", err) on a lookup failure,
	// and "pending" is not one of the blocked statuses below — so a
	// swallowed error here used to let a transient lookup failure through
	// this specific check as if the account were merely pending. Fail
	// closed instead: a status we could not verify is refused, same as
	// every other failure path in this function.
	status, serr := rbac.GetUserStatus(userID)
	if serr != nil {
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
			"error": "could not verify account status",
		})
		return "", false
	}
	if status == "suspended" || status == "locked" || status == "deleted" {
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
			"error": "account restricted",
		})
		return "", false
	}

	c.Set("adminUserID", userID)
	return userID, true
}

// RequireVerifiedIdentity authenticates the caller with the same real,
// cryptographically-verified bearer-token flow as RequireAdminConsoleRole
// (resolves the user via Supabase, checks the account isn't
// suspended/locked/deleted) and sets "adminUserID" on the context — but,
// unlike RequireAdminConsoleRole, does NOT additionally require the caller
// hold a consoleAdminRoleSlugs role (super-admin/system-admin).
//
// ADR-057 (docs/adr/ADR-057-stem-routes-verified-identity-gate.md): STEM
// routes (router.go's stemRead/stemManage) used to be sub-groups of
// adminGroup, which requires RequireAdminConsoleRole — so a real person
// holding e.g. only 'judge' (and neither 'super-admin' nor 'system-admin')
// could never reach a STEM route at all, no matter what RequireStemRoles
// decided (see ADR-056 point 6). consoleAdminRoleSlugs is deliberately narrow
// because it gates unrelated PII-bearing routes (leads, chatbot transcripts,
// handoffs) that a STEM judge has no business seeing. STEM routes now use
// this middleware instead: a real verified identity, with the STEM-specific
// role decision left entirely to RequireStemRoles's own allow-list per route.
func RequireVerifiedIdentity(supabase *integrations.SupabaseRestClient, rbac services.RBACService) gin.HandlerFunc {
	return func(c *gin.Context) {
		if _, ok := resolveVerifiedIdentity(c, supabase, rbac); ok {
			c.Next()
		}
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
