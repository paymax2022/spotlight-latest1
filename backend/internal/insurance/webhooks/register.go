package webhooks

import (
	"github.com/gin-gonic/gin"
)

// Register wires the UNAUTHENTICATED, signature-verified provider webhook routes.
//
//   - webhooks (no auth; provider-signed; idempotent on (provider, external_event_id)):
//       POST /internal/webhooks/mycover
//       POST /internal/webhooks/octamile
func Register(webhooks *gin.RouterGroup, h *Handler) {
	g := webhooks.Group("/internal/webhooks")
	g.POST("/mycover", h.MyCover)
	g.POST("/octamile", h.Octamile)
}
