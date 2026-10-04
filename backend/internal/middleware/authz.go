package middleware

import (
	"errors"
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
// Previously this validated only a client-supplied `X-Admin-Role` header against
// a fixed set of role NAMES — it never verified the caller was actually that
// role, or authenticated at all. A request carrying X-Admin-Role: SuperAdmin (or
// any other listed name) passed with no proof of identity whatsoever. Worse, the
// live admin-console `/overview` endpoint isn't even wired through this
// middleware (see router.go) and was found returning real financial/operational
// data to fully anonymous requests — a separate gate's issue, not this one's,
// but proof the console's authorization story needs a real identity check
// wherever it's applied.
// It does NOT yet enforce per-endpoint permission checks — that's still a future
// phase, same as before. For now, any user holding one of consoleAdminRoleSlugs
// can access any /api/v1/admin/* endpoint gated by this middleware — but now
// that requires a real, verified admin identity instead of an unverified string.
// Future: extend this to check specific permissions per role per endpoint via
// rbac.CheckPermission, the same mechanism /api/admin/* already uses.
func RequireAdminConsoleRole(supabase *integrations.SupabaseRestClient, rbac services.RBACService) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, ok := resolveVerifiedIdentity(c, supabase, rbac)
		if !ok {
			return
		}

		// AUD-PERF-001: reuse the roles the auth middleware already fetched for
		// this request when it's the same identity; nil means that fetch failed
		// upstream, so fall through to the repository call.
		var roles []string
		if au, ok := GetAuthenticatedUser(c); ok && au.ID == userID && au.Roles != nil {
			roles = au.Roles
		} else {
			var err error
			roles, err = rbac.GetUserRoles(userID)
			if err != nil {
				c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
					"error": "could not resolve admin role",
				})
				return
			}
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
		// AUD-AUTH-001: distinguish a real token rejection from an auth-backend
		// outage — the latter is a 503, not a 401.
		if errors.Is(err, integrations.ErrTokenInvalid) {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "invalid token",
			})
		} else {
			c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{
				"error": "authentication service unavailable",
			})
		}
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
	// and "pending" is not one of the blocked statuses below — a swallowed
	// error would let a transient lookup failure through as if the account
	// were merely pending. Fail closed: a status we could not verify is
	// refused, same as every other failure path in this function.
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
// ADR-057 (docs/adr/ADR-057-stem-routes-verified-identity-gate.md): STEM
// routes (router.go's stemRead/stemManage) must NOT sit under adminGroup,
// which requires RequireAdminConsoleRole — a real person holding e.g. only
// 'judge' (and neither 'super-admin' nor 'system-admin') could never reach a
// STEM route at all, no matter what RequireStemRoles decided (see ADR-056
// point 6). consoleAdminRoleSlugs is deliberately narrow because it gates
// unrelated PII-bearing routes (leads, chatbot transcripts, handoffs) that a
// STEM judge has no business seeing. STEM routes use this middleware instead:
// a real verified identity, with the STEM-specific role decision left
// entirely to RequireStemRoles's own allow-list per route.
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

// RequireStemRoles enforces which STEM sub-role an already-verified admin
// must hold for protected admin STEM endpoints. If no roles are configured,
// the middleware allows all requests.
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
// AUTH-020: the caller's STEM sub-role is resolved from rbac.GetUserRoles(userID),
// same as RequireAdminConsoleRole — never from a client-supplied `x-stem-role`
// header, which would be unverified input.
// See ADR-056 (docs/adr/ADR-056-stem-role-real-rbac.md) for the design
// decisions this rests on, and 20270205000000_stem_admin_rbac_roles.sql for
// the public.roles rows
// (operations-manager, school-admin, teacher-coach, mentor, sponsor) this
// depends on; contest-manager, judge, super-admin and system-admin already
// existed (20260527100000_enterprise_auth_rbac.sql). Per ADR-057, STEM-specific
// roles are reachable by someone who holds only one of them, not just by
// platform admins who also qualify via the ADMIN/SUPER_ADMIN alias.
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

		// AUD-PERF-001: reuse roles already resolved by the auth middleware for
		// the same identity; nil means the upstream fetch failed → fall back to
		// the repository call.
		var roles []string
		if au, ok := GetAuthenticatedUser(c); ok && au.ID == adminUserID && au.Roles != nil {
			roles = au.Roles
		} else {
			var err error
			roles, err = rbac.GetUserRoles(adminUserID)
			if err != nil {
				c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
					"success": false,
					"error":   "could not resolve stem role",
				})
				return
			}
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

// AllStemRoleNames is the full set of STEM role names RequireStemRoles is
// ever configured to check against — the union of every stemRead/stemManage
// allow-list in router.go. Exported so router.go's broadest group (stemRead)
// can pass this instead of repeating the list literally, and so
// ResolveStemRoleNames below can filter its output to real STEM roles only.
// Keep this in sync with router.go if a new STEM role is ever introduced —
// there is deliberately only one place that needs to change.
var AllStemRoleNames = []string{
	"SUPER_ADMIN",
	"ADMIN",
	"OPERATIONS_MANAGER",
	"CONTEST_MANAGER",
	"SCHOOL_ADMIN",
	"TEACHER_COACH",
	"JUDGE",
	"MENTOR",
	"SPONSOR",
}

// ResolveStemRoleNames maps a user's real RBAC role slugs (as returned by
// rbac.GetUserRoles) to the STEM role name(s) router.go's allow-lists use
// (e.g. "JUDGE", "CONTEST_MANAGER"), using the exact same rule
// RequireStemRoles itself checks against — exported so a "what STEM role do
// I have" endpoint (StemHandler.MyRole) can report the same answer
// RequireStemRoles would compute for this user, without duplicating or
// drifting from the mapping.
// normalizeStemRoleSlug is a MECHANICAL conversion — it has no notion of
// which resulting names are actually meaningful STEM roles, so a slug like
// 'registered-user' converts to "REGISTERED_USER" just as readily as
// 'judge' converts to "JUDGE". Filtered against AllStemRoleNames here so the
// answer only ever contains roles someone could actually be granted STEM
// access through. Order is deterministic (input order, first occurrence);
// duplicates are removed.
func ResolveStemRoleNames(roleSlugs []string) []string {
	recognized := make(map[string]struct{}, len(AllStemRoleNames))
	for _, n := range AllStemRoleNames {
		recognized[n] = struct{}{}
	}

	seen := map[string]struct{}{}
	out := make([]string, 0, len(roleSlugs))
	for _, slug := range roleSlugs {
		for _, name := range normalizeStemRoleSlug(slug) {
			if _, ok := recognized[name]; !ok {
				continue
			}
			if _, ok := seen[name]; ok {
				continue
			}
			seen[name] = struct{}{}
			out = append(out, name)
		}
	}
	return out
}
