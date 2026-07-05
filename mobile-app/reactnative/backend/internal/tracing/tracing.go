// Package tracing provides lightweight, dependency-free request tracing: a Span
// carries a trace id / span id pair, the Middleware starts one span per HTTP
// request, propagates the trace id through context and the X-Trace-Id response
// header, and logs a one-line summary on finish.
//
// Stdlib-only (crypto/rand for ids). It deliberately mirrors the existing
// requestIDMW pattern in the api package — start, inject into context, set a
// response header — so it slots into the same middleware chain.
package tracing

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"log"
	"net/http"
	"strings"
	"time"
)

// Span is a single timed unit of work, identified by a trace id (shared across a
// request) and a span id (unique to this unit).
type Span struct {
	TraceID string
	SpanID  string
	Name    string
	Start   time.Time
}

// New starts a span with a random 16-hex trace id and 8-hex span id.
func New(name string) *Span {
	return &Span{
		TraceID: randHex(16),
		SpanID:  randHex(8),
		Name:    name,
		Start:   time.Now(),
	}
}

// newChild starts a span that inherits an existing trace id but gets a fresh span
// id — used when the request carries an incoming trace id to join.
func newChild(traceID, name string) *Span {
	return &Span{
		TraceID: traceID,
		SpanID:  randHex(8),
		Name:    name,
		Start:   time.Now(),
	}
}

// Finish returns the elapsed time since the span started.
func (s *Span) Finish() time.Duration {
	return time.Since(s.Start)
}

// randHex returns a cryptographically-random hex string of n characters. If the
// system RNG is unavailable it falls back to a timestamp-derived value so the
// caller always gets a non-empty id.
func randHex(n int) string {
	b := make([]byte, n/2)
	if _, err := rand.Read(b); err != nil {
		return hex.EncodeToString([]byte(time.Now().Format("150405.000000")))[:n]
	}
	return hex.EncodeToString(b)
}

// ── Request context ───────────────────────────────────────────────────────────

type ctxKey struct{}

// WithSpan returns a copy of ctx carrying the span.
func WithSpan(ctx context.Context, s *Span) context.Context {
	return context.WithValue(ctx, ctxKey{}, s)
}

// FromContext returns the span stored in ctx, if any.
func FromContext(ctx context.Context) (*Span, bool) {
	s, ok := ctx.Value(ctxKey{}).(*Span)
	return s, ok
}

// ── Middleware ────────────────────────────────────────────────────────────────

// Middleware starts a span per request, reusing an incoming X-Trace-Id (or the
// trace-id field of a W3C traceparent) when present, injects the span into the
// request context, sets the X-Trace-Id response header, and logs a one-line
// summary when the request finishes.
func Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var span *Span
		if incoming := incomingTraceID(r); incoming != "" {
			span = newChild(incoming, r.URL.Path)
		} else {
			span = New(r.URL.Path)
		}

		w.Header().Set("X-Trace-Id", span.TraceID)
		ctx := WithSpan(r.Context(), span)

		defer func() {
			log.Printf("[trace=%s] %s %s %s", span.TraceID, r.Method, r.URL.Path, span.Finish())
		}()
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// incomingTraceID extracts a trace id to continue from request headers, preferring
// an explicit X-Trace-Id and falling back to the trace-id field of a W3C
// traceparent header (version-traceid-spanid-flags).
func incomingTraceID(r *http.Request) string {
	if v := strings.TrimSpace(r.Header.Get("X-Trace-Id")); v != "" {
		return v
	}
	if tp := strings.TrimSpace(r.Header.Get("traceparent")); tp != "" {
		parts := strings.Split(tp, "-")
		if len(parts) >= 2 && parts[1] != "" {
			return parts[1]
		}
	}
	return ""
}
