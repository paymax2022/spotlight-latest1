package app

import "github.com/gin-gonic/gin"

// adminGroupTop5 builds an admin route group for a Top-5 module at the given
// base path, applying the same authenticated-user guard the other admin groups
// use (per-route RBAC permissions are applied inside each module's Register fn).
func adminGroupTop5(r *gin.Engine, basePath string) *gin.RouterGroup {
	g := r.Group(basePath)
	g.Use(requireUserID())
	return g
}
