package app

import (
	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/config"
	"spotlight/backend/internal/telemetry/navigation"
)

// RegisterNavTelemetryRoutes mounts POST /api/v1/telemetry/navigation, only
// when FEATURE_NAV_TELEMETRY_ENABLED. Auth runs first, then the rate limit.
func RegisterNavTelemetryRoutes(r *gin.Engine, cfg config.Config, repo *navigation.Repository, authMW, limitMW gin.HandlerFunc) {
	if !cfg.FeatureNavTelemetryEnabled || repo == nil {
		return
	}
	r.POST("/api/v1/telemetry/navigation", authMW, limitMW, navigation.NewHandler(repo).Ingest)
}
