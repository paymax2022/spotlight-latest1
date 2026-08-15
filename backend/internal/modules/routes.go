package modules

import (
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// Register mounts the module registry.
//
//	member: GET /api/v1/modules/visibility        — authenticated, any user
//	admin:  GET/PATCH /api/v1/admin/modules/...   — platform.modules.{read,manage}
//
// `member` and `admin` are route groups the caller has already put behind
// authentication, matching how every other module registers.
func Register(member, admin *gin.RouterGroup, db *pgxpool.Pool, rbac services.RBACService, env Environment, flag FlagLookup) {
	h := NewHandler(NewService(db, env, flag))

	// Any signed-in client asks what it may render. No permission required — the
	// answer is scoped to this tier and contains nothing an operator would hide.
	member.GET("/modules/visibility", h.Visibility)

	// Reading the registry exposes unreleased work, so it is permissioned too —
	// not just the writes.
	mods := admin.Group("/modules")
	mods.GET("", middleware.RequirePermission(rbac, "platform.modules.read"), h.List)
	mods.GET("/:key/history", middleware.RequirePermission(rbac, "platform.modules.read"), h.History)

	// Writes change what every user of an environment sees.
	mods.PATCH("/:key/visibility", middleware.RequirePermission(rbac, "platform.modules.manage"), h.SetVisibility)
	mods.PATCH("/:key/lifecycle", middleware.RequirePermission(rbac, "platform.modules.manage"), h.SetLifecycle)
}
