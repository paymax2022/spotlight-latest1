package realtime

import (
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// heartbeatInterval keeps intermediaries (and the client's reconnect timer) from
// treating an idle stream as dead. SSE comments (":") are ignored by clients.
const heartbeatInterval = 25 * time.Second

// StreamHandler returns a Gin handler that streams SSE events for the authenticated
// user. userIDKey is the gin.Context key set by the auth middleware (e.g. "user_id").
// The handler blocks until the client disconnects (request context cancelled).
//
// Wire it behind an auth middleware so the caller identity is trusted, and behind a
// feature flag. Emits `event: <type>\ndata: <json>\n\n` per push.
func (h *Hub) StreamHandler(userIDKey string) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.GetString(userIDKey)
		if userID == "" {
			c.AbortWithStatus(http.StatusUnauthorized)
			return
		}

		// The response writer must support flushing for streaming to work.
		flusher, ok := c.Writer.(http.Flusher)
		if !ok {
			c.AbortWithStatus(http.StatusInternalServerError)
			return
		}

		ch, unsubscribe := h.Subscribe(userID)
		defer unsubscribe()

		hdr := c.Writer.Header()
		hdr.Set("Content-Type", "text/event-stream")
		hdr.Set("Cache-Control", "no-cache")
		hdr.Set("Connection", "keep-alive")
		hdr.Set("X-Accel-Buffering", "no") // disable proxy (nginx) response buffering
		c.Writer.WriteHeader(http.StatusOK)

		// Open the stream with a comment so the client fires 'open' immediately.
		fmt.Fprint(c.Writer, ": connected\n\n")
		flusher.Flush()

		heartbeat := time.NewTicker(heartbeatInterval)
		defer heartbeat.Stop()

		ctx := c.Request.Context()
		for {
			select {
			case <-ctx.Done():
				return
			case ev, open := <-ch:
				if !open {
					return
				}
				fmt.Fprintf(c.Writer, "event: %s\ndata: %s\n\n", ev.Type, ev.Data)
				flusher.Flush()
			case <-heartbeat.C:
				fmt.Fprint(c.Writer, ": ping\n\n")
				flusher.Flush()
			}
		}
	}
}
