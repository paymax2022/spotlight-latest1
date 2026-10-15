package app

import (
	"context"
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/config"
	"spotlight/backend/internal/integrations/livekit"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// registerLiveKit builds the LiveKit client from config and mounts its two HTTP surfaces:
//
//   - POST /api/v1/webhooks/livekit: LiveKit's signed event callback. It is reachable without
//     user auth by design; the signature (a JWT over the body hash, signed with the API secret)
//     is the only gate, and anything unsigned or altered is 401.
//   - GET /api/v1/admin/rtc/livekit: reachability and open-room count, for operators.
//
// It returns nil, and mounts nothing, when the flag is off or the configuration is unusable. A
// bad configuration is logged loudly and fails CLOSED: live rooms then fall back to the
// previous provider rather than minting tokens a server would reject.
func registerLiveKit(r *gin.Engine, cfg config.Config, rbac services.RBACService, adminAuth gin.HandlerFunc) *livekit.Client {
	if !cfg.FeatureLiveKitEnabled {
		return nil
	}
	c, err := livekit.NewClient(livekit.Config{
		URL: cfg.LiveKitURL, APIKey: cfg.LiveKitAPIKey, APISecret: cfg.LiveKitAPISecret,
		TokenTTL: time.Duration(cfg.LiveKitTokenTTLSeconds) * time.Second,
	})
	if err != nil {
		log.Printf("[livekit][ALERT] FEATURE_LIVEKIT_ENABLED is on but LiveKit is NOT available: %v", err)
		return nil
	}

	r.POST("/api/v1/webhooks/livekit", c.WebhookHandler(func(_ context.Context, ev livekit.Event) error {
		// Events are recorded for operations; no domain state is changed from here yet.
		log.Printf("[livekit] event=%s room=%s identity=%s id=%s", ev.Type, ev.Room, ev.Identity, ev.ID)
		return nil
	}))

	admin := r.Group("/api/v1/admin/rtc")
	admin.Use(adminAuth, middleware.RequirePermission(rbac, "audit.logs.view"))
	admin.GET("/livekit", func(g *gin.Context) {
		g.JSON(http.StatusOK, gin.H{"success": true, "provider": "livekit", "status": c.Health(g.Request.Context())})
	})

	log.Printf("[livekit] enabled: server %s (webhook /api/v1/webhooks/livekit, status /api/v1/admin/rtc/livekit)", c.Host())
	return c
}
