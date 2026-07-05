package tracing

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestNew_DistinctNonEmptyIDs(t *testing.T) {
	a := New("op")
	b := New("op")

	if a.TraceID == "" || a.SpanID == "" {
		t.Fatalf("ids empty: trace=%q span=%q", a.TraceID, a.SpanID)
	}
	if len(a.TraceID) != 16 || len(a.SpanID) != 8 {
		t.Fatalf("id lengths: trace=%d span=%d (want 16/8)", len(a.TraceID), len(a.SpanID))
	}
	if a.TraceID == b.TraceID {
		t.Fatalf("two New() spans share trace id %q", a.TraceID)
	}
	if a.SpanID == b.SpanID {
		t.Fatalf("two New() spans share span id %q", a.SpanID)
	}
}

func TestMiddleware_SetsTraceHeaderAndContext(t *testing.T) {
	var seenInContext string
	h := Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s, ok := FromContext(r.Context()); ok {
			seenInContext = s.TraceID
		}
		w.WriteHeader(http.StatusOK)
	}))

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/portfolio", nil)
	h.ServeHTTP(rec, req)

	got := rec.Header().Get("X-Trace-Id")
	if got == "" {
		t.Fatal("X-Trace-Id response header not set")
	}
	if seenInContext != got {
		t.Fatalf("context trace id %q != response header %q", seenInContext, got)
	}
}

func TestMiddleware_PropagatesIncomingTraceID(t *testing.T) {
	const incoming = "abcdef0123456789"
	h := Middleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("X-Trace-Id", incoming)
	h.ServeHTTP(rec, req)

	if got := rec.Header().Get("X-Trace-Id"); got != incoming {
		t.Fatalf("X-Trace-Id = %q, want propagated %q", got, incoming)
	}
}

func TestMiddleware_PropagatesTraceparent(t *testing.T) {
	const traceID = "0af7651916cd43dd8448eb211c80319c"
	tp := "00-" + traceID + "-b7ad6b7169203331-01"
	h := Middleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("traceparent", tp)
	h.ServeHTTP(rec, req)

	if got := rec.Header().Get("X-Trace-Id"); got != traceID {
		t.Fatalf("X-Trace-Id = %q, want traceparent trace-id %q", got, traceID)
	}
}
