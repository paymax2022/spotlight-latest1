package embedded

import (
	"github.com/gin-gonic/gin"
)

// Register wires the internal/member embedded-engine routes. The engine is
// primarily driven by Handle() from existing emit points; these routes exist for
// testing + manual triggers.
//
//   - member/internal:
//       POST /embedded/events   (trigger an embedded bind; idempotent on source_event_id)
//       GET  /embedded/events   (list mapped event types)
func Register(member *gin.RouterGroup, h *Handler) {
	g := member.Group("/embedded")
	g.POST("/events", h.Trigger)
	g.GET("/events", h.KnownEvents)
}
