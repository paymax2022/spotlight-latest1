package middleware

import (
	"context"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// RequestIDHeader is the correlation header. CORS already allows it inbound
// and the middleware echoes it outbound, so web/mobile callers can log the
// same ID the backend handled.
const RequestIDHeader = "X-Request-Id"

type requestIDKey struct{}

// RequestID mints or echoes a per-request correlation ID. An inbound
// X-Request-Id is trusted only when it is short and charset-clean — it is
// caller-controlled text that lands in logs, so junk/oversized values are
// replaced rather than propagated.
func RequestID() gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.GetHeader(RequestIDHeader)
		if len(id) == 0 || len(id) > 64 || !cleanRequestID(id) {
			id = uuid.NewString()
		}
		c.Set("request_id", id)
		c.Writer.Header().Set(RequestIDHeader, id)
		c.Request = c.Request.WithContext(context.WithValue(c.Request.Context(), requestIDKey{}, id))
		c.Next()
	}
}

// RequestIDFrom returns the ID stored by the RequestID middleware ("" if it
// did not run) — for handlers/services that want it in log lines or
// downstream calls.
func RequestIDFrom(ctx context.Context) string {
	if id, ok := ctx.Value(requestIDKey{}).(string); ok {
		return id
	}
	return ""
}

func cleanRequestID(s string) bool {
	for _, r := range s {
		if r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '-' || r == '_' || r == '.' {
			continue
		}
		return false
	}
	return true
}
