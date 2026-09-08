package modules

import (
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// Register mounts the module registry.
//
//	public: GET /api/v1/modules/visibility        — UNAUTHENTICATED
//	admin:  GET/PATCH /api/v1/admin/modules/...   — platform.modules.{read,manage}
//
// `admin` is a route group the caller has already put behind authentication.
func Register(public, admin *gin.RouterGroup, db *pgxpool.Pool, rbac services.RBACService, env Environment, flag FlagLookup) {
	h := NewHandler(NewService(db, env, flag))

	// Deliberately UNAUTHENTICATED. The response is the set of modules already
	// visible in this tier's UI — the same information anyone gets by opening the
	// app — so it is not a disclosure. It never includes unpublished modules, and
	// never another tier's state.
	//
	// Requiring auth here broke the callers rather than protecting anything: the
	// web helper fetches server-to-server with no user token, so it always got 401,
	// fell back to "unknown" and rendered everything; and a logged-out mobile user
	// got the same. A gate that silently fails open for its main callers is worse
	// than no gate, because it looks like it is working.
	public.GET("/modules/visibility", h.Visibility)

	// Reading the registry exposes unreleased work, so it is permissioned too —
	// not just the writes.
	mods := admin.Group("/modules")
	mods.GET("", middleware.RequirePermission(rbac, "platform.modules.read"), h.List)
	mods.GET("/:key/history", middleware.RequirePermission(rbac, "platform.modules.read"), h.History)

	// Per-user grants. Same permission as the rest of the registry: deciding who may
	// use an unreleased module is the same class of act as publishing it.
	//
	// These control MODULE ACCESS ONLY — never money. A granted Tier 0 user can open
	// the module and still cannot transact, because finance/tiers remains the sole
	// authority on wallet debits and never reads these rows.
	mods.GET("/users/:userId/grants", middleware.RequirePermission(rbac, "platform.modules.read"), h.ListUserGrants)
	mods.POST("/users/:userId/grants", middleware.RequirePermission(rbac, "platform.modules.manage"), h.GrantUserModule)
	mods.DELETE("/users/:userId/grants/:moduleKey", middleware.RequirePermission(rbac, "platform.modules.manage"), h.RevokeUserModule)

	// Writes change what every user of an environment sees.
	mods.PATCH("/:key/visibility", middleware.RequirePermission(rbac, "platform.modules.manage"), h.SetVisibility)
	mods.PATCH("/:key/lifecycle", middleware.RequirePermission(rbac, "platform.modules.manage"), h.SetLifecycle)
}
