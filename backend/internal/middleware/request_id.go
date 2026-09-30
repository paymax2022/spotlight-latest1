package middleware

import (
	"context"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// RequestIDHeader is the correlation header honored on inbound requests and
// echoed on every response.
const RequestIDHeader = "X-Request-Id"

// requestIDKey is the gin context key; requestIDCtxKey is the net/http context
// key — kept unexported so callers go through the typed accessors.
const requestIDKey = "spotlight.request_id"

type requestIDCtxKey struct{}

// RequestID mints or adopts a correlation ID for every request. An inbound
// header is reused only when it is a plausible ID — arbitrary strings are
// replaced rather than propagated into logs (log-injection hygiene).
func RequestID() gin.HandlerFunc {
	return func(c *gin.Context) {
		id := sanitizeRequestID(c.GetHeader(RequestIDHeader))
		if id == "" {
			id = uuid.NewString()
		}
		c.Set(requestIDKey, id)
		c.Request = c.Request.WithContext(context.WithValue(c.Request.Context(), requestIDCtxKey{}, id))
		c.Header(RequestIDHeader, id)
		c.Next()
	}
}

// GetRequestID returns the ID set by the RequestID middleware, or "".
func GetRequestID(c *gin.Context) string {
	if v, ok := c.Get(requestIDKey); ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

// RequestIDFromContext returns the ID propagated into the request context, or "".
func RequestIDFromContext(ctx context.Context) string {
	if v := ctx.Value(requestIDCtxKey{}); v != nil {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

// sanitizeRequestID accepts UUIDs and similar printable token IDs, rejecting
// anything with control characters/whitespace or longer than 128 bytes.
func sanitizeRequestID(s string) string {
	if len(s) == 0 || len(s) > 128 {
		return ""
	}
	for _, r := range s {
		if r < 0x21 || r > 0x7e {
			return ""
		}
	}
	return s
}
